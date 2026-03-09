"""
Ground Station Blackout Checker — Project AETHER
NSH-2026

Determines whether a satellite is in a communications blackout zone
(i.e. below minimum elevation angle for ALL ground stations).
"""
import numpy as np
import csv
import os
from typing import List, Tuple

RE = 6378.137   # Earth radius [km]

# Path is relative to repo root
_CSV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "ground_stations.csv")


def _load_stations(csv_path: str) -> List[dict]:
    stations = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stations.append({
                "id":       row["Station_ID"].strip(),
                "name":     row["Station_Name"].strip(),
                "lat_rad":  np.radians(float(row["Latitude"])),
                "lon_rad":  np.radians(float(row["Longitude"])),
                "elev_km":  float(row["Elevation_m"]) / 1000.0,
                "min_el":   np.radians(float(row["Min_Elevation_Angle_deg"])),
            })
    return stations


def _ecef_from_geodetic(lat_rad: float, lon_rad: float, alt_km: float) -> np.ndarray:
    """Converts geodetic (lat, lon, alt) to ECEF position [km]."""
    r = RE + alt_km
    return np.array([
        r * np.cos(lat_rad) * np.cos(lon_rad),
        r * np.cos(lat_rad) * np.sin(lon_rad),
        r * np.sin(lat_rad),
    ])


def elevation_angle(gs_pos: np.ndarray, sat_pos: np.ndarray) -> float:
    """
    Computes the elevation angle of a satellite as seen from a ground station.

    Args:
        gs_pos:  ECEF position of ground station [km]
        sat_pos: ECI/ECEF position of satellite   [km]
                 (treated as ECEF — valid approximation for short intervals)

    Returns:
        elevation angle in radians
    """
    gs_to_sat = sat_pos - gs_pos
    nadir     = -gs_pos / np.linalg.norm(gs_pos)    # points to Earth centre

    # Elevation = 90° − angle between (gs→sat) and (nadir)
    cos_angle = np.dot(gs_to_sat, -nadir) / (np.linalg.norm(gs_to_sat) + 1e-12)
    cos_angle = np.clip(cos_angle, -1.0, 1.0)
    zenith    = np.arccos(cos_angle)
    return (np.pi / 2.0) - zenith


def is_in_blackout(sat_pos_eci: np.ndarray, csv_path: str = _CSV_PATH) -> Tuple[bool, str]:
    """
    Determines if a satellite is in comms blackout (visible to no ground station).

    Args:
        sat_pos_eci: ECI/ECEF satellite position [km]
        csv_path:    path to ground_stations.csv

    Returns:
        (blackout: bool, reason: str)
    """
    stations  = _load_stations(csv_path)
    visible   = []

    for gs in stations:
        gs_pos = _ecef_from_geodetic(gs["lat_rad"], gs["lon_rad"], gs["elev_km"])
        el     = elevation_angle(gs_pos, sat_pos_eci)
        if el >= gs["min_el"]:
            visible.append(gs["name"])

    if not visible:
        return True,  "No ground station in range — BLACKOUT"
    return False, f"Visible via: {', '.join(visible)}"


def get_visible_stations(sat_pos_eci: np.ndarray, csv_path: str = _CSV_PATH) -> List[dict]:
    """Returns list of currently visible ground stations with elevation angles."""
    stations = _load_stations(csv_path)
    result   = []
    for gs in stations:
        gs_pos = _ecef_from_geodetic(gs["lat_rad"], gs["lon_rad"], gs["elev_km"])
        el_rad = elevation_angle(gs_pos, sat_pos_eci)
        el_deg = np.degrees(el_rad)
        result.append({
            "id":      gs["id"],
            "name":    gs["name"],
            "el_deg":  round(el_deg, 2),
            "visible": el_rad >= gs["min_el"],
        })
    return sorted(result, key=lambda x: -x["el_deg"])
