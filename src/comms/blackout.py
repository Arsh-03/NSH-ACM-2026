"""
Ground Station Blackout Checker — Project AETHER
NSH-2026
"""
import numpy as np
import csv
import os
from typing import List, Tuple

RE = 6378.137

_CSV_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "data", "ground_stations.csv"
)


def _load_stations(csv_path: str) -> List[dict]:
    stations = []
    csv_path = os.path.normpath(csv_path)

    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        # Read raw content and fix broken header (trailing comma + newline)
        content = f.read()

    # Fix: join lines where header was split across two lines
    content = content.replace(",\r\nMin_Elevation_Angle_deg", ",Min_Elevation_Angle_deg")
    content = content.replace(",\nMin_Elevation_Angle_deg",   ",Min_Elevation_Angle_deg")

    reader = csv.DictReader(content.splitlines())

    for row in reader:
        # Skip rows where essential fields are missing or None
        if not row.get("Station_Name") or not row.get("Station_ID"):
            continue
        try:
            stations.append({
                "id":      row["Station_ID"].strip(),
                "name":    row["Station_Name"].strip(),
                "lat_rad": np.radians(float(row["Latitude"])),
                "lon_rad": np.radians(float(row["Longitude"])),
                "elev_km": float(row["Elevation_m"]) / 1000.0,
                "min_el":  np.radians(float(row["Min_Elevation_Angle_deg"])),
            })
        except (KeyError, ValueError, TypeError):
            continue  # Skip malformed rows silently

    return stations


def _ecef_from_geodetic(lat_rad: float, lon_rad: float, alt_km: float) -> np.ndarray:
    r = RE + alt_km
    return np.array([
        r * np.cos(lat_rad) * np.cos(lon_rad),
        r * np.cos(lat_rad) * np.sin(lon_rad),
        r * np.sin(lat_rad),
    ])


def elevation_angle(gs_pos: np.ndarray, sat_pos: np.ndarray) -> float:
    gs_to_sat = sat_pos - gs_pos
    nadir     = -gs_pos / (np.linalg.norm(gs_pos) + 1e-12)
    cos_angle = np.dot(gs_to_sat, -nadir) / (np.linalg.norm(gs_to_sat) + 1e-12)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    zenith    = np.arccos(cos_angle)
    return (np.pi / 2.0) - zenith


def is_in_blackout(sat_pos_eci, csv_path: str = _CSV_PATH) -> Tuple[bool, str]:
    """
    Returns (blackout: bool, reason: str).
    Safe against malformed CSV — returns False (not in blackout) on any error.
    """
    try:
        sat_pos = np.array(sat_pos_eci)
        stations = _load_stations(csv_path)

        if not stations:
            return False, "No stations loaded — assuming contact"

        visible = []
        for gs in stations:
            gs_pos = _ecef_from_geodetic(gs["lat_rad"], gs["lon_rad"], gs["elev_km"])
            el     = elevation_angle(gs_pos, sat_pos)
            if el >= gs["min_el"]:
                visible.append(gs["name"])

        if not visible:
            return True, "No ground station in range — BLACKOUT"
        return False, f"Visible via: {', '.join(visible)}"

    except Exception as e:
        # Never crash the auto-pilot due to blackout check failure
        return False, f"Blackout check error (assuming contact): {e}"


def get_visible_stations(sat_pos_eci, csv_path: str = _CSV_PATH) -> List[dict]:
    try:
        sat_pos  = np.array(sat_pos_eci)
        stations = _load_stations(csv_path)
        result   = []
        for gs in stations:
            gs_pos = _ecef_from_geodetic(gs["lat_rad"], gs["lon_rad"], gs["elev_km"])
            el_rad = elevation_angle(gs_pos, sat_pos)
            result.append({
                "id":      gs["id"],
                "name":    gs["name"],
                "el_deg":  round(np.degrees(el_rad), 2),
                "visible": el_rad >= gs["min_el"],
            })
        return sorted(result, key=lambda x: -x["el_deg"])
    except Exception:
        return []