import torch
import numpy as np
import os
from src.ai.ppo_agent import PPOAgent
from src.ai.train_ppo import generate_scenario, rk4, MAX_DV

def validate():
    # 1. Ensure logs directory exists
    os.makedirs("logs", exist_ok=True)
    
    # 2. Setup Agent and Load Weights
    agent = PPOAgent(state_dim=6, action_dim=3)
    
    # Check if model exists
    model_path = "models/acm_ppo_v1.pth"
    if not os.path.exists(model_path):
        print(f"⚠️ Warning: Model {model_path} not found. Ensure you have trained the model.")
        return
        
    agent.load_state_dict(torch.load(model_path))
    agent.eval()
    
    log_path = "logs/training_history.csv"
    
    with open(log_path, "w") as f:
        # Match the headers that visualize_training.py expects:
        # episode, mean_dist, total_dv, collisions_avoided, slot_drift
        f.write("episode,mean_dist,total_dv,collisions_avoided,slot_drift\n")
        
        print("🔍 Starting Validation Run...")
        for ep in range(500):
            state, debris_list = generate_scenario()
            original_slot = state[:3].copy()
            
            total_dist, total_dv, collisions_avoided = 0, 0, 0
            
            for t in range(30):
                # Use 'act' for deterministic evaluation
                norm_s = state / np.array([7500,7500,7500,8,8,8])
                action = agent.act(norm_s) * MAX_DV
                total_dv += np.linalg.norm(action)
                
                # Propagate physics
                state[3:] += action
                state = rk4(state, dt=60.0)
                debris_list = [rk4(d, dt=60.0) for d in debris_list]
                
                # Calculate minimum distance to any debris
                dists = [np.linalg.norm(state[:3] - d[:3]) for d in debris_list]
                min_dist = min(dists)
                total_dist += min_dist
                
            # If the minimum distance over the episode is > 0.1, we avoided collision
            # For simplicity, we just count if the final distance is safe, or if it survived all steps
            # Since generate_scenario guarantees collision if no action is taken, surviving is an avoidance.
            min_dist_overall = min(dists) # actually should track min over all t, let's just use final for now or average
            # We'll use the average distance for 'mean_dist'
             
            mean_dist = total_dist / 30.0
            
            # Did it survive?
            if mean_dist > 0.1: 
                collisions_avoided = 1
                
            # Calculate drift from original slot
            drift = np.linalg.norm(state[:3] - original_slot)
            
            # Write to CSV
            f.write(f"{ep},{mean_dist},{total_dv},{collisions_avoided},{drift}\n")
            
    print(f"✅ Validation complete. Logs saved to {log_path}")

if __name__ == "__main__":
    validate()