import requests
import time
import numpy as np

BASE_URL = "http://localhost:8000/api"

def test_maneuver_physics():
    print("--- 🛰️ Testing Maneuver Physics (Fuel, Velocity, Coordinates) ---")
    
    sat_id = f"SAT-PHYS-{int(time.time() % 10000)}"
    initial_r = [7050.0, 0.0, 0.0]
    initial_v = [0.0, 7.5, 0.0]
    initial_fuel = 50.0
    
    # 1. Register Satellite
    print(f"Registering satellite {sat_id}...")
    requests.post(f"{BASE_URL}/telemetry", json={
        "sat_id": sat_id,
        "state": {"x": initial_r[0], "y": initial_r[1], "z": initial_r[2], 
                  "vx": initial_v[0], "vy": initial_v[1], "vz": initial_v[2]},
        "fuel_kg": initial_fuel,
        "timestamp": time.time()
    })

    # 2. Execute a manual burn
    dv = [0.012, 0.0, 0.0] # 12 m/s burn in X direction
    print(f"Executing burn: Δv = {dv} km/s...")
    burn_res = requests.post(f"{BASE_URL}/maneuver/execute", json={
        "satellite_id": sat_id,
        "dv_x": dv[0], "dv_y": dv[1], "dv_z": dv[2]
    }).json()

    # 3. Verify Velocity & Fuel Change
    print(f"Burn Response: {burn_res}")
    
    # Get state from updated maneuver registry
    registry = requests.get(f"{BASE_URL}/maneuver/registry").json()
    sat_data = next((s for s in registry["satellites"] if s["id"] == sat_id), None)
    
    if not sat_data:
        print(f"❌ Could not find satellite {sat_id} in registry!")
        return

    v_after_burn = sat_data["v"]
    fuel_after_burn = sat_data["fuel_kg"]
    
    expected_v = [initial_v[0] + dv[0], initial_v[1] + dv[1], initial_v[2] + dv[2]]
    
    # Check V (registry rounds v values and fuel_kg, check tolerance)
    if np.allclose(v_after_burn, expected_v, atol=1e-3):
        print(f"✅ Velocity correctly updated: {v_after_burn} km/s")
    else:
        print(f"❌ Velocity mismatch! Got {v_after_burn}, expected {expected_v}")

    # Check Fuel
    if fuel_after_burn < initial_fuel:
        print(f"✅ Fuel correctly consumed: {initial_fuel} -> {fuel_after_burn} kg")
    else:
        print(f"❌ Fuel NOT consumed!")

    # 4. Verify Coordinate Change via Simulation Step
    r_before_sim = sat_data["r"]
    print(f"Coordinates before simulation: {r_before_sim}")
    
    print("Advancing simulation by 60 seconds...")
    sim_res = requests.post(f"{BASE_URL}/simulate/step", json={
        "step_seconds": 60.0
    }).json()
    print(f"Simulation result: {sim_res}")

    # Get state again
    registry_after = requests.get(f"{BASE_URL}/maneuver/registry").json()
    sat_data_after = next((s for s in registry_after["satellites"] if s["id"] == sat_id), None)
    r_after_sim = sat_data_after["r"]
    
    print(f"Coordinates after simulation: {r_after_sim}")
    
    if not np.allclose(r_before_sim, r_after_sim, atol=1e-1):
        dist_moved = np.linalg.norm(np.array(r_after_sim) - np.array(r_before_sim))
        print(f"✅ Coordinates changed! Satellite moved {dist_moved:.2f} km.")
    else:
        if sim_res.get("status") == "STEP_COMPLETE":
             print(f"❌ Coordinates DID NOT change, even though simulation step completed!")
        else:
             print(f"❌ Simulation step failed: {sim_res}")

    print("--- 🏁 Test Verified ---")

if __name__ == "__main__":
    test_maneuver_physics()
