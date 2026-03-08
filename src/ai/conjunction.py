import numpy as np
from src.ai.controller import HybridController

class ConjunctionAnalyzer:
    def __init__(self):
        self.controller = HybridController()
        # Strategic Horizon: 2 hours (7200s)
        self.lookahead_seconds = 7200 
        self.time_step = 300 # Check every 5 minutes

    def analyze_threats(self, satellite_id, sat_state, debris_registry):
        """
        Projects paths and prioritizes conjunctions by risk.
        """
        prioritized_threats = []
        
        for t_offset in range(self.time_step, self.lookahead_seconds + 1, self.time_step):
            # 1. Project Satellite State
            future_sat_state = self.controller.predict_future_state(sat_state, t_offset)
            
            for deb_id, deb_data in debris_registry.items():
                if deb_data["type"] != "DEBRIS":
                    continue
                
                # 2. Project Debris State
                deb_initial = np.array(deb_data["r"] + deb_data["v"])
                future_deb_state = self.controller.predict_future_state(deb_initial, t_offset)
                
                # 3. Calculate Distance
                dist = np.linalg.norm(future_sat_state[:3] - future_deb_state[:3])
                
                # 4. Categorize Risk
                if dist < 0.15: # Critical Danger (Under 150m in the future)
                    risk_level = "CRITICAL"
                elif dist < 0.3: # Warning (Under 300m)
                    risk_level = "WARNING"
                else:
                    continue

                prioritized_threats.append({
                    "satellite": satellite_id,
                    "debris": deb_id,
                    "t_minus_sec": t_offset,
                    "predicted_dist_km": round(dist, 4),
                    "risk_level": risk_level
                })
        
        # Sort by urgency (shortest time to impact) and then by distance
        prioritized_threats.sort(key=lambda x: (x["t_minus_sec"], x["predicted_dist_km"]))
        return prioritized_threats