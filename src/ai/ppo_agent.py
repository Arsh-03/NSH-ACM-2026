import torch
import torch.nn as nn
from torch.distributions import MultivariateNormal
import numpy as np

class PPOAgent(nn.Module):
    def __init__(self, state_dim=6, action_dim=3, action_var=0.05):
        """
        action_var=0.05 (was 0.5)
        At 0.5: mean random burn = 18 m/s → agent never needs to learn
        At 0.05: mean random burn = 1.8 m/s → agent MUST learn correct direction
        """
        super(PPOAgent, self).__init__()

        self.actor = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, action_dim),
            nn.Tanh()
        )

        self.critic = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, 1)
        )

        # FIX: 0.05 not 0.5 — random noise ~1.8 m/s, not 18 m/s
        self.action_var = torch.full((action_dim,), action_var)
        self.cov_mat    = torch.diag(self.action_var)

    def select_action(self, state):
        state       = torch.FloatTensor(state)
        action_mean = self.actor(state)
        dist        = MultivariateNormal(action_mean, self.cov_mat)
        action      = dist.sample()
        return action.detach().numpy(), dist.log_prob(action).detach()

    def evaluate(self, state, action):
        action_mean = self.actor(state)
        action_var  = self.action_var.expand_as(action_mean)
        cov_mat     = torch.diag_embed(action_var)
        dist        = MultivariateNormal(action_mean, cov_mat)
        # FIX: .squeeze(-1) prevents broadcasting corruption in PPO loss
        return dist.log_prob(action), self.critic(state).squeeze(-1), dist.entropy()

    def act(self, state):
        state = torch.FloatTensor(state)
        return self.actor(state).detach().numpy()

    def set_action_var(self, new_var: float):
        """Call this to anneal exploration noise during training."""
        self.action_var = torch.full((self.action_var.shape[0],), new_var)
        self.cov_mat    = torch.diag(self.action_var)
