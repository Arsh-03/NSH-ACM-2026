from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from src.physics.integrator import rk4_step
from src.api.telemetry import orbital_registry
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.ai.ppo_agent import PPOAgent
import numpy as np
import torch

router = APIRouter()

# Initialize AI Pilot (6 state dimensions -> 3 action dimensions)
agent = PPOAgent(6, 3) 
D_CRIT = 0.1  # 100m threshold in km

class SimStepRequest(BaseModel):
    """Standard request format for simulation ticks"""
    time_step: float  # dt
    iterations: int = 1

@router.post("/simulate/step")
async def advance_simulation(req: SimStepRequest):
    if not orbital_registry:
        raise HTTPException(status_code=400, detail="Telemetry registry is empty.")

    try:
        dt = req.time_step
        
        # 1. UPDATE SPATIAL AWARENESS
        # Collect debris positions for the KD-Tree (O(N log N) efficiency)
        debris_data = [
            (id, d["r"]) for id, d in orbital_registry.items() 
            if d["type"] == "DEBRIS"
        ]
        
        if debris_data:
            debris_ids, debris_coords = zip(*debris_data)
            spatial_tree = build_spatial_index(list(debris_coords))
        else:
            spatial_tree = None

        # 2. PROCESS SATELLITE FLEET
        for obj_id, data in orbital_registry.items():
            current_state = np.array(data["r"] + data["v"])
            
            if data["type"] == "SATELLITE" and spatial_tree:
                # Detection: Check 100m danger zone
                threats = find_nearby_threats(spatial_tree, data["r"], radius=D_CRIT)
                
                if threats:
                    # Decision: AI calculates optimal Delta-V
                    dv_action = agent.act(current_state)
                    
                    # Apply Maneuver (Instantaneous Velocity Change)
                    data["v"] = (np.array(data["v"]) + dv_action).tolist()
                    print(f"🛰️ {obj_id}: Maneuver executed. Delta-V: {np.linalg.norm(dv_action):.6f} km/s")

            # 3. PHYSICS EXECUTION
            # Step forward in time using RK4 with J2 perturbations
            new_state = rk4_step(np.array(data["r"] + data["v"]), dt)
            
            # Sync back to global state
            data["r"] = new_state[:3].tolist()
            data["v"] = new_state[3:].tolist()
            data["last_update"] += dt
            
        return {
            "status": "SUCCESS",
            "tick_size": dt,
            "total_objects": len(orbital_registry)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Step failed: {str(e)}")