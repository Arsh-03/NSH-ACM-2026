import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from src.api import telemetry, simulation, maneuvers
from src.ai.auto_pilot import run_auto_pilot
import asyncio


# Import your custom logic modules (we will create these next)
# from src.api import telemetry, maneuvers, simulation

app = FastAPI(title="NSH-ACM-2026 Mission Control")

# 1. Enable CORS so your React frontend can talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Include API Routers
app.include_router(telemetry.router, prefix="/api", tags=["Telemetry"])
app.include_router(simulation.router, prefix="/api", tags=["Simulation"])
app.include_router(maneuvers.router, prefix="/api", tags=["Maneuvers"])

@app.get("/api/health")
async def health_check():
    """Verify the system is online for the grader."""
    return {"status": "operational", "system": "ACM-v1"}

@app.on_event("startup")
async def startup_event():
    """Start the Auto-Pilot task when the server starts."""
    asyncio.create_task(run_auto_pilot())

# 3. Serve React Static Files
# Note: Ensure you run 'npm run build' in your frontend folder first
# app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="frontend")

if __name__ == "__main__":
    # Must bind to 0.0.0.0:8000 for the NSH evaluation environment
    uvicorn.run(app, host="0.0.0.0", port=8000)