"""
Run: python debug_maneuver.py
Tests maneuver endpoint with every possible satellite ID format
"""
import requests, json

BASE = "http://localhost:8000"

# Check what's in registry
print("=== REGISTRY ===")
r = requests.get(f"{BASE}/api/maneuver/registry")
print(json.dumps(r.json(), indent=2))

# Try every possible ID the frontend might send
test_ids = [
    "ACM-AETHER-ARSH",
    "SAT-01-ARSH",
    "AETHER-01",
    "SAT-01",
    "ARSH",
]

print("\n=== MANEUVER TEST ===")
for sat_id in test_ids:
    r = requests.post(f"{BASE}/api/maneuver/execute", json={
        "satellite_id": sat_id,
        "dv_x": 0.001, "dv_y": 0.001, "dv_z": 0.001
    })
    print(f"  {sat_id:<25} → {r.status_code} | {r.json()}")