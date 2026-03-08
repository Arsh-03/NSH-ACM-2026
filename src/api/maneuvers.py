from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from src.api.telemetry import orbital_registry
from src.physics.fuel_model import calculate_fuel_consumed
import numpy as np

router = APIRouter()

# --- 1. Data Models ---

class ManeuverRequest(BaseModel):
    """Command to execute a thruster burn"""
    satellite_id: str = Field(..., example="SAT-001")
    dv_x: float = Field(..., description="Delta-V in x direction (km/s)")
    dv_y: float = Field(..., description="Delta-V in y direction (km/s)")
    dv_z: float = Field(..., description="Delta-V in z direction (km/s)")

# --- 2. Global State for Constraints ---

# Tracks the last time a satellite performed a maneuver
# Key: satellite_id, Value: last_burn_timestamp (simulation time)
maneuver_history = {}

# --- 3. The Maneuver Logic ---

@router.post("/maneuver/execute")
async def execute_burn(req: ManeuverRequest):
    """
    Executes an impulsive maneuver and updates fuel mass.
    Ensures 600s cooldown between burns for each satellite.
    """
    # 1. Existence Check
    if req.satellite_id not in orbital_registry:
        raise HTTPException(status_code=404, detail="Satellite not found.")

    sat_data = orbital_registry[req.satellite_id]

    # 2. Enforce 600-second Cooldown
    current_sim_time = sat_data.get("last_update", 0)
    last_burn = maneuver_history.get(req.satellite_id, -1000)
    
    if (current_sim_time - last_burn) < 600:
        wait_time = 600 - (current_sim_time - last_burn)
        raise HTTPException(
            status_code=429, 
            detail=f"Thruster cooldown active. Wait {wait_time:.1f}s."
        )

    # 3. Fuel Calculation
    dv_vector = [req.dv_x, req.dv_y, req.dv_z]
    # Defaulting to 50kg initial fuel if not present in registry
    current_fuel = sat_data.get("fuel_mass", 50.0) 
    
    fuel_spent = calculate_fuel_consumed(current_fuel, dv_vector)
    
    if fuel_spent > current_fuel:
        raise HTTPException(status_code=400, detail="Insufficient fuel for maneuver.")

    # 4. Apply the Delta-V (Update Velocity Vector)
    #
    velocity = np.array(sat_data["v"])
    velocity += np.array(dv_vector)
    
    # 5. Sync Updates to Registry
    sat_data["v"] = velocity.tolist()
    sat_data["fuel_mass"] = current_fuel - fuel_spent
    maneuver_history[req.satellite_id] = current_sim_time

    return {
        "status": "BURN_SUCCESSFUL",
        "satellite": req.satellite_id,
        "dv_magnitude": f"{np.linalg.norm(dv_vector):.6f} km/s",
        "remaining_fuel": f"{sat_data['fuel_mass']:.4f} kg",
        "next_available_burn": current_sim_time + 600
    }