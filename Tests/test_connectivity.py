import requests
import json
import time
import math

BASE_URL = "http://localhost:8000/api"

def lat_lon_to_eci(lat, lon, alt_km):
    RE = 6378.137
    r = RE + alt_km
    lat_r = math.radians(lat)
    lon_r = math.radians(lon)
    x = r * math.cos(lat_r) * math.cos(lon_r)
    y = r * math.cos(lat_r) * math.sin(lon_r)
    z = r * math.sin(lat_r)
    return {"x": x, "y": y, "z": z}

def test_connectivity():
    print("--- Testing Ground Station Connectivity ---")
    
    # -- 1. Visible Case (Bengaluru) --
    # ISTRAC is at 13.03N, 77.51E
    sat_visible = lat_lon_to_eci(13.03, 77.51, 550)
    print(f"Testing Visible Position: {sat_visible}")
    
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": "SAT-VISIBLE",
        "state": {**sat_visible, "vx": 0, "vy": 7.5, "vz": 0},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    })
    
    payload_sched = {
        "satelliteId": "SAT-VISIBLE",
        "maneuver_sequence": [
            {
                "burn_id": "BURN_1",
                "burnTime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 60)),
                "deltaV_vector": {"x": 0.001, "y": 0.0, "z": 0.0}
            }
        ]
    }
    r1 = requests.post(f"{BASE_URL}/maneuver/schedule", json=payload_sched)
    print(f"Visible Result: {r1.status_code} | LOS OK: {r1.json().get('validation', {}).get('ground_station_los')}")

    # -- 2. Blackout Case (Pacific Ocean) --
    # Middle of Pacific: 0N, 160W
    sat_blackout = lat_lon_to_eci(0.0, -160.0, 550)
    print(f"Testing Blackout Position: {sat_blackout}")
    
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": "SAT-BLACKOUT",
        "state": {**sat_blackout, "vx": 0, "vy": 7.5, "vz": 0},
        "fuel_kg": 50.0,
        "timestamp": time.time()
    })
    
    payload_sched["satelliteId"] = "SAT-BLACKOUT"
    r2 = requests.post(f"{BASE_URL}/maneuver/schedule", json=payload_sched)
    print(f"Blackout Result: {r2.status_code} | LOS OK: {r2.json().get('validation', {}).get('ground_station_los')}")

if __name__ == "__main__":
    test_connectivity()
