import uvicorn
import asyncio
import json
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.websockets import WebSocketState

from src.api import telemetry, simulation, maneuvers
from src.ai.auto_pilot import run_auto_pilot

# ── App ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="NSH-ACM-2026 Mission Control")

# ── CORS ──────────────────────────────────────────────────────────────────────
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
        # Send full state immediately on connect
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
                # Push live update every second even with no incoming message
                if websocket.client_state == WebSocketState.CONNECTED:
                    await _send_state(websocket)

    except WebSocketDisconnect:
        print("[WS] Client disconnected.")
    except Exception as e:
        print(f"[WS] Error: {e}")
    finally:
        if websocket in connected_clients:
            connected_clients.remove(websocket)


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _send_state(websocket: WebSocket):
    """Sends full constellation state to one client."""
    from src.api.telemetry import orbital_registry

    satellites, debris = [], []

    for obj_id, data in orbital_registry.items():
        obj = {
            "id":   obj_id,
            "r":    data.get("r",   [0, 0, 0]),
            "v":    data.get("v",   [0, 0, 0]),
            "fuel": round(data.get("fuel_mass", 50.0), 2),
            "type": data.get("type", "UNKNOWN"),
        }
        if data.get("type") == "SATELLITE":
            obj["status"]    = data.get("status",    "NOMINAL")
            obj["last_burn"] = data.get("last_burn",  0)
            satellites.append(obj)
        else:
            debris.append(obj)

    payload = {
        "type":         "state_update",
        "timestamp":    time.time(),
        "satellites":   satellites,
        "debris":       debris,
        "sat_count":    len(satellites),
        "debris_count": len(debris),
        "total":        len(orbital_registry),
    }
    await websocket.send_text(json.dumps(payload))


def _build_strategy() -> str:
    """Returns AI strategic assessment for the frontend advisory panel."""
    from src.api.telemetry import orbital_registry

    sats   = [v for v in orbital_registry.values()
               if v.get("type") == "SATELLITE"]
    debris = [v for v in orbital_registry.values()
               if v.get("type") == "DEBRIS"]

    if not sats:
        return ("No satellites registered. "
                "Send telemetry to begin constellation tracking.")

    low_fuel = [s for s in sats if s.get("fuel_mass", 50) < 10]

    msg  = (f"Tracking {len(sats)} satellite(s) and "
            f"{len(debris)} debris object(s). ")
    msg += ("All systems nominal. " if not low_fuel else
            f"WARNING: {len(low_fuel)} satellite(s) below 10 kg fuel. ")
    msg += "PPO collision avoidance ACTIVE. Station-keeping ENABLED."
    return msg


async def broadcast(message: dict):
    """Push an alert to all connected WebSocket clients."""
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
    return {
        "status":     "operational",
        "system":     "ACM-v1",
        "model_ready": True,
        "satellites": sum(1 for v in orbital_registry.values()
                          if v.get("type") == "SATELLITE"),
        "ws_clients": len(connected_clients),
    }


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    asyncio.create_task(run_auto_pilot())


# ── Static frontend (uncomment after npm run build) ───────────────────────────
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)