import requests
import json
import time

# The endpoint where your ACM is listening (Docker or Local)
URL = "http://localhost:8000/api/telemetry"

def simulate_evaluator():
    # A sample LEO state vector [x, y, z, vx, vy, vz]
    test_telemetry = {
        "sat_id": "SAT-01-ARSH",
        "state_vector": [7000.0, 0.0, 0.0, 0.0, 7.5, 0.0],
        "epoch": time.time()
    }

    print(f"📡 Sending telemetry for {test_telemetry['sat_id']}...")
    
    try:
        response = requests.post(URL, json=test_telemetry)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Response Received from ACM:")
            print(json.dumps(result, indent=4))
            
            if result.get("status") == "MANEUVER_REQUIRED":
                dv = result.get("delta_v")
                print(f"🚀 Success! Agent scheduled a burn: {dv}")
        else:
            print(f"❌ Error: Received status code {response.status_code}")
            
    except requests.exceptions.ConnectionError:
        print("❌ Connection Failed! Is your FastAPI server/Docker running?")

if __name__ == "__main__":
    simulate_evaluator()