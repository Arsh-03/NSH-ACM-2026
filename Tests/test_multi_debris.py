import requests
import json
import time

BASE_URL = "http://localhost:8000/api"

def test_multi_debris_handling():
    print("--- 🛡️ Testing Multi-Debris Conflict Handling ---")
    
    sat_id = f"SAT-MULTI-{int(time.time() % 10000)}"
    sat_pos = {"x": 7000.0, "y": 0.0, "z": 0.0}
    
    # 1. Register Satellite
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, "vx": 0, "vy": 7.5, "vz": 0},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    })

    # 2. Inject TWO Debris objects
    # DEBRIS-A at 2km
    # DEBRIS-B at 5km
    print("Injecting two debris objects (DEBRIS-A @ 2km, DEBRIS-B @ 5km)...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "timestamp": time.time(),
        "objects": [
            {
                "id": "DEBRIS-A",
                "type": "DEBRIS",
                "r": {"x": 7002.0, "y": 0, "z": 0},
                "v": {"x": 0, "y": 0, "z": 0}
            },
            {
                "id": "DEBRIS-B",
                "type": "DEBRIS",
                "r": {"x": 7005.0, "y": 0, "z": 0},
                "v": {"x": 0, "y": 0, "z": 0}
            }
        ]
    })

    # 3. Trigger satellite update
    r = requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, "vx": 0, "vy": 7.5, "vz": 0},
        "fuel_kg": 50.0,
        "timestamp": time.time() + 1
    })
    
    res = r.json()
    closest = res.get("closest_debris")
    dist = res.get("min_dist_km")
    
    print(f"Server Response -> Closest: {closest} | Distance: {dist}km")
    
    if closest == "DEBRIS-A":
        print("✅ Success: System correctly prioritized the closest threat (DEBRIS-A).")
    else:
        print(f"❌ Fail: Expected DEBRIS-A, got {closest}.")

    # 4. Now move DEBRIS-A away and check if it targets DEBRIS-B
    print("Moving DEBRIS-A far away...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "timestamp": time.time() + 2,
        "objects": [
            {
                "id": "DEBRIS-A",
                "type": "DEBRIS",
                "r": {"x": 10000.0, "y": 0, "z": 0},
                "v": {"x": 0, "y": 0, "z": 0}
            }
        ]
    })

    r2 = requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {**sat_pos, "vx": 0, "vy": 7.5, "vz": 0},
        "fuel_kg": 49.9,
        "timestamp": time.time() + 3
    })
    
    res2 = r2.json()
    closest2 = res2.get("closest_debris")
    dist2 = res2.get("min_dist_km")
    
    print(f"New Server Response -> Closest: {closest2} | Distance: {dist2}km")
    
    if closest2 == "DEBRIS-B":
        print("✅ Success: System now targets the next closest threat (DEBRIS-B).")
    else:
        print(f"❌ Fail: Expected DEBRIS-B, got {closest2}.")

if __name__ == "__main__":
    test_multi_debris_handling()
