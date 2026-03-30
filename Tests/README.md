# 🛠️ Verification & Simulation Suite — Project AETHER

This directory contains standalone testing and simulation scripts to verify the core autonomous constellation management (ACM) logic, including collision avoidance, ground station connectivity, and End-of-Life (EOL) maneuvers.

---

## 🛰️ Core Simulation
### `mock_grader.py`
The primary production-ready telemetry stream generator. It propagates a constellation of satellites and a debris field using an RK4 physics engine and sends real-time state vectors to the FastAPI backend. Used to populate the dashboard and simulate long-term station-keeping scenarios.

---

## 🧪 Validation Tests
### `test_collision_avoidance.py`
**Objective:** Validates the closed-loop collision avoidance system.
- **Workflow:** Injects a "threat" debris object near a satellite → verifies the automated dodge vector is requested → clears the threat → verifies the system enters and completes the orbital recovery phase.

### `test_multi_threat.py`
**Objective:** Tests the prioritization engine when multiple hazards exist simultaneously.
- **Workflow:** Places two debris objects at varying distances → confirms the system always targets the **closest** (highest risk) object first → verifies sequential re-targeting of the next most dangerous object.

### `test_connectivity.py`
**Objective:** Verifies Ground Station Line-of-Sight (LOS) and communication blackout logic.
- **Workflow:** Simulates satellites over known ground stations (e.g., ISTRAC Bengaluru) and in blackout zones (e.g., Pacific Ocean) → confirms that the system correctly status-flags the availability of telemetry links.

### `test_graveyard_logic.py`
**Objective:** Validates the automated decommissioning and graveyard orbit maneuvers.
- **Workflow:** Reduces a satellite's fuel below the **EOL threshold (2.5 kg)** → verifies the status change to `EOL` → confirms that a prograde exit maneuver (orbital raise) is automatically calculated and triggered.

### `test_constraints.py`
**Objective:** Enforces physical and operational mission boundaries.
- **Workflow:** Verifies that **MAX_DV** is capped at $0.015\text{ km/s}$ → confirms that the **600s Thermal Cooldown** is enforced (429 rejection) → validates the **10s scheduling latency** constraint.

### `test_maneuver_physics.py`
**Objective:** High-fidelity validation of orbital mechanics and fuel models.
- **Workflow:** Registers a satellite → executes a manual $\Delta v$ burn → verifies that velocity is updated and fuel is consumed via the Tsiolkovsky equation → propagates time by 60s to ensure coordinates diverge realistically.

---

## 🚀 How to Run
Ensure the FastAPI backend is running (`python main.py`) before executing these scripts. All tests use the `requests` library to communicate with the API layer.

Example:
```bash
python Tests/test_collision_avoidance.py
```
*Note: Run from the project root to ensure correct path resolution for your virtual environment.*

---
*NSH-2026 | Project AETHER | team Syntaxion*
