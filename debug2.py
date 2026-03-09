"""
Run from project root: python debug2.py
This tests the exact scenario generator from train_ppo.py
"""
import numpy as np, sys, os
sys.path.insert(0, os.getcwd())

MU, RE, J2 = 398600.4418, 6378.137, 1.08262668e-3
SIM_DT = 60.0

def _eom(s):
    r=np.linalg.norm(s[:3]); z=s[2]; zr2=(z/r)**2
    f=(1.5*J2*MU*RE**2)/(r**5)
    a=-(MU/r**3)*s[:3]+np.array([s[0]*f*(5*zr2-1),s[1]*f*(5*zr2-1),s[2]*f*(5*zr2-3)])
    return np.concatenate([s[3:],a])

def rk4(s,dt):
    k1=_eom(s);k2=_eom(s+0.5*dt*k1);k3=_eom(s+0.5*dt*k2);k4=_eom(s+dt*k3)
    return s+(dt/6.0)*(k1+2*k2+2*k3+k4)

def propagate(s,duration,dt=60.0):
    t,cur=0.0,s.copy()
    while abs(t)<abs(duration):
        step=np.sign(duration)*min(abs(dt),abs(duration)-abs(t))
        cur=rk4(cur,step);t+=abs(step)
    return cur

# Fixed sat state
r_mag=RE+500; v_mag=np.sqrt(MU/r_mag)
sat=np.array([r_mag,0.,0.,0.,v_mag,0.])

print("="*60)
print("PASSIVE FLIGHT — does debris hit sat at step 10,11,12?")
print("="*60)

sat_vel_n = sat[3:]/np.linalg.norm(sat[3:])
r_n       = sat[:3]/np.linalg.norm(sat[:3])
cross_n   = np.cross(sat_vel_n,r_n)
cross_n  /= np.linalg.norm(cross_n)+1e-12
deb_dirs  = [sat_vel_n*-1, r_n, cross_n]

for i,tca_step in enumerate([10,11,12]):
    t_ca = tca_step*SIM_DT
    future = propagate(sat,t_ca)
    deb_vel = deb_dirs[i]*v_mag
    deb_at_ca = np.concatenate([future[:3].copy(), deb_vel])
    deb_start = propagate(deb_at_ca,-t_ca)

    # Forward prop both passively
    s,d = sat.copy(), deb_start.copy()
    min_d = 9999.0
    hit_step = -1
    for t in range(20):
        s=rk4(s,SIM_DT); d=rk4(d,SIM_DT)
        dist=np.linalg.norm(s[:3]-d[:3])
        if dist < min_d:
            min_d=dist; hit_step=t+1
        if dist < 0.1:
            print(f"  Debris {i+1} (TCA={tca_step}): 💥 COLLISION at step {t+1}, dist={dist*1000:.2f}m")
            break
    else:
        print(f"  Debris {i+1} (TCA={tca_step}): ❌ NO collision. MinDist={min_d*1000:.1f}m at step {hit_step}")

print()
print("="*60)
print("CHECKING: Is pycache stale? Which ppo_agent is loaded?")
print("="*60)
import importlib, src.ai.ppo_agent as pa
print(f"  File loaded: {pa.__file__}")
agent = pa.PPOAgent()
print(f"  action_var:  {agent.action_var}")

# Simulate what actually happens in one episode
print()
print("="*60)
print("SIMULATING ONE EPISODE — tracking closest debris per step")
print("="*60)
sat2=sat.copy()
t_ca=10*SIM_DT
future2=propagate(sat2,t_ca)
deb_vel2=deb_dirs[0]*v_mag
deb2=propagate(np.concatenate([future2[:3].copy(),deb_vel2]),-t_ca)

s,d=sat2.copy(),deb2.copy()
last_burn=-10
for t in range(20):
    dist_before=np.linalg.norm(s[:3]-d[:3])
    norm_s=s/np.array([7500,7500,7500,8,8,8])
    raw,_=agent.select_action(norm_s)
    action=raw*0.015
    if (t-last_burn)<10:
        action=np.zeros(3)
    dv=np.linalg.norm(action)
    if dv>1e-7:
        s[3:]+=action; last_burn=t
    s=rk4(s,SIM_DT); d=rk4(d,SIM_DT)
    dist_after=np.linalg.norm(s[:3]-d[:3])
    burn_str=f"BURN dv={dv*1000:.1f}m/s" if dv>1e-7 else "coast"
    col="💥" if dist_after<0.1 else "  "
    print(f"  Step {t+1:2d} | dist={dist_after*1000:10.1f}m | {burn_str} {col}")