import numpy as np
from src.physics.integrator import rk4_step

# NSH-2026 Physics Constants
RE = 6378.137 
MU = 398600.4418

def generate_conjunction_scenario(sat_state):
    """
    Creates a debris object that is physically in orbit and 
    guaranteed to pass within 500m of the satellite at t=1000s.
    """
    # 1. Project the satellite's "Nominal Path" forward
    # We pick a time-to-closest-approach (TCA) of 1000 seconds
    t_ca = 1000.0 
    future_sat = rk4_step(sat_state, t_ca)
    future_pos = future_sat[:3]
    
    # 2. Define the "Kill Zone" (The intersection point)
    # We add a 0.2 km (200m) offset to force the AI to distinguish 
    # between 'Safe' and 'Unsafe' encounters.
    offset = np.random.uniform(-0.2, 0.2, 3) 
    collision_point = future_pos + offset
    
    # 3. Generate a valid Debris Orbit
    # Instead of linear back-propagation, we give the debris a 
    # hypervelocity vector (~7.8 km/s) at the collision point.
    v_mag = np.sqrt(MU / np.linalg.norm(collision_point)) * np.random.uniform(1.02, 1.1)
    
    # Random encounter angle (Inclination/RAAN difference)
    direction = np.random.randn(3)
    direction /= np.linalg.norm(direction)
    debris_vel_at_ca = direction * v_mag
    
    # 4. Integrate BACKWARDS using RK4 to get the start state
    # This ensures the debris follows a curved Keplerian path
    debris_at_ca = np.concatenate([collision_point, debris_vel_at_ca])
    debris_start_state = rk4_step(debris_at_ca, -t_ca)
    
    return debris_start_state

def get_training_batch(batch_size=64):
    """
    Generates diverse LEO orbits (Inclined, Polar, Equatorial)
    to ensure the AI generalizes across the whole constellation.
    """
    batch = []
    for _ in range(batch_size):
        # Random Altitude 400-1200km (Dense debris zone)
        r_mag = RE + np.random.uniform(400, 1200)
        v_mag = np.sqrt(MU / r_mag)
        
        # Randomize orientation (Theta and Phi)
        phi = np.random.uniform(0, 2*np.pi)
        theta = np.random.uniform(0, np.pi)
        
        # Position vector
        pos = r_mag * np.array([
            np.sin(theta) * np.cos(phi),
            np.sin(theta) * np.sin(phi),
            np.cos(theta)
        ])
        
        # Velocity vector (Perpendicular to position for circular orbit)
        v_dir = np.random.randn(3)
        v_dir -= v_dir.dot(pos) * pos / np.linalg.norm(pos)**2
        v_dir /= np.linalg.norm(v_dir)
        vel = v_dir * v_mag
        
        sat_state = np.concatenate([pos, vel])
        debris_state = generate_conjunction_scenario(sat_state)
        
        batch.append((sat_state, debris_state))
    return batch