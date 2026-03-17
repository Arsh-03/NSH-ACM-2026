import numpy as np
import torch
from src.ai.ppo_agent import PPOAgent
from src.ai.spatial_index import find_nearby_threats

# ── Self-contained RK4 (no circular import from integrator) ──────────────────
MU  = 398600.4418
RE  = 6378.137
J2  = 1.08262668e-3

def _eom(s):
    r = np.linalg.norm(s[:3]); z = s[2]; zr2 = (z/r)**2
    f = (1.5*J2*MU*RE**2)/(r**5)
    a = -(MU/r**3)*s[:3] + np.array([
        s[0]*f*(5*zr2-1), s[1]*f*(5*zr2-1), s[2]*f*(5*zr2-3)])
    return np.concatenate([s[3:], a])

def _rk4(s, dt):
    k1=_eom(s); k2=_eom(s+0.5*dt*k1)
    k3=_eom(s+0.5*dt*k2); k4=_eom(s+dt*k3)
    return s+(dt/6.0)*(k1+2*k2+2*k3+k4)


class HybridController:
    def __init__(self, model_path="models/acm_ppo_v1.pth"):
        self.agent = PPOAgent(state_dim=6, action_dim=3)
        try:
            self.agent.load_state_dict(
                torch.load(model_path, map_location="cpu"))
            self.agent.eval()
            print(f"[HybridController] ✅ Weights loaded from {model_path}")
        except FileNotFoundError:
            print(f"[HybridController] ⚠️  Weights not found at {model_path}. Using random init.")

    def predict_future_state(self, state: np.ndarray,
                              t_seconds: float,
                              dt: float = 60.0) -> np.ndarray:
        """
        Propagates a 6-dim ECI state [x,y,z,vx,vy,vz] forward by
        t_seconds using RK4 + J2 perturbation.

        Used by ConjunctionAnalyzer for lookahead threat assessment.

        Args:
            state:     ECI state vector [km, km/s]
            t_seconds: propagation duration [s]
            dt:        integration step size [s] (default 60s)

        Returns:
            Propagated state vector [x,y,z,vx,vy,vz]
        """
        cur = np.array(state, dtype=float)
        t   = 0.0
        while t < t_seconds:
            step = min(dt, t_seconds - t)
            cur  = _rk4(cur, step)
            t   += step
        return cur

    def compute_command(self, sat_state: np.ndarray,
                         debris_field) -> tuple:
        """
        Switches between AI Collision Avoidance and Station-Keeping.

        Returns:
            (mode: str, delta_v: np.ndarray)
        """
        # 1. Spatial filter — check for nearby threats
        nearby_threats = find_nearby_threats(sat_state[:3], debris_field)

        if nearby_threats:
            # 2. AI MODE — PPO evasion burn
            action  = self.agent.act(sat_state)
            dv_mag  = np.linalg.norm(action)
            if dv_mag > 0.015:                        # enforce 15 m/s cap
                action = (action / dv_mag) * 0.015
            return "AI_EVASION", action

        # 3. NOMINAL — station-keeping micro-burn if drifting
        drift = np.linalg.norm(sat_state[:3])
        if drift > 8.0:
            correction = -sat_state[:3] * 0.0001
            return "STATION_KEEPING", correction

        return "NOMINAL", np.zeros(3)