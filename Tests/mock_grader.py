"""
NSH-2026 Mock Grader — Project AETHER
Run from project root: python Tests/mock_grader.py
"""
import requests
import json
import time
import math
import random
import numpy as np

BASE_URL    = "http://localhost:8000/api"
RE          = 6378.137
UPDATE_RATE = 2.0
NUM_SATS    = 50
NUM_DEBRIS  = 10000

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
# ⚰️  Two dedicated graveyard-orbit test satellites:
#   EOL-TEST-01: starts exactly at 2.5 kg threshold → triggers EOL immediately
#   EOL-TEST-02: starts at 3.8 kg, drains 0.4 kg/tick → crosses threshold in ~3-4 ticks
# Both positioned over ISTRAC Bengaluru so they're never in a comms blackout,
# guaranteeing the auto_pilot can execute their graveyard burn.
SATELLITES = [
    # ── Graveyard test satellites (appear first so they're easy to spot) ──
    {"id": "EOL-TEST-01", "alt": 545, "inc": 13,  "raan": 77,  "ta": 0,  "fuel": 2.5},
    {"id": "EOL-TEST-02", "alt": 555, "inc": 13,  "raan": 77,  "ta": 10, "fuel": 3.8},
    # ── Normal constellation ──
    {"id": "SAT-01-ARSH", "alt": 550, "inc": 53,  "raan": 0,   "ta": 0},
    {"id": "AETHER-02",   "alt": 560, "inc": 53,  "raan": 36,  "ta": 20},
    {"id": "AETHER-03",   "alt": 570, "inc": 53,  "raan": 72,  "ta": 40},
    {"id": "AETHER-04",   "alt": 550, "inc": 53,  "raan": 108, "ta": 60},
    {"id": "AETHER-05",   "alt": 560, "inc": 53,  "raan": 144, "ta": 80},
]

# EOL_FUEL_DRAIN: how many kg to subtract from each EOL test sat per tick.
# EOL-TEST-01 is already at threshold; EOL-TEST-02 drains until it crosses 2.5 kg.
EOL_SATELLITES = {"EOL-TEST-01", "EOL-TEST-02"}
EOL_FUEL_DRAIN = {"EOL-TEST-01": 0.0, "EOL-TEST-02": 0.4}  # kg/tick
EOL_THRESHOLD  = 2.5  # must match src/api/telemetry.py:EOL_FUEL

# Fill remaining satellites up to NUM_SATS
for i in range(len(SATELLITES), NUM_SATS):
    SATELLITES.append({
        "id": f"AETHER-{i+1:02d}",
        "alt": random.uniform(500, 600),
        "inc": random.choice([53, 98, 45, 28]),
        "raan": random.uniform(0, 360),
        "ta": random.uniform(0, 360)
    })

def safe_post(url, payload, label=""):
    """POST with full error reporting — never crashes on bad response."""
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200 or resp.status_code == 202:
            try:
                return resp.json()
            except Exception:
                print(f"  [WARN] [{label}] Non-JSON response: {resp.text[:200]}")
                return None
        else:
            print(f"  [FAIL] [{label}] HTTP {resp.status_code}: {resp.text[:300]}")
            return None
    except requests.exceptions.ConnectionError:
        print(f"  [FAIL] [{label}] Connection refused — is server running?")
        return None
    except Exception as e:
        print(f"  [FAIL] [{label}] Error: {e}")
        return None

def build_debris_field_numpy(sat_states):
    # Fixed debris near targets
    fixed_r = []
    fixed_v = []
    
    s1 = sat_states["SAT-01-ARSH"]
    fixed_r.append([s1[0]+0.025, s1[1], s1[2]])
    fixed_v.append([s1[3]*0.1, -s1[4]*1.02, s1[5]*0.1])
    
    s5 = sat_states["AETHER-05"]
    fixed_r.append([s5[0], s5[1]+0.040, s5[2]])
    fixed_v.append([s5[3]*0.1, -s5[4]*1.02, s5[5]*0.1])
    
    # Random debris field
    num_random = NUM_DEBRIS - len(fixed_r)
    random.seed(42)
    
    rand_alts  = np.random.uniform(450, 650, num_random)
    rand_incs  = np.random.uniform(0, 110, num_random)
    rand_raans = np.random.uniform(0, 360, num_random)
    rand_tas   = np.random.uniform(0, 360, num_random)
    
    rand_r = []
    rand_v = []
    for i in range(num_random):
        sv = circular_orbit_state(rand_alts[i], rand_incs[i], rand_raans[i], rand_tas[i])
        rand_r.append(sv[:3])
        rand_v.append(sv[3:])
        
    all_r = np.array(fixed_r + rand_r)
    all_v = np.array(fixed_v + rand_v)
    return all_r, all_v


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
        print(f"[OK] Backend online | system={h.get('system')} "
              f"| model_ready={h.get('model_ready')}")
    except Exception as e:
        print(f"[FAIL] Backend offline — start server: python main.py\n  ({e})")
        return

    # Fuel tracker — persists actual fuel across ticks
    # Use per-satellite initial fuel from SATELLITES list (EOL sats start low)
    fuel_tracker: dict = { sat["id"]: sat.get("fuel", 50.0) for sat in SATELLITES }

    # Build satellite states
    print("\n[SAT] Initialising constellation...")
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
            eol_flag = result.get("eol_flag", False)
            eol_marker = " ⚰️  EOL!" if eol_flag else ""
            if sat["id"] in EOL_SATELLITES:
                print(f"  [EOL] {sat['id']:<20} | fuel={fuel_tracker[sat['id']]:.2f}kg"
                      f" | status={result.get('status')}{eol_marker}")
            else:
                print(f"  [OK] {sat['id']:<20} | status={result.get('status')} "
                      f"| dist={result.get('min_dist_km','?')}km "
                      f"| dv={result.get('dv_magnitude',0):.5f} km/s")
        else:
            print(f"  [FAIL] {sat['id']:<20} | FAILED — check server logs")

    # Register debris
    debris_r, debris_v = build_debris_field_numpy(sat_states)
    debris_ids = [f"DEBRIS-{i:04d}" for i in range(NUM_DEBRIS)]
    
    def get_debris_payload(ids, r_arr, v_arr):
        return [
            {
                "id": str(ids[i]), "type": "DEBRIS",
                "r": {"x": float(r_arr[i][0]), "y": float(r_arr[i][1]), "z": float(r_arr[i][2])},
                "v": {"x": float(v_arr[i][0]), "y": float(v_arr[i][1]), "z": float(v_arr[i][2])},
            } for i in range(len(ids))
        ]

    bulk_result = safe_post(f"{BASE_URL}/telemetry/bulk", {
        "timestamp": time.time(),
        "objects":   get_debris_payload(debris_ids, debris_r, debris_v),
    }, label="bulk-debris")

    if bulk_result:
        at_risk = bulk_result.get("at_risk_sats", [])
        print(f"  [OK] {NUM_DEBRIS} debris registered | at_risk={at_risk}")
    else:
        print(f"  [FAIL] Bulk debris registration failed")

    # Live ticks
    print(f"\n[STREAM] Streaming every {UPDATE_RATE}s — Ctrl+C to stop\n")
    tick = 0
    total_burns = 0

    while True:
        tick += 1
        now   = time.time()
        tick_burns = 0

        # ── Send debris FIRST so threat detection works this tick ──────────
        MU_D = 398600.4418
        # Vectorized Numpy propagation
        rm   = np.linalg.norm(debris_r, axis=1, keepdims=True)
        acc  = (-MU_D / rm**3) * debris_r
        debris_r += debris_v * UPDATE_RATE + 0.5 * acc * UPDATE_RATE**2
        debris_v += acc * UPDATE_RATE

        safe_post(f"{BASE_URL}/telemetry/bulk", {
            "timestamp": now,
            "objects":   get_debris_payload(debris_ids, debris_r, debris_v),
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

            # ── EOL fuel drain simulation ─────────────────────────────────
            # For EOL test sats: manually deplete fuel in the tracker each tick
            # so the backend sees it crossing the 2.5 kg threshold.
            # (Real satellites deplete via burn physics; we simulate it here.)
            if sat["id"] in EOL_SATELLITES:
                drain = EOL_FUEL_DRAIN.get(sat["id"], 0.0)
                if drain > 0:
                    fuel_tracker[sat["id"]] = max(0.0, fuel_tracker[sat["id"]] - drain)
                status    = result.get("status", "?") if result else "NO_RESP"
                fuel_left = fuel_tracker[sat["id"]]
                eol_flag  = result.get("eol_flag", False) if result else False
                graveyard = status in ("GRAVEYARD", "EOL_STANDBY", "EOL")
                icon = "⚰️ " if graveyard else ("⚠️ " if eol_flag else "🛰️ ")
                print(f"  {icon} EOL-WATCH {sat['id']:<16}"
                      f" | fuel={fuel_left:.2f}kg"
                      f" | status={status}"
                      f" | eol_flag={eol_flag}")
                if graveyard:
                    print(f"    ✅ GRAVEYARD MANEUVER CONFIRMED for {sat['id']}!")

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
                    print(f"  [BURN] BURN  | {sat['id']:<20} "
                          f"| dist={mdist}km "
                          f"| dv=[{dv[0]:.4f},{dv[1]:.4f},{dv[2]:.4f}]")
                elif mdist != "?" and mdist is not None and float(mdist) < 100:
                    print(f"  [WARN] CLOSE | {sat['id']:<20} "
                          f"| dist={mdist}km")

        # Debris already sent above

        # ── Auto-generate new threats every 30 ticks if all clear ──────────
        all_nominal = tick_burns == 0 and tick > 10
        if all_nominal and tick % 30 == 0:
            # Pick 2 random satellites and place new debris near them
            targets = random.sample(SATELLITES, min(2, len(SATELLITES)))
            
            for tgt in targets:
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
                
                new_id = f"DEBRIS-N{len(debris_ids):02d}"
                debris_ids.append(new_id)
                debris_r = np.vstack([debris_r, new_r])
                debris_v = np.vstack([debris_v, new_v])
                
                print(f"  [NEW] NEW THREAT: {new_id} → {tgt['id']} "
                      f"| offset={offset*1000:.0f}m")

        # ── Replace a random debris every 60 ticks for continuous action ──
        if tick % 60 == 0 and tick > 0:
            tgt = random.choice(SATELLITES)
            sv_t = sat_states[tgt["id"]]
            offset = random.uniform(0.015, 0.05)
            axis   = random.choice([0, 1, 2])
            new_r  = [sv_t[0], sv_t[1], sv_t[2]]
            new_r[axis] += offset
            new_v  = [sv_t[3]*0.1, -sv_t[4]*1.02, sv_t[5]*0.1]
            idx_replace = random.randint(2, len(debris_ids)-1)
            
            debris_r[idx_replace] = new_r
            debris_v[idx_replace] = new_v
            
            print(f"  [RECYCLE] DEBRIS RESET: {debris_ids[idx_replace]} "
                  f"→ {tgt['id']} | dist={offset*1000:.0f}m")

        print(f"  Tick {tick:4d} | t={int(now)} | "
              f"burns_this_tick={tick_burns} | total_burns={total_burns}")

        time.sleep(UPDATE_RATE)


if __name__ == "__main__":
    simulate_evaluator()