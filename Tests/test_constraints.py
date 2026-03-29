import requests
import json
import time

BASE_URL = "http://localhost:8000/api"

def test_mission_constraints():
    print("--- ⚔️ Testing Mission Constraints (Cooldown, Latency, Max-DV) ---")
    
    sat_id = f"SAT-CONSTRAINT-{int(time.time() % 10000)}"
    sat_pos = {"x": 7000.0, "y": 7000.0, "z": 0.0}
    
    # 1. Register Satellite
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, "vx": 0, "vy": 0, "vz": 0},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    })

    # 2. Test Max DV Capping
    print("Testing MAX_DV capping (sending 1.0 km/s)...")
    payload_huge = {
        "satellite_id": sat_id,
        "dv_x": 1.0, "dv_y": 0.0, "dv_z": 0.0
    }
    r1 = requests.post(f"{BASE_URL}/maneuver/execute", json=payload_huge)
    res1 = r1.json()
    print(f"Result: {res1.get('status')} | DV Magnitude: {res1.get('dv_magnitude')}")
    if "0.015000" in str(res1.get('dv_magnitude')):
        print("✅ Success: DV correctly capped to 0.015 km/s.")
    else:
        print("❌ Fail: DV was not capped.")

    # 3. Test Thermal Cooldown (600s)
    print("Testing Thermal Cooldown (immediate second burn)...")
    r2 = requests.post(f"{BASE_URL}/maneuver/execute", json=payload_huge)
    if r2.status_code == 429:
        print(f"✅ Success: Second burn REJECTED with 429 ({r2.json().get('detail')})")
    else:
        print(f"❌ Fail: Second burn should have been rejected (Status: {r2.status_code})")

    # 4. Test Latency Constraint (10s for scheduling)
    print("Testing Scheduling Latency (trying to schedule a burn starting in 2 seconds)...")
    payload_fast = {
        "satelliteId": sat_id,
        "maneuver_sequence": [
            {
                "burn_id": "BURN_FAST",
                "burnTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 2)),
                "deltaV_vector": {"x": 0.001, "y": 0.0, "z": 0.0}
            }
        ]
    }
    r3 = requests.post(f"{BASE_URL}/maneuver/schedule", json=payload_fast)
    if r3.status_code == 400:
        print(f"✅ Success: Schedule REJECTED due to latency constraint ({r3.json().get('detail')})")
    else:
        print(f"❌ Fail: Schedule should have been rejected (Status: {r3.status_code})")

if __name__ == "__main__":
    test_mission_constraints()
