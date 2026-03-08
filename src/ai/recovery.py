import numpy as np
from src.api.maneuvers import ManeuverRequest

def calculate_recovery_burn(sat_id, current_state, nominal_slot, current_sim_time):
    """
    Calculates a recovery burn to return the satellite to its 10km slot.
    Utilizes a phasing maneuver (Transverse burn) to correct drift.
    """
    # 1. Calculate the Error Vector (Current Position - Nominal Slot) [cite: 69]
    error_vector = current_state[:3] - nominal_slot[:3]
    distance_error = np.linalg.norm(error_vector)
    
    # 2. Check if recovery is needed (Tolerance is 10 km) 
    if distance_error < 8.0: # Start recovery early at 8km to stay safe
        return None

    # 3. Calculate corrective Delta-V in the Transverse (Velocity) direction 
    # This is a simplified proportional controller for the hackathon
    velocity_dir = current_state[3:] / np.linalg.norm(current_state[3:])
    
    # A small push opposite to the drift direction
    dv_magnitude = 0.002 # 2 m/s correction [cite: 62]
    dv_vector = -velocity_dir * dv_magnitude 
    
    return ManeuverRequest(
        satellite_id=sat_id,
        burn_time=current_sim_time + 600.0, # Respect 600s cooldown [cite: 63]
        dv_x=dv_vector[0], dv_y=dv_vector[1], dv_z=dv_vector[2]
    )