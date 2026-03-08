import numpy as np
import pandas as pd

# Load the official Ground Station Network [cite: 191]
GROUND_STATIONS = pd.read_csv("data/ground_stations.csv")
RE = 6378.137  # Earth radius in km [cite: 67]

def eci_to_lla(r_vector):
    """
    Converts ECI (x, y, z) to Latitude, Longitude, and Altitude.
    This is required to check Line-of-Sight against ground stations[cite: 185].
    """
    x, y, z = r_vector
    
    # 1. Calculate Altitude
    r_mag = np.linalg.norm(r_vector)
    alt = r_mag - RE
    
    # 2. Calculate Latitude
    lat = np.arcsin(z / r_mag)
    
    # 3. Calculate Longitude (Simplified for simulation time)
    # Note: In a real-world scenario, you'd account for Earth's rotation (GMST)
    lon = np.arctan2(y, x)
    
    # Convert from Radians to Degrees for CSV comparison 
    return np.degrees(lat), np.degrees(lon), alt

def calculate_elevation(sat_lat, sat_lon, sat_alt, station):
    """
    Calculates the elevation angle of the satellite from a ground station.
    Ensures the 5.0 - 15.0 degree mask angle is respected[cite: 193, 195].
    """
    # Simplified geometric elevation check for the NSH-2026 environment
    # In a full engine, you'd use a Topocentric (SEZ) conversion here.
    dist = np.sqrt((sat_lat - station['Latitude'])**2 + (sat_lon - station['Longitude'])**2)
    # Basic approximation of elevation based on altitude and distance
    elevation = np.degrees(np.arctan2(sat_alt, dist * 111.32)) # 111.32 km per degree
    return elevation

def has_line_of_sight(r_vector):
    """
    Final check: Is the satellite visible to ANY station? [cite: 185, 192]
    """
    sat_lat, sat_lon, sat_alt = eci_to_lla(r_vector)
    
    for _, station in GROUND_STATIONS.iterrows():
        el = calculate_elevation(sat_lat, sat_lon, sat_alt, station)
        if el >= station['Min_Elevation_Angle_deg']:
            return True
    return False