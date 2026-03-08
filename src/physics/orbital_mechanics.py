import numpy as np

# Earth Constant
MU = 398600.4418  # km^3/s^2
RE = 6378.137     # Earth Radius in km

def get_orbital_elements(state):
    """
    Extracts key orbital parameters from a state vector [r, v].
    """
    r_vec = np.array(state[:3])
    v_vec = np.array(state[3:])
    r_mag = np.linalg.norm(r_vec)
    v_mag = np.linalg.norm(v_vec)

    # 1. Altitude (Height above Earth's surface)
    altitude = r_mag - RE

    # 2. Specific Orbital Energy (epsilon)
    energy = (v_mag**2 / 2) - (MU / r_mag)

    # 3. Semi-major Axis (a)
    # If a < 0, the orbit is hyperbolic (escape trajectory)
    semi_major_axis = -MU / (2 * energy)

    # 4. Orbital Period (T) in seconds
    period = 2 * np.pi * np.sqrt(semi_major_axis**3 / MU)

    return {
        "altitude_km": round(altitude, 2),
        "period_min": round(period / 60, 2),
        "is_stable": energy < 0
    }