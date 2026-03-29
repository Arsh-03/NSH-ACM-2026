import requests
import json
import time
import numpy as np

BASE_URL = "http://localhost:8000/api"

def test_collision_avoidance_and_recovery():
    print("--- 🛡️ Testing Collision Avoidance & Recovery ---")
    
    sat_id = f"SAT-TEST-{int(time.time() % 10000)}"
    # Base position (ECI)
    sat_pos = {"x": 7000.0, "y": 0.0, "z": 0.0}
    sat_vel = {"vx": 0.0, "vy": 7.5, "vz": 0.0}
    
    # 1. Register Satellite
    print(f"Registering satellite {sat_id}...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, **sat_vel},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    })

    # 2. Simulate Near-Miss Debris
    # WARNING_KM is 50.0 km. Let's place it at 1 km.
    debris_id = "DEBRIS-THREAT"
    debris_pos = {"x": 7001.0, "y": 0.5, "z": 0.0}  # Very close!
    
    print("Injecting close-proximity debris threat...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "timestamp": time.time(),
        "objects": [
            {
                "id": debris_id,
                "type": "DEBRIS",
                "r": debris_pos,
                "v": {"x": 0, "y": 0, "z": 0}
            }
        ]
    })

    # 3. Trigger Maneuver by sending satellite update (to force re-evaluation)
    print("Updating satellite telemetry to trigger avoidance...")
    r_man = requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, **sat_vel},
        "fuel_kg": 50.0,
        "timestamp": time.time() + 1
    })
    
    print(f"Maneuver Status response: {r_man.json().get('status')}")
    
    # 4. Verify Status in Registry
    time.sleep(1)
    r_reg = requests.get(f"{BASE_URL}/maneuver/registry")
    sat_info = next((s for s in r_reg.json()["satellites"] if s["id"] == sat_id), None)
    print(f"Current Status after threat: {sat_info.get('status')}")
    
    if sat_info.get("status") == "MANEUVERING":
        print("✅ Avoidance Maneuver TRIGGERED.")
    else:
        print(f"❌ Avoidance Maneuver NOT triggered (Status: {sat_info.get('status')})")

    # 5. Clear Threat (Move debris far away)
    print("Clearing threat (moving debris 1000km away)...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "timestamp": time.time() + 2,
        "objects": [
            {
                "id": debris_id,
                "type": "DEBRIS",
                "r": {"x": 8000.0, "y": 0, "z": 0},
                "v": {"x": 0, "y": 0, "z": 0}
            }
        ]
    })

    # 6. Check for RECOVERING status
    # Need another satellite update to trigger the check inside ingest_telemetry
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, **sat_vel},
        "fuel_kg": 49.5,
        "timestamp": time.time() + 3
    })
    
    time.sleep(1)
    r_reg2 = requests.get(f"{BASE_URL}/maneuver/registry")
    sat_info2 = next((s for s in r_reg2.json()["satellites"] if s["id"] == sat_id), None)
    print(f"Current Status after clearing threat: {sat_info2.get('status')}")
    
    if sat_info2.get("status") == "RECOVERING":
        print("✅ Recovery Phase INITIATED.")
    else:
        print(f"⚠️  Note: Status is '{sat_info2.get('status')}', expected RECOVERING.")

if __name__ == "__main__":
    test_collision_avoidance_and_recovery()
