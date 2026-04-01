import uvicorn
import asyncio
import json
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketState

from src.api import telemetry, simulation, maneuvers
from src.ai.auto_pilot import run_auto_pilot

# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    asyncio.create_task(run_auto_pilot())
    yield
    # Shutdown (if needed)

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="NSH-ACM-2026 Mission Control", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── REST Routers ──────────────────────────────────────────────────────────────
app.include_router(telemetry.router,  prefix="/api", tags=["Telemetry"])
app.include_router(simulation.router, prefix="/api", tags=["Simulation"])
app.include_router(maneuvers.router,  prefix="/api", tags=["Maneuvers"])

# ── WebSocket state ───────────────────────────────────────────────────────────
connected_clients: list = []


# ── WebSocket endpoint ────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.append(websocket)
    print(f"[WS] Client connected. Total: {len(connected_clients)}")

    try:
        await _send_state(websocket)

        while True:
            try:
                msg  = await asyncio.wait_for(
                    websocket.receive_text(), timeout=1.0)
                data = json.loads(msg)

                if data.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps({"type": "pong"}))

                elif data.get("type") == "get_state":
                    await _send_state(websocket)

                elif data.get("type") == "get_strategy":
                    await websocket.send_text(json.dumps({
                        "type":     "strategy",
                        "strategy": _build_strategy(),
                    }))

            except asyncio.TimeoutError:
                if websocket.client_state == WebSocketState.CONNECTED:
                    await _send_state(websocket)

    except WebSocketDisconnect:
        print("[WS] Client disconnected.")
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


# ── State builder ─────────────────────────────────────────────────────────────
async def _send_state(websocket: WebSocket):
    from src.api.telemetry import orbital_registry

    satellites, debris_compact = [], []
    for obj_id, data in orbital_registry.items():
        if not data.get("r"):
            continue
        if data.get("type") == "SATELLITE":
            satellites.append({
                "id": str(obj_id),
                "r": [float(x) for x in data["r"]],
                "v": [float(x) for x in data["v"]],
                "fuel": float(data.get("fuel_mass", 50.0)),
                "status": str(data.get("status", "NOMINAL")),
                "last_burn": float(data.get("last_burn", 0)),
                "lastUpdate": float(data.get("last_update", 0)),
                "type": "SATELLITE"
            })
        elif data.get("type") == "DEBRIS":
            # Compact format: [id, x, y, z]
            r = data["r"]
            debris_compact.append([str(obj_id), float(r[0]), float(r[1]), float(r[2])])

    # ── Simulation Clock ──────────────────────────────────────────────────────
    # We use the most recent satellite update timestamp as the authoritative
    # 'sim_time'. This ensures the frontend's GMST calculation stays perfectly
    # in sync with the backend's integrator clock, eliminating longitudinal drift.
    authoritative_ts = max((s["lastUpdate"] for s in satellites), default=time.time())

    payload = {
        "type": "state_update",
        "timestamp": float(authoritative_ts),
        "satellites": satellites,
        "debris_compact": debris_compact,
        "sat_count": len(satellites),
        "debris_count": len(debris_compact),
    }
    await websocket.send_text(json.dumps(payload))


def _build_strategy() -> str:
    from src.api.telemetry import orbital_registry

    sats   = [v for v in orbital_registry.values()
               if v.get("type") == "SATELLITE"]
    debris = [v for v in orbital_registry.values()
               if v.get("type") == "DEBRIS"]

    if not sats:
        return ("No satellites registered. "
                "Send telemetry to begin constellation tracking.")

    low_fuel = [s for s in sats if float(s.get("fuel_mass", 50)) < 10]
    evading  = [s for s in sats if s.get("status") == "EVADING"]

    msg  = (f"Tracking {len(sats)} satellite(s) and "
            f"{len(debris)} debris object(s). ")
    if evading:
        msg += f"ALERT: {len(evading)} satellite(s) executing evasion burn. "
    elif low_fuel:
        msg += f"WARNING: {len(low_fuel)} satellite(s) below 10kg fuel. "
    else:
        msg += "All systems nominal. "
    msg += "PPO collision avoidance ACTIVE. Station-keeping ENABLED."
    return msg


async def broadcast(message: dict):
    dead = []
    for ws in connected_clients:
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(json.dumps(message))
        except Exception:
            dead.append(ws)
    for ws in dead:
        connected_clients.remove(ws)


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health_check():
    from src.api.telemetry import orbital_registry
    sats = sum(1 for v in orbital_registry.values()
               if v.get("type") == "SATELLITE")
    return {
        "status":      "operational",
        "system":      "ACM-v1",
        "model_ready": True,
        "satellites":  int(sats),
        "ws_clients":  int(len(connected_clients)),
    }


# ── Serve frontend (uncomment after npm run build) ────────────────────────────
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)