import numpy as np
from src.physics.integrator import rk4_step

# NSH-2026 Constants [cite: 65, 67]
RE = 6378.137 
MU = 398600.4418

def generate_conjunction_scenario(sat_state):
    """
    Generates a 'Threat' debris object that will pass within 
    the 100m critical threshold if no action is taken. 
    """
    # 1. Target a point in the future (e.g., 30 mins away)
    t_collision = 1800 
    future_sat_pos = rk4_step(sat_state, t_collision)[:3]
    
    # 2. Spawn debris that intersects this point
    # We add a small random offset to simulate 'Near Misses' vs 'Direct Hits'
    offset = np.random.uniform(-0.15, 0.15, 3) # 150m variance
    debris_pos_at_t = future_sat_pos + offset
    
    # 3. Calculate an incoming velocity (Hypervelocity: ~7.5 km/s) [cite: 14]
    # We pick a random incoming vector to simulate different encounter geometries
    direction = np.random.randn(3)
    direction /= np.linalg.norm(direction)
    debris_vel = direction * 7.5 
    
    # 4. Back-propagate to get the debris starting state at t=0
    # (Simplified: moving backwards in time)
    debris_start_pos = debris_pos_at_t - (debris_vel * t_collision)
    
    return np.append(debris_start_pos, debris_vel)

def get_training_batch(batch_size=64):
    """
    Creates a batch of satellite-debris pairs for the PPO Trainer.
    """
    batch = []
    for _ in range(batch_size):
        # Random LEO Altitude (400km - 2000km) [cite: 12]
        alt = np.random.uniform(400, 2000)
        r_mag = RE + alt
        v_mag = np.sqrt(MU / r_mag)
        
        sat_state = np.array([r_mag, 0, 0, 0, v_mag, 0]) # Circular starter
        debris_state = generate_conjunction_scenario(sat_state)
        
        batch.append((sat_state, debris_state))
    return batch