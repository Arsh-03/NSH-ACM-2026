import requests
BASE_URL = "http://localhost:8000/api"
def list_sats():
    try:
        r = requests.get(f"{BASE_URL}/visualization/snapshot")
        if r.status_code != 200:
            print(f"Error: {r.status_code} - {r.text}")
            return
        data = r.json()
        ids = [s["id"] for s in data.get("satellites", [])]
        print(f"DEBUG: Found {len(ids)} satellites. First 5: {ids[:5]}")
        if "AETHER-49" in ids:
            print("DEBUG: AETHER-49 is definitely there.")
        else:
            print(f"DEBUG: AETHER-49 is NOT there. Similar IDs: {[idx for idx in ids if '49' in idx]}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_sats()
