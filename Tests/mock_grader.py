"""
NSH-2026 Mock Grader — Project AETHER
Run from project root: python Tests/mock_grader.py
"""
import requests
import json
import time
import math
import random

BASE_URL    = "http://localhost:8000/api"
RE          = 6378.137
UPDATE_RATE = 2.0
NUM_SATS    = 10
NUM_DEBRIS  = 20

# ── Orbital helper ────────────────────────────────────────────────────────────
def circular_orbit_state(alt_km, inc_deg, raan_deg, ta_deg):
    MU    = 398600.4418
    r     = RE + alt_km
    v_mag = math.sqrt(MU / r)
    inc   = math.radians(inc_deg)
    raan  = math.radians(raan_deg)
    ta    = math.radians(ta_deg)
    rx = r * math.cos(ta);  ry = r * math.sin(ta)
    x  =  rx*math.cos(raan) - ry*math.cos(inc)*math.sin(raan)
    y  =  rx*math.sin(raan) + ry*math.cos(inc)*math.cos(raan)
    z  =  ry*math.sin(inc)
    vx = v_mag*(-math.sin(ta)*math.cos(raan) - math.cos(ta)*math.cos(inc)*math.sin(raan))
    vy = v_mag*(-math.sin(ta)*math.sin(raan) + math.cos(ta)*math.cos(inc)*math.cos(raan))
    vz = v_mag*( math.cos(ta)*math.sin(inc))
    return [x, y, z, vx, vy, vz]

# ── Constellation ─────────────────────────────────────────────────────────────
SATELLITES = [
    {"id": "SAT-01-ARSH", "alt": 550, "inc": 53,  "raan": 0,   "ta": 0},
    {"id": "AETHER-02",   "alt": 560, "inc": 53,  "raan": 36,  "ta": 20},
    {"id": "AETHER-03",   "alt": 570, "inc": 53,  "raan": 72,  "ta": 40},
    {"id": "AETHER-04",   "alt": 550, "inc": 53,  "raan": 108, "ta": 60},
    {"id": "AETHER-05",   "alt": 560, "inc": 53,  "raan": 144, "ta": 80},
    {"id": "AETHER-06",   "alt": 580, "inc": 98,  "raan": 0,   "ta": 0},
    {"id": "AETHER-07",   "alt": 590, "inc": 98,  "raan": 45,  "ta": 30},
    {"id": "AETHER-08",   "alt": 600, "inc": 45,  "raan": 90,  "ta": 15},
    {"id": "AETHER-09",   "alt": 610, "inc": 45,  "raan": 135, "ta": 45},
    {"id": "AETHER-10",   "alt": 620, "inc": 28,  "raan": 180, "ta": 90},
]

def safe_post(url, payload, label=""):
    """POST with full error reporting — never crashes on bad response."""
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200 or resp.status_code == 202:
            try:
                return resp.json()
            except Exception:
                print(f"  ⚠️  [{label}] Non-JSON response: {resp.text[:200]}")
                return None
        else:
            print(f"  ❌ [{label}] HTTP {resp.status_code}: {resp.text[:300]}")
            return None
    except requests.exceptions.ConnectionError:
        print(f"  ❌ [{label}] Connection refused — is server running?")
        return None
    except Exception as e:
        print(f"  ❌ [{label}] Error: {e}")
        return None

def build_debris_field(sat_states):
    debris = []

    # Guaranteed close approach to SAT-01 (25km away)
    # Counter-orbital velocity — debris passes through and moves away naturally
    s1 = sat_states["SAT-01-ARSH"]
    debris.append({
        "id": "DEBRIS-000", "type": "DEBRIS",
        "r": {"x": s1[0]+0.025, "y": s1[1],      "z": s1[2]},
        "v": {"x": s1[3]*0.1,   "y": -s1[4]*1.02, "z": s1[5]*0.1},
    })

    # Guaranteed close approach to AETHER-05 (40km away)
    s5 = sat_states["AETHER-05"]
    debris.append({
        "id": "DEBRIS-001", "type": "DEBRIS",
        "r": {"x": s5[0],      "y": s5[1]+0.040,  "z": s5[2]},
        "v": {"x": s5[3]*0.1,  "y": -s5[4]*1.02,  "z": s5[5]*0.1},
    })

    # Random debris
    random.seed(42)
    for i in range(2, NUM_DEBRIS):
        sv = circular_orbit_state(
            random.uniform(450, 650),
            random.uniform(0, 110),
            random.uniform(0, 360),
            random.uniform(0, 360),
        )
        debris.append({
            "id": f"DEBRIS-{i:03d}", "type": "DEBRIS",
            "r": {"x": sv[0], "y": sv[1], "z": sv[2]},
            "v": {"x": sv[3], "y": sv[4], "z": sv[5]},
        })
    return debris


def simulate_evaluator():
    print("=" * 60)
    print("  NSH-2026 Mock Grader — Project AETHER")
    print(f"  Satellites: {NUM_SATS} | Debris: {NUM_DEBRIS}")
    print(f"  Update rate: {UPDATE_RATE}s")
    print("=" * 60)

    # Health check
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        h = r.json()
        print(f"✅ Backend online | system={h.get('system')} "
              f"| model_ready={h.get('model_ready')}")
    except Exception as e:
        print(f"❌ Backend offline — start server: python main.py\n  ({e})")
        return

    # Fuel tracker — persists actual fuel across ticks
    fuel_tracker: dict = { sat["id"]: 50.0 for sat in SATELLITES }

    # Build satellite states
    print("\n🛰️  Initialising constellation...")
    sat_states = {}
    for sat in SATELLITES:
        sv = circular_orbit_state(sat["alt"], sat["inc"],
                                  sat["raan"], sat["ta"])
        sat_states[sat["id"]] = sv

        result = safe_post(f"{BASE_URL}/telemetry", {
            "sat_id":       sat["id"],
            "state_vector": sv,
            "epoch":        time.time(),
            "fuel_kg":      fuel_tracker.get(sat["id"], 50.0),
        }, label=sat["id"])
        if result and result.get("fuel_remaining") is not None:
            fuel_tracker[sat["id"]] = result["fuel_remaining"]

        if result:
            print(f"  ✅ {sat['id']:<20} | status={result.get('status')} "
                  f"| dist={result.get('min_dist_km','?')}km "
                  f"| dv={result.get('dv_magnitude',0):.5f} km/s")
        else:
            print(f"  ❌ {sat['id']:<20} | FAILED — check server logs")

    # Register debris
    debris_list = build_debris_field(sat_states)
    bulk_result = safe_post(f"{BASE_URL}/telemetry/bulk", {
        "timestamp": time.time(),
        "objects":   debris_list,
    }, label="bulk-debris")

    if bulk_result:
        at_risk = bulk_result.get("at_risk_sats", [])
        print(f"  ✅ {NUM_DEBRIS} debris registered | at_risk={at_risk}")
    else:
        print(f"  ❌ Bulk debris registration failed")

    # Live ticks
    print(f"\n📡 Streaming every {UPDATE_RATE}s — Ctrl+C to stop\n")
    tick = 0
    total_burns = 0

    while True:
        tick += 1
        now   = time.time()
        tick_burns = 0

        # ── Send debris FIRST so threat detection works this tick ──────────
        MU_D = 398600.4418
        for deb in debris_list:
            r = [deb["r"]["x"], deb["r"]["y"], deb["r"]["z"]]
            v = [deb["v"]["x"], deb["v"]["y"], deb["v"]["z"]]
            rm = (r[0]**2+r[1]**2+r[2]**2)**0.5
            ax = -MU_D/rm**3 * r[0]
            ay = -MU_D/rm**3 * r[1]
            az = -MU_D/rm**3 * r[2]
            deb["r"]["x"] += v[0]*UPDATE_RATE + 0.5*ax*UPDATE_RATE**2
            deb["r"]["y"] += v[1]*UPDATE_RATE + 0.5*ay*UPDATE_RATE**2
            deb["r"]["z"] += v[2]*UPDATE_RATE + 0.5*az*UPDATE_RATE**2
            deb["v"]["x"] += ax*UPDATE_RATE
            deb["v"]["y"] += ay*UPDATE_RATE
            deb["v"]["z"] += az*UPDATE_RATE

        safe_post(f"{BASE_URL}/telemetry/bulk", {
            "timestamp": now,
            "objects":   debris_list,
        }, label="bulk-first")

        # ── Then send satellites — debris already in registry ────────────
        MU_S = 398600.4418
        for sat in SATELLITES:
            sv = sat_states[sat["id"]]

            # Propagate satellite state forward by UPDATE_RATE seconds (RK4-lite)
            # This keeps lat/lon/altitude updating realistically each tick
            r  = sv[:3]; v  = sv[3:]
            rm = (r[0]**2+r[1]**2+r[2]**2)**0.5
            ax = -MU_S/rm**3 * r[0]
            ay = -MU_S/rm**3 * r[1]
            az = -MU_S/rm**3 * r[2]
            new_r = [r[i] + v[i]*UPDATE_RATE + 0.5*[ax,ay,az][i]*UPDATE_RATE**2
                     for i in range(3)]
            new_v = [v[i] + [ax,ay,az][i]*UPDATE_RATE for i in range(3)]
            sat_states[sat["id"]] = new_r + new_v
            sv = sat_states[sat["id"]]

            result = safe_post(f"{BASE_URL}/telemetry", {
                "sat_id":       sat["id"],
                "state_vector": sv,
                "epoch":        now,
                "fuel_kg":      fuel_tracker.get(sat["id"], 50.0),
            }, label=sat["id"])

            if result and result.get("fuel_remaining") is not None:
                fuel_tracker[sat["id"]] = result["fuel_remaining"]

            # If a burn was executed, apply the delta-v to satellite state
            if result and result.get("status") == "MANEUVER_REQUIRED":
                dv = result.get("delta_v", [0,0,0])
                sv2 = sat_states[sat["id"]]
                # Apply burn to velocity components
                sat_states[sat["id"]] = [
                    sv2[0], sv2[1], sv2[2],
                    sv2[3]+dv[0], sv2[4]+dv[1], sv2[5]+dv[2]
                ]

            if result:
                status = result.get("status", "UNKNOWN")
                dv_mag = result.get("dv_magnitude", 0)
                mdist  = result.get("min_dist_km", "?")

                if status == "MANEUVER_REQUIRED":
                    tick_burns  += 1
                    total_burns += 1
                    dv = result.get("delta_v", [0,0,0])
                    print(f"  🚀 BURN  | {sat['id']:<20} "
                          f"| dist={mdist}km "
                          f"| dv=[{dv[0]:.4f},{dv[1]:.4f},{dv[2]:.4f}]")
                elif mdist != "?" and mdist is not None and float(mdist) < 100:
                    print(f"  ⚠️  CLOSE | {sat['id']:<20} "
                          f"| dist={mdist}km")

        # Debris already sent above

        # ── Auto-generate new threats every 30 ticks if all clear ──────────
        all_nominal = tick_burns == 0 and tick > 10
        if all_nominal and tick % 30 == 0:
            # Pick 2 random satellites and place new debris near them
            import random
            targets = random.sample(SATELLITES, min(2, len(SATELLITES)))
            new_debris_id_base = len(debris_list)

            for i, tgt in enumerate(targets):
                sv_t = sat_states[tgt["id"]]
                # Place debris 20-80km away on crossing trajectory
                offset = random.uniform(0.02, 0.08)
                axis   = random.choice([0, 1, 2])
                sign   = random.choice([-1, 1])
                new_r  = [sv_t[0], sv_t[1], sv_t[2]]
                new_r[axis] += sign * offset
                # Counter-orbital velocity
                new_v  = [-sv_t[3]*random.uniform(0.98,1.02),
                          -sv_t[4]*random.uniform(0.98,1.02),
                           sv_t[5]*random.uniform(0.98,1.02)]
                new_id = f"DEBRIS-N{new_debris_id_base+i:02d}"

                # Replace an old debris or add new one
                if new_debris_id_base + i < len(debris_list):
                    debris_list[new_debris_id_base + i] = {
                        "id": new_id, "type": "DEBRIS",
                        "r": {"x":new_r[0],"y":new_r[1],"z":new_r[2]},
                        "v": {"x":new_v[0],"y":new_v[1],"z":new_v[2]},
                    }
                else:
                    debris_list.append({
                        "id": new_id, "type": "DEBRIS",
                        "r": {"x":new_r[0],"y":new_r[1],"z":new_r[2]},
                        "v": {"x":new_v[0],"y":new_v[1],"z":new_v[2]},
                    })
                print(f"  🆕 NEW THREAT: {new_id} → {tgt['id']} "
                      f"| offset={offset*1000:.0f}m")

        # ── Replace a random debris every 60 ticks for continuous action ──
        if tick % 60 == 0 and tick > 0:
            import random
            tgt = random.choice(SATELLITES)
            sv_t = sat_states[tgt["id"]]
            offset = random.uniform(0.015, 0.05)
            axis   = random.choice([0, 1, 2])
            new_r  = [sv_t[0], sv_t[1], sv_t[2]]
            new_r[axis] += offset
            new_v  = [sv_t[3]*0.1, -sv_t[4]*1.02, sv_t[5]*0.1]
            idx_replace = random.randint(2, len(debris_list)-1)
            debris_list[idx_replace] = {
                "id": f"DEBRIS-{idx_replace:03d}", "type": "DEBRIS",
                "r": {"x":new_r[0],"y":new_r[1],"z":new_r[2]},
                "v": {"x":new_v[0],"y":new_v[1],"z":new_v[2]},
            }
            print(f"  ♻️  DEBRIS RESET: DEBRIS-{idx_replace:03d} "
                  f"→ {tgt['id']} | dist={offset*1000:.0f}m")

        print(f"  Tick {tick:4d} | t={int(now)} | "
              f"burns_this_tick={tick_burns} | total_burns={total_burns}")

        time.sleep(UPDATE_RATE)


if __name__ == "__main__":
    simulate_evaluator()