"""
RK4 Integrator with J2 Perturbation Modeling
NSH-2026 | Project AETHER
"""
import numpy as np

# ── Constants ──────────────────────────────────────────────────────────────────
MU  = 398600.4418   # Earth gravitational parameter  [km³/s²]
RE  = 6378.137      # Earth equatorial radius         [km]
J2  = 1.08262668e-3 # J2 oblateness coefficient      [dimensionless]
G0  = 9.80665e-3    # Standard gravity                [km/s²]
ISP = 220.0         # Specific impulse (hydrazine)    [s]


def j2_accel(state: np.ndarray) -> np.ndarray:
    """
    Computes J2 oblateness perturbation acceleration in ECI frame.

    Args:
        state: [x, y, z, vx, vy, vz]  (km, km/s)

    Returns:
        acceleration vector [ax, ay, az]  (km/s²)
    """
    r   = np.linalg.norm(state[:3])
    z   = state[2]
    zr2 = (z / r) ** 2

    factor = (1.5 * J2 * MU * RE**2) / (r**5)
    ax = state[0] * factor * (5 * zr2 - 1)
    ay = state[1] * factor * (5 * zr2 - 1)
    az = state[2] * factor * (5 * zr2 - 3)
    return np.array([ax, ay, az])


def eom(state: np.ndarray) -> np.ndarray:
    """
    Equations of motion: gravity + J2.

    Returns: state derivative [vx, vy, vz, ax, ay, az]
    """
    pos = state[:3]
    vel = state[3:]
    r   = np.linalg.norm(pos)

    # Two-body gravity
    a_grav = -(MU / r**3) * pos

    # J2 perturbation
    a_j2 = j2_accel(state)

    a_total = a_grav + a_j2
    return np.concatenate([vel, a_total])


def rk4_step(state: np.ndarray, dt: float) -> np.ndarray:
    """
    Single RK4 integration step.

    Args:
        state: [x, y, z, vx, vy, vz]
        dt:    time step in seconds (can be negative for back-propagation)

    Returns:
        new_state after dt seconds
    """
    k1 = eom(state)
    k2 = eom(state + 0.5 * dt * k1)
    k3 = eom(state + 0.5 * dt * k2)
    k4 = eom(state + dt * k3)
    return state + (dt / 6.0) * (k1 + 2*k2 + 2*k3 + k4)


def propagate(state: np.ndarray, duration: float, dt: float = 1.0) -> np.ndarray:
    """
    Propagates an orbit over `duration` seconds using fixed RK4 steps.

    Args:
        state:    initial ECI state vector
        duration: total propagation time  [s]
        dt:       step size               [s]

    Returns:
        Final state vector after propagation.
    """
    t   = 0.0
    cur = state.copy()
    while abs(t) < abs(duration):
        step = np.sign(duration) * min(abs(dt), abs(duration) - abs(t))
        cur  = rk4_step(cur, step)
        t   += step
    return cur


def tsiolkovsky_dm(current_mass: float, dv_mag: float) -> float:
    """
    Computes mass expended for a given Δv burn using Tsiolkovsky rocket equation.

    Args:
        current_mass: wet mass before burn  [kg]
        dv_mag:       magnitude of Δv       [km/s]

    Returns:
        Δm (mass consumed)  [kg]
    """
    return current_mass * (1.0 - np.exp(-dv_mag / (ISP * G0)))
