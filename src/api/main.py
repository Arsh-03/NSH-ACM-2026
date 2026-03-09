"""
FastAPI Backend — Project AETHER
NSH-2026 | Autonomous Constellation Manager
Port: 8000
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import numpy as np
import torch
import torch.nn as nn
import os

# ── Match your actual project structure (src.ai not src.agent) ───────────────
from src.ai.ppo_agent import PPOAgent
from src.physics.integrator import rk4_step
from src.ai.spatial_index import build_spatial_index, find_nearby_threats

# ── Constants ─────────────────────────────────────────────────────────────────
RE             = 6378.137
MU             = 398600.4418
FUEL_BUDGET    = 50.0
DRY_MASS       = 500.0
MAX_THRUST     = 0.015
THERMAL_CD     = 600.0
D_CRIT         = 0.1
EOL_FUEL_KG    = 2.5

BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR       = os.path.dirname(os.path.dirname(BASE_DIR))
MODEL_PATH     = os.environ.get(
    "MODEL_PATH",
    os.path.join(ROOT_DIR, "models", "acm_ppo_v1.pth")
)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Project AETHER — ACM API",
    description="Autonomous Constellation Manager | NSH-2026",
    version="1.0.0"
)

# ── Model loader ──────────────────────────────────────────────────────────────
_model: Optional[PPOAgent] = None

def get_model() -> PPOAgent:
    global _model
    if _model is None:
        _model = PPOAgent()
        if os.path.exists(MODEL_PATH):
            _model.load_state_dict(
                torch.load(MODEL_PATH, map_location="cpu"))
            _model.eval()
            print(f"[AETHER] Model loaded from {MODEL_PATH}")
        else:
            print(f"[AETHER] WARNING: No weights at {MODEL_PATH}. "
                  f"Run training first: python -m src.ai.train_ppo")
    return _model

# ── In-memory constellation state ─────────────────────────────────────────────
_constellation: dict = {}
_debris_cache:  list = []


# ── Schemas ───────────────────────────────────────────────────────────────────
class ECIState(BaseModel):
    x: float;  y: float;  z: float
    vx: float; vy: float; vz: float
    def to_array(self): return np.array([self.x,self.y,self.z,self.vx,self.vy,self.vz])

class TelemetryPayload(BaseModel):
    sat_id:        str
    timestamp:     float
    state:         ECIState
    fuel_kg:       float = Field(FUEL_BUDGET, ge=0.0, le=FUEL_BUDGET)
    debris_states: List[ECIState] = []

class ManeuverRequest(BaseModel):
    sat_id:    str
    timestamp: float

class ManeuverResponse(BaseModel):
    sat_id:         str
    delta_v:        List[float]
    dv_magnitude:   float
    burn_approved:  bool
    reason:         str
    fuel_remaining: float
    eol_flag:       bool


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    model_ready = os.path.exists(MODEL_PATH)
    return {
        "status":      "ok",
        "service":     "AETHER-ACM",
        "version":     "1.0.0",
        "model_ready": model_ready,
        "model_path":  MODEL_PATH,
        "satellites":  len(_constellation),
    }


@app.post("/api/telemetry")
def ingest_telemetry(payload: TelemetryPayload):
    global _debris_cache
    sat_arr = payload.state.to_array()

    if payload.sat_id not in _constellation:
        _constellation[payload.sat_id] = {
            "state":         sat_arr,
            "nominal_slot":  sat_arr[:3].copy(),
            "fuel":          payload.fuel_kg,
            "last_burn_time": payload.timestamp - THERMAL_CD,
            "time":          payload.timestamp,
            "eol":           False,
        }
    else:
        rec = _constellation[payload.sat_id]
        rec["state"] = sat_arr
        rec["fuel"]  = payload.fuel_kg
        rec["time"]  = payload.timestamp
        rec["eol"]   = payload.fuel_kg <= EOL_FUEL_KG

    if payload.debris_states:
        _debris_cache = [d.to_array() for d in payload.debris_states]

    return {
        "status":   "accepted",
        "sat_id":   payload.sat_id,
        "fuel_kg":  payload.fuel_kg,
        "eol_flag": _constellation[payload.sat_id]["eol"],
        "debris_ct": len(_debris_cache),
    }


@app.post("/api/maneuver/schedule", response_model=ManeuverResponse)
def schedule_maneuver(req: ManeuverRequest):
    if req.sat_id not in _constellation:
        raise HTTPException(404, f"Satellite {req.sat_id} not found. Send telemetry first.")

    rec   = _constellation[req.sat_id]
    model = get_model()

    # Build 6-dim normalised state (matches PPOAgent input)
    state    = rec["state"]
    norm_s   = state / np.array([7500,7500,7500,8,8,8])
    state_t  = torch.FloatTensor(norm_s).unsqueeze(0)

    with torch.no_grad():
        action_mean = model.actor(state_t)
    dv_raw = action_mean.squeeze(0).numpy()
    dv_vec = np.clip(dv_raw, -1.0, 1.0) * MAX_THRUST
    dv_mag = float(np.linalg.norm(dv_vec))

    # Thermal cooldown check
    time_since_burn = req.timestamp - rec["last_burn_time"]
    if time_since_burn < THERMAL_CD:
        wait = THERMAL_CD - time_since_burn
        return ManeuverResponse(
            sat_id=req.sat_id, delta_v=[0,0,0], dv_magnitude=0,
            burn_approved=False,
            reason=f"Thermal cooldown: {wait:.0f}s remaining",
            fuel_remaining=rec["fuel"], eol_flag=rec["eol"])

    # Fuel check
    if rec["fuel"] <= 0:
        return ManeuverResponse(
            sat_id=req.sat_id, delta_v=[0,0,0], dv_magnitude=0,
            burn_approved=False, reason="Fuel exhausted",
            fuel_remaining=0.0, eol_flag=True)

    # EOL check
    if rec["eol"]:
        return ManeuverResponse(
            sat_id=req.sat_id, delta_v=dv_vec.tolist(),
            dv_magnitude=dv_mag, burn_approved=True,
            reason="EOL: Graveyard maneuver initiated",
            fuel_remaining=rec["fuel"], eol_flag=True)

    rec["last_burn_time"] = req.timestamp
    return ManeuverResponse(
        sat_id=req.sat_id, delta_v=dv_vec.tolist(),
        dv_magnitude=dv_mag, burn_approved=True,
        reason="Burn approved", fuel_remaining=rec["fuel"],
        eol_flag=False)


@app.get("/api/status/{sat_id}")
def get_status(sat_id: str):
    if sat_id not in _constellation:
        raise HTTPException(404, f"{sat_id} not registered.")
    rec   = _constellation[sat_id]
    state = rec["state"]
    alt   = float(np.linalg.norm(state[:3]) - RE)
    return {
        "sat_id":            sat_id,
        "altitude_km":       round(alt, 3),
        "position_eci_km":   state[:3].tolist(),
        "velocity_eci_kmps": state[3:].tolist(),
        "fuel_kg":           round(rec["fuel"], 4),
        "fuel_pct":          round(rec["fuel"]/FUEL_BUDGET*100, 1),
        "eol_flag":          rec["eol"],
        "dist_from_slot_km": round(float(
            np.linalg.norm(state[:3]-rec["nominal_slot"])), 3),
    }


@app.get("/api/constellation")
def get_constellation():
    return {
        "total":     len(_constellation),
        "eol_count": sum(1 for r in _constellation.values() if r["eol"]),
        "satellites": [
            {"sat_id": sid, "fuel_kg": round(r["fuel"],2), "eol": r["eol"]}
            for sid, r in _constellation.items()
        ]
    }