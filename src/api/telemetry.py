from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from typing import List, Dict, Optional
import numpy as np
import torch
import time
import math
import os

from src.ai.ppo_agent import PPOAgent

router = APIRouter()

FUEL_BUDGET = 50.0
MAX_THRUST  = 0.015
ISP         = 300.0
G0          = 9.80665e-3
DRY_MASS    = 500.0
EOL_FUEL    = 2.5
THERMAL_CD  = 600.0
WARNING_KM  = 50.0

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
for _ in range(4):
    if os.path.exists(os.path.join(ROOT_DIR, "models")):
        break
    ROOT_DIR = os.path.dirname(ROOT_DIR)
MODEL_PATH = os.path.join(ROOT_DIR, "models", "acm_ppo_v1.pth")

_agent: Optional[PPOAgent] = None

def get_agent() -> PPOAgent:
    global _agent
    if _agent is None:
        _agent = PPOAgent()
        if os.path.exists(MODEL_PATH):
            _agent.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
            _agent.eval()
    return _agent

orbital_registry: Dict[str, dict] = {}


def check_threats_for_sat(sat_pos: np.ndarray) -> tuple:
    min_dist   = 9999.0
    closest = None
    for obj_id, data in orbital_registry.items():
        if data.get("type") != "DEBRIS":
            continue
        try:
            dist = float(np.linalg.norm(
                sat_pos - np.array(data["r"], dtype=float)))
            if math.isfinite(dist) and dist < min_dist:
                min_dist   = dist
                closest = obj_id
        except Exception:
            continue
    return min_dist < WARNING_KM, round(min(min_dist, 9999.0), 3), closest


def scan_full_fleet():
    for data in orbital_registry.values():
        if data.get("type") != "SATELLITE":
            continue
        try:
            threat, min_dist, closest = check_threats_for_sat(
                np.array(data["r"], dtype=float))
            data["min_dist_km"]    = min_dist
            data["closest_debris"] = closest
            data["status"] = "AT_RISK" if threat else data.get("status", "NOMINAL")
        except Exception:
            continue


class Vector3D(BaseModel):
    x: float; y: float; z: float

class SpaceObject(BaseModel):
    id: str
    object_type: str = Field(..., alias="type")
    r: Vector3D
    v: Vector3D

class TelemetrySnapshot(BaseModel):
    timestamp: float
    objects: List[SpaceObject]

class NSHTelemetry(BaseModel):
    sat_id:       str
    state_vector: Optional[List[float]] = None
    epoch:        Optional[float]       = None
    state:        Optional[Dict]        = None
    timestamp:    Optional[float]       = None
    fuel_kg:      float                 = FUEL_BUDGET

    @model_validator(mode="after")
    def normalise(self):
        if self.epoch is not None and self.timestamp is None:
            self.timestamp = self.epoch
        if self.timestamp is None:
            self.timestamp = time.time()
        if self.state_vector is not None and self.state is None:
            sv = self.state_vector
            if len(sv) != 6:
                raise ValueError("state_vector must have 6 elements")
            self.state = dict(x=sv[0],y=sv[1],z=sv[2],
                              vx=sv[3],vy=sv[4],vz=sv[5])
        if self.state is None:
            raise ValueError("Provide 'state' or 'state_vector'")
        return self

    def to_array(self) -> np.ndarray:
        s = self.state
        return np.array([s["x"],s["y"],s["z"],
                         s["vx"],s["vy"],s["vz"]], dtype=float)


@router.post("/telemetry", status_code=200)
async def ingest_telemetry(data: NSHTelemetry):
    sat_arr = data.to_array()
    sat_id  = data.sat_id

    if sat_id not in orbital_registry:
        orbital_registry[sat_id] = {
            "type":          "SATELLITE",
            "r":             sat_arr[:3].tolist(),
            "v":             sat_arr[3:].tolist(),
            "fuel_mass":     data.fuel_kg,
            "nominal_slot":  sat_arr[:3].tolist(),
            "last_update":   data.timestamp,
            "last_burn":     data.timestamp - THERMAL_CD,
            "status":        "NOMINAL",
            "min_dist_km":   9999.0,
            "closest_debris":None,
        }
    else:
        rec = orbital_registry[sat_id]
        rec["r"]           = sat_arr[:3].tolist()
        rec["v"]           = sat_arr[3:].tolist()
        rec["fuel_mass"]   = data.fuel_kg
        rec["last_update"] = data.timestamp

    rec = orbital_registry[sat_id]
    threat, min_dist, closest = check_threats_for_sat(sat_arr[:3])
    rec["min_dist_km"]    = min_dist
    rec["closest_debris"] = closest


    # ── Physics-based avoidance burn ─────────────────────────────────────
    # Computes optimal dodge direction using relative velocity geometry.
    # Burns perpendicular to debris approach vector — maximises miss distance.
    if threat and closest is not None:
        deb_data = orbital_registry.get(closest)
        if deb_data:
            deb_pos = np.array(deb_data["r"], dtype=float)
            deb_vel = np.array(deb_data.get("v", [0,0,0]), dtype=float)
            sat_pos = sat_arr[:3]
            sat_vel = sat_arr[3:]

            rel_pos  = deb_pos - sat_pos        # vector FROM sat TO debris
            rel_vel  = deb_vel - sat_vel        # debris approach velocity
            rel_dist = float(np.linalg.norm(rel_pos))

            if rel_dist > 1e-6:
                away_unit = -rel_pos / rel_dist  # points away from debris

                # Is debris closing in?
                closing_rate = float(np.dot(rel_vel, rel_pos / rel_dist))

                if closing_rate < 0:
                    # Debris approaching — burn out-of-plane for max miss distance
                    orb_normal = np.cross(sat_pos, sat_vel)
                    orb_mag    = float(np.linalg.norm(orb_normal))
                    if orb_mag > 1e-6:
                        orb_normal /= orb_mag
                        rel_vel_mag = float(np.linalg.norm(rel_vel))
                        if rel_vel_mag > 1e-6:
                            rv_unit  = rel_vel / rel_vel_mag
                            dodge    = np.cross(rv_unit, orb_normal)
                            dodge_mg = float(np.linalg.norm(dodge))
                            dodge_unit = dodge / dodge_mg if dodge_mg > 1e-6 else away_unit
                        else:
                            dodge_unit = away_unit
                    else:
                        dodge_unit = away_unit
                else:
                    # Debris moving away — burn radially outward
                    radial     = sat_pos / (float(np.linalg.norm(sat_pos)) + 1e-12)
                    dodge_unit = radial

                dv_vec = np.array(dodge_unit * MAX_THRUST, dtype=float)
                dv_mag = float(np.linalg.norm(dv_vec))
            else:
                # Direct hit — burn prograde immediately
                prograde = sat_vel / (float(np.linalg.norm(sat_vel)) + 1e-12)
                dv_vec   = np.array(prograde * MAX_THRUST, dtype=float)
                dv_mag   = float(np.linalg.norm(dv_vec))
        else:
            dv_vec = np.zeros(3, dtype=float)
            dv_mag = 0.0
    else:
        # No threat — PPO agent for nominal station-keeping
        agent  = get_agent()
        norm_s = sat_arr / np.array([7500,7500,7500,8,8,8])
        with torch.no_grad():
            dv_raw = agent.actor(
                torch.FloatTensor(norm_s).unsqueeze(0)).squeeze(0).numpy()
        dv_vec = np.clip(dv_raw, -1.0, 1.0) * MAX_THRUST
        dv_mag = float(np.linalg.norm(dv_vec))
    time_since_burn = data.timestamp - rec["last_burn"]
    can_burn     = time_since_burn >= THERMAL_CD and rec["fuel_mass"] > 0
    cooling_down = time_since_burn < THERMAL_CD

    # Keep burning every cooldown cycle until threat is cleared
    # Each burn uses fuel but debris keeps being re-evaluated each tick
    if threat and can_burn and dv_mag > 1e-4 and rec["fuel_mass"] > 0:
        # Burn approved — apply delta-v
        dm = (DRY_MASS + rec["fuel_mass"]) * (1 - np.exp(-dv_mag/(ISP*G0)))
        rec["fuel_mass"]  = max(0.0, rec["fuel_mass"] - dm)
        rec["last_burn"]  = data.timestamp
        rec["status"]     = "MANEUVERING"
        status = "MANEUVER_REQUIRED"
        print(f"  🚀 BURN #{rec.get("burn_count",0)+1}: {data.sat_id} "
              f"| dv={dv_mag:.5f}km/s | fuel_left={rec["fuel_mass"]:.2f}kg "
              f"| debris_dist={min_dist:.3f}km")
        rec["burn_count"] = rec.get("burn_count", 0) + 1

    elif threat and cooling_down:
        # In cooldown — preserve MANEUVERING, next burn fires when cooldown expires
        dv_vec = np.zeros(3)
        dv_mag = 0.0
        rec["status"] = "MANEUVERING"
        status = "NOMINAL"

    elif not threat and rec["status"] == "MANEUVERING":
        # Threat cleared after burn(s) — mark as recovering
        dv_vec = np.zeros(3)
        dv_mag = 0.0
        rec["status"] = "RECOVERING"
        rec["burn_count"] = 0
        status = "NOMINAL"
        print(f"  ✅ THREAT CLEARED: {data.sat_id} | "
              f"dist={min_dist:.1f}km > {WARNING_KM}km")

    else:
        dv_vec = np.zeros(3)
        dv_mag = 0.0
        # Preserve RECOVERING status for 5 ticks before going NOMINAL
        if rec["status"] == "RECOVERING":
            rec["recover_ticks"] = rec.get("recover_ticks", 0) + 1
            if rec["recover_ticks"] > 5:
                rec["status"] = "NOMINAL"
                rec["recover_ticks"] = 0
        elif threat:
            rec["status"] = "AT_RISK"
        else:
            rec["status"] = "NOMINAL"
        status = "NOMINAL"

    # Ensure all values are JSON-safe native Python types
    dv_list = [float(x) for x in dv_vec] if hasattr(dv_vec, "__iter__") else [0.0, 0.0, 0.0]
    return {
        "status":         str(status),
        "sat_id":         str(sat_id),
        "delta_v":        dv_list,
        "dv_magnitude":   round(float(dv_mag), 6),
        "fuel_remaining": round(float(rec["fuel_mass"]), 4),
        "eol_flag":       bool(rec["fuel_mass"] <= EOL_FUEL),
        "min_dist_km":    round(float(min_dist), 3) if math.isfinite(min_dist) else 9999.0,
        "closest_debris": str(closest) if closest else None,
        "accepted":       True,
    }


@router.post("/telemetry/bulk", status_code=202)
async def ingest_bulk_telemetry(data: TelemetrySnapshot):
    try:
        start = time.perf_counter()
        for obj in data.objects:
            prev = orbital_registry.get(obj.id, {})
            orbital_registry[obj.id] = {
                "type":        obj.object_type,
                "r":           [obj.r.x, obj.r.y, obj.r.z],
                "v":           [obj.v.x, obj.v.y, obj.v.z],
                "fuel_mass":   prev.get("fuel_mass", FUEL_BUDGET),
                "last_update": data.timestamp,
                "last_burn":   prev.get("last_burn", data.timestamp - THERMAL_CD),
                "status":      prev.get("status", "NOMINAL"),
                "min_dist_km": 9999.0,
            }
        scan_full_fleet()
        ms = (time.perf_counter() - start) * 1000
        at_risk = [sid for sid, d in orbital_registry.items()
                   if d.get("type") == "SATELLITE"
                   and d.get("status") in ("AT_RISK", "MANEUVERING")]
        return {
            "status":           "ACK",
            "received_objects": len(data.objects),
            "timestamp":        data.timestamp,
            "processing_ms":    round(ms, 2),
            "at_risk_sats":     at_risk,
        }
    except Exception as e:
        raise HTTPException(500, f"Bulk telemetry failed: {e}")


@router.get("/telemetry/count")
async def get_object_count():
    sats   = [v for v in orbital_registry.values() if v.get("type")=="SATELLITE"]
    debris = [v for v in orbital_registry.values() if v.get("type")=="DEBRIS"]
    at_risk= [s for s in sats if s.get("status") in ("AT_RISK","MANEUVERING")]
    return {
        "tracked_objects":      len(orbital_registry),
        "satellites":           len(sats),
        "debris":               len(debris),
        "at_risk":              len(at_risk),
        "warning_threshold_km": WARNING_KM,
    }