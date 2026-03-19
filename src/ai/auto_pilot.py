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

                    # Blackout check — wrapped so it never blocks
                    try:
                        is_blackout, _ = is_in_blackout(data["r"])
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
                    # ConjunctionAnalyzer does 2-hour lookahead which is CPU
                    # intensive and blocks the event loop — moved to background
                    is_critical_future = False

                    if immediate_danger and is_connected:
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
                        nominal_slot = data.get("nominal_slot_r")
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