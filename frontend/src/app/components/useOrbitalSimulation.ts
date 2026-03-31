/**
 * useOrbitalSimulation.ts
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Bridges the gap between WebSocket telemetry ticks (typically every 1–5s)
 *   and smooth 60fps visual updates. Without this, satellite markers jump
 *   discretely each time a WebSocket message arrives.
 *
 * HOW IT WORKS:
 *   1. The WebSocket provides real ECI state vectors [r, v] on each tick.
 *      We store those in a "truth anchor" ref — the authoritative position.
 *
 *   2. Between WS ticks, we propagate each satellite's position forward using
 *      a lightweight two-body Keplerian integrator (Euler method, dt = frame time).
 *      This gives smooth continuous motion at 60fps.
 *
 *   3. On each new WS tick, we "snap" back to the real position. Because
 *      Keplerian propagation is accurate, the snap is imperceptibly small.
 *
 *   4. The simulation state is stored entirely in useRef — mutations never
 *      trigger React re-renders. Only a single `setTick` counter increments
 *      once per frame to drive rendering downstream.
 *
 * ARCHITECTURE:
 *
 *   WebSocket
 *       │ (every 1-5s, real r/v vectors)
 *       ▼
 *   truthRef (anchor)    ←── snap on each WS update
 *       │
 *       ▼
 *   RAF integrator       ←── propagates r/v forward by deltaTime each frame
 *       │
 *       ▼
 *   simStateRef          ←── current interpolated r/v/lat/lon per satellite
 *       │
 *   ┌───┴────┐
 *   ▼        ▼
 * 2D map   3D globe    ←── both read from simStateRef, perfectly in sync
 *
 * HISTORY MANAGEMENT:
 *   Each satellite's trail is managed inside the RAF loop. A new point is
 *   pushed at most every HISTORY_SAMPLE_INTERVAL_MS (default: 5s). Points
 *   older than 90 minutes are pruned on every frame. This keeps the arrays
 *   bounded at max 90*60/5 = 1080 points per satellite — tiny.
 *
 * PREDICTION GENERATION:
 *   Predictions are generated for the SELECTED satellite only, on demand,
 *   using the same two-body propagator stepped 90 minutes into the future.
 *   They're regenerated whenever the selected satellite changes or the RAF
 *   loop completes PREDICT_REGEN_INTERVAL frames.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useRef, useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Raw satellite state as received from the WebSocket */
export interface LiveSatInput {
  id: string;
  r: number[];    // ECI position [x, y, z] km
  v: number[];    // ECI velocity [vx, vy, vz] km/s
  status: string;
  fuel: number;
  type: string;
}

/** A single point in a satellite's history trail */
export interface TrailPoint {
  lat: number;
  lon: number;
  timestamp: number; // unix ms
}

/** The simulated, continuously-updated state of one satellite */
export interface SimSatellite {
  id: string;
  status: string;
  fuel: number;
  type: string;
  // Current ECI state (updated every frame by integrator)
  r: number[];
  v: number[];
  // Geographic position derived from ECI (updated every frame)
  lat: number;
  lon: number;
  alt: number; // km above surface
  // History trail (updated every HISTORY_SAMPLE_INTERVAL_MS)
  history: TrailPoint[];
  // Authoritative WS target blended in over a short window to avoid visible kinks.
  wsTargetR?: number[];
  wsTargetV?: number[];
  wsBlendRemainingMs?: number;
}

/** Predicted future positions for the selected satellite */
export interface PredictPoint {
  lat: number;
  lon: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MU                        = 398600.4418; // Earth gravitational parameter km³/s²
const RE                        = 6378.137;    // Earth radius km
const TRAIL_WINDOW_MS           = 90 * 60 * 1000; // 90 minutes
const HISTORY_SAMPLE_INTERVAL_MS = 5_000;       // push new trail point every 5s
const MANEUVER_HISTORY_SAMPLE_INTERVAL_MS = 1_000; // denser trail while maneuvering
const PREDICT_MINUTES           = 90;
const PREDICT_DT_S              = 30;           // 30s steps → 180 future points
const PREDICT_STEPS             = (PREDICT_MINUTES * 60) / PREDICT_DT_S;
const PREDICT_REGEN_FRAMES      = 360;          // regenerate prediction every ~6s at 60fps
// Max integration step to avoid numerical instability
const MAX_DT_S                  = 0.1;          // clamp frame deltaTime to 100ms
const WS_BLEND_DURATION_MS       = 300;          // smooth truth-anchor correction window

// ── Math helpers ──────────────────────────────────────────────────────────────

const norm3 = (v: number[]) =>
  Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

/**
 * ECI → geographic lat/lon/alt using GMST correction for Earth rotation.
 */
function eciToGeo(r: number[], gmstRad: number): { lat: number; lon: number; alt: number } {
  const mag = norm3(r);
  if (mag < 1e-9) return { lat: 0, lon: 0, alt: 0 };
  
  const lat = Math.asin(Math.max(-1, Math.min(1, r[2] / mag))) * (180 / Math.PI);
  
  // Apply GMST rotation to longitude
  let lon = (Math.atan2(r[1], r[0]) - gmstRad) * (180 / Math.PI);
  
  // Wrap to [-180, 180]
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  
  const alt = mag - RE;
  return { lat, lon, alt };
}

/** Compute GMST in radians for a given Unix timestamp in milliseconds */
function getGmstRad(ms: number) {
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0;
  const gmstDeg =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000.0;
  return (((gmstDeg % 360) + 360) % 360 * Math.PI) / 180;
}

/** 
 * Two-body Keplerian integrator + J2 Perturbation — one Euler step.
 * 
 * J2 reflects the Earth's non-spherical shape (equatorial bulge), 
 * causing nodal regression and apsidal precession. Without this,
 * frontend paths drift from the J2-aware backend.
 */
function eulerStep(
  r: number[],
  v: number[],
  dt_s: number,
): { r: number[]; v: number[] } {
  const mag = Math.sqrt(r[0]**2 + r[1]**2 + r[2]**2);
  const mag2 = mag * mag;
  const mag3 = mag2 * mag;
  const mag5 = mag3 * mag2;

  // 1. Core Keplerian Acceleration
  const k = -MU / mag3;
  let ax = k * r[0];
  let ay = k * r[1];
  let az = k * r[2];

  // 2. J2 Perturbation Acceleration
  const z2 = r[2] * r[2];
  const j2_k = (1.5 * 1.08263e-3 * MU * RE * RE) / mag5;
  const xy_factor = j2_k * (5 * z2 / mag2 - 1);
  const z_factor  = j2_k * (5 * z2 / mag2 - 3);

  ax += r[0] * xy_factor;
  ay += r[1] * xy_factor;
  az += r[2] * z_factor;

  return {
    v: [v[0] + ax * dt_s, v[1] + ay * dt_s, v[2] + az * dt_s],
    r: [r[0] + v[0] * dt_s, r[1] + v[1] * dt_s, r[2] + v[2] * dt_s],
  };
}

/**
 * Propagate forward N steps and collect geographic positions.
 * Used for prediction generation.
 */
function propagateN(
  r0: number[],
  v0: number[],
  dt_s: number,
  steps: number,
  ms: number,
): PredictPoint[] {
  const result: PredictPoint[] = [];
  let r = [...r0];
  let v = [...v0];
  for (let i = 0; i < steps; i++) {
    const next = eulerStep(r, v, dt_s);
    r = next.r;
    v = next.v;
    const ts = ms + (i + 1) * dt_s * 1000;
    const gmst = getGmstRad(ts);
    const { lat, lon } = eciToGeo(r, gmst);
    result.push({ lat, lon });
  }
  return result;
}

/**
 * Back-propagate to seed initial history using J2 awareness.
 */
function seedHistory(r0: number[], v0: number[], ms: number): TrailPoint[] {
  const dt_s  = PREDICT_DT_S;
  const steps = (TRAIL_WINDOW_MS / 1000) / dt_s;
  const vNeg  = [-v0[0], -v0[1], -v0[2]];

  const pts: TrailPoint[] = [];
  let r = [...r0];
  let v = [...vNeg];

  for (let i = 0; i < steps; i++) {
    const ts = ms - (i + 1) * dt_s * 1000;
    const next = eulerStep(r, v, dt_s);
    r = next.r;
    v = next.v;
    const gmst = getGmstRad(ts);
    pts.push({
      ...eciToGeo(r, gmst),
      timestamp: ts,
    });
  }
  pts.reverse();
  return pts;
}

// ── useOrbitalSimulation ───────────────────────────────────────────────────────

interface UseOrbitalSimulationOptions {
  /** Raw satellite list from the WebSocket hook */
  liveSats: LiveSatInput[];
  /** Currently selected satellite ID (for prediction computation) */
  selectedId: string;
}

interface UseOrbitalSimulationResult {
  /** Tick counter — increment signals "state has changed, please re-read simRef" */
  tick: number;
  /** Ref to current simulation state — read this in render, never store a copy */
  simRef: React.MutableRefObject<Map<string, SimSatellite>>;
  /** Predicted future positions for the selected satellite */
  prediction: PredictPoint[];
  /** Sorted satellite IDs in current simulation */
  satIds: string[];
}

export function useOrbitalSimulation({
  liveSats,
  selectedId,
}: UseOrbitalSimulationOptions): UseOrbitalSimulationResult {

  // ── Simulation state in a ref (not state) to avoid React re-renders per frame
  //
  // PERFORMANCE DECISION:
  //   Storing satellite state in useState would trigger a full re-render of the
  //   entire component tree on every RAF frame (60x/s). With 50 satellites and
  //   a complex dashboard, this would be catastrophic.
  //
  //   Instead, we store everything in a Map<id, SimSatellite> ref and only
  //   increment a lightweight `tick` counter to signal that downstream
  //   consumers (Canvas, SVG) should redraw. The consumers read directly from
  //   the ref on each frame — no React diffing involved.
  const simRef  = useRef<Map<string, SimSatellite>>(new Map());

  // Single counter that advances once per RAF frame to trigger re-renders
  const [tick, setTick] = useState(0);

  // Ref to the last prediction result (avoids state for this too)
  const [prediction, setPrediction] = useState<PredictPoint[]>([]);

  // RAF handle for cleanup
  const rafRef           = useRef<number>(0);
  // Timestamp of the previous RAF frame
  const lastTimeRef      = useRef<number>(0);
  // When each satellite's history was last sampled
  const lastSampleRef    = useRef<Map<string, number>>(new Map());
  // Frame counter for prediction regeneration timing
  const frameCountRef    = useRef<number>(0);
  // Whether history has been seeded for each satellite
  const seededRef        = useRef<Set<string>>(new Set());
  // Anchors the simulation to the latest authoritative backend clock
  const simTimeRef       = useRef<number>(Date.now());
  // Current selected ID ref (avoids stale closure in RAF)
  const selectedIdRef    = useRef<string>(selectedId);
  selectedIdRef.current  = selectedId;

  // Immediate prediction update function
  const regeneratePrediction = useCallback(() => {
    const sel = simRef.current.get(selectedIdRef.current);
    if (sel?.r?.length === 3 && sel?.v?.length === 3) {
      const pts = propagateN(sel.r, sel.v, PREDICT_DT_S, PREDICT_STEPS, simTimeRef.current);
      const current: PredictPoint = { lat: sel.lat, lon: sel.lon };
      setPrediction([current, ...pts]);
    }
  }, [selectedId]);

  // ── Absorb new WebSocket data into simulation state ────────────────────────
  //
  // Called whenever `liveSats` changes (i.e. new WS message received).
  // IMPORTANT: This is a SNAP, not a lerp. Because our integrator is accurate,
  // the snap distance is tiny and visually imperceptible.
  useEffect(() => {
    const sim = simRef.current;
    
    // Use latest message timestamp or fallback
    const wallClock = Date.now();
    simTimeRef.current = wallClock;

    liveSats.forEach((ls) => {
      if (!ls.r?.length || !ls.v?.length) return;

      const existing = sim.get(ls.id);
      if (existing) {
        const statusChanged = existing.status !== ls.status;
        // Blend toward authoritative state to avoid visible trajectory kinks.
        existing.wsTargetR = [...ls.r];
        existing.wsTargetV = [...ls.v];
        existing.wsBlendRemainingMs = WS_BLEND_DURATION_MS;
        existing.status = ls.status;
        existing.fuel   = ls.fuel;

        // Trigger immediate path update if maneuver starts/ends
        if (statusChanged && ls.id === selectedIdRef.current) {
          regeneratePrediction();
        }

        const geo = eciToGeo(existing.r, getGmstRad(simTimeRef.current));
        existing.lat = geo.lat;
        existing.lon = geo.lon;
        existing.alt = geo.alt;
      } else {
        // First time we see this satellite — MapViewPanel was just remounted
        // with real positions so we seed history immediately.
        const geo = eciToGeo(ls.r, getGmstRad(simTimeRef.current));
        const newSat: SimSatellite = {
          id:      ls.id,
          status:  ls.status,
          fuel:    ls.fuel,
          type:    ls.type,
          r:       [...ls.r],
          v:       [...ls.v],
          lat:     geo.lat,
          lon:     geo.lon,
          alt:     geo.alt,
          history: [],
          wsTargetR: undefined,
          wsTargetV: undefined,
          wsBlendRemainingMs: 0,
        };

        if (!seededRef.current.has(ls.id) && ls.r.length === 3 && ls.v.length === 3) {
          newSat.history = seedHistory(ls.r, ls.v, simTimeRef.current);
          seededRef.current.add(ls.id);
        }
        sim.set(ls.id, newSat);
      }
    });

    const liveIds = new Set(liveSats.map((s) => s.id));
    for (const id of sim.keys()) {
      if (!liveIds.has(id)) sim.delete(id);
    }
  }, [liveSats, selectedId, regeneratePrediction]);

  // ── RAF animation loop ─────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (timestamp: number) => {
      // ── Compute deltaTime ─────────────────────────────────────────────────
      //
      // deltaTime = time elapsed since last frame, in seconds.
      //
      // WHY WE CLAMP TO MAX_DT_S:
      //   If the browser tab is hidden and then foregrounded, the first frame
      //   after resumption will have a very large deltaTime (potentially seconds).
      //   Unclamped, this would cause satellites to "teleport" forward.
      //   Clamping to 100ms caps the maximum integration step.
      const now       = timestamp;
      const dt_ms     = lastTimeRef.current === 0 ? 16 : now - lastTimeRef.current;
      const dt_s      = Math.min(dt_ms / 1000, MAX_DT_S);
      lastTimeRef.current = now;

      const wallClock = Date.now();
      const gmstRad   = getGmstRad(wallClock);
      const sim       = simRef.current;

      // ── Update every satellite position ───────────────────────────────────
      sim.forEach((sat) => {
        // Apply a short blend toward authoritative WS state before propagation.
        if (
          sat.wsTargetR &&
          sat.wsTargetV &&
          (sat.wsBlendRemainingMs ?? 0) > 0
        ) {
          const remaining = Math.max(1, sat.wsBlendRemainingMs as number);
          const alpha = Math.min(1, dt_ms / remaining);
          sat.r = sat.r.map((cur, i) => cur + ((sat.wsTargetR as number[])[i] - cur) * alpha);
          sat.v = sat.v.map((cur, i) => cur + ((sat.wsTargetV as number[])[i] - cur) * alpha);
          sat.wsBlendRemainingMs = Math.max(0, remaining - dt_ms);

          if ((sat.wsBlendRemainingMs ?? 0) <= 0) {
            sat.r = [...sat.wsTargetR];
            sat.v = [...sat.wsTargetV];
            sat.wsTargetR = undefined;
            sat.wsTargetV = undefined;
            sat.wsBlendRemainingMs = 0;
          }
        }

        // One Euler integration step with clamped deltaTime
        const next = eulerStep(sat.r, sat.v, dt_s);
        sat.r = next.r;
        sat.v = next.v;

        // Update geographic position from new ECI state
        const geo = eciToGeo(sat.r, gmstRad);
        sat.lat = geo.lat;
        sat.lon = geo.lon;
        sat.alt = geo.alt;

        // ── History sampling ──────────────────────────────────────────────
        //
        // We don't push a history point every frame (that would be 60 points/sec
        // = 324,000 points per satellite over 90 minutes). Instead we sample
        // every HISTORY_SAMPLE_INTERVAL_MS (5 seconds = 1080 max points).
        const sampleInterval = sat.status === 'MANEUVERING'
          ? MANEUVER_HISTORY_SAMPLE_INTERVAL_MS
          : HISTORY_SAMPLE_INTERVAL_MS;
        const lastSample = lastSampleRef.current.get(sat.id) ?? 0;
        if (wallClock - lastSample >= sampleInterval) {
          sat.history.push({ lat: sat.lat, lon: sat.lon, timestamp: wallClock });
          lastSampleRef.current.set(sat.id, wallClock);

          // STRICT TIME FILTER: prune points older than 90 minutes
          // This runs infrequently (every 5s) so the O(n) filter is cheap
          sat.history = sat.history.filter(
            (pt) => wallClock - pt.timestamp <= TRAIL_WINDOW_MS,
          );
        }
      });

      // ── Prediction regeneration ────────────────────────────────────────
      //
      // Generate prediction for selected satellite every PREDICT_REGEN_FRAMES.
      // We increment frameCountRef and check modulo so this doesn't run every frame.
      // Running every 360 frames at 60fps = every ~6 seconds.
      // The prediction barely changes in 6 seconds visually, so this is fine.
      frameCountRef.current += 1;
      if (
        frameCountRef.current % PREDICT_REGEN_FRAMES === 0 &&
        selectedIdRef.current
      ) {
        const sel = sim.get(selectedIdRef.current);
        if (sel?.r?.length === 3 && sel?.v?.length === 3) {
          const pts = propagateN(sel.r, sel.v, PREDICT_DT_S, PREDICT_STEPS, simTimeRef.current);
          // Include current position as first point so path starts at marker
          const current: PredictPoint = { lat: sel.lat, lon: sel.lon };
          setPrediction([current, ...pts]);
        }
      }

      // ── Trigger React re-render ────────────────────────────────────────
      //
      // We increment tick by 1 on every frame. Components that display satellite
      // data watch this tick counter and re-read from simRef.current on change.
      // This is much cheaper than storing the full satellite array in state.
      setTick((t) => t + 1);

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // empty dep array — loop runs forever, reads from refs

  // ── Regenerate prediction when selection changes ───────────────────────────
  //
  // When user selects a different satellite, regenerate prediction immediately
  // rather than waiting PREDICT_REGEN_FRAMES frames.
  useEffect(() => {
    if (!selectedId) { setPrediction([]); return; }

    const sel = simRef.current.get(selectedId);
    if (sel?.r?.length === 3 && sel?.v?.length === 3) {
      const pts = propagateN(sel.r, sel.v, PREDICT_DT_S, PREDICT_STEPS, simTimeRef.current);
      setPrediction([{ lat: sel.lat, lon: sel.lon }, ...pts]);
    } else {
      setPrediction([]);
    }
  }, [selectedId]);

  // ── Satellite ID list ──────────────────────────────────────────────────────
  // Derived from the simulation map. Recomputed only when liveSats changes.
  const satIds = liveSats.map((s) => s.id);

  return { tick, simRef, prediction, satIds };
}

// ── Helper: extract a snapshot array from simRef ───────────────────────────────
//
// Use this in components that need to iterate over satellites.
// Call inside render (after tick triggers re-render) to get the current state.
//
// Example:
//   const sats = useSimSnapshot(simRef);
//
export function useSimSnapshot(
  simRef: React.MutableRefObject<Map<string, SimSatellite>>,
  _tick: number, // passed to ensure this is re-called when tick changes
): SimSatellite[] {
  return Array.from(simRef.current.values());
}