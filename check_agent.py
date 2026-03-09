import sys, os
sys.path.insert(0, os.getcwd())
from src.ai.ppo_agent import PPOAgent
import numpy as np

agent = PPOAgent()
print(f"action_var = {agent.action_var}")
print(f"Expected:    tensor([0.0500, 0.0500, 0.0500])")
print()

# Simulate 5 burns
sat = np.array([6878.137, 0, 0, 0, 7.784, 0])
norm = sat / np.array([7500,7500,7500,8,8,8])
burns = [np.linalg.norm(agent.select_action(norm)[0]) * 0.015 * 1000
         for _ in range(20)]
print(f"Mean random burn magnitude: {np.mean(burns):.1f} m/s")
print(f"5-burn deflection estimate: {np.mean(burns)*5:.1f} m")
print()
if agent.action_var[0].item() > 0.1:
    print("❌ ppo_agent.py was NOT replaced — still using old action_var=0.5")
    print("   Copy the new ppo_agent.py to src\\ai\\ppo_agent.py and retry")
else:
    print("✅ ppo_agent.py is correct")