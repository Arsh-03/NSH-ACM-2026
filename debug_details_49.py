import requests
BASE_URL = "http://localhost:8000/api"
def check_sat_details(sat_id):
    try:
        r = requests.get(f"{BASE_URL}/visualization/snapshot")
        data = r.json()
        sats = data.get("satellites", [])
        target = next((s for s in sats if s["id"] == sat_id), None)
        print(f"DEBUG: {sat_id} found! Details: {target}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_sat_details("AETHER-49")
