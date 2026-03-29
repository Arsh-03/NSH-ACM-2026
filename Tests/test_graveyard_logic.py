import requests
import json
import time

BASE_URL = "http://localhost:8000/api"

def test_graveyard_logic_v3():
    print("--- 🧪 Testing Graveyard Orbit Logic (v3 - Visible Position) ---")
    
    # satellite ID should be randomized for each run
    sat_id = f"SAT-EOL-{int(time.time() % 10000)}"

    # Position over Bengaluru (Approximately) to avoid blackout
    pos = {"x": 1500.0, "y": 6500.0, "z": 1500.0}
    vel = {"vx": 0.0, "vy": 0.0, "vz": 7.5}

    # 1. Register Satellite mit normaler Fuel
    payload_normal = {
        "sat_id": sat_id,
        "state": {**pos, **vel},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    }
    r1 = requests.post(f"{BASE_URL}/telemetry", json=payload_normal)
    print(f"Initial: {r1.status_code} | id: {sat_id}")

    # 2. Update with Low Fuel (exactly 2.5kg or less)
    payload_low = {
        "sat_id": sat_id,
        "state": {**pos, **vel},
        "fuel_kg": 2.4, # Just below EOL_FUEL (2.5) but enough for 5m/s burn
        "timestamp": time.time() + 60
    }
    r2 = requests.post(f"{BASE_URL}/telemetry", json=payload_low)
    print(f"Low Fuel Push: {r2.status_code} | eol_flag: {r2.json().get('eol_flag')}")

    # 3. Wait for the auto-pilot to process
    print("Waiting for auto-pilot to detect EOL status...")
    time.sleep(6)

    # 4. Check status in registry
    r3 = requests.get(f"{BASE_URL}/maneuver/registry")
    registry = r3.json()
    sat_info = next((s for s in registry["satellites"] if s["id"] == sat_id), None)
    
    if sat_info:
        print(f"Current Status: {sat_info.get('status')} | Fuel: {sat_info.get('fuel_kg')}kg")
        if sat_info.get("status") == "GRAVEYARD":
            print("✅ Success: Satellite successfully initiated GRAVEYARD maneuver.")
        else:
            print(f"❌ Fail: Status is {sat_info.get('status')}")
    else:
        print("❌ Fail: Satellite disappeared from registry")

if __name__ == "__main__":
    test_graveyard_logic_v3()
