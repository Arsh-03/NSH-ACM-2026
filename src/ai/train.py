"""
PPO Training Loop — Project AETHER
NSH-2026 | Autonomous Constellation Manager

Fixes & improvements over baseline:
  - Observation dim bumped to 13 (matches SatelliteEnv)
  - action_var annealing: starts high (0.5) → decays to 0.05
  - Generalised Advantage Estimation (GAE, λ=0.95) for better credit assignment
  - Entropy coefficient annealed to prevent premature convergence
  - Gradient clipping (max_norm=0.5)
  - Normalised advantages
  - Periodic checkpoint saving
"""
import numpy as np
import torch
import torch.nn as nn
from torch.distributions import MultivariateNormal
import os
import time

from src.physics.integrator import MU, RE
from src.env.satellite_env import SatelliteEnv
from src.data_gen import get_training_batch

# ── Hyperparameters ───────────────────────────────────────────────────────────
STATE_DIM       = 13        # extended observation
ACTION_DIM      = 3
LR              = 1e-4      # kept low to prevent success-rate crashes
GAMMA           = 0.99
GAE_LAMBDA      = 0.95
CLIP_EPS        = 0.2
ENTROPY_START   = 0.05
ENTROPY_END     = 0.005
ACTION_VAR_START = 0.5
ACTION_VAR_END   = 0.05
MAX_GRAD_NORM   = 0.5
PPO_EPOCHS      = 10
BATCH_SIZE      = 64
MINI_BATCH      = 32
MAX_EPISODES    = 5000
SAVE_EVERY      = 200        # save checkpoint every N episodes
STEPS_PER_EP    = 500        # max steps per episode

CHECKPOINT_DIR  = "checkpoints"
os.makedirs(CHECKPOINT_DIR, exist_ok=True)


# ── Actor-Critic Network ──────────────────────────────────────────────────────
class ActorCritic(nn.Module):
    def __init__(self):
        super().__init__()
        self.actor = nn.Sequential(
            nn.Linear(STATE_DIM, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, ACTION_DIM),
            nn.Tanh()
        )
        self.critic = nn.Sequential(
            nn.Linear(STATE_DIM, 512),
            nn.ReLU(),
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Linear(256, 1)
        )

    def forward(self, x):
        return self.actor(x), self.critic(x)


# ── PPO Agent ─────────────────────────────────────────────────────────────────
class PPOTrainer:
    def __init__(self):
        self.net       = ActorCritic()
        self.optimizer = torch.optim.Adam(self.net.parameters(), lr=LR)
        self.mse_loss  = nn.MSELoss()

        self.action_var = ACTION_VAR_START
        self.entropy_coef = ENTROPY_START

    def _get_dist(self, states):
        means = self.net.actor(states)
        cov   = torch.diag(torch.full((ACTION_DIM,), self.action_var))
        return MultivariateNormal(means, cov)

    def select_action(self, state: np.ndarray):
        state_t = torch.FloatTensor(state).unsqueeze(0)
        with torch.no_grad():
            dist = self._get_dist(state_t)
            action = dist.sample()
            log_prob = dist.log_prob(action)
        return action.squeeze(0).numpy(), log_prob.item()

    def compute_gae(self, rewards, values, dones, next_value):
        """Generalised Advantage Estimation."""
        advantages = []
        gae = 0.0
        values_ext = values + [next_value]
        for t in reversed(range(len(rewards))):
            delta = rewards[t] + GAMMA * values_ext[t+1] * (1 - dones[t]) - values_ext[t]
            gae   = delta + GAMMA * GAE_LAMBDA * (1 - dones[t]) * gae
            advantages.insert(0, gae)
        returns = [adv + val for adv, val in zip(advantages, values)]
        return advantages, returns

    def update(self, trajectory: dict):
        states   = torch.FloatTensor(np.array(trajectory["states"]))
        actions  = torch.FloatTensor(np.array(trajectory["actions"]))
        old_lps  = torch.FloatTensor(trajectory["log_probs"])
        returns  = torch.FloatTensor(trajectory["returns"])
        advs     = torch.FloatTensor(trajectory["advantages"])

        # Normalise advantages
        advs = (advs - advs.mean()) / (advs.std() + 1e-8)

        total_loss = 0.0
        for _ in range(PPO_EPOCHS):
            # Mini-batch SGD
            indices = torch.randperm(len(states))
            for start in range(0, len(states), MINI_BATCH):
                idx   = indices[start:start + MINI_BATCH]
                s, a  = states[idx], actions[idx]
                olp   = old_lps[idx]
                ret   = returns[idx]
                adv   = advs[idx]

                dist       = self._get_dist(s)
                new_lp     = dist.log_prob(a)
                entropy    = dist.entropy().mean()
                _, values  = self.net(s)
                values     = values.squeeze(-1)

                ratio      = torch.exp(new_lp - olp)
                surr1      = ratio * adv
                surr2      = torch.clamp(ratio, 1 - CLIP_EPS, 1 + CLIP_EPS) * adv

                actor_loss  = -torch.min(surr1, surr2).mean()
                critic_loss = 0.5 * self.mse_loss(values, ret)
                loss        = actor_loss + critic_loss - self.entropy_coef * entropy

                self.optimizer.zero_grad()
                loss.backward()
                nn.utils.clip_grad_norm_(self.net.parameters(), MAX_GRAD_NORM)
                self.optimizer.step()
                total_loss += loss.item()

        return total_loss

    def anneal(self, episode: int, max_episodes: int):
        """Linearly anneal action_var and entropy coefficient."""
        frac = episode / max_episodes
        self.action_var   = ACTION_VAR_START + frac * (ACTION_VAR_END - ACTION_VAR_START)
        self.entropy_coef = ENTROPY_START   + frac * (ENTROPY_END  - ENTROPY_START)

    def save(self, path: str):
        torch.save(self.net.state_dict(), path)
        print(f"  [SAVE] Checkpoint → {path}")

    def load(self, path: str):
        self.net.load_state_dict(torch.load(path))
        print(f"  [LOAD] Weights ← {path}")


# ── Environment factory ───────────────────────────────────────────────────────
def make_env(sat_state: np.ndarray, debris_states: list) -> SatelliteEnv:
    """Wraps a sat + debris pair into a SatelliteEnv."""
    nominal_slot = sat_state[:3].copy()   # use initial position as nominal slot
    return SatelliteEnv(
        sat_state    = sat_state,
        nominal_slot = nominal_slot,
        debris_list  = [d.copy() for d in debris_states],
        sim_dt       = 10.0,
        max_steps    = STEPS_PER_EP,
    )


# ── Main training loop ────────────────────────────────────────────────────────
def train():
    trainer     = PPOTrainer()
    best_rate   = 0.0
    ep_rewards  = []
    successes   = []

    print("=" * 60)
    print("  Project AETHER — PPO Training")
    print(f"  State dim: {STATE_DIM}  |  Action dim: {ACTION_DIM}")
    print(f"  LR={LR}  |  Episodes={MAX_EPISODES}  |  Steps/ep={STEPS_PER_EP}")
    print("=" * 60)

    for episode in range(1, MAX_EPISODES + 1):
        # ── Sample a new scenario ─────────────────────────────────────────
        batch = get_training_batch(batch_size=1)
        sat_state, debris_state = batch[0]
        env = make_env(sat_state, [debris_state])
        obs = env.reset()

        trajectory = {
            "states": [], "actions": [], "log_probs": [],
            "rewards": [], "dones": [], "values": []
        }

        ep_reward = 0.0
        t_start   = time.time()

        # ── Rollout ───────────────────────────────────────────────────────
        for _ in range(STEPS_PER_EP):
            action, log_prob = trainer.select_action(obs)

            # Get value estimate
            state_t = torch.FloatTensor(obs).unsqueeze(0)
            with torch.no_grad():
                _, val = trainer.net(state_t)
            value = val.item()

            next_obs, reward, done, info = env.step(action)

            trajectory["states"].append(obs)
            trajectory["actions"].append(action)
            trajectory["log_probs"].append(log_prob)
            trajectory["rewards"].append(reward)
            trajectory["dones"].append(float(done))
            trajectory["values"].append(value)

            ep_reward += reward
            obs        = next_obs
            if done:
                break

        # ── Compute returns via GAE ────────────────────────────────────────
        next_val = 0.0
        if not done:
            state_t  = torch.FloatTensor(obs).unsqueeze(0)
            with torch.no_grad():
                _, val = trainer.net(state_t)
            next_val = val.item()

        advantages, returns = trainer.compute_gae(
            trajectory["rewards"], trajectory["values"],
            trajectory["dones"], next_val
        )
        trajectory["advantages"] = advantages
        trajectory["returns"]    = returns

        # ── PPO update ────────────────────────────────────────────────────
        loss = trainer.update(trajectory)
        trainer.anneal(episode, MAX_EPISODES)

        # ── Logging ───────────────────────────────────────────────────────
        ep_rewards.append(ep_reward)
        survived = info.get("termination", "") != "collision" and \
                   info.get("eol", "") != "graveyard_failed_fuel"
        successes.append(int(survived))

        if episode % 50 == 0:
            window      = min(100, len(successes))
            success_rate = sum(successes[-window:]) / window * 100
            avg_reward  = np.mean(ep_rewards[-window:])
            elapsed     = time.time() - t_start

            print(f"  Ep {episode:5d} | "
                  f"AvgR={avg_reward:8.1f} | "
                  f"SuccessRate={success_rate:5.1f}% | "
                  f"Fuel={info.get('fuel_kg',0):.2f}kg | "
                  f"AVar={trainer.action_var:.3f} | "
                  f"Loss={loss:.4f}")

            if success_rate > best_rate:
                best_rate = success_rate
                trainer.save(os.path.join(CHECKPOINT_DIR, "acm_ppo_best.pth"))

        if episode % SAVE_EVERY == 0:
            trainer.save(os.path.join(CHECKPOINT_DIR, f"acm_ppo_ep{episode}.pth"))

    # ── Final save ────────────────────────────────────────────────────────────
    trainer.save(os.path.join(CHECKPOINT_DIR, "acm_ppo_v1.pth"))
    print(f"\n  Training complete. Best success rate: {best_rate:.1f}%")
    return trainer


if __name__ == "__main__":
    train()
