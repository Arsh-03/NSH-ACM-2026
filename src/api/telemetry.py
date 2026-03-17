from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator
from typing import List, Dict, Optional
import numpy as np
import torch
import time

from src.ai.ppo_agent import PPOAgent
import os

router = APIRouter()

# ── Constants ─────────────────────────────────────────────────────────────────
FUEL_BUDGET = 50.0
MAX_THRUST  = 0.015
ISP         = 300.0
G0          = 9.80665e-3
DRY_MASS    = 500.0
EOL_FUEL    = 2.5
THERMAL_CD  = 600.0

# ── Model loader ──────────────────────────────────────────────────────────────
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

# ── Global State ──────────────────────────────────────────────────────────────
orbital_registry: Dict[str, dict] = {}


# ── Schemas ───────────────────────────────────────────────────────────────────

class Vector3D(BaseModel):
    x: float; y: float; z: float

class SpaceObject(BaseModel):
    """Original bulk-telemetry format (simulation ticks)"""
    id: str = Field(..., example="SAT-001")
    object_type: str = Field(..., alias="type", example="SATELLITE")
    r: Vector3D
    v: Vector3D

class TelemetrySnapshot(BaseModel):
    """Original bulk format: { timestamp, objects: [...] }"""
    timestamp: float
    objects: List[SpaceObject]

class NSHTelemetry(BaseModel):
    """
    NSH Grader / mock_grader.py format:
    { "sat_id": "SAT-01", "state_vector": [x,y,z,vx,vy,vz], "epoch": 123.0 }
    
    Also accepts standard format:
    { "sat_id": "SAT-01", "state": {x,y,z,vx,vy,vz}, "timestamp": 123.0 }
    """
    sat_id:       str
    # NSH grader fields
    state_vector: Optional[List[float]] = None
    epoch:        Optional[float]       = None
    # Standard fields
    state:        Optional[Dict]        = None
    timestamp:    Optional[float]       = None
    fuel_kg:      float                 = FUEL_BUDGET

    @model_validator(mode="after")
    def normalise(self):
        # epoch → timestamp
        if self.epoch is not None and self.timestamp is None:
            self.timestamp = self.epoch
        if self.timestamp is None:
            self.timestamp = time.time()
        # state_vector → state dict
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
        return np.array([s["x"],s["y"],s["z"],s["vx"],s["vy"],s["vz"]])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/telemetry", status_code=200)
async def ingest_telemetry(data: NSHTelemetry):
    """
    PRIMARY endpoint — handles NSH grader + standard single-sat format.
    Returns MANEUVER_REQUIRED or NOMINAL with delta_v.
    """
    sat_arr = data.to_array()
    sat_id  = data.sat_id

    # Register / update satellite
    if sat_id not in orbital_registry:
        orbital_registry[sat_id] = {
            "type":          "SATELLITE",
            "r":             sat_arr[:3].tolist(),
            "v":             sat_arr[3:].tolist(),
            "fuel_mass":     data.fuel_kg,
            "nominal_slot":  sat_arr[:3].tolist(),
            "last_update":   data.timestamp,
            "last_burn":     data.timestamp - THERMAL_CD,
        }
    else:
        rec = orbital_registry[sat_id]
        rec["r"]           = sat_arr[:3].tolist()
        rec["v"]           = sat_arr[3:].tolist()
        rec["fuel_mass"]   = data.fuel_kg
        rec["last_update"] = data.timestamp

    rec = orbital_registry[sat_id]

    # Check debris threats in registry
    debris_positions = [
        d["r"] for d in orbital_registry.values()
        if d.get("type") == "DEBRIS"
    ]
    threat_close = False
    if debris_positions:
        dists = [np.linalg.norm(sat_arr[:3] - np.array(p))
                 for p in debris_positions]
        if min(dists) < 1000.0:
            threat_close = True

    # Run PPO agent
    agent   = get_agent()
    norm_s  = sat_arr / np.array([7500,7500,7500,8,8,8])
    with torch.no_grad():
        dv_raw = agent.actor(
            torch.FloatTensor(norm_s).unsqueeze(0)).squeeze(0).numpy()
    dv_vec = np.clip(dv_raw, -1.0, 1.0) * MAX_THRUST
    dv_mag = float(np.linalg.norm(dv_vec))

    time_since_burn = data.timestamp - rec["last_burn"]
    can_burn = (time_since_burn >= THERMAL_CD
                and rec["fuel_mass"] > 0
                and dv_mag > 1e-4)

    if threat_close and can_burn:
        # Apply burn
        dm = (DRY_MASS + rec["fuel_mass"]) * \
             (1 - np.exp(-dv_mag / (ISP * G0)))
        rec["fuel_mass"] = max(0.0, rec["fuel_mass"] - dm)
        rec["last_burn"] = data.timestamp
        status = "MANEUVER_REQUIRED"
    else:
        dv_vec = np.zeros(3)
        dv_mag = 0.0
        status = "NOMINAL"

    return {
        "status":          status,
        "sat_id":          sat_id,
        "delta_v":         dv_vec.tolist(),
        "dv_magnitude":    round(dv_mag, 6),
        "fuel_remaining":  round(rec["fuel_mass"], 4),
        "eol_flag":        rec["fuel_mass"] <= EOL_FUEL,
        "accepted":        True,
    }


@router.post("/telemetry/bulk", status_code=202)
async def ingest_bulk_telemetry(data: TelemetrySnapshot):
    """
    BULK endpoint — handles simulation tick format with objects list.
    Used by simulation.py for full fleet propagation.
    """
    try:
        start = time.perf_counter()
        for obj in data.objects:
            orbital_registry[obj.id] = {
                "type":        obj.object_type,
                "r":           [obj.r.x, obj.r.y, obj.r.z],
                "v":           [obj.v.x, obj.v.y, obj.v.z],
                "fuel_mass":   orbital_registry.get(obj.id, {}).get("fuel_mass", FUEL_BUDGET),
                "last_update": data.timestamp,
                "last_burn":   orbital_registry.get(obj.id, {}).get("last_burn", data.timestamp - THERMAL_CD),
            }
        ms = (time.perf_counter() - start) * 1000
        return {
            "status":            "ACK",
            "received_objects":  len(data.objects),
            "internal_timestamp": data.timestamp,
            "processing_ms":     round(ms, 2),
        }
    except Exception as e:
        raise HTTPException(500, f"Bulk telemetry failed: {e}")


@router.get("/telemetry/count")
async def get_object_count():
    return {
        "tracked_objects": len(orbital_registry),
        "satellites": sum(1 for o in orbital_registry.values() if o.get("type")=="SATELLITE"),
        "debris":     sum(1 for o in orbital_registry.values() if o.get("type")=="DEBRIS"),
    }