import torch
import torch.nn as nn
from torch.distributions import MultivariateNormal
import numpy as np

class PPOAgent(nn.Module):
    def __init__(self, state_dim, action_dim):
        super(PPOAgent, self).__init__()
        
        # Actor: Decides the Delta-V vector (Action Space)
        # Hidden layers increased to 256 for J2 complexity [cite: 66, 67]
        self.actor = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, action_dim),
            nn.Tanh() # Normalizes Delta-V between -1 and 1 [cite: 112, 159]
        )
        
        # Critic: Predicts the expected reward (Value Function) [cite: 259]
        self.critic = nn.Sequential(
            nn.Linear(state_dim, 256),
            nn.ReLU(),
            nn.Linear(256, 256),
            nn.ReLU(),
            nn.Linear(256, 1)
        )
        
        # Action variance for exploration during training
        self.action_var = torch.full((action_dim,), 0.5)
        self.cov_mat = torch.diag(self.action_var)

    def select_action(self, state):
        """Used during TRAINING to explore different maneuvers."""
        state = torch.FloatTensor(state)
        action_mean = self.actor(state)
        
        # Create a multivariate normal distribution for exploration
        dist = MultivariateNormal(action_mean, self.cov_mat)
        action = dist.sample()
        action_logprob = dist.log_prob(action)
        
        return action.detach().numpy(), action_logprob.detach()

    def act(self, state):
        """Used during INFERENCE (Live Simulation) for deterministic dodging."""
        state = torch.FloatTensor(state)
        # Returns the mean action (highest probability)
        return self.actor(state).detach().numpy()

    def evaluate(self, state, action):
        """Used during the PPO Update phase to calculate advantages."""
        action_mean = self.actor(state)
        
        action_var = self.action_var.expand_as(action_mean)
        cov_mat = torch.diag_embed(action_var)
        dist = MultivariateNormal(action_mean, cov_mat)
        
        action_logprobs = dist.log_prob(action)
        dist_entropy = dist.entropy()
        state_values = self.critic(state)
        
        return action_logprobs, state_values, dist_entropy