# 🛰️ Project AETHER — Autonomous Constellation Manager
**NSH-2026 | National Space Hackathon | Team Arsh-03**

> **Project AETHER** is a high-performance mission control and satellite fleet management system. It integrates a PPO-trained AI autopilot with a real-time React dashboard to manage autonomous collision avoidance in congested Low Earth Orbit (LEO) environments.

---

## 🖥️ Aether Mission Control Dashboard
The project features a state-of-the-art telemetry dashboard built for real-time situational awareness.

*   **Live Satellite Tracking:** 3D visual globe and 2D Mercator/Equirectangular ground tracks.
*   **Bullseye Radar:** Proximity monitoring for selected targets against debris clouds.
*   **Resource Heatmaps:** Real-time fuel consumption vs. collisions avoided monitoring.
*   **Maneuver Timeline:** Gantt-style visualization of scheduled and executed evasion burns.
*   **Telemetry Logs:** Command-line style live feed of system-wide events and physics updates.

---

## 📁 Project Structure

```
nsh-acm-2026/
├── main.py                          ← Primary FastAPI backend entry point
├── populate_data.py                 ← (Scratch) Data generation utility
├── requirements.txt                 ← Python dependencies (FastAPI, PyTorch, NumPy)
├── .venv/                           ← Virtual environment
│
├── frontend/                        ← Vite + React Dashboard
│   ├── src/
│   │   ├── app/components/          ← Main Dash logic (EnhancedDashboard.tsx)
│   │   ├── components/              ← UI sub-components
│   │   └── assets/                  ← 3D textures and UI icons
│   └── package.json                 ← Frontend dependencies
│
├── src/                             ← Core Logic
│   ├── ai/                          ← PPO Autopilot, Conjunction Analysis, KD-Trees
│   ├── api/                         ← REST & WebSocket Handlers (Telemetry, Maneuvers)
│   ├── physics/                     ← RK4 Integrator, J2 Perturbation, Fuel Models
│   └── comms/                       ← Ground Station Blackout logic
│
└── Tests/
    └── mock_grader.py               ← Production telemetry stream simulator
```

---

## 🚀 Getting Started

### 1. Docker Setup (Recommended for Submission)
Build and run the full stack (FastAPI + built frontend) using Docker.

```bash
# From repository root
docker build -t nsh-acm-2026 .
docker run --rm -p 8000:8000 nsh-acm-2026
```

Open: `http://localhost:8000`

If port 8000 is already in use, map another host port:

```bash
docker run --rm -p 8001:8000 nsh-acm-2026
```

Then open: `http://localhost:8001`

To populate live telemetry in Docker mode, run the mock grader in a separate terminal:

```bash
# If container runs on 8000
python Tests/mock_grader.py

# If container runs on 8001 (PowerShell)
$env:BASE_URL="http://localhost:8001/api"
python Tests/mock_grader.py
```

### 2. Local Development Setup

#### Environment & Backend Setup
Create and activate the virtual environment (Python 3.10+ recommended) and install dependencies.

```bash
# 1. Create the virtual environment (if not already present)
python -m venv .venv

# 2. Activate the environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# 3. Install required packages
pip install -r requirements.txt

# 4. Start the FastAPI server
python main.py
```
*Backend runs at `http://localhost:8000`*

#### Frontend Setup
Navigate to the frontend directory and start the Vite dev server.
```bash
cd frontend
npm install
npm run dev
```
*Frontend runs at `http://localhost:5173`*

#### Populating Data (Mock Grader)
To see the dashboard in action, run the mock grader to stream orbital telemetry into the system.
```bash
python Tests/mock_grader.py
```

---

## 🧬 Simulation & Verification Suite
Project AETHER includes a robust suite of standalone scripts to validate every phase of the mission lifecycle. Detailed documentation for each script can be found in the [Tests directory](file:///c:/Users/AITNS/Documents/nsh-acm-2026/Tests).

*   **Collision Avoidance (`test_avoidance.py`):** Real-time dodge vector validation and recovery.
*   **Multi-Threat Handling (`test_multi_debris.py`):** "Greedy closest-first" hazard prioritization.
*   **Comms Check (`test_connectivity.py`):** Ground station Line-of-Sight (LOS) and blackout logic.
*   **EOL Maneuvers (`test_graveyard_logic.py`):** Fuel-aware orbital decommissioning.
*   **Constraints Check (`test_constraints.py`):** Cooldown, latency, and Max-DV enforcement.
*   **Physics Verification (`test_maneuver_physics.py`):** Core validation of Δv impulse, fuel consumption (Tsiolkovsky), and state propagation.

---

## 🌐 API Ecosystem

| Protocol | Category | Endpoint | Description |
| :--- | :--- | :--- | :--- |
| **WS** | **Live Data** | `/ws` | Real-time state updates (Satellites + Debris) |
| `POST` | **Telemetry** | `/api/telemetry` | Ingest single satellite state vector |
| `POST` | **Telemetry** | `/api/telemetry/bulk` | Ingest entire fleet/debris cloud snapshots |
| `GET` | **Visuals** | `/api/visualization/snapshot` | Export current LLA state for external renderers |
| `POST` | **Maneuver** | `/api/maneuver/schedule` | Schedule a future Δv burn sequence |
| `GET` | **Maneuver** | `/api/maneuver/registry` | List all tracked satellites (ID, R, V, Fuel, Status) |
| `POST` | **Simulation** | `/api/simulate/step` | Advance the physics engine by `N` seconds |

---

## 🧠 Core Technologies

*   **Autopilot:** PPO-trained Actor-Critic network for autonomous station-keeping and evasion.
*   **Physics:** 4th-order Runge-Kutta (RK4) integration with J₂ nodal regression support.
*   **Proximity:** SciPy-powered KD-Tree spatial indexing for $O(\log n)$ collision detection.
*   **Frontend:** React 18 + Three.js + Frame Motion for a premium, low-latency UI.

---

## 🛡️ Mission Constraints
*   **Safety Buffer:** 100 meters (Critical Collision Threshold).
*   **Max Δv:** 15 m/s per individual burn.
*   **Thermal Window:** 600s mandatory cooldown between burns.
*   **Fuel Budget:** 50kg Hydrazine per satellite (Dry Mass: 500kg).

---
*NSH-2026 | Project AETHER | team - Syntaxion*