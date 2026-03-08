import numpy as np

# --- 1. Earth Physical Constants (Standard WGS84) ---
MU = 398600.4418  # Earth's gravitational parameter (km^3/s^2)
J2 = 1.08263e-3   # J2 perturbation coefficient
RE = 6378.137     # Earth's equatorial radius (km)

def get_acceleration(state):
    """
    Calculates total acceleration: Central Gravity + J2 Perturbation.
    state: [x, y, z, vx, vy, vz]
    """
    r_vec = state[:3]
    r_mag = np.linalg.norm(r_vec)
    
    # 1. Basic Two-Body Gravity (Newtonian)
    a_grav = -MU * r_vec / (r_mag**3)
    
    # 2. J2 Perturbation Logic
    # This accounts for the equatorial bulge pulling on the satellite.
    z = r_vec[2]
    factor = (1.5 * J2 * MU * RE**2) / (r_mag**5)
    z_ratio = 5 * (z**2 / r_mag**2)
    
    a_j2 = factor * np.array([
        r_vec[0] * (z_ratio - 1),
        r_vec[1] * (z_ratio - 1),
        r_vec[2] * (z_ratio - 3)
    ])
    
    return a_grav + a_j2

def rk4_step(state, dt):
    """
    Advances the state vector by dt seconds using RK4 Integration.
    dt: Time step (seconds)
    """
    def derivatives(s):
        v = s[3:]
        a = get_acceleration(s)
        return np.concatenate([v, a])

    # Standard RK4 coefficients
    k1 = derivatives(state)
    k2 = derivatives(state + 0.5 * dt * k1)
    k3 = derivatives(state + 0.5 * dt * k2)
    k4 = derivatives(state + dt * k3)
    
    # Combine to find the final state
    return state + (dt / 6.0) * (k1 + 2*k2 + 2*k3 + k4)