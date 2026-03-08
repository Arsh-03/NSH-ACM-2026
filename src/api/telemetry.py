from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict
import time

router = APIRouter()

# --- 1. Data Models (Strictly following ECI frame requirements) ---

class Vector3D(BaseModel):
    """3D Vector for Position (km) or Velocity (km/s)"""
    x: float
    y: float
    z: float

class SpaceObject(BaseModel):
    """Represents a single Satellite or Debris object"""
    id: str = Field(..., example="SAT-001")
    object_type: str = Field(..., alias="type", example="SATELLITE") # "SATELLITE" or "DEBRIS"
    r: Vector3D # Position vector in ECI frame
    v: Vector3D # Velocity vector in ECI frame

class TelemetrySnapshot(BaseModel):
    """The bulk data packet sent by the simulation grader"""
    timestamp: float # Simulation time in seconds
    objects: List[SpaceObject]

# --- 2. Global State (The "In-Memory" Universe) ---

# This dictionary stores the latest known state of every object in orbit.
# Key: object_id, Value: SpaceObject data + arrival time
orbital_registry: Dict[str, dict] = {}

# --- 3. Endpoints ---

@router.post("/telemetry", status_code=202)
async def ingest_telemetry(data: TelemetrySnapshot):
    """
    Ingests high-frequency state vectors from the simulation.
    Target: 10,000+ objects processed per 'Tick'.
    """
    try:
        start_time = time.perf_counter()
        
        for obj in data.objects:
            # Update our global registry with the fresh state
            orbital_registry[obj.id] = {
                "type": obj.object_type,
                "r": [obj.r.x, obj.r.y, obj.r.z],
                "v": [obj.v.x, obj.v.y, obj.v.z],
                "last_update": data.timestamp
            }
        
        processing_time = (time.perf_counter() - start_time) * 1000
        
        return {
            "status": "ACK",
            "received_objects": len(data.objects),
            "internal_timestamp": data.timestamp,
            "processing_ms": round(processing_time, 2)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Telemetry Ingestion Failed: {str(e)}")

@router.get("/telemetry/count")
async def get_object_count():
    """Verify how many objects are currently being tracked."""
    return {"tracked_objects": len(orbital_registry)}