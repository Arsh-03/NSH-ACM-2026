import os
import matplotlib.pyplot as plt
import pandas as pd
import numpy as np

def plot_training_results(log_file="logs/training_history.csv"):
    """
    Generates the 'Orbital Insight' analytics for the Technical Report.
    Plots Safety (Collisions) vs. Efficiency (Fuel).
    """
    data = pd.read_csv(log_file)
    
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(10, 15))
    plt.subplots_adjust(hspace=0.4)

    # 1. Safety Score: Mean Miss Distance (D_crit = 0.1km)
    ax1.plot(data['episode'], data['mean_dist'], color='blue', label='Avg Miss Distance')
    ax1.axhline(y=0.1, color='red', linestyle='--', label='Critical Threshold (100m)')
    ax1.set_title("Safety Score: Proximity Trend [Goal > 0.1km]")
    ax1.set_ylabel("Distance (km)")
    ax1.legend()

    # 2. Fuel Efficiency: Delta-V vs. Collisions Avoided
    ax2.scatter(data['collisions_avoided'], data['total_dv'], c=data['episode'], cmap='viridis')
    ax2.set_title("Efficiency: Fuel Consumed vs. Collisions Avoided")
    ax2.set_xlabel("Successful Avoidances")
    ax2.set_ylabel("Total Δv (km/s)")
    
    # 3. Constellation Uptime: Slot Deviation
    ax3.plot(data['episode'], data['slot_drift'], color='green')
    ax3.axhline(y=10.0, color='orange', linestyle='--', label='10km Tolerance')
    ax3.set_title("Constellation Uptime: Nominal Slot Drift")
    ax3.set_ylabel("Drift (km)")
    ax3.set_xlabel("Episode")
    ax3.legend()

    plt.savefig("outputs/training_analytics.png")
    print("📈 Analytics saved to outputs/training_analytics.png")
    plt.show()


if __name__ == "__main__":
    os.makedirs("outputs", exist_ok=True)
    plot_training_results()