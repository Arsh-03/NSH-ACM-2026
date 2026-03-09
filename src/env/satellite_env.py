"""
Satellite Environment — Project AETHER
NSH-2026 | Autonomous Constellation Manager

Implements:
  - Station-keeping reward / penalty
  - Fuel-aware reward shaping (Tsiolkovsky)
  - Thermal cooldown enforcement (600 s)
  - EOL / Graveyard orbit maneuver logic
  - Collision avoidance reward
"""
import numpy as np
from src.physics.integrator import (
    rk4_step, propagate, tsiolkovsky_dm,
    MU, RE, G0, ISP
)
from src.spatial_index import build_spatial_index, find_nearby_threats

# ── Mission constants ─────────────────────────────────────────────────────────
D_CRIT          = 0.1        # [km]  hard safety threshold (100 m)
MAX_THRUST      = 0.015      # [km/s] max Δv per burn
THERMAL_COOLDOWN = 600.0     # [s]   min wait between burns
FUEL_BUDGET     = 50.0       # [kg]  initial fuel
DRY_MASS        = 500.0      # [kg]  dry mass
STATION_RADIUS  = 10.0       # [km]  station-keeping radius
EOL_FUEL_FRAC   = 0.05       # 5 %   → graveyard maneuver trigger
EOL_FUEL_KG     = FUEL_BUDGET * EOL_FUEL_FRAC   # 2.5 kg

# Graveyard orbit target: ~300 km above operational band ceiling
GRAVEYARD_ALT_KM = 1500.0    # [km] above Earth surface

# ── Reward weights ────────────────────────────────────────────────────────────
W_SURVIVAL    =  10.0
W_FUEL        =  50.0
W_DISTANCE    =   2.0
W_COLLISION   = -10_000.0
W_STATION     =  -5.0
W_EOL_SUCCESS = 500.0


class SatelliteEnv:
    """
    Single-satellite episode environment.

    Observation space : 13-dim vector
        [x, y, z, vx, vy, vz,           (ECI state, normalised)
         dx_nom, dy_nom, dz_nom,         (offset from nominal slot, km)
         fuel_fraction,                  (0-1)
         closest_debris_dist,            (km, capped at 50)
         time_since_burn_norm,           (0-1, 600 s window)
         eol_flag]                       (0 or 1)

    Action space : 3-dim Δv vector in ECI frame, scaled to [-MAX_THRUST, MAX_THRUST]
    """

    def __init__(self, sat_state: np.ndarray, nominal_slot: np.ndarray,
                 debris_list: list, sim_dt: float = 10.0, max_steps: int = 500):
        """
        Args:
            sat_state:    initial ECI state [x,y,z,vx,vy,vz] km/km·s⁻¹
            nominal_slot: nominal orbital slot ECI position [x,y,z] km
            debris_list:  list of ECI state arrays for debris objects
            sim_dt:       simulation time step [s]
            max_steps:    episode length in steps
        """
        self.initial_state   = sat_state.copy()
        self.nominal_slot    = nominal_slot.copy()
        self.debris_list     = debris_list
        self.sim_dt          = sim_dt
        self.max_steps       = max_steps

        self.reset()

    # ──────────────────────────────────────────────────────────────────────────
    def reset(self) -> np.ndarray:
        self.state         = self.initial_state.copy()
        self.fuel          = FUEL_BUDGET
        self.wet_mass      = DRY_MASS + self.fuel
        self.time          = 0.0
        self.step_count    = 0
        self.last_burn_time = -THERMAL_COOLDOWN   # allow burn at t=0
        self.eol_triggered = False
        self.done          = False
        self.info          = {}
        return self._get_obs()

    # ──────────────────────────────────────────────────────────────────────────
    def step(self, action: np.ndarray):
        """
        Args:
            action: raw network output in [-1, 1]³  (will be scaled)

        Returns:
            obs, reward, done, info
        """
        assert not self.done, "Call reset() before step() on finished episode."

        reward = 0.0

        # ── 1. Scale action to physical Δv ───────────────────────────────────
        dv     = np.clip(action, -1.0, 1.0) * MAX_THRUST   # [km/s]
        dv_mag = np.linalg.norm(dv)

        # ── 2. Apply burn (thermal + fuel checks) ────────────────────────────
        burn_applied = False
        if dv_mag > 1e-6:
            time_since_burn = self.time - self.last_burn_time
            if time_since_burn < THERMAL_COOLDOWN:
                # Suppress burn — thermal cooldown not satisfied
                dv     = np.zeros(3)
                dv_mag = 0.0
            else:
                # Fuel check
                dm = tsiolkovsky_dm(self.wet_mass, dv_mag)
                if dm > self.fuel:
                    # Scale down to available fuel
                    dv_mag_max = -ISP * G0 * np.log(1.0 - self.fuel / self.wet_mass)
                    dv         = dv / (dv_mag + 1e-12) * dv_mag_max
                    dv_mag     = dv_mag_max
                    dm         = self.fuel

                # Commit burn
                self.state[3:] += dv
                self.fuel      -= dm
                self.wet_mass  -= dm
                self.last_burn_time = self.time
                burn_applied   = True

                # Fuel consumption penalty
                reward += W_FUEL * (-dm)

        # ── 3. Propagate orbit ───────────────────────────────────────────────
        self.state = rk4_step(self.state, self.sim_dt)
        self.time += self.sim_dt

        # Propagate debris positions too
        self.debris_list = [rk4_step(d, self.sim_dt) for d in self.debris_list]

        # ── 4. Collision / proximity check ───────────────────────────────────
        debris_positions = [d[:3] for d in self.debris_list]
        tree             = build_spatial_index(debris_positions)
        threat_indices   = find_nearby_threats(tree, self.state[:3], radius=D_CRIT * 10)
        closest_dist     = 9999.0

        if threat_indices:
            dists        = [np.linalg.norm(self.state[:3] - self.debris_list[i][:3])
                            for i in threat_indices]
            closest_dist = min(dists)
            if closest_dist < D_CRIT:
                reward += W_COLLISION
                self.done = True
                self.info["termination"] = "collision"

        closest_dist = min(closest_dist, 50.0)   # cap for normalisation

        # ── 5. Station-keeping check ─────────────────────────────────────────
        dist_from_slot = np.linalg.norm(self.state[:3] - self.nominal_slot)
        if dist_from_slot > STATION_RADIUS:
            reward += W_STATION * (dist_from_slot - STATION_RADIUS)

        # ── 6. Survival bonus ────────────────────────────────────────────────
        reward += W_SURVIVAL

        # ── 7. Distance reward (staying close to nominal) ────────────────────
        reward += W_DISTANCE * max(0.0, STATION_RADIUS - dist_from_slot)

        # ── 8. EOL / Graveyard logic ─────────────────────────────────────────
        if self.fuel <= EOL_FUEL_KG and not self.eol_triggered:
            self.eol_triggered = True
            graveyard_success  = self._execute_graveyard_maneuver()
            if graveyard_success:
                reward += W_EOL_SUCCESS
                self.info["eol"] = "graveyard_success"
            else:
                self.info["eol"] = "graveyard_failed_fuel"
            self.done = True

        # ── 9. Step limit ────────────────────────────────────────────────────
        self.step_count += 1
        if self.step_count >= self.max_steps:
            self.done = True
            self.info.setdefault("termination", "max_steps")

        obs = self._get_obs()
        self.info.update({
            "fuel_kg":        self.fuel,
            "dist_from_slot": dist_from_slot,
            "closest_debris": closest_dist,
            "burn_applied":   burn_applied,
            "time_s":         self.time,
        })
        return obs, reward, self.done, self.info

    # ──────────────────────────────────────────────────────────────────────────
    def _execute_graveyard_maneuver(self) -> bool:
        """
        Hohmann-style transfer to graveyard orbit.
        Burns are split across two impulses; uses whatever fuel remains.

        Returns True if the satellite successfully reaches graveyard altitude.
        """
        r_current = np.linalg.norm(self.state[:3])
        r_grave   = RE + GRAVEYARD_ALT_KM

        if r_current >= r_grave:
            return True  # Already above graveyard altitude

        # Δv for Hohmann transfer — both burns combined estimate
        v_circ_cur  = np.sqrt(MU / r_current)
        v_trans_apo = np.sqrt(MU * (2 / r_current - 2 / (r_current + r_grave)))
        dv1_mag     = abs(v_trans_apo - v_circ_cur)

        v_circ_grave = np.sqrt(MU / r_grave)
        v_trans_peri = np.sqrt(MU * (2 / r_grave - 2 / (r_current + r_grave)))
        dv2_mag      = abs(v_circ_grave - v_trans_peri)

        total_dv = dv1_mag + dv2_mag

        # Check if we have enough fuel for at least the first burn
        dm_needed = tsiolkovsky_dm(self.wet_mass, dv1_mag)
        if dm_needed > self.fuel:
            return False   # Not enough fuel

        # Apply first burn (prograde)
        vel_dir   = self.state[3:] / (np.linalg.norm(self.state[3:]) + 1e-12)
        dv1_vec   = vel_dir * dv1_mag
        self.state[3:] += dv1_vec
        dm1       = tsiolkovsky_dm(self.wet_mass, dv1_mag)
        self.fuel      -= dm1
        self.wet_mass  -= dm1

        # Propagate half-orbit to apogee
        half_period = np.pi * np.sqrt(((r_current + r_grave) / 2)**3 / MU)
        self.state  = propagate(self.state, half_period, dt=10.0)

        # Apply second burn if fuel allows
        if self.fuel > 0:
            dm2 = tsiolkovsky_dm(self.wet_mass, dv2_mag)
            dm2 = min(dm2, self.fuel)
            vel_dir2      = self.state[3:] / (np.linalg.norm(self.state[3:]) + 1e-12)
            actual_dv2    = -(ISP * G0) * np.log(1.0 - dm2 / self.wet_mass)
            self.state[3:] += vel_dir2 * actual_dv2
            self.fuel      -= dm2
            self.wet_mass  -= dm2

        final_alt = np.linalg.norm(self.state[:3]) - RE
        return final_alt >= (GRAVEYARD_ALT_KM - 50.0)   # 50 km tolerance

    # ──────────────────────────────────────────────────────────────────────────
    def _get_obs(self) -> np.ndarray:
        """
        Builds normalised 13-dim observation vector.
        """
        # Normalise position (Earth radii) and velocity (km/s ÷ 8)
        pos_norm  = self.state[:3] / (RE + 1200.0)
        vel_norm  = self.state[3:] / 8.0

        # Offset from nominal slot (km ÷ 50)
        slot_off  = (self.state[:3] - self.nominal_slot) / 50.0

        # Fuel fraction
        fuel_frac = self.fuel / FUEL_BUDGET

        # Closest debris (capped at 50 km, normalised)
        debris_positions = [d[:3] for d in self.debris_list]
        tree             = build_spatial_index(debris_positions)
        threats          = find_nearby_threats(tree, self.state[:3], radius=50.0)
        if threats:
            dists   = [np.linalg.norm(self.state[:3] - self.debris_list[i][:3]) for i in threats]
            closest = min(dists)
        else:
            closest = 50.0
        closest_norm = closest / 50.0

        # Time since last burn (normalised 0→1 over cooldown window)
        tsb_norm = min((self.time - self.last_burn_time) / THERMAL_COOLDOWN, 1.0)

        # EOL flag
        eol_flag = 1.0 if self.fuel <= EOL_FUEL_KG else 0.0

        return np.concatenate([
            pos_norm, vel_norm, slot_off,
            [fuel_frac, closest_norm, tsb_norm, eol_flag]
        ]).astype(np.float32)
