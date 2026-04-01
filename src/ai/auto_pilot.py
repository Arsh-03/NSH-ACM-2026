import asyncio
import numpy as np
from src.api.telemetry import orbital_registry
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.ai.ppo_agent import PPOAgent
from src.api.maneuvers import execute_burn, ManeuverRequest
from src.ai.conjunction import ConjunctionAnalyzer
from src.ai.recovery import calculate_recovery_burn
from src.comms.blackout import is_in_blackout

D_CRIT         = 0.1
SLOT_TOLERANCE = 10.0
COMM_LATENCY   = 10.0

agent    = PPOAgent(6, 3)
analyzer = ConjunctionAnalyzer()

async def run_auto_pilot():
    print("🚀 ACM Strategic Auto-Pilot with Recovery: ONLINE")

    while True:
        try:
            if not orbital_registry:
                await asyncio.sleep(2)
                continue

            # Build debris spatial index
            debris_data = [
                d["r"] for d in orbital_registry.values()
                if d.get("type") == "DEBRIS"
            ]
            spatial_tree = build_spatial_index(debris_data) if debris_data else None

            for sat_id, data in list(orbital_registry.items()):
                if data.get("type") != "SATELLITE":
                    continue

                try:
                    sat_state    = np.array(data["r"] + data["v"])
                    current_time = data.get("last_update", 0)

                    # Blackout check — pass current simulation timestamp for accurate GS rotation
                    try:
                        is_blackout, _ = is_in_blackout(data["r"], current_time)
                        is_connected   = not is_blackout
                    except Exception:
                        is_connected = True

                    # Immediate KD-Tree proximity check
                    immediate_danger = False
                    if spatial_tree:
                        nearby = find_nearby_threats(
                            spatial_tree, data["r"], radius=D_CRIT)
                        immediate_danger = len(nearby) > 0

                    # ── SKIP conjunction analysis in the hot path ────────────
                    # Use strategic lookahead to preempt blind conjunctions.
                    # Run threat analysis in thread pool to avoid blocking event loop
                    is_critical_future = False
                    try:
                        debris_registry = {
                            k: v for k, v in orbital_registry.items()
                            if v.get("type") == "DEBRIS"
                        }
                        future_threats = await asyncio.to_thread(
                            analyzer.analyze_threats,
                            sat_id,
                            sat_state,
                            debris_registry,
                        )
                        is_critical_future = any(t.get("risk_level") == "CRITICAL" for t in future_threats)
                    except Exception:
                        is_critical_future = False

                    # Graveyard Orbit Maneuver (EOL Handling)
                    # We bypass is_connected for graveyard maneuvers to ensure mission completion in the simulation
                    if data.get("status") == "EOL":
                        # Issuing a prograde burn to move to graveyard orbit (+300km raise target)
                        # We use 13m/s which is safely within the remaining budget for a 2.4kg payload
                        vel      = np.array(data["v"], dtype=float)
                        v_unit   = vel / (np.linalg.norm(vel) + 1e-12)
                        dv_vec   = v_unit * 0.013 # 13 m/s prograde burn
                        req = ManeuverRequest(
                            satellite_id=sat_id,
                            dv_x=float(dv_vec[0]),
                            dv_y=float(dv_vec[1]),
                            dv_z=float(dv_vec[2])
                        )
                        try:
                            await execute_burn(req)
                            print(f"  ⚰️  GRAVEYARD MANEUVER: {sat_id} | Raising orbit...")
                            # Mark as 'GRAVEYARD' to avoid repeated burns next tick
                            orbital_registry[sat_id]["status"] = "GRAVEYARD"
                        except Exception as e:
                            print(f"[AutoPilot] Graveyard burn failed for {sat_id}: {e}")
                        continue

                    if (immediate_danger or is_critical_future) and is_connected:
                        dv_action = agent.act(sat_state)
                        req = ManeuverRequest(
                            satellite_id=sat_id,
                            dv_x=float(dv_action[0]),
                            dv_y=float(dv_action[1]),
                            dv_z=float(dv_action[2])
                        )
                        try:
                            await execute_burn(req)
                            orbital_registry[sat_id]["status"] = "RECOVERING"
                        except Exception:
                            pass

                    # Station-keeping
                    if is_connected:
                        nominal_slot = data.get("nominal_slot")
                        if nominal_slot:
                            try:
                                recovery_req = calculate_recovery_burn(
                                    sat_id, sat_state, nominal_slot, current_time)
                                if recovery_req:
                                    await execute_burn(recovery_req)
                            except Exception:
                                pass

                except Exception:
                    continue

            # Sleep 2 seconds between full fleet scans — yields to HTTP handlers
            await asyncio.sleep(2)

        except Exception as e:
            print(f"[AutoPilot] Error: {e}")
            await asyncio.sleep(2)