import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import MultivariateNormal
import numpy as np
from src.ai.ppo_agent import PPOAgent
from src.physics.integrator import rk4_step
from src.ai.data_gen import generate_conjunction_scenario

# --- 1. NSH-2026 Constants ---
MU = 398600.4418      # km^3/s^2 [cite: 65]
RE = 6378.137         # km [cite: 67]
J2 = 1.08263e-3       # [cite: 67]
D_CRIT = 0.1          # 100 meters in km [cite: 70]
M_DRY = 500.0         # kg [cite: 156]
M_FUEL_INIT = 50.0    # kg [cite: 157]
ISP = 300.0           # seconds [cite: 158]
G0 = 9.80665 / 1000.0 # km/s^2 [cite: 164]
MAX_DV = 0.015        # 15 m/s in km/s per burn [cite: 159]

class PPOBuffer:
    """Stores transitions for batch updates."""
    def __init__(self):
        self.states, self.actions, self.logprobs, self.rewards, self.is_terminals = [], [], [], [], []

    def clear(self):
        del self.states[:], self.actions[:], self.logprobs[:], self.rewards[:], self.is_terminals[:]

class PPOTrainer:
    def __init__(self):
        self.agent = PPOAgent(state_dim=6, action_dim=3)
        self.optimizer = optim.Adam(self.agent.parameters(), lr=3e-4)
        self.buffer = PPOBuffer()
        self.gamma = 0.99
        self.eps_clip = 0.2
        self.mse_loss = nn.MSELoss()
        self.M_CRITICAL = (M_DRY + M_FUEL_INIT) * 0.05 # 5% Fuel threshold 

    def calculate_nsh_reward(self, next_state, dv_vec, current_mass, debris_pos):
        """Calculates reward based on NSH-2026 Evaluation Criteria."""
        dist = np.linalg.norm(next_state[:3] - debris_pos)
        dv_mag = np.linalg.norm(dv_vec)
        
        # 1. Safety Score (25% Weight) 
        if dist < D_CRIT:
            return -5000.0, 0.0  # Massive penalty for collision 
        
        # 2. Fuel Efficiency (20% Weight) [cite: 163, 259]
        dm = current_mass * (1 - np.exp(-dv_mag / (ISP * G0)))
        
        # 3. Constellation Uptime (15% Weight) [cite: 169, 171, 259]
        slot_dist = np.linalg.norm(next_state[:3]) 
        uptime_penalty = 0 if slot_dist < 10.0 else -50.0 # 10km tolerance [cite: 169]
        
        reward = (dist * 10.0) - (dm * 500.0) + uptime_penalty
        return reward, dm

    def update(self):
        """PPO Clipped Objective Update for Actor and Critic."""
        rewards = []
        discounted_reward = 0
        for reward, is_terminal in zip(reversed(self.buffer.rewards), reversed(self.buffer.is_terminals)):
            if is_terminal: discounted_reward = 0
            discounted_reward = reward + (self.gamma * discounted_reward)
            rewards.insert(0, discounted_reward)
            
        # Normalize rewards
        rewards = torch.tensor(rewards, dtype=torch.float32)
        rewards = (rewards - rewards.mean()) / (rewards.std() + 1e-7)

        old_states = torch.FloatTensor(np.array(self.buffer.states))
        old_actions = torch.FloatTensor(np.array(self.buffer.actions))
        old_logprobs = torch.FloatTensor(np.array(self.buffer.logprobs))

        for _ in range(10): # Update for 10 epochs
            # Evaluate old actions using current policy
            logprobs, state_values, dist_entropy = self.agent.evaluate(old_states, old_actions)
            
            # Finding the ratio (pi_theta / pi_theta__old)
            ratios = torch.exp(logprobs - old_logprobs.detach())

            # Finding Surrogate Loss
            advantages = rewards - state_values.detach()
            surr1 = ratios * advantages
            surr2 = torch.clamp(ratios, 1-self.eps_clip, 1+self.eps_clip) * advantages

            # Final loss of clipped objective PPO
            loss = -torch.min(surr1, surr2) + 0.5 * self.mse_loss(state_values, rewards) - 0.01 * dist_entropy
            
            self.optimizer.zero_grad()
            loss.mean().backward()
            self.optimizer.step()
        
        self.buffer.clear()

    def train(self, episodes=2000):
        print("🚀 NSH-2026 Training Session Started...")
        for ep in range(episodes):
            state = self.generate_initial_orbit()
            debris_state = generate_conjunction_scenario(state)
            current_mass = M_DRY + M_FUEL_INIT
            
            # --- Metrics Trackers ---
            total_dist = 0
            total_dv = 0
            success_count = 0
            
            for t in range(20):
                if current_mass <= self.M_CRITICAL:
                    # Move to Graveyard Orbit logic would go here 
                    break

                action, logprob = self.agent.select_action(state)
                total_dv += np.linalg.norm(action)
                
                state_after_burn = state.copy()
                state_after_burn[3:] += action
                next_state = rk4_step(state_after_burn, dt=60.0)
                debris_state = rk4_step(debris_state, dt=60.0)
                
                dist = np.linalg.norm(next_state[:3] - debris_state[:3])
                total_dist += dist
                if dist > D_CRIT: success_count += 1
                
                reward, dm = self.calculate_nsh_reward(next_state, action, current_mass, debris_state[:3])
                current_mass -= dm
                
                self.buffer.states.append(state)
                self.buffer.actions.append(action)
                self.buffer.logprobs.append(logprob)
                self.buffer.rewards.append(reward)
                self.buffer.is_terminals.append(t == 19)

                state = next_state

            # --- Calculate Episode Stats ---
            avg_dist = total_dist / 20
            avg_drift = np.linalg.norm(state[:3] - self.generate_initial_orbit()[:3]) # Simple drift calc

            if ep % 20 == 0: self.update()
            
            # Save logs every episode [cite: 259]
            with open("logs/training_history.csv", "a") as f:
                f.write(f"{ep},{avg_dist},{total_dv},{success_count},{avg_drift}\n")

            if ep % 100 == 0:
                print(f"Ep {ep} | Fuel Left: {current_mass-M_DRY:.2f}kg | Success Rate: {success_count/20*100}%")
                torch.save(self.agent.state_dict(), "models/acm_ppo_v1.pth")
                
    def generate_initial_orbit(self):
        """Random LEO circular state vector[cite: 58]."""
        r_mag = RE + np.random.uniform(400, 1000)
        v_mag = np.sqrt(MU / r_mag)
        return np.array([r_mag, 0, 0, 0, v_mag, 0])

if __name__ == "__main__":
    trainer = PPOTrainer()
    trainer.train()