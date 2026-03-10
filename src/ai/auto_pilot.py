import asyncio
import numpy as np
from src.api.telemetry import orbital_registry
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.ai.ppo_agent import PPOAgent
from src.api.maneuvers import execute_burn, ManeuverRequest
from src.ai.conjunction import ConjunctionAnalyzer
from src.ai.recovery import calculate_recovery_burn
from src.comms.blackout import is_in_blackout

# --- Constants from NSH-2026 PS ---
D_CRIT = 0.1  # 100m Critical Collision Threshold [cite: 70]
SLOT_TOLERANCE = 10.0  # 10km Station-Keeping Box [cite: 169]
COMM_LATENCY = 10.0  # 10-second signal delay [cite: 186]

# Initialize Systems
agent = PPOAgent(6, 3) 
analyzer = ConjunctionAnalyzer()

async def run_auto_pilot():
    print("🚀 ACM Strategic Auto-Pilot with Recovery: ONLINE")
    
    while True:
        if not orbital_registry:
            await asyncio.sleep(1)
            continue

        # 1. SPATIAL MAPPING (O(N log N)) [cite: 40]
        debris_data = [d["r"] for d in orbital_registry.values() if d["type"] == "DEBRIS"]
        spatial_tree = build_spatial_index(debris_data) if debris_data else None

        for sat_id, data in orbital_registry.items():
            if data["type"] != "SATELLITE":
                continue

            # State & Connectivity Check [cite: 185, 192]
            sat_state = np.array(data["r"] + data["v"])
            is_blackout, _ = is_in_blackout(data["r"])
            is_connected = not is_blackout
            current_time = data["last_update"]

            # --- STEP 1: SAFETY CHECK (REACTIVE & STRATEGIC) --- [cite: 41, 42]
            # Immediate proximity check via KD-Tree
            immediate_danger = False
            if spatial_tree:
                nearby = find_nearby_threats(spatial_tree, data["r"], radius=D_CRIT)
                immediate_danger = len(nearby) > 0

            # Long-range lookahead (up to 2 hours) [cite: 39]
            future_threats = analyzer.analyze_threats(sat_id, sat_state, orbital_registry)
            is_critical_future = future_threats and future_threats[0]["risk_level"] == "CRITICAL"

            if immediate_danger or is_critical_future:
                if is_connected:
                    # Execute Evasion Maneuver [cite: 42]
                    dv_action = agent.act(sat_state)
                    req = ManeuverRequest(
                        satellite_id=sat_id,
                        burn_time=current_time + COMM_LATENCY + 2.0,
                        dv_x=dv_action[0], dv_y=dv_action[1], dv_z=dv_action[2]
                    )
                    try:
                        await execute_burn(req)
                        # Mark for recovery once the threat is cleared [cite: 172]
                        orbital_registry[sat_id]["status"] = "RECOVERING"
                        print(f"✅ EVASION: {sat_id} maneuvering. Next: Recovery.")
                    except Exception as e:
                        print(f"⚠️ EVASION FAILED: {str(e)}")
                continue # Safety takes precedence over recovery

            # --- STEP 2: ORBITAL RECOVERY (STATION-KEEPING) --- [cite: 44, 166]
            # If safe and connected, check if we need to return to our 10km slot
            if is_connected:
                # Get the nominal slot position for this satellite [cite: 168]
                nominal_slot = data.get("nominal_slot_r") 
                
                if nominal_slot:
                    recovery_req = calculate_recovery_burn(
                        sat_id, sat_state, nominal_slot, current_time
                    )
                    
                    if recovery_req:
                        try:
                            await execute_burn(recovery_req)
                            print(f"🔄 RECOVERY: {sat_id} returning to nominal slot.")
                        except Exception as e:
                            # Usually fails due to 600s thruster cooldown [cite: 160]
                            pass 

        await asyncio.sleep(0.5)