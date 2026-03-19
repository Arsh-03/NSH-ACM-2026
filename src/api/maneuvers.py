from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from src.api.telemetry import orbital_registry
from src.physics.fuel_model import calculate_fuel_consumed
from typing import Optional
import numpy as np

router = APIRouter()

THERMAL_COOLDOWN = 600.0
MAX_DV_MAG       = 0.015
maneuver_history = {}

# ── Permanent aliases ─────────────────────────────────────────────────────────
# Maps frontend/UI satellite IDs → registry IDs
# Add any new aliases here as needed
SATELLITE_ALIASES = {
    "ACM-AETHER-ARSH": "SAT-01-ARSH",
    "AETHER-01":       "SAT-01-ARSH",
    "SAT-01":          "SAT-01-ARSH",
}


class ManeuverRequest(BaseModel):
    satellite_id: str   = Field(..., example="SAT-001")
    dv_x:         float = Field(...)
    dv_y:         float = Field(...)
    dv_z:         float = Field(...)
    burn_time:    Optional[float] = None


def _resolve_sat_id(requested_id: str) -> str:
    # 1. Check alias table first
    if requested_id in SATELLITE_ALIASES:
        resolved = SATELLITE_ALIASES[requested_id]
        if resolved in orbital_registry:
            return resolved

    # 2. Exact match
    if requested_id in orbital_registry:
        return requested_id

    # 3. Case-insensitive
    match = next((k for k in orbital_registry
                  if k.lower() == requested_id.lower()), None)
    if match:
        return match

    # 4. Partial match
    match = next((k for k in orbital_registry
                  if requested_id.lower() in k.lower()
                  or k.lower() in requested_id.lower()), None)
    if match:
        return match

    available = [k for k in orbital_registry
                 if orbital_registry[k].get("type") == "SATELLITE"]
    raise HTTPException(
        status_code=404,
        detail={
            "error":     f"Satellite '{requested_id}' not found.",
            "tip":       "Check SATELLITE_ALIASES in maneuvers.py or send telemetry first.",
            "available": available or ["(none registered yet)"],
        }
    )


@router.post("/maneuver/execute")
async def execute_burn(req: ManeuverRequest):
    sat_key  = _resolve_sat_id(req.satellite_id)
    sat_data = orbital_registry[sat_key]

    current_time = float(sat_data.get("last_update", 0))
    last_burn    = float(maneuver_history.get(sat_key, -1000))

    if (current_time - last_burn) < THERMAL_COOLDOWN:
        wait = THERMAL_COOLDOWN - (current_time - last_burn)
        raise HTTPException(
            status_code=429,
            detail=f"Thruster cooldown active. Wait {wait:.1f}s.")

    dv_vector = np.array([req.dv_x, req.dv_y, req.dv_z])
    dv_mag    = float(np.linalg.norm(dv_vector))
    if dv_mag > MAX_DV_MAG:
        dv_vector = (dv_vector / dv_mag) * MAX_DV_MAG
        dv_mag    = MAX_DV_MAG

    current_fuel = float(sat_data.get("fuel_mass", 50.0))
    fuel_spent   = float(calculate_fuel_consumed(
        current_fuel, dv_vector.tolist()))

    if fuel_spent > current_fuel:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient fuel. Have {current_fuel:.2f}kg, "
                   f"need {fuel_spent:.2f}kg.")

    velocity = np.array(sat_data["v"]) + dv_vector
    sat_data["v"]         = [float(x) for x in velocity]
    sat_data["fuel_mass"] = float(round(current_fuel - fuel_spent, 4))
    sat_data["status"]    = "POST_BURN"
    maneuver_history[sat_key] = current_time

    return {
        "status":              "BURN_SUCCESSFUL",
        "satellite":           str(sat_key),
        "dv_magnitude":        f"{dv_mag:.6f} km/s",
        "dv_vector":           [float(x) for x in dv_vector],
        "remaining_fuel":      f"{sat_data['fuel_mass']:.4f} kg",
        "next_available_burn": float(current_time + THERMAL_COOLDOWN),
    }


@router.post("/maneuver/schedule")
async def schedule_maneuver(req: ManeuverRequest):
    return await execute_burn(req)


@router.get("/maneuver/history/{satellite_id}")
async def get_maneuver_history(satellite_id: str):
    sat_key  = _resolve_sat_id(satellite_id)
    last     = maneuver_history.get(sat_key)
    cur_time = float(orbital_registry[sat_key].get("last_update", 0))
    return {
        "satellite_id":       str(sat_key),
        "last_burn_time":     float(last) if last else None,
        "cooldown_active":    bool((cur_time - last) < THERMAL_COOLDOWN) if last else False,
        "cooldown_remaining": float(max(0, THERMAL_COOLDOWN - (cur_time - last))) if last else 0.0,
    }


@router.get("/maneuver/registry")
async def list_satellites():
    return {
        "satellites": [
            {
                "id":          str(k),
                "fuel_kg":     float(round(v.get("fuel_mass", 50.0), 2)),
                "status":      str(v.get("status", "NOMINAL")),
                "last_update": float(v.get("last_update", 0)),
            }
            for k, v in orbital_registry.items()
            if v.get("type") == "SATELLITE" and k
        ],
        "total": int(sum(1 for v in orbital_registry.values()
                         if v.get("type") == "SATELLITE")),
        "aliases": SATELLITE_ALIASES,
    }