"""
FastAPI Backend — Project AETHER
NSH-2026 | Autonomous Constellation Manager
Port: 8000
"""
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import List, Optional, Set
import numpy as np
import torch
import torch.nn as nn
import os
import json
import asyncio
import time

# ── Match your actual project structure (src.ai not src.agent) ───────────────
from src.ai.ppo_agent import PPOAgent
from src.physics.integrator import rk4_step
from src.ai.spatial_index import build_spatial_index, find_nearby_threats
from src.api.telemetry import router as telemetry_router
from src.api.maneuvers import router as maneuvers_router
from src.api.simulation import router as simulation_router

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
_ws_clients: Set[WebSocket] = set()  # Track active WebSocket connections


# ── WebSocket Connection Manager ──────────────────────────────────────────────
async def broadcast_state_update():
    """Broadcast current constellation state to all connected WebSocket clients"""
    if not _ws_clients:
        return
    
    # Convert constellation to frontend-friendly format
    satellites_list = []
    for sat_id, rec in _constellation.items():
        state = rec["state"]
        satellites_list.append({
            "id": sat_id,
            "r": state[:3].tolist(),
            "v": state[3:].tolist(),
            "fuel": rec["fuel"],
            "status": "NOMINAL" if rec["fuel"] > EOL_FUEL_KG else "EOL"
        })
    
    debris_list = []
    for i, deb_state in enumerate(_debris_cache):
        debris_list.append({
            "id": f"DEBRIS-{i}",
            "r": deb_state[:3].tolist() if len(deb_state) >= 3 else [0, 0, 0],
            "v": deb_state[3:].tolist() if len(deb_state) >= 6 else [0, 0, 0]
        })
    
    message = {
        "type": "state_update",
        "satellites": satellites_list,
        "debris": debris_list,
        "sat_count": len(satellites_list),
        "debris_count": len(debris_list),
        "at_risk": sum(1 for s in satellites_list if s["status"] != "NOMINAL")
    }
    
    # Send to all connected clients
    disconnected = set()
    for ws in _ws_clients:
        try:
            await ws.send_json(message)
        except Exception as e:
            print(f"[WS] Error broadcasting to client: {e}")
            disconnected.add(ws)
    
    # Remove disconnected clients
    _ws_clients.difference_update(disconnected)


# ── Schemas ───────────────────────────────────────────────────────────────────
class ECIState(BaseModel):
    x: float;  y: float;  z: float
    vx: float; vy: float; vz: float
    def to_array(self): return np.array([self.x,self.y,self.z,self.vx,self.vy,self.vz])

class TelemetryPayload(BaseModel):
    sat_id:        str
    timestamp:     Optional[float] = None
    epoch:         Optional[float] = None
    state:         Optional[ECIState] = None
    state_vector:  Optional[List[float]] = None
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
async def ingest_telemetry(payload: TelemetryPayload):
    global _debris_cache
    
    # Handle timestamp/epoch conversion
    ts = payload.timestamp if payload.timestamp is not None else (payload.epoch if payload.epoch is not None else time.time())
    
    # Handle state/state_vector conversion
    if payload.state is not None:
        sat_arr = payload.state.to_array()
    elif payload.state_vector is not None and len(payload.state_vector) == 6:
        sat_arr = np.array([float(x) for x in payload.state_vector], dtype=float)
    else:
        return {"error": "Provide either 'state' or 'state_vector'"}, 400

    if payload.sat_id not in _constellation:
        _constellation[payload.sat_id] = {
            "state":         sat_arr,
            "nominal_slot":  sat_arr[:3].copy(),
            "fuel":          payload.fuel_kg,
            "last_burn_time": ts - THERMAL_CD,
            "time":          ts,
            "eol":           False,
        }
    else:
        rec = _constellation[payload.sat_id]
        rec["state"] = sat_arr
        rec["fuel"]  = payload.fuel_kg
        rec["time"]  = ts
        rec["eol"]   = payload.fuel_kg <= EOL_FUEL_KG

    if payload.debris_states:
        _debris_cache = [d.to_array() for d in payload.debris_states]

    # Broadcast updated state to all WebSocket clients
    await broadcast_state_update()

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


@app.get("/api/telemetry/count")
def get_telemetry_count():
    """Get current constellation telemetry counts"""
    at_risk = sum(1 for r in _constellation.values() 
                 if r["fuel"] <= EOL_FUEL_KG or r["eol"])
    return {
        "satellites": len(_constellation),
        "debris": len(_debris_cache),
        "at_risk": at_risk
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


# ── WebSocket Endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Live constellation state streaming via WebSocket"""
    await websocket.accept()
    _ws_clients.add(websocket)
    print(f"[WS] Client connected. Total: {len(_ws_clients)}")
    
    try:
        # Send initial state
        await broadcast_state_update()
        
        # Listen for client messages
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "get_state":
                    # Client requested current state
                    await broadcast_state_update()
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)
        print(f"[WS] Client disconnected. Total: {len(_ws_clients)}")
    except Exception as e:
        print(f"[WS] Error: {e}")
        _ws_clients.discard(websocket)


# ── CORS Middleware ───────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Include Routers ───────────────────────────────────────────────────────────
app.include_router(telemetry_router, prefix="/api", tags=["telemetry"])
app.include_router(maneuvers_router, prefix="/api", tags=["maneuvers"])
app.include_router(simulation_router, prefix="/api", tags=["simulation"])