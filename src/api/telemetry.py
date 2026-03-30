from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, validator
from typing import List, Dict, Optional, Any
import numpy as np
import torch
import time
import math
import os
from datetime import datetime, timezone

from src.ai.ppo_agent import PPOAgent
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.api import database as db

router = APIRouter()

FUEL_BUDGET = 50.0
MAX_THRUST  = 0.015
ISP         = 300.0
G0          = 9.80665e-3
DRY_MASS    = 500.0
EOL_FUEL    = 2.5
THERMAL_CD  = 30.0   # TEMP: Reduced from 600.0 for testing purposes
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
GLOBAL_SPATIAL_TREE: Optional[Any] = None
GLOBAL_DEBRIS_IDS: List[str] = []

def sync_registry_with_db():
    db.init_db()
    db_reg = db.load_registry_from_db()
    if db_reg:
        print(f"📦 Restoring {len(db_reg)} satellites from database.")
        orbital_registry.update(db_reg)

# Global initialization call (happens on first import)
sync_registry_with_db()


def _parse_timestamp(value: Any) -> float:
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


def _upsert_object(obj_id: str, obj_type: str, r: List[float], v: List[float], timestamp: float):
    prev = orbital_registry.get(obj_id, {})
    rec = {
        "type": obj_type,
        "r": [float(r[0]), float(r[1]), float(r[2])],
        "v": [float(v[0]), float(v[1]), float(v[2])],
        "fuel_mass": float(prev.get("fuel_mass", FUEL_BUDGET)),
        "last_update": float(timestamp),
        "last_burn": float(prev.get("last_burn", timestamp - THERMAL_CD)),
        "status": str(prev.get("status", "NOMINAL")),
        "min_dist_km": float(prev.get("min_dist_km", 9999.0)),
        "closest_debris": prev.get("closest_debris"),
    }
    if obj_type == "SATELLITE":
        rec["nominal_slot"] = prev.get("nominal_slot", [float(r[0]), float(r[1]), float(r[2])])
        # Persistence call
        db.upsert_satellite(obj_id, rec)
    orbital_registry[obj_id] = rec


def check_threats_for_sat(sat_pos: np.ndarray, debris_ids: List[str], spatial_tree: Any = None) -> tuple:
    if spatial_tree is None:
        return False, 9999.0, None
    
    # query_ball_point returns INDICES of debris_ids
    indices = find_nearby_threats(spatial_tree, sat_pos, radius=WARNING_KM)
    
    if not indices:
        # No threats within WARNING_KM, but we still need the ABSOLUTE closest to report a distance
        dist, idx = spatial_tree.query(sat_pos)
        return False, round(float(dist), 3), debris_ids[int(idx)]
    
    # We have threats within WARNING_KM. Find the closest among them.
    # Actually, KDTree.query is faster for finding the single closest.
    dist, idx = spatial_tree.query(sat_pos)
    return dist < WARNING_KM, round(float(dist), 3), debris_ids[int(idx)]


def scan_full_fleet():
    global GLOBAL_SPATIAL_TREE, GLOBAL_DEBRIS_IDS
    debris_data = [(oid, d["r"]) for oid, d in orbital_registry.items() if d.get("type") == "DEBRIS"]
    if not debris_data:
        GLOBAL_SPATIAL_TREE = None
        GLOBAL_DEBRIS_IDS = []
        return
        
    GLOBAL_DEBRIS_IDS, debris_coords = zip(*debris_data)
    GLOBAL_SPATIAL_TREE = build_spatial_index(list(debris_coords))

    for oid, data in orbital_registry.items():
        if data.get("type") != "SATELLITE":
            continue
        try:
            sat_pos = np.array(data["r"], dtype=float)
            threat, min_dist, closest = check_threats_for_sat(sat_pos, GLOBAL_DEBRIS_IDS, GLOBAL_SPATIAL_TREE)
            data["min_dist_km"]    = min_dist
            data["closest_debris"] = closest
            if threat:
                db.log_alert(oid, closest, time.time(), min_dist)
                # Only overwrite to AT_RISK if we aren't already maneuvering or recovering
                if data.get("status") not in ("MANEUVERING", "RECOVERING"):
                    data["status"] = "AT_RISK"
            else:
                if data.get("status") == "AT_RISK":
                    data["status"] = "NOMINAL"
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

    @validator('timestamp', pre=True, always=True)
    def normalise_timestamp(cls, v, values):
        if v is None:
            epoch = values.get('epoch')
            if epoch is not None:
                return epoch
            return time.time()
        return v

    @validator('state', pre=False, always=True)
    def ensure_state_from_vector(cls, v, values):
        # If state is already provided, validate it has all required keys
        if v is not None:
            return v
        # Try to convert from state_vector
        state_vector = values.get('state_vector')
        if state_vector is not None:
            if len(state_vector) != 6:
                raise ValueError("state_vector must have 6 elements")
            return {
                'x': float(state_vector[0]), 
                'y': float(state_vector[1]), 
                'z': float(state_vector[2]),
                'vx': float(state_vector[3]), 
                'vy': float(state_vector[4]), 
                'vz': float(state_vector[5])
            }
        # If neither provided, error
        raise ValueError("Provide either 'state' or 'state_vector'")

    def to_array(self) -> np.ndarray:
        s = self.state
        return np.array([s["x"],s["y"],s["z"],
                         s["vx"],s["vy"],s["vz"]], dtype=float)


@router.post("/telemetry", status_code=200)
async def ingest_telemetry(payload: Dict[str, Any]):
    # Official NSH contract: {timestamp, objects:[...]}
    if "objects" in payload:
        ts = _parse_timestamp(payload.get("timestamp"))
        objects = payload.get("objects") or []
        processed = 0

        for obj in objects:
            try:
                obj_id = str(obj["id"])
                obj_type = str(obj.get("type", "DEBRIS")).upper()
                r = obj.get("r", {})
                v = obj.get("v", {})
                rr = [float(r["x"]), float(r["y"]), float(r["z"])]
                vv = [float(v["x"]), float(v["y"]), float(v["z"])]
                _upsert_object(obj_id, obj_type, rr, vv, ts)
                processed += 1
            except Exception:
                continue

        scan_full_fleet()
        active_warnings = sum(
            1 for d in orbital_registry.values()
            if d.get("type") == "SATELLITE" and d.get("status") in ("AT_RISK", "MANEUVERING")
        )

        return {
            "status": "ACK",
            "processed_count": int(processed),
            "active_cdm_warnings": int(active_warnings),
        }

    # Backward-compatible contract used by local mock grader
    # Manual parsing to avoid Pydantic validation issues
    try:
        sat_id      = str(payload.get("sat_id"))
        fuel_kg     = float(payload.get("fuel_kg", FUEL_BUDGET))
        timestamp   = _parse_timestamp(payload.get("timestamp", payload.get("epoch")))
        
        # Parse state_vector or state
        if "state_vector" in payload and payload["state_vector"] is not None:
            sv = payload["state_vector"]
            if len(sv) != 6:
                return {"error": "state_vector must have 6 elements"}, 400
            sat_arr = np.array([float(x) for x in sv], dtype=float)
        elif "state" in payload and payload["state"] is not None:
            state_dict = payload["state"]
            sat_arr = np.array([
                float(state_dict["x"]), float(state_dict["y"]), float(state_dict["z"]),
                float(state_dict["vx"]), float(state_dict["vy"]), float(state_dict["vz"])
            ], dtype=float)
        else:
            return {"error": "Provide 'state_vector' or 'state'"}, 400
    except Exception as e:
        return {"error": f"Invalid payload: {str(e)}"}, 400

    if sat_id not in orbital_registry:
        orbital_registry[sat_id] = {
            "type":          "SATELLITE",
            "r":             sat_arr[:3].tolist(),
            "v":             sat_arr[3:].tolist(),
            "fuel_mass":     fuel_kg,
            "nominal_slot":  sat_arr[:3].tolist(),
            "last_update":   timestamp,
            "last_burn":     timestamp - THERMAL_CD,
            "status":        "NOMINAL",
            "min_dist_km":   9999.0,
            "closest_debris":None,
        }
        # Persistence call
        db.upsert_satellite(sat_id, orbital_registry[sat_id])
    else:
        rec = orbital_registry[sat_id]
        rec["r"]           = sat_arr[:3].tolist()
        rec["v"]           = sat_arr[3:].tolist()
        rec["fuel_mass"]   = fuel_kg
        rec["last_update"] = timestamp
        # Persistence call
        db.upsert_satellite(sat_id, rec)

    rec = orbital_registry[sat_id]
    threat, min_dist, closest = check_threats_for_sat(sat_arr[:3], GLOBAL_DEBRIS_IDS, GLOBAL_SPATIAL_TREE)
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
    time_since_burn = timestamp - rec["last_burn"]
    can_burn     = time_since_burn >= THERMAL_CD and rec["fuel_mass"] > 0
    cooling_down = time_since_burn < THERMAL_CD

    # Keep burning every cooldown cycle until threat is cleared
    # Each burn uses fuel but debris keeps being re-evaluated each tick
    if threat and can_burn and dv_mag > 1e-4 and rec["fuel_mass"] > 0:
        # Burn approved — apply delta-v
        dm = (DRY_MASS + rec["fuel_mass"]) * (1 - np.exp(-dv_mag/(ISP*G0)))
        rec["fuel_mass"]  = max(0.0, rec["fuel_mass"] - dm)
        rec["last_burn"]  = timestamp
        rec["status"]     = "MANEUVERING"
        status = "MANEUVER_REQUIRED"
        burn_no = rec.get("burn_count", 0) + 1
        print(
            f"  BURN #{burn_no}: {sat_id} "
            f"| dv={dv_mag:.5f}km/s | fuel_left={rec['fuel_mass']:.2f}kg "
            f"| debris_dist={min_dist:.3f}km"
        )
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
        print(f"  ✅ THREAT CLEARED: {sat_id} | "
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
        elif rec["fuel_mass"] <= EOL_FUEL:
            rec["status"] = "EOL"
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
            _upsert_object(
                obj.id,
                obj.object_type,
                [obj.r.x, obj.r.y, obj.r.z],
                [obj.v.x, obj.v.y, obj.v.z],
                data.timestamp,
            )
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


@router.get("/visualization/snapshot")
async def visualization_snapshot():
    def to_lat_lon_alt(r: List[float]):
        mag = max(1e-9, float(np.linalg.norm(r)))
        lat = math.degrees(math.asin(max(-1.0, min(1.0, r[2] / mag))))
        lon = math.degrees(math.atan2(r[1], r[0]))
        alt = mag - 6378.137
        return round(lat, 5), round(lon, 5), round(alt, 3)

    satellites = []
    debris_cloud = []

    for obj_id, data in orbital_registry.items():
        r = data.get("r")
        if not r or len(r) < 3:
            continue
        lat, lon, alt = to_lat_lon_alt(r)
        if data.get("type") == "SATELLITE":
            satellites.append({
                "id": str(obj_id),
                "lat": lat,
                "lon": lon,
                "fuel_kg": round(float(data.get("fuel_mass", FUEL_BUDGET)), 3),
                "status": str(data.get("status", "NOMINAL")),
            })
        elif data.get("type") == "DEBRIS":
            debris_cloud.append([str(obj_id), lat, lon, alt])

    return {
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "satellites": satellites,
        "debris_cloud": debris_cloud,
    }