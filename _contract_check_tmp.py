import sys, time
sys.path.append(r"d:/Arsh/NSH-ACM-2026")
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)

# 1) telemetry contract (objects[])
telemetry_payload = {
  "timestamp": "2026-03-12T08:00:00.000Z",
  "objects": [
    {"id":"SAT-Alpha-04","type":"SATELLITE","r":{"x":7000.0,"y":0.0,"z":0.0},"v":{"x":0.0,"y":7.5,"z":0.0}},
    {"id":"DEB-99421","type":"DEBRIS","r":{"x":7000.04,"y":0.0,"z":0.0},"v":{"x":0.0,"y":-7.4,"z":0.1}}
  ]
}
r1 = client.post('/api/telemetry', json=telemetry_payload)
print('TELEMETRY_STATUS', r1.status_code, r1.json())

# 2) schedule contract (maneuver_sequence)
future_t = time.time() + 30
schedule_payload = {
  "satelliteId":"SAT-Alpha-04",
  "maneuver_sequence":[
    {
      "burn_id":"EVASION_BURN_1",
      "burnTime": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(future_t)),
      "deltaV_vector":{"x":0.002,"y":0.015,"z":-0.001}
    }
  ]
}
r2 = client.post('/api/maneuver/schedule', json=schedule_payload)
print('SCHEDULE_STATUS', r2.status_code, r2.json())

# 3) simulate step contract
r3 = client.post('/api/simulate/step', json={"step_seconds": 120})
print('SIM_STATUS', r3.status_code, r3.json())

# 4) snapshot endpoint
r4 = client.get('/api/visualization/snapshot')
print('SNAPSHOT_STATUS', r4.status_code, list(r4.json().keys()))
