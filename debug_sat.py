import requests
import json
import time

BASE_URL = "http://localhost:8000"

def check_sat(sat_id):
    try:
        # We can't query individual registry, but we can check the visualization snapshot
        r = requests.get(f"{BASE_URL}/visualization/snapshot")
        data = r.json()
        sats = data.get("satellites", [])
        target = next((s for s in sats if s["id"] == sat_id), None)
        if target:
            print(f"DEBUG: {sat_id} state: {target}")
        else:
            print(f"DEBUG: {sat_id} not found in snapshot")
            
        # Check counts
        r2 = requests.get(f"{BASE_URL}/telemetry/count")
        print(f"DEBUG: Registry Counts: {r2.json()}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    for _ in range(3):
        check_sat("AETHER-49")
        time.sleep(2)
