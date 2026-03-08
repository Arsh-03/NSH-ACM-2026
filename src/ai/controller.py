import numpy as np
import torch
from src.ai.ppo_agent import PPOAgent
from src.ai.spatial_index import find_nearby_threats

class HybridController:
    def __init__(self, model_path="models/acm_ppo_v1.pth"):
        self.agent = PPOAgent(state_dim=6, action_dim=3)
        # Load the weights your partner trained
        try:
            self.agent.load_state_dict(torch.load(model_path))
            self.agent.eval()
        except FileNotFoundError:
            print("⚠️ Model weights not found. Using default initialization.")

    def compute_command(self, sat_state, debris_field):
        """
        Switches between Station-Keeping and AI Collision Avoidance.
        """
        # 1. Use Spatial Indexing to filter 10,000+ objects
        nearby_threats = find_nearby_threats(sat_state[:3], debris_field)

        if nearby_threats:
            # 2. AI MODE: Execute PPO-calculated dodge
            action = self.agent.act(sat_state)
            
            # Enforce NSH-2026 15 m/s limit
            dv_mag = np.linalg.norm(action)
            if dv_mag > 0.015:
                action = (action / dv_mag) * 0.015
            return "AI_EVASION", action

        # 3. NOMINAL MODE: Simple PID Station-Keeping
        # Goal: Stay within 10km of [0,0,0] relative to slot
        drift = np.linalg.norm(sat_state[:3])
        if drift > 8.0: # Early correction at 8km
            correction = -sat_state[:3] * 0.0001 # Micro-burn
            return "STATION_KEEPING", correction

        return "NOMINAL", np.zeros(3)