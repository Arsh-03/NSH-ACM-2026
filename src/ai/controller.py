import torch
import numpy as np
from src.physics.integrator import rk4_step
from src.ai.pinn_model import OrbitPINN

# Threshold: Use PINN for predictions > 30 minutes (1800s)
# Use RK4 for immediate maneuvers < 30 minutes
HORIZON_THRESHOLD = 1800.0

class HybridController:
    def __init__(self, model_path=None):
        self.pinn = OrbitPINN()
        if model_path:
            self.pinn.load_state_dict(torch.load(model_path))
        self.pinn.eval()

    def predict_future_state(self, current_state, target_time_offset):
        """
        Switches between Classical Physics and PINN based on time horizon.
        """
        if target_time_offset < HORIZON_THRESHOLD:
            # 🚀 Classical Physics: High precision for immediate danger
            # We step forward using our verified RK4 logic
            return rk4_step(current_state, target_time_offset)
        else:
            # 🧠 PINN: Instantaneous inference for long-range planning
            # No need to loop; just a single forward pass
            t_tensor = torch.tensor([[target_time_offset]], dtype=torch.float32)
            with torch.no_grad():
                predicted_state = self.pinn(t_tensor)
            return predicted_state.numpy().flatten()