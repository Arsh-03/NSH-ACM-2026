import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import os, sys
from src.ai.ppo_agent import PPOAgent

MU, RE, D_CRIT  = 398600.4418, 6378.137, 0.1
J2              = 1.08262668e-3
M_DRY, M_FUEL_INIT, ISP = 500.0, 50.0, 300.0
G0, MAX_DV      = 9.80665 / 1000.0, 0.015
SIM_DT          = 60.0
STEPS           = 30
COOLDOWN_STEPS  = 3           # reduced: 3 steps x 60s = 180s cooldown
WARNING_DIST_KM = 1000.0      # tightened: burns only when debris < 1000km

BASE_DIR   = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(BASE_DIR, "models", "acm_ppo_v1.pth")
os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)


# ── Physics ───────────────────────────────────────────────────────────────────
def _eom(s):
    r=np.linalg.norm(s[:3]); z=s[2]; zr2=(z/r)**2
    f=(1.5*J2*MU*RE**2)/(r**5)
    a=-(MU/r**3)*s[:3]+np.array([
        s[0]*f*(5*zr2-1),s[1]*f*(5*zr2-1),s[2]*f*(5*zr2-3)])
    return np.concatenate([s[3:],a])

def rk4(s,dt):
    k1=_eom(s);k2=_eom(s+0.5*dt*k1)
    k3=_eom(s+0.5*dt*k2);k4=_eom(s+dt*k3)
    return s+(dt/6.0)*(k1+2*k2+2*k3+k4)

def propagate(s,duration,dt=60.0):
    t,cur=0.0,s.copy()
    while abs(t)<abs(duration):
        step=np.sign(duration)*min(abs(dt),abs(duration)-abs(t))
        cur=rk4(cur,step);t+=abs(step)
    return cur


# ── Scenario generator ────────────────────────────────────────────────────────
def generate_scenario():
    r_mag = RE+np.random.uniform(400,1000)
    v_mag = np.sqrt(MU/r_mag)
    inc   = np.random.uniform(0,np.pi)
    raan  = np.random.uniform(0,2*np.pi)
    ci,si = np.cos(inc),np.sin(inc)
    cr,sr = np.cos(raan),np.sin(raan)

    sat_pos   = r_mag*np.array([cr,sr,0.0])
    sat_vel   = v_mag*np.array([-si*sr,si*cr,ci])
    sat_state = np.concatenate([sat_pos,sat_vel])

    sat_vel_n = sat_vel/np.linalg.norm(sat_vel)
    r_n       = sat_pos/np.linalg.norm(sat_pos)
    cross_n   = np.cross(sat_vel_n,r_n)
    cross_n  /= np.linalg.norm(cross_n)+1e-12

    debris_list = []
    for tca_step, dv_dir in [(10, -sat_vel_n), (15, cross_n)]:
        t_ca      = tca_step*SIM_DT
        future    = propagate(sat_state, t_ca)
        deb_at_ca = np.concatenate([future[:3].copy(), dv_dir*v_mag])
        debris_list.append(propagate(deb_at_ca, -t_ca))

    return sat_state, debris_list


# ── Buffer ────────────────────────────────────────────────────────────────────
class PPOBuffer:
    def __init__(self):
        self.states,self.actions,self.logprobs=[],[],[]
        self.rewards,self.is_terminals=[],[]
    def clear(self):
        del self.states[:],self.actions[:],self.logprobs[:]
        del self.rewards[:],self.is_terminals[:]


# ── Trainer ───────────────────────────────────────────────────────────────────
class PPOTrainer:
    def __init__(self):
        self.agent     = PPOAgent(action_var=0.05)
        self.optimizer = optim.Adam(self.agent.parameters(),lr=1e-4)
        self.buffer    = PPOBuffer()
        self.gamma,self.eps_clip=0.99,0.2
        self.mse_loss  = nn.MSELoss()

    def get_reward(self, closest, dv_mag, collision):
        if collision: return -10000.0
        r = 1.0
        # Graded danger penalty
        if closest < 0.5:    r -= 5000.0
        elif closest < 1.0:  r -= 1000.0
        elif closest < 5.0:  r -= 200.0
        elif closest < 50.0: r -= (50.0/(closest+0.01))*10.0
        elif closest < 500.0:r -= (500.0/(closest+0.01))*2.0
        else:                r += 2.0    # safe distance bonus
        if dv_mag>1e-7:
            r -= (dv_mag/MAX_DV)*1.5
        return r

    def update(self):
        if len(self.buffer.rewards)<2:
            self.buffer.clear(); return
        disc,rewards=0,[]
        for rv,done in zip(reversed(self.buffer.rewards),
                           reversed(self.buffer.is_terminals)):
            if done: disc=0
            disc=rv+self.gamma*disc
            rewards.insert(0,disc)
        R=torch.tensor(rewards,dtype=torch.float32)
        if R.std()>1e-7: R=(R-R.mean())/(R.std()+1e-7)
        S=torch.FloatTensor(np.array(self.buffer.states))
        A=torch.FloatTensor(np.array(self.buffer.actions))
        LP=torch.FloatTensor(np.array(self.buffer.logprobs))
        for _ in range(10):
            lp,V,ent=self.agent.evaluate(S,A)
            ratio=torch.exp(lp-LP.detach())
            adv=R-V.detach().squeeze()
            adv=(adv-adv.mean())/(adv.std()+1e-8)
            loss=(-torch.min(ratio*adv,
                  torch.clamp(ratio,1-self.eps_clip,1+self.eps_clip)*adv)
                  +0.5*self.mse_loss(V.squeeze(),R)-0.01*ent)
            self.optimizer.zero_grad()
            loss.mean().backward()
            nn.utils.clip_grad_norm_(self.agent.parameters(),0.5)
            self.optimizer.step()
        self.buffer.clear()

    def train(self, episodes=5000):
        print("🛰️  [START] NSH-2026 AETHER — Tightened Warning Zone")
        print(f"    Burns only within {WARNING_DIST_KM}km | Cooldown={COOLDOWN_STEPS} steps")
        print(f"    Debris at TCA steps 10 & 15 — agent has ~2 steps to react")
        print("-"*70)

        best_success,win=0.0,[]

        for ep in range(episodes):
            # Anneal: 0.05 → 0.005
            new_var=max(0.005, 0.05*(1.0 - ep/episodes))
            self.agent.set_action_var(new_var)

            state,debris_list=generate_scenario()
            mass=M_DRY+M_FUEL_INIT
            total_dv=0.0
            collision=False
            last_burn=-COOLDOWN_STEPS
            min_dist=9999.0

            for t in range(STEPS):
                dists=[np.linalg.norm(state[:3]-d[:3]) for d in debris_list]
                closest=min(dists)
                min_dist=min(min_dist,closest)

                norm_s=state/np.array([7500,7500,7500,8,8,8])
                raw,lp=self.agent.select_action(norm_s)
                action=raw*MAX_DV

                # Gate 1: thermal cooldown
                if (t-last_burn)<COOLDOWN_STEPS:
                    action=np.zeros(3); lp=torch.tensor(0.0)

                # Gate 2: only burn when debris is close
                if closest>WARNING_DIST_KM:
                    action=np.zeros(3); lp=torch.tensor(0.0)

                dv=np.linalg.norm(action)
                if dv>1e-7:
                    dm=mass*(1-np.exp(-dv/(ISP*G0)))
                    if dm<=(mass-M_DRY):
                        state[3:]+=action
                        mass-=dm; total_dv+=dv; last_burn=t
                    else:
                        action=np.zeros(3); dv=0.0

                state=rk4(state,SIM_DT)
                debris_list=[rk4(d,SIM_DT) for d in debris_list]

                dists_after=[np.linalg.norm(state[:3]-d[:3]) for d in debris_list]
                closest_after=min(dists_after)
                min_dist=min(min_dist,closest_after)

                if closest_after<D_CRIT: collision=True

                self.buffer.states.append(norm_s)
                self.buffer.actions.append(action/MAX_DV)
                self.buffer.logprobs.append(
                    lp if isinstance(lp,float) else lp.item())
                self.buffer.rewards.append(
                    self.get_reward(closest_after,dv,collision))
                self.buffer.is_terminals.append(t==STEPS-1 or collision)

                if collision: break

            if ep%20==0: self.update()

            win.append(0 if collision else 1)
            if len(win)>100: win.pop(0)
            sr=sum(win)/len(win)*100

            if ep%50==0:
                fuel=max(0.0,mass-M_DRY)
                flag="💥 COLLISION" if collision else "✅ Safe"
                print(f"Ep {ep:4d} | Fuel:{fuel:5.2f}kg | "
                      f"Success:{sr:5.1f}% | "
                      f"DV:{total_dv:.5f}km/s | "
                      f"MinDist:{min_dist*1000:8.2f}m | "
                      f"AVar:{new_var:.4f} | {flag}")
                sys.stdout.flush()
                if sr>=best_success:
                    best_success=sr
                    torch.save(self.agent.state_dict(),MODEL_PATH)

        print("-"*70)
        print(f"✅ Done. Best success rate: {best_success:.1f}%")
        torch.save(self.agent.state_dict(),MODEL_PATH)


if __name__ == "__main__":
    trainer=PPOTrainer()
    trainer.train()