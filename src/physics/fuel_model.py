import numpy as np

# Constants for the Satellite Fleet
I_SP = 300.0        # Specific Impulse of thrusters (seconds)
G0 = 0.00980665     # Standard gravity (km/s^2)
DRY_MASS = 500.0    # Mass of satellite without fuel (kg)

def calculate_fuel_consumed(initial_fuel_mass, dv_vector):
    """
    Calculates fuel spent for a maneuver using the Rocket Equation.
    dv_vector: [dv_x, dv_y, dv_z] in km/s
    """
    dv_mag = np.linalg.norm(dv_vector)
    if dv_mag == 0:
        return 0.0

    # Total current mass (Dry Mass + current Fuel)
    m_initial = DRY_MASS + initial_fuel_mass
    
    # Calculate final mass after burn: m_final = m_initial / e^(dv / (Isp * g0))
    m_final = m_initial / np.exp(dv_mag / (I_SP * G0))
    
    fuel_spent = m_initial - m_final
    return round(fuel_spent, 4)