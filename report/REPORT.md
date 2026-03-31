# Project AETHER: Autonomous Constellation Management System
**National Space Hackathon 2026**  
*Orbital Debris Avoidance & Constellation Management*

---

## Abstract
As Low Earth Orbit (LEO) becomes increasingly congested, traditional human-in-the-loop collision avoidance systems are no longer scalable. This report details the architecture of **Project AETHER**, an Autonomous Constellation Manager (ACM). Our system uses **KD-Trees** for predictive conjunction assessment, **Proximal Policy Optimization (PPO)** for maneuver scheduling, and **Physics-Informed Neural Networks (PINNs)** to ensure high-fidelity trajectory prediction under J2-perturbed orbital mechanics.

---

## 1. System Architecture
AETHER is a microservice-based suite containerized via Docker (Ubuntu 22.04) for high-performance orbital operations.

*   **Telemetry Engine**: Ingests high-frequency ECI state vectors.
*   **Physics Core**: Propagates orbits using **4th Order Runge-Kutta (RK4)** integration.
*   **Autonomous Controller**: A hybrid system combining deep reinforcement learning (PPO) and a PINN for physical consistency.
*   **Orbital Insight Visualizer**: A 2D/3D frontend for real-time situational awareness.

---

## 2. Numerical Methods and Physics
### 2.1 Orbital Propagation
We model the Earth's non-spherical mass using the **J2 Perturbation** model. The acceleration is calculated as:
$$ a = -\frac{\mu}{|\vec{r}|^3}\vec{r} + a_{J2} $$
This accounts for the equatorial bulge, causing nodal regression and apsidal precession, which are critical for maintaining the 10km station-keeping box.

### 2.2 Propulsion
Every maneuver follows the **Tsiolkovsky Rocket Equation**. Fuel mass is strictly tracked, and a **600-second thermal cooldown** is enforced between burns to maintain thruster integrity.

---

## 3. Spatial Optimization
To handle the O(N²) problem of checking 50+ satellites against 10,000+ debris fragments, we utilize a **KD-Tree** spatial index.
*   **Search Complexity**: $O(\log N)$ for nearest-neighbor threat detection.
*   **Threat Radius**: Identifying all debris within a 5km "Caution" shell for detailed Conjunction Data Message (CDM) analysis.

---

## 4. AI and Autonomous Logic
### 4.1 Proximal Policy Optimization (PPO)
Our evasion agent is trained to minimize $\Delta v$ while maximizing miss distance. It operates in the **RTN Frame** (Radial, Transverse, Normal) to ensure efficient phasing maneuvers.

### 4.2 Physics-Informed Neural Networks (PINNs)
The `OrbitPINN` model ensures that even when telemetry is sparse, the predicted paths obey the laws of physics by incorporating the equations of motion directly into the standard neural network loss function.

---

## 5. Mission Constraints
*   **End-of-Life (EOL)**: Auto-detection of 5% fuel levels triggers a prograde graveyard burn.
*   **Blackout Resilience**: Strategic lookahead logic schedules maneuvers 24 hours in advance to handle communication gaps.

---

## 6. Conclusion
Project AETHER demonstrates a scalable, autonomous solution for the future of LEO traffic management, balancing safety, fuel efficiency, and mission uptime.
