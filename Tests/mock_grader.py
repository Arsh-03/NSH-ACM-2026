"""
NSH-2026 Mock Grader — Project AETHER
Run from project root: python Tests/mock_grader.py

This generator now creates:
1) Base constellation: 50 satellites (dashboard baseline)
2) Scenario satellites: 2-3 per test type for faster validation
3) Targeted debris patterns to trigger specific behaviors quickly
"""
import math
import random
import time
import os
from typing import Dict, List, Tuple

import numpy as np
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000/api")
RE = 6378.137
UPDATE_RATE = 2.0

BASE_CONSTELLATION_SIZE = 50
SCENARIO_SATS_PER_TYPE = 3
NUM_DEBRIS_RANDOM = 4000

TEST_TYPES = [
    "avoidance",
    "multi_debris",
    "graveyard",
    "constraints",
    "maneuver_physics",
    "connectivity",
]


def circular_orbit_state(alt_km, inc_deg, raan_deg, ta_deg):
    mu = 398600.4418
    r = RE + alt_km
    v_mag = math.sqrt(mu / r)
    inc = math.radians(inc_deg)
    raan = math.radians(raan_deg)
    ta = math.radians(ta_deg)
    rx = r * math.cos(ta)
    ry = r * math.sin(ta)
    x = rx * math.cos(raan) - ry * math.cos(inc) * math.sin(raan)
    y = rx * math.sin(raan) + ry * math.cos(inc) * math.cos(raan)
    z = ry * math.sin(inc)
    vx = v_mag * (-math.sin(ta) * math.cos(raan) - math.cos(ta) * math.cos(inc) * math.sin(raan))
    vy = v_mag * (-math.sin(ta) * math.sin(raan) + math.cos(ta) * math.cos(inc) * math.cos(raan))
    vz = v_mag * (math.cos(ta) * math.sin(inc))
    return [x, y, z, vx, vy, vz]


def safe_post(url, payload, label=""):
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code in (200, 202):
            try:
                return resp.json()
            except Exception:
                print(f"  [WARN] [{label}] Non-JSON response: {resp.text[:200]}")
                return None
        print(f"  [FAIL] [{label}] HTTP {resp.status_code}: {resp.text[:300]}")
        return None
    except requests.exceptions.ConnectionError:
        print(f"  [FAIL] [{label}] Connection refused — is server running?")
        return None
    except Exception as e:
        print(f"  [FAIL] [{label}] Error: {e}")
        return None


def make_base_constellation() -> List[Dict]:
    sats = [
        {"id": "SAT-01-ARSH", "alt": 550, "inc": 53, "raan": 0, "ta": 0, "fuel_start": 50.0, "test_type": "baseline"},
        {"id": "AETHER-02", "alt": 560, "inc": 53, "raan": 36, "ta": 20, "fuel_start": 50.0, "test_type": "baseline"},
        {"id": "AETHER-03", "alt": 570, "inc": 53, "raan": 72, "ta": 40, "fuel_start": 50.0, "test_type": "baseline"},
        {"id": "AETHER-04", "alt": 550, "inc": 53, "raan": 108, "ta": 60, "fuel_start": 50.0, "test_type": "baseline"},
        {"id": "AETHER-05", "alt": 560, "inc": 53, "raan": 144, "ta": 80, "fuel_start": 50.0, "test_type": "baseline"},
    ]
    for i in range(len(sats), BASE_CONSTELLATION_SIZE):
        sats.append({
            "id": f"AETHER-{i+1:02d}",
            "alt": random.uniform(500, 600),
            "inc": random.choice([53, 98, 45, 28]),
            "raan": random.uniform(0, 360),
            "ta": random.uniform(0, 360),
            "fuel_start": 50.0,
            "test_type": "baseline",
        })
    return sats


def make_test_scenario_satellites() -> List[Dict]:
    sats = []
    for test_type in TEST_TYPES:
        for i in range(SCENARIO_SATS_PER_TYPE):
            sid = f"T-{test_type[:5].upper()}-{i+1:02d}"
            fuel_start = 4.0 if test_type == "graveyard" else 50.0
            sats.append({
                "id": sid,
                "alt": 535 + 8 * i + random.uniform(-2, 2),
                "inc": random.choice([53, 60, 75, 98]),
                "raan": (i * 35 + random.uniform(0, 10)) % 360,
                "ta": random.uniform(0, 360),
                "fuel_start": fuel_start,
                "test_type": test_type,
            })
    return sats


def build_debris_field_numpy(
    sat_states: Dict[str, List[float]],
    satellites: List[Dict],
) -> Tuple[np.ndarray, np.ndarray, List[str], List[Dict]]:
    random.seed(42)
    np.random.seed(42)

    debris_ids: List[str] = []
    fixed_r: List[List[float]] = []
    fixed_v: List[List[float]] = []
    meta: List[Dict] = []

    def add_targeted(target_id: str, offset_km: float, axis: int, mode: str, note: str = "", sign: int = 1):
        sv = sat_states[target_id]
        rr = [sv[0], sv[1], sv[2]]
        rr[axis] += sign * offset_km
        vv = [
            -sv[3] * 0.9,
            -sv[4] * 1.0,
            sv[5] * 0.95,
        ]
        idx = len(fixed_r)
        fixed_r.append(rr)
        fixed_v.append(vv)
        did = f"DEB-T-{len(debris_ids)+1:04d}"
        debris_ids.append(did)
        meta.append({
            "idx": idx,
            "debris_id": did,
            "target_id": target_id,
            "mode": mode,
            "base_offset_km": offset_km,
            "axis": axis,
            "sign": sign,
            "note": note,
        })

    # Build targeted debris patterns per test type
    for sat in satellites:
        sid = sat["id"]
        ttype = sat["test_type"]
        if ttype == "avoidance":
            add_targeted(sid, offset_km=1.5 + random.uniform(-0.4, 0.4), axis=random.choice([0, 1]), mode="avoidance")
        elif ttype == "multi_debris":
            axis = random.choice([0, 1, 2])
            add_targeted(sid, offset_km=2.0, axis=axis, mode="multi_close", sign=1)
            add_targeted(sid, offset_km=5.0, axis=axis, mode="multi_far", sign=-1)
        elif ttype == "graveyard":
            # Start outside warning sphere and drift inward over 5-10 minutes.
            add_targeted(sid, offset_km=80.0, axis=random.choice([0, 1]), mode="graveyard_ramp")
        elif ttype == "maneuver_physics":
            add_targeted(sid, offset_km=12.0, axis=random.choice([0, 2]), mode="maneuver_physics")
        elif ttype == "constraints":
            add_targeted(sid, offset_km=55.0, axis=random.choice([0, 1]), mode="constraints_edge")

    # Random background debris (lighter than previous 10k to speed test cycles)
    num_random = max(0, NUM_DEBRIS_RANDOM)
    rand_alts = np.random.uniform(450, 650, num_random)
    rand_incs = np.random.uniform(0, 110, num_random)
    rand_raans = np.random.uniform(0, 360, num_random)
    rand_tas = np.random.uniform(0, 360, num_random)

    rand_r = []
    rand_v = []
    for i in range(num_random):
        sv = circular_orbit_state(rand_alts[i], rand_incs[i], rand_raans[i], rand_tas[i])
        rand_r.append(sv[:3])
        rand_v.append(sv[3:])
        debris_ids.append(f"DEB-R-{i:05d}")

    all_r = np.array(fixed_r + rand_r, dtype=float)
    all_v = np.array(fixed_v + rand_v, dtype=float)
    return all_r, all_v, debris_ids, meta


def apply_targeted_debris_overrides(
    debris_r: np.ndarray,
    debris_v: np.ndarray,
    debris_meta: List[Dict],
    sat_states: Dict[str, List[float]],
    elapsed_sec: float,
    graveyard_ramp_by_sat: Dict[str, float],
):
    for m in debris_meta:
        idx = m["idx"]
        sid = m["target_id"]
        if sid not in sat_states:
            continue
        sv = sat_states[sid]
        axis = int(m["axis"])
        sign = int(m["sign"])
        offset = float(m["base_offset_km"])

        if m["mode"] == "graveyard_ramp":
            # 80km -> 45km over 5-10 minutes, then hold.
            ramp = max(300.0, float(graveyard_ramp_by_sat.get(sid, 420.0)))
            alpha = min(1.0, elapsed_sec / ramp)
            offset = 80.0 - 35.0 * alpha

        rr = [sv[0], sv[1], sv[2]]
        rr[axis] += sign * offset
        debris_r[idx] = np.array(rr, dtype=float)

        # Counter-track velocity keeps conjunction geometry active.
        debris_v[idx] = np.array([
            -sv[3] * 0.95,
            -sv[4] * 0.98,
            sv[5] * 0.92,
        ], dtype=float)


def get_debris_payload(ids, r_arr, v_arr):
    return [
        {
            "id": str(ids[i]),
            "type": "DEBRIS",
            "r": {"x": float(r_arr[i][0]), "y": float(r_arr[i][1]), "z": float(r_arr[i][2])},
            "v": {"x": float(v_arr[i][0]), "y": float(v_arr[i][1]), "z": float(v_arr[i][2])},
        }
        for i in range(len(ids))
    ]


def simulate_evaluator():
    random.seed(7)
    np.random.seed(7)

    satellites = make_base_constellation() + make_test_scenario_satellites()
    num_sats = len(satellites)
    scenario_count = sum(1 for s in satellites if s["test_type"] != "baseline")

    print("=" * 70)
    print("  NSH-2026 Mock Grader — Scenario-Accelerated Mode")
    print(f"  Base satellites: {BASE_CONSTELLATION_SIZE} | Scenario satellites: {scenario_count}")
    print(f"  Total satellites: {num_sats} | Random debris: {NUM_DEBRIS_RANDOM}")
    print(f"  Update rate: {UPDATE_RATE}s")
    print("  Test types (3 each): " + ", ".join(TEST_TYPES))
    print("=" * 70)

    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        h = r.json()
        print(f"[OK] Backend online | system={h.get('system')} | model_ready={h.get('model_ready')}")
    except Exception as e:
        print(f"[FAIL] Backend offline — start server: python main.py\n  ({e})")
        return

    # Fuel tracker starts from satellite-specific initial fuel.
    fuel_tracker: Dict[str, float] = {s["id"]: float(s.get("fuel_start", 50.0)) for s in satellites}
    sat_index = {s["id"]: s for s in satellites}

    # Per-graveyard satellite ramp duration in [5,10] minutes.
    graveyard_ramp_by_sat = {}
    for s in satellites:
        if s["test_type"] == "graveyard":
            graveyard_ramp_by_sat[s["id"]] = random.choice([300.0, 360.0, 420.0, 540.0, 600.0])

    print("\n[SAT] Initialising constellation...")
    sat_states: Dict[str, List[float]] = {}
    sim_start = time.time()
    for sat in satellites:
        sv = circular_orbit_state(sat["alt"], sat["inc"], sat["raan"], sat["ta"])
        sat_states[sat["id"]] = sv

        res = safe_post(
            f"{BASE_URL}/telemetry",
            {
                "sat_id": sat["id"],
                "state_vector": sv,
                "epoch": sim_start,
                "fuel_kg": fuel_tracker[sat["id"]],
            },
            label=sat["id"],
        )
        if res and res.get("fuel_remaining") is not None:
            fuel_tracker[sat["id"]] = float(res["fuel_remaining"])

        if sat["test_type"] != "baseline":
            print(
                f"  [SCN] {sat['id']:<18} type={sat['test_type']:<16} "
                f"fuel_start={sat['fuel_start']:.1f}kg"
            )

    debris_r, debris_v, debris_ids, debris_meta = build_debris_field_numpy(sat_states, satellites)
    bulk_result = safe_post(
        f"{BASE_URL}/telemetry/bulk",
        {"timestamp": time.time(), "objects": get_debris_payload(debris_ids, debris_r, debris_v)},
        label="bulk-debris-init",
    )
    if bulk_result:
        print(f"\n[OK] Debris registered: {len(debris_ids)} total ({len(debris_meta)} targeted + {NUM_DEBRIS_RANDOM} random)")
    else:
        print("\n[FAIL] Bulk debris registration failed")

    print("\n[STREAM] Scenario telemetry streaming — Ctrl+C to stop\n")
    tick = 0
    total_burns = 0

    while True:
        tick += 1
        now = time.time()
        elapsed = now - sim_start
        tick_burns = 0

        # Debris propagation + targeted overrides
        mu_d = 398600.4418
        rm = np.linalg.norm(debris_r, axis=1, keepdims=True)
        acc = (-mu_d / np.maximum(rm, 1e-9) ** 3) * debris_r
        debris_r += debris_v * UPDATE_RATE + 0.5 * acc * UPDATE_RATE**2
        debris_v += acc * UPDATE_RATE
        apply_targeted_debris_overrides(
            debris_r,
            debris_v,
            debris_meta,
            sat_states,
            elapsed_sec=elapsed,
            graveyard_ramp_by_sat=graveyard_ramp_by_sat,
        )

        safe_post(
            f"{BASE_URL}/telemetry/bulk",
            {"timestamp": now, "objects": get_debris_payload(debris_ids, debris_r, debris_v)},
            label="bulk-tick",
        )

        # Satellite propagation and telemetry push
        mu_s = 398600.4418
        for sat in satellites:
            sid = sat["id"]
            sv = sat_states[sid]

            r = sv[:3]
            v = sv[3:]
            rm_s = (r[0] ** 2 + r[1] ** 2 + r[2] ** 2) ** 0.5
            ax = -mu_s / rm_s**3 * r[0]
            ay = -mu_s / rm_s**3 * r[1]
            az = -mu_s / rm_s**3 * r[2]
            new_r = [r[i] + v[i] * UPDATE_RATE + 0.5 * [ax, ay, az][i] * UPDATE_RATE**2 for i in range(3)]
            new_v = [v[i] + [ax, ay, az][i] * UPDATE_RATE for i in range(3)]
            sat_states[sid] = new_r + new_v

            # For graveyard scenarios, feed a controlled 4.0kg -> ~2.5kg ramp over 5-10 min.
            fuel_to_send = fuel_tracker.get(sid, 50.0)
            if sat["test_type"] == "graveyard":
                ramp = graveyard_ramp_by_sat.get(sid, 420.0)
                target_fuel = max(2.4, 4.0 - (min(elapsed, ramp) / ramp) * (4.0 - 2.4))
                fuel_to_send = min(fuel_to_send, target_fuel)

            result = safe_post(
                f"{BASE_URL}/telemetry",
                {
                    "sat_id": sid,
                    "state_vector": sat_states[sid],
                    "epoch": now,
                    "fuel_kg": float(fuel_to_send),
                },
                label=sid,
            )

            if result and result.get("fuel_remaining") is not None:
                fuel_tracker[sid] = float(result["fuel_remaining"])

            if result and result.get("status") == "MANEUVER_REQUIRED":
                dv = result.get("delta_v", [0, 0, 0])
                sv2 = sat_states[sid]
                sat_states[sid] = [sv2[0], sv2[1], sv2[2], sv2[3] + dv[0], sv2[4] + dv[1], sv2[5] + dv[2]]

                tick_burns += 1
                total_burns += 1
                print(
                    f"  [BURN] {sid:<18} type={sat['test_type']:<16} "
                    f"dist={result.get('min_dist_km', '?')}km "
                    f"fuel={fuel_tracker.get(sid, 0):.2f}kg"
                )

        if tick % int(30 / UPDATE_RATE) == 0:
            grave_ids = [s["id"] for s in satellites if s["test_type"] == "graveyard"]
            grave_status = ", ".join(
                f"{gid}:{fuel_tracker.get(gid, 0):.2f}kg" for gid in grave_ids
            )
            print(
                f"  Tick {tick:4d} | t+{int(elapsed):4d}s | "
                f"burns={tick_burns} (total={total_burns}) | graveyard={grave_status}"
            )

        time.sleep(UPDATE_RATE)


if __name__ == "__main__":
    simulate_evaluator()