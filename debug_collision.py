"""
Run this FIRST to diagnose why collisions aren't happening.
Place in your project root and run: python debug_collision.py
"""
import numpy as np
import sys, os
sys.path.insert(0, os.getcwd())

MU, RE, J2 = 398600.4418, 6378.137, 1.08262668e-3
SIM_DT = 60.0

def _eom(s):
    r = np.linalg.norm(s[:3]); z = s[2]; zr2 = (z/r)**2
    f = (1.5*J2*MU*RE**2)/(r**5)
    a = -(MU/r**3)*s[:3] + np.array([
        s[0]*f*(5*zr2-1), s[1]*f*(5*zr2-1), s[2]*f*(5*zr2-3)])
    return np.concatenate([s[3:], a])

def rk4(s, dt):
    k1=_eom(s); k2=_eom(s+0.5*dt*k1)
    k3=_eom(s+0.5*dt*k2); k4=_eom(s+dt*k3)
    return s+(dt/6.0)*(k1+2*k2+2*k3+k4)

def propagate(s, duration, dt=60.0):
    t, cur = 0.0, s.copy()
    while abs(t) < abs(duration):
        step = np.sign(duration)*min(abs(dt), abs(duration)-abs(t))
        cur = rk4(cur, step); t += abs(step)
    return cur

print("="*60)
print("TEST 1: Does passive flight cause collision at step 12?")
print("="*60)

r_mag = RE + 500; v_mag = np.sqrt(MU/r_mag)
sat_state = np.array([r_mag, 0.0, 0.0, 0.0, v_mag, 0.0])
t_ca = 12 * SIM_DT

future_sat = propagate(sat_state, t_ca, dt=SIM_DT)
collision_point = future_sat[:3].copy()
sat_vel = sat_state[3:]
sat_vel_norm = sat_vel / np.linalg.norm(sat_vel)
perp = np.cross(sat_vel_norm, future_sat[:3]/np.linalg.norm(future_sat[:3]))
perp /= np.linalg.norm(perp) + 1e-12
deb_vel_at_ca = perp * v_mag
debris_at_ca = np.concatenate([collision_point, deb_vel_at_ca])
debris_start = propagate(debris_at_ca, -t_ca, dt=SIM_DT)

print(f"Debris initial separation: {np.linalg.norm(debris_start[:3]-sat_state[:3])*1000:.1f}m")
s, d = sat_state.copy(), debris_start.copy()
min_dist = 9999.0
for t in range(20):
    s = rk4(s, SIM_DT); d = rk4(d, SIM_DT)
    dist = np.linalg.norm(s[:3]-d[:3])
    min_dist = min(min_dist, dist)
    marker = " <<< TCA" if t+1==12 else ""
    print(f"  Step {t+1:2d} | dist={dist*1000:10.2f}m{marker}")

print(f"\nMin distance: {min_dist*1000:.2f}m")
print(f"Collision (< 100m): {'YES ✅' if min_dist < 0.1 else 'NO ❌ — BUG!'}")

print()
print("="*60)
print("TEST 2: What does your src.physics.integrator.rk4_step do?")
print("="*60)
try:
    from src.physics.integrator import rk4_step
    result = rk4_step(sat_state.copy(), SIM_DT)
    expected = rk4(sat_state.copy(), SIM_DT)
    diff = np.linalg.norm(result - expected)
    print(f"  Your rk4_step result:  {result[:3]}")
    print(f"  Expected result:       {expected[:3]}")
    print(f"  Difference: {diff:.6f} km")
    print(f"  Match: {'YES ✅' if diff < 0.001 else 'NO ❌ — integrators differ!'}")
except Exception as e:
    print(f"  Import failed: {e}")

print()
print("="*60)
print("TEST 3: PPOAgent action_var check")
print("="*60)
try:
    from src.ai.ppo_agent import PPOAgent
    import torch
    agent = PPOAgent()
    print(f"  Default action_var: {agent.action_var}")
    norm_state = sat_state / np.array([7500,7500,7500,8,8,8])
    actions = [agent.select_action(norm_state)[0] for _ in range(20)]
    dvs = [np.linalg.norm(a)*0.015 for a in actions]
    print(f"  Mean |DV| over 20 samples: {np.mean(dvs)*1000:.2f} m/s")
    print(f"  Max  |DV| over 20 samples: {np.max(dvs)*1000:.2f} m/s")
    print(f"  → Random burns deflecting ~{np.mean(dvs)*1000*5:.0f}m per episode")
except Exception as e:
    print(f"  Error: {e}")
