# 🛰️ Project AETHER — Autonomous Constellation Manager
**NSH-2026 | National Space Hackathon**

> AI-powered satellite fleet manager for congested LEO environments.  
> PPO-trained agent performing real-time collision avoidance across 50+ satellites against 10,000+ debris fragments.

---

## 📁 Project Structure

```
NSH-ACM-2026/
├── main.py                          ← Root entry point (alternative API launcher)
├── requirements.txt                 ← All Python dependencies
├── Dockerfile                       ← Ubuntu 22.04 container
├── README.md                        ← This file
│
├── data/
│   └── ground_stations.csv          ← 6 global ground stations (lat/lon/elevation)
│
├── models/
│   └── acm_ppo_v1.pth               ← Trained PPO weights (generated after training)
│
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── style.css
│
├── logs/
│
└── src/
    ├── ai/
    │   ├── ppo_agent.py             ← Actor-Critic PPO network (action_var=0.05)
    │   ├── train_ppo.py             ← Full training loop (warning-zone gated)
    │   ├── data_gen.py              ← Conjunction scenario generator
    │   ├── spatial_index.py         ← KD-Tree debris threat detection
    │   ├── auto_pilot.py
    │   ├── conjunction.py
    │   ├── controller.py
    │   ├── pinn_model.py
    │   └── recovery.py
    │
    ├── physics/
    │   ├── integrator.py            ← RK4 + J2 perturbation + Tsiolkovsky
    │   ├── environment.py
    │   ├── fuel_model.py
    │   └── orbital_mechanics.py
    │
    ├── api/
    │   ├── main.py                  ← FastAPI server (port 8000)
    │   ├── maneuvers.py
    │   ├── simulation.py
    │   └── telemetry.py
    │
    └── utils/
        └── visualize_training.py
```

---

## ⚙️ Technical Stack

| Layer | Technology |
|-------|-----------|
| Language | Python 3.10+ |
| AI/ML | PyTorch 2.2 — PPO (Proximal Policy Optimization) |
| Physics | Custom RK4 Integrator + J₂ Perturbation |
| Backend | FastAPI + Uvicorn (port 8000) |
| Spatial Index | SciPy KD-Tree |
| Container | Ubuntu 22.04 Docker |

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Train the PPO agent
```bash
python -m src.ai.train_ppo
```
Weights are saved to `models/acm_ppo_v1.pth` automatically during training.

### 3. Start the API server
```bash
python -m uvicorn src.api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Open interactive API docs
```
http://localhost:8000/docs
```

### Docker (optional)
```bash
docker build -t aether-acm .
docker run -p 8000:8000 -v %cd%/models:/app/models aether-acm
```

---

## 🌐 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/api/health` | Liveness check + model status |
| `POST` | `/api/telemetry` | Ingest ECI state vector + debris |
| `POST` | `/api/maneuver/schedule` | Request Δv burn from PPO agent |
| `GET`  | `/api/status/{sat_id}` | Query individual satellite status |
| `GET`  | `/api/constellation` | Full fleet overview |

### POST /api/telemetry
```json
{
  "sat_id": "SAT-001",
  "timestamp": 1700000000.0,
  "state": {
    "x": 7000.0, "y": 0.0, "z": 0.0,
    "vx": 0.0, "vy": 7.5, "vz": 0.0
  },
  "fuel_kg": 45.0,
  "debris_states": [
    { "x": 7000.1, "y": 0.0, "z": 0.0, "vx": 0.0, "vy": -7.5, "vz": 0.1 }
  ]
}
```

### POST /api/maneuver/schedule
```json
{ "sat_id": "SAT-001", "timestamp": 1700000060.0 }
```

### Response
```json
{
  "sat_id": "SAT-001",
  "delta_v": [0.008, -0.003, 0.002],
  "dv_magnitude": 0.00872,
  "burn_approved": true,
  "reason": "Burn approved",
  "fuel_remaining": 44.91,
  "eol_flag": false
}
```

---

## 🧠 AI Architecture

### PPO Agent (Actor-Critic)
```
Input:  6-dim normalised ECI state [x,y,z,vx,vy,vz]
        Normalisation: position ÷ 7500 km, velocity ÷ 8 km/s

Actor:  Linear(6→256) → ReLU → Linear(256→256) → ReLU → Linear(256→3) → Tanh
        Output: Δv vector in [-1,1]³, scaled by MAX_THRUST (0.015 km/s)

Critic: Linear(6→256) → ReLU → Linear(256→256) → ReLU → Linear(256→1)
        Output: State value estimate V(s)

Noise:  action_var = 0.05 (annealed to 0.005 during training)
        Mean random burn: ~1.8 m/s (safe — cannot accidentally dodge threats)
```

### Training Configuration
| Parameter | Value |
|-----------|-------|
| Learning rate | `1e-4` |
| Discount factor γ | `0.99` |
| PPO clip ε | `0.2` |
| PPO epochs per update | `10` |
| Gradient clip | `0.5` |
| Update frequency | Every 20 episodes |
| action_var | `0.05` → `0.005` (annealed) |
| Episodes | 5000 |
| Steps per episode | 30 × 60s = 1800s sim |

### Training Scenario Design
- **2 debris objects** converging at TCA steps 10 and 15
- **Warning zone gate**: burns only permitted when debris is within 1000 km
- **Cooldown**: 3 steps (180s) between burns
- **Guaranteed collision** if no correct maneuver is performed
- Final success rate: **94–99%** across 100-episode rolling window

---

## ⚛️ Physics Engine

### RK4 Integrator (`src/physics/integrator.py`)
4th-order Runge-Kutta integration with fixed 60s timestep.

### J₂ Perturbation
```
J₂ = 1.08262668 × 10⁻³
aₓ = x · factor · (5z²/r² - 1)
aᵧ = y · factor · (5z²/r² - 1)
a_z = z · factor · (5z²/r² - 3)
where factor = (1.5 · J₂ · μ · Rₑ²) / r⁵
```

### Tsiolkovsky Rocket Equation
```
Δm = m_wet · (1 - e^(-Δv / (Isp · g₀)))
Isp = 300 s  |  g₀ = 9.80665×10⁻³ km/s²
```

---

## 🛡️ Mission Constraints

| Constraint | Value |
|-----------|-------|
| Safety threshold D_crit | **100 m** (0.1 km) |
| Collision penalty | **−10,000** reward |
| Max thrust per burn | **15 m/s** (0.015 km/s) |
| Thermal cooldown | **600 s** (10 min) |
| Fuel budget | **50 kg** per satellite |
| Dry mass | **500 kg** per satellite |
| Station-keeping radius | **10 km** from nominal slot |
| EOL trigger | **5% fuel** (2.5 kg) → graveyard orbit |

---

## 🔧 Key Bug Fixes (Development Log)

| Episode | Symptom | Root Cause | Fix |
|---------|---------|-----------|-----|
| 0–1950 | `DV=0` always | `coasting_bonus=0.5` rewarded inaction | Removed coasting bonus |
| 0–2950 | MinDist=100,000m | Single large RK4 step (1000s) in scenario gen | Multi-step propagation |
| 0–2950 | No collisions | `action_var=0.5` → 18 m/s noise cleared threats | Fixed to `action_var=0.05` |
| 0–500 | MinDist=3000m | Early burn at t=0 accidentally deflecting | Warning zone gate (1000 km) |
| 4500+ | **Success 94–99%** | ✅ Genuine learning | All fixes combined |

---

## 📡 Ground Stations

| ID | Station | Lat | Lon | Min Elevation |
|----|---------|-----|-----|---------------|
| GS-001 | ISTRAC Bengaluru | 13.03°N | 77.52°E | 5° |
| GS-002 | Svalbard | 78.23°N | 15.41°E | 5° |
| GS-003 | Goldstone | 35.43°N | 116.89°W | 10° |
| GS-004 | Punta Arenas | 53.15°S | 70.92°W | 5° |
| GS-005 | IIT Delhi | 28.55°N | 77.19°E | 15° |
| GS-006 | McMurdo Station | 77.85°S | 166.67°E | 5° |

---

## 📋 Assumptions

- All telemetry in **ECI J2000** frame (km, km/s)
- Debris follows unpowered orbits under J₂ + gravity only
- Communications instantaneous except in ground station blackout zones
- ISP = 300 s (hydrazine monopropellant)

---

*NSH-2026 | Project AETHER | Autonomous Constellation Manager*