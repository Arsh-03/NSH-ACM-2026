from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from src.api.telemetry import orbital_registry
from src.physics.fuel_model import calculate_fuel_consumed
from typing import Optional
import numpy as np
import time
from datetime import datetime
from src.comms.blackout import is_in_blackout

router = APIRouter()

THERMAL_COOLDOWN = 600.0
MAX_DV_MAG       = 0.015
maneuver_history = {}
scheduled_maneuvers = []
executed_maneuvers = []


def _parse_timestamp(value) -> float:
    if value is None:
        return float(time.time())
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except Exception:
            try:
                return float(value)
            except Exception:
                return float(time.time())
    return float(time.time())

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


class DeltaVVector(BaseModel):
    x: float
    y: float
    z: float


class ManeuverSequenceItem(BaseModel):
    burn_id: str
    burnTime: str
    deltaV_vector: DeltaVVector


class ManeuverSchedulePayload(BaseModel):
    satelliteId: str
    maneuver_sequence: list[ManeuverSequenceItem]


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


async def execute_scheduled_burn(satellite_id: str, dv_vector: list[float], burn_time: float, burn_id: str):
    req = ManeuverRequest(
        satellite_id=satellite_id,
        dv_x=float(dv_vector[0]),
        dv_y=float(dv_vector[1]),
        dv_z=float(dv_vector[2]),
        burn_time=burn_time,
    )
    result = await execute_burn(req)

    executed_maneuvers.append({
        "satellite_id": satellite_id,
        "burn_id": burn_id,
        "burn_start": burn_time,
        "burn_end": burn_time,
        "cooldown_end": burn_time + THERMAL_COOLDOWN,
        "dv_vector": [float(dv_vector[0]), float(dv_vector[1]), float(dv_vector[2])],
        "dv_magnitude": float(np.linalg.norm(np.array(dv_vector, dtype=float))),
        "status": "EXECUTED",
    })
    return result


def pop_due_maneuvers(start_time: float, end_time: float):
    due = [m for m in scheduled_maneuvers if start_time < m["burn_time"] <= end_time]
    if due:
        scheduled_maneuvers[:] = [m for m in scheduled_maneuvers if m not in due]
    due.sort(key=lambda m: m["burn_time"])
    return due


@router.post("/maneuver/schedule", status_code=202)
async def schedule_maneuver(payload: dict):
    # New NSH contract
    if "maneuver_sequence" in payload and "satelliteId" in payload:
        req = ManeuverSchedulePayload.model_validate(payload)
        sat_key = _resolve_sat_id(req.satelliteId)
        sat_data = orbital_registry[sat_key]
        current_time = float(sat_data.get("last_update", time.time()))

        blackout, _ = is_in_blackout(sat_data.get("r", [0, 0, 0]))
        los_ok = not blackout

        projected_fuel = float(sat_data.get("fuel_mass", 50.0))
        sufficient_fuel = True

        for step in req.maneuver_sequence:
            bt = _parse_timestamp(step.burnTime)
            if bt < current_time + 10.0:
                raise HTTPException(status_code=400, detail=f"burnTime for {step.burn_id} violates 10s latency constraint")

            dv = [float(step.deltaV_vector.x), float(step.deltaV_vector.y), float(step.deltaV_vector.z)]
            dv_mag = float(np.linalg.norm(np.array(dv)))
            if dv_mag > MAX_DV_MAG:
                scale = MAX_DV_MAG / dv_mag
                dv = [d * scale for d in dv]

            fuel_use = float(calculate_fuel_consumed(projected_fuel, dv))
            if fuel_use > projected_fuel:
                sufficient_fuel = False
                break
            projected_fuel -= fuel_use

            scheduled_maneuvers.append({
                "satellite_id": sat_key,
                "burn_id": step.burn_id,
                "burn_time": bt,
                "dv_vector": dv,
                "created_at": float(time.time()),
            })

        return {
            "status": "SCHEDULED",
            "validation": {
                "ground_station_los": bool(los_ok),
                "sufficient_fuel": bool(sufficient_fuel),
                "projected_mass_remaining_kg": round(500.0 + projected_fuel, 3),
            },
        }

    # Backward-compatible legacy contract
    req = ManeuverRequest.model_validate(payload)
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


@router.get("/maneuver/timeline")
async def get_maneuver_timeline():
    pending = sorted(scheduled_maneuvers, key=lambda m: m["burn_time"])
    executed = sorted(executed_maneuvers, key=lambda m: m["burn_start"])
    return {
        "pending": pending,
        "executed": executed,
        "pending_count": len(pending),
        "executed_count": len(executed),
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