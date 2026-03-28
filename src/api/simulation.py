from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.physics.integrator import rk4_step
from src.api.telemetry import orbital_registry
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.ai.ppo_agent import PPOAgent
import numpy as np
import torch
from datetime import datetime, timezone

router = APIRouter()

# Initialize AI Pilot (6 state dimensions -> 3 action dimensions)
agent = PPOAgent(6, 3) 
D_CRIT = 0.1  # 100m threshold in km

class SimStepRequest(BaseModel):
    """Standard request format for simulation ticks"""
    step_seconds: float | None = None
    time_step: float | None = None
    iterations: int = 1

@router.post("/simulate/step")
async def advance_simulation(req: SimStepRequest):
    if not orbital_registry:
        raise HTTPException(status_code=400, detail="Telemetry registry is empty.")

    try:
        from src.api.maneuvers import pop_due_maneuvers, execute_scheduled_burn

        step_seconds = req.step_seconds
        if step_seconds is None:
            if req.time_step is None:
                raise HTTPException(status_code=400, detail="Provide step_seconds (or legacy time_step)")
            step_seconds = float(req.time_step) * max(int(req.iterations), 1)

        if step_seconds <= 0:
            raise HTTPException(status_code=400, detail="step_seconds must be > 0")

        collisions_detected = 0
        maneuvers_executed = 0

        current_time = max(float(v.get("last_update", 0.0)) for v in orbital_registry.values())
        remaining = float(step_seconds)
        
        while remaining > 0:
            dt = min(60.0, remaining)
            window_end = current_time + dt

            due = pop_due_maneuvers(current_time, window_end)
            for m in due:
                try:
                    await execute_scheduled_burn(
                        m["satellite_id"],
                        m["dv_vector"],
                        m["burn_time"],
                        m["burn_id"],
                    )
                    maneuvers_executed += 1
                except Exception:
                    continue

            # 1. UPDATE SPATIAL AWARENESS
            debris_data = [
                (oid, d["r"]) for oid, d in orbital_registry.items()
                if d["type"] == "DEBRIS"
            ]

            if debris_data:
                _, debris_coords = zip(*debris_data)
                spatial_tree = build_spatial_index(list(debris_coords))
            else:
                spatial_tree = None

            # 2. PROCESS SATELLITE FLEET
            for obj_id, data in orbital_registry.items():
                current_state = np.array(data["r"] + data["v"])

                if data["type"] == "SATELLITE" and spatial_tree:
                    threats = find_nearby_threats(spatial_tree, data["r"], radius=D_CRIT)
                    if threats:
                        dv_action = agent.act(current_state)
                        data["v"] = (np.array(data["v"]) + dv_action).tolist()

                new_state = rk4_step(np.array(data["r"] + data["v"]), dt)
                data["r"] = new_state[:3].tolist()
                data["v"] = new_state[3:].tolist()
                data["last_update"] = float(data.get("last_update", current_time)) + dt

            sats = [d for d in orbital_registry.values() if d.get("type") == "SATELLITE"]
            debs = [d for d in orbital_registry.values() if d.get("type") == "DEBRIS"]
            for s in sats:
                sr = np.array(s["r"], dtype=float)
                for d in debs:
                    dr = np.array(d["r"], dtype=float)
                    if float(np.linalg.norm(sr - dr)) < D_CRIT:
                        collisions_detected += 1

            current_time = window_end
            remaining -= dt

        return {
            "status": "STEP_COMPLETE",
            "new_timestamp": datetime.fromtimestamp(current_time, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            "collisions_detected": int(collisions_detected),
            "maneuvers_executed": int(maneuvers_executed),
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step failed: {str(e)}")