import torch
import torch.nn as nn
from src.physics.integrator import MU, J2, RE

class OrbitPINN(nn.Module):
    def __init__(self):
        super(OrbitPINN, self).__init__()
        self.net = nn.Sequential(
            nn.Linear(1, 64), # Input: Time (t)
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
            nn.Linear(64, 6)  # Output: State vector [x, y, z, vx, vy, vz]
        )

    def forward(self, t):
        return self.net(t)


    def physics_loss(self, t):
        """
        Enforces the orbital mechanics differential equations:
        d^2r/dt^2 = -mu*r/r^3 + a_J2
        """
        t.requires_grad = True
        state_pred = self.forward(t) # Output: [x, y, z, vx, vy, vz]
        
        r_pred = state_pred[:, :3] # Predicted Position
        v_pred = state_pred[:, 3:] # Predicted Velocity

        # 1. Calculate Velocity from Position: dr/dt
        # We use autograd to find the derivative of position w.r.t time
        dr_dt = torch.autograd.grad(r_pred, t, torch.ones_like(r_pred), create_graph=True)[0]

        # 2. Calculate Acceleration from Velocity: dv/dt
        dv_dt = torch.autograd.grad(v_pred, t, torch.ones_like(v_pred), create_graph=True)[0]

        # 3. Calculate Physics-Based Acceleration (The "True" Physics)
        r_mag = torch.norm(r_pred, dim=1, keepdim=True)
        a_grav = -MU * r_pred / (r_mag**3)
        
        # J2 Perturbation Logic (Simplified for PINN)
        z = r_pred[:, 2:3]
        factor = (1.5 * J2 * MU * RE**2) / (r_mag**5)
        z_ratio = 5 * (z**2 / r_mag**2)
        a_j2 = factor * torch.cat([
            r_pred[:, 0:1] * (z_ratio - 1),
            r_pred[:, 1:2] * (z_ratio - 1),
            r_pred[:, 2:3] * (z_ratio - 3)
        ], dim=1)

        a_total_physics = a_grav + a_j2

        # 4. The Physics Loss: How much does the AI's math deviate from real physics?
        loss_velocity = torch.mean((dr_dt - v_pred)**2)
        loss_acceleration = torch.mean((dv_dt - a_total_physics)**2)

        return loss_velocity + loss_acceleration