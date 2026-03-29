import sqlite3
import os
import time
from datetime import datetime, timezone
import json

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "aether_mission.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. Satellite Registry (Current State)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS satellite_registry (
            sat_id TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            fuel_mass REAL NOT NULL,
            r_json TEXT NOT NULL,
            v_json TEXT NOT NULL,
            nominal_slot_json TEXT NOT NULL,
            last_burn REAL,
            last_update REAL NOT NULL
        )
    """)

    # 2. Telemetry History (Time-series)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS telemetry_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sat_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            x REAL, y REAL, z REAL,
            vx REAL, vy REAL, vz REAL,
            FOREIGN KEY (sat_id) REFERENCES satellite_registry (sat_id)
        )
    """)

    # 3. Maneuver Log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS maneuvers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sat_id TEXT NOT NULL,
            burn_time REAL NOT NULL,
            dv_x REAL, dv_y REAL, dv_z REAL,
            dv_mag REAL,
            fuel_consumed REAL,
            reason TEXT,
            FOREIGN KEY (sat_id) REFERENCES satellite_registry (sat_id)
        )
    """)

    # 4. Proximity Alerts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS proximity_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sat_id TEXT NOT NULL,
            debris_id TEXT NOT NULL,
            timestamp REAL NOT NULL,
            min_dist_km REAL,
            FOREIGN KEY (sat_id) REFERENCES satellite_registry (sat_id)
        )
    """)

    conn.commit()
    conn.close()
    print(f"📦 Database initialized at {DB_PATH}")

def load_registry_from_db():
    """Returns a dict corresponding to orbital_registry from the database"""
    registry = {}
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM satellite_registry")
        rows = cursor.fetchall()
        for row in rows:
            registry[row['sat_id']] = {
                "type":          "SATELLITE",
                "status":        row['status'],
                "fuel_mass":     row['fuel_mass'],
                "r":             json.loads(row['r_json']),
                "v":             json.loads(row['v_json']),
                "nominal_slot":  json.loads(row['nominal_slot_json']),
                "last_burn":     row['last_burn'],
                "last_update":   row['last_update']
            }
        conn.close()
    except Exception as e:
        print(f"⚠️ Error loading registry from DB: {e}")
    return registry

def upsert_satellite(sat_id, data):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO satellite_registry (sat_id, status, fuel_mass, r_json, v_json, nominal_slot_json, last_burn, last_update)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(sat_id) DO UPDATE SET
                status=excluded.status,
                fuel_mass=excluded.fuel_mass,
                r_json=excluded.r_json,
                v_json=excluded.v_json,
                last_burn=excluded.last_burn,
                last_update=excluded.last_update
        """, (
            sat_id,
            data.get("status", "NOMINAL"),
            data.get("fuel_mass", 50.0),
            json.dumps(data.get("r", [0,0,0])),
            json.dumps(data.get("v", [0,0,0])),
            json.dumps(data.get("nominal_slot", data.get("r", [0,0,0]))),
            data.get("last_burn"),
            data.get("last_update", time.time())
        ))
        
        # Archiving telemetry
        r = data.get("r", [0,0,0])
        v = data.get("v", [0,0,0])
        cursor.execute("""
            INSERT INTO telemetry_history (sat_id, timestamp, x, y, z, vx, vy, vz)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (sat_id, data.get("last_update", time.time()), r[0], r[1], r[2], v[0], v[1], v[2]))
        
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ Error upserting satellite to DB: {e}")

def log_maneuver(sat_id, burn_time, dv, fuel_spent, reason="MANEUVERING"):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        dv_mag = (sum(x**2 for x in dv)**0.5) if dv else 0.0
        cursor.execute("""
            INSERT INTO maneuvers (sat_id, burn_time, dv_x, dv_y, dv_z, dv_mag, fuel_consumed, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (sat_id, burn_time, dv[0], dv[1], dv[2], dv_mag, fuel_spent, reason))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ Error logging maneuver to DB: {e}")

def log_alert(sat_id, debris_id, timestamp, min_dist):
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO proximity_alerts (sat_id, debris_id, timestamp, min_dist_km)
            VALUES (?, ?, ?, ?)
        """, (sat_id, debris_id, timestamp, min_dist))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ Error logging alert to DB: {e}")
