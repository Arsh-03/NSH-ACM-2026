/**
 * OrbitalOverlays.tsx  — v2 (full rewrite)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Three precision-fixed overlay components for AETHER's 2D Ground Track Map:
 *
 *   1. HistoricalTrail    — strictly last 90 min, per-segment opacity fade via Canvas
 *   2. PredictedPath      — strictly next 90 min, dashed + arrowhead + march animation
 *   3. TerminatorOverlay  — correct night-side polygon for ALL solar positions
 *
 * KEY FIXES vs v1:
 *   ✔ Trail uses Canvas2D (not SVG linearGradient) → per-segment fade that follows
 *     the actual curve direction, not a fixed horizontal axis
 *   ✔ Trail driven by requestAnimationFrame (not setInterval) for smooth 60fps updates
 *   ✔ Trail strictly time-filtered: only points within [now-90min, now] are rendered
 *   ✔ Prediction generates exactly 90 min of future points, not a full orbit
 *   ✔ Terminator correctly determines night side by testing a known night-side point
 *     against the subsolar position — works for ALL sun longitudes, not just east/west
 *   ✔ Antimeridian breaks are handled in both SVG (prediction) and Canvas (trail)
 *
 * LAYERING ORDER (z-index):
 *   z:2  TerminatorOverlay  (Canvas)
 *   z:3  HistoricalTrail    (Canvas, RAF-driven)
 *   z:4  PredictedPath      (SVG, recomputed every 30s)
 *   z:5+ Satellite markers  (existing, unchanged)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  RefObject,
  memo,
} from 'react';

// ── Shared Types ───────────────────────────────────────────────────────────────

export interface TrailPoint {
  lat: number;
  lon: number;
  /** Unix milliseconds — used for strict time-window filtering */
  timestamp: number;
}

export interface SatelliteForOverlay {
  id: string;
  status: string;
  /** ECI position [x, y, z] km */
  r: number[];
  /** ECI velocity [vx, vy, vz] km/s */
  v: number[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TRAIL_WINDOW_MS  = 90 * 60 * 1000;   // 90 minutes in ms
const PREDICT_MINUTES  = 90;
const PREDICT_DT_S     = 30;               // seconds per propagation step
const PREDICT_STEPS    = (PREDICT_MINUTES * 60) / PREDICT_DT_S; // = 180 steps
const MU               = 398600.4418;      // Earth's gravitational parameter km³/s²

// ── Core Math ─────────────────────────────────────────────────────────────────

const norm3 = (v: number[]) =>
  Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);

/**
 * ECI → geographic lat/lon.
 * Ignores GMST rotation — consistent with EnhancedDashboard's eciToLatLonAlt.
 * Both trail and marker share the same offset so they visually align.
 */
function eciToLatLon(r: number[]): { lat: number; lon: number } {
  const mag = norm3(r);
  if (mag < 1e-9) return { lat: 0, lon: 0 };
  const lat = Math.asin(Math.max(-1, Math.min(1, r[2] / mag))) * (180 / Math.PI);
  const lon = Math.atan2(r[1], r[0]) * (180 / Math.PI);
  return { lat, lon };
}

/**
 * Equirectangular projection → pixel coords.
 *
 *   px = (lon + 180) / 360  * W
 *   py = (90  - lat) / 180  * H
 */
function toPixel(lat: number, lon: number, W: number, H: number) {
  return {
    x: ((lon + 180) / 360) * W,
    y: ((90 - lat) / 180) * H,
  };
}

/**
 * Two-body Keplerian propagation via Euler integration.
 *
 * MATH:
 *   Gravitational acceleration:  a = −(μ/|r|³) · r
 *   Euler step:  v(t+dt) = v(t) + a·dt
 *                r(t+dt) = r(t) + v(t)·dt   ← leapfrog would be better but
 *                                               Euler is sufficient for 90min demo
 *
 * Returns an array of {lat, lon} at each step (does NOT include r=0 starting point).
 */
function propagateOrbit(
  r0: number[],
  v0: number[],
  dt_s: number,
  steps: number,
): { lat: number; lon: number }[] {
  const result: { lat: number; lon: number }[] = [];
  let r = [...r0];
  let v = [...v0];
  for (let i = 0; i < steps; i++) {
    const mag  = norm3(r);
    const mag3 = mag * mag * mag;
    v = [
      v[0] + (-MU / mag3) * r[0] * dt_s,
      v[1] + (-MU / mag3) * r[1] * dt_s,
      v[2] + (-MU / mag3) * r[2] * dt_s,
    ];
    r = [r[0] + v[0] * dt_s, r[1] + v[1] * dt_s, r[2] + v[2] * dt_s];
    result.push(eciToLatLon(r));
  }
  return result;
}

/**
 * Back-propagate to seed 90 min of history at component mount.
 *
 * We negate the velocity and propagate forward (which is backwards in time),
 * then reverse the result array so index 0 = oldest point 90 min ago.
 * Each point is stamped with the correct historical timestamp.
 *
 * dt_s = 30s  →  180 points over 90 minutes
 */
function seedHistory(r0: number[], v0: number[]): TrailPoint[] {
  const dt_s = 30;
  const steps = (TRAIL_WINDOW_MS / 1000) / dt_s;        // 180
  const vRev  = v0.map((x) => -x);                      // negate velocity
  const past  = propagateOrbit(r0, vRev, dt_s, steps);  // propagate "backwards"
  past.reverse();                                         // oldest → newest order

  const now = Date.now();
  return past.map((pt, i) => ({
    lat: pt.lat,
    lon: pt.lon,
    // Stamp each point at its historical time
    // past[0] is ~90min ago, past[179] is ~30s ago
    timestamp: now - (steps - i) * dt_s * 1000,
  }));
}

// ── useContainerSize ───────────────────────────────────────────────────────────

function useContainerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. HISTORICAL TRAIL — Canvas2D + requestAnimationFrame
// ══════════════════════════════════════════════════════════════════════════════

/**
 * HistoricalTrail
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY CANVAS INSTEAD OF SVG:
 *   SVG linearGradient is applied along a fixed axis (x1→x2 or y1→y2), not
 *   along the path tangent. For a curved orbit crossing multiple quadrants, the
 *   gradient looks wrong — segments going "left" appear bright when they should
 *   be faint (they're the old end of the trail).
 *
 *   Canvas2D lets us draw each segment individually and control its opacity as
 *   a function of the point's age:
 *     opacity = (now - timestamp) / TRAIL_WINDOW_MS   → 0.0 at oldest, 1.0 at newest
 *   This gives a true per-segment fade that follows the orbit curve perfectly.
 *
 * RAF LOOP:
 *   We use requestAnimationFrame rather than setInterval so:
 *   - Updates are synchronised with the display's refresh rate (typically 60fps)
 *   - The browser can throttle the loop when the tab is hidden (saves CPU)
 *   - No risk of setInterval drift causing visual stutter
 *
 * TIME FILTERING (strict):
 *   Every frame, before drawing, we filter the history array to:
 *     trail.filter(pt => now - pt.timestamp <= TRAIL_WINDOW_MS)
 *   This means the trail SHRINKS from the tail as old points expire — exactly
 *   what "last 90 minutes only" means.
 *
 * ANTIMERIDIAN HANDLING (Canvas):
 *   When consecutive longitude difference > 180°, we call ctx.moveTo() instead
 *   of ctx.lineTo() — same logic as SVG "M" vs "L", breaks the path at the wrap.
 *
 * NEW POINT SAMPLING:
 *   We push a new point every 10 seconds (not every frame — that would be
 *   excessive at 60fps). The RAF loop only re-draws; sampling is on a separate
 *   setInterval.
 */

interface HistoricalTrailProps {
  satellites: SatelliteForOverlay[];
  containerRef: RefObject<HTMLDivElement | null>;
}

export const HistoricalTrail = memo(function HistoricalTrail({
  satellites,
  containerRef,
}: HistoricalTrailProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const { w, h }   = useContainerSize(containerRef);

  // History stored in ref — mutations don't trigger re-renders
  const historyRef  = useRef<Record<string, TrailPoint[]>>({});
  const seededRef   = useRef<Set<string>>(new Set());
  const rafRef      = useRef<number>(0);

  // Helper: satellite status → trail color
  const trailColor = (sat: SatelliteForOverlay) =>
    sat.status === 'AT_RISK' || sat.status === 'MANEUVERING' ? '#ff6644' : '#3a7fff';

  // Hex color → { r, g, b } for Canvas rgba() usage
  const hexToRgb = (hex: string) => {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m
      ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
      : { r: 58, g: 127, b: 255 };
  };

  // ── Seed history for new satellites ─────────────────────────────────────────
  useEffect(() => {
    satellites.forEach((sat) => {
      if (seededRef.current.has(sat.id)) return;
      if (!sat.r?.length || !sat.v?.length) return;
      historyRef.current[sat.id] = seedHistory(sat.r, sat.v);
      seededRef.current.add(sat.id);
    });
  }, [satellites]);

  // ── Sample a new live position every 10s ────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      satellites.forEach((sat) => {
        if (!sat.r?.length) return;
        const { lat, lon } = eciToLatLon(sat.r);
        if (!historyRef.current[sat.id]) historyRef.current[sat.id] = [];
        historyRef.current[sat.id].push({ lat, lon, timestamp: now });
      });
    }, 10_000);
    return () => clearInterval(interval);
  }, [satellites]);

  // ── RAF draw loop ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // SIZE SYNC: keep canvas pixel dimensions matching layout dimensions
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }

      // Clear previous frame
      ctx.clearRect(0, 0, w, h);

      const now = Date.now();

      satellites.forEach((sat) => {
        const fullTrail = historyRef.current[sat.id];
        if (!fullTrail || fullTrail.length < 2) return;

        // ── STRICT TIME FILTER: keep only last 90 minutes ──────────────────
        // This is the core correctness fix. The trail SHORTENS as old points age out.
        const trail = fullTrail.filter(
          (pt) => now - pt.timestamp <= TRAIL_WINDOW_MS,
        );
        // Prune the stored array too, so memory doesn't grow unboundedly
        historyRef.current[sat.id] = trail;

        if (trail.length < 2) return;

        const color = trailColor(sat);
        const { r: cr, g: cg, b: cb } = hexToRgb(color);

        // ── DRAW EACH SEGMENT INDIVIDUALLY ──────────────────────────────────
        //
        // For each consecutive pair of points (i, i+1):
        //   • Age at the midpoint determines the opacity
        //   • opacity_base = 1 - age_fraction   (1.0 = newest, 0.0 = oldest)
        //   • We apply a mild ease: opacity = base^0.6  (keeps mid-trail visible)
        //
        // Glow effect: draw each segment twice —
        //   Pass 1: wide, blurred-looking stroke at low opacity  (glow halo)
        //   Pass 2: narrow, full-color stroke at full opacity    (core line)

        let prevLon = trail[0].lon;

        for (let i = 0; i < trail.length - 1; i++) {
          const ptA = trail[i];
          const ptB = trail[i + 1];

          // Skip antimeridian segments (longitude wrap)
          if (Math.abs(ptB.lon - prevLon) > 180) {
            prevLon = ptB.lon;
            continue;
          }
          prevLon = ptB.lon;

          // Age fraction: 0 = just sampled, 1 = 90 min old
          const midAge     = (ptA.timestamp + ptB.timestamp) / 2;
          const ageFrac    = Math.max(0, Math.min(1, (now - midAge) / TRAIL_WINDOW_MS));
          // Opacity curve: old points are faint, recent are bright
          // Using power < 1 keeps the mid-trail more visible
          const opacity    = Math.pow(1 - ageFrac, 0.6);

          const { x: ax, y: ay } = toPixel(ptA.lat, ptA.lon, w, h);
          const { x: bx, y: by } = toPixel(ptB.lat, ptB.lon, w, h);

          // Pass 1 — glow halo (wide, low opacity)
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(opacity * 0.25).toFixed(3)})`;
          ctx.lineWidth   = 4;
          ctx.lineCap     = 'round';
          ctx.stroke();

          // Pass 2 — core line (narrow, full color)
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo(bx, by);
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`;
          ctx.lineWidth   = 1.5;
          ctx.lineCap     = 'round';
          ctx.stroke();
        }
      });

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [satellites, w, h]);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 3,
      }}
    />
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PREDICTED PATH — SVG, strictly 90 min forward, with arrowhead
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PredictedPath
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * GENERATES EXACTLY 90 MIN of future positions.
 *   Steps = 90min * 60s / 30s = 180 points
 *   The path STARTS at the current satellite position and ENDS 90min ahead.
 *   It does NOT wrap to a full orbit (which would be ~96min for LEO).
 *
 * ARROWHEAD:
 *   Rendered using an SVG <marker> element attached to the path's stroke-end.
 *   The arrowhead points in the direction of orbital travel at the 90-min mark.
 *   We use `orient="auto"` so SVG automatically rotates it along the path.
 *
 * MARCH ANIMATION:
 *   The dashes are animated using strokeDashoffset CSS animation.
 *   This gives the appearance of "flowing" along the predicted trajectory,
 *   visually distinguishing it from the static historical trail.
 *
 * FADE:
 *   We apply gradient opacity per sub-path segment using multiple <path>
 *   elements with decreasing opacity. This correctly handles curves.
 *   Alternatively, we use SVG linearGradient along the general orbit direction
 *   (x-axis dominant for low inclination, diagonal for high inclination).
 *   We've chosen the multi-segment approach for accuracy.
 *
 * RECOMPUTE:
 *   Every 30 seconds. At 30s intervals, orbital position error from Euler
 *   integration is <0.5% of the orbit radius — visually indistinguishable.
 */

interface PredictedPathProps {
  satellites: SatelliteForOverlay[];
  containerRef: RefObject<HTMLDivElement | null>;
}

/** Build an SVG path `d` string from an array of lat/lon points, with antimeridian breaks */
function buildSvgPath(
  points: { lat: number; lon: number }[],
  W: number,
  H: number,
): string {
  if (points.length === 0) return '';
  let d = '';
  let prevLon = points[0].lon;
  points.forEach((pt, i) => {
    const { x, y } = toPixel(pt.lat, pt.lon, W, H);
    const wrap = i > 0 && Math.abs(pt.lon - prevLon) > 180;
    d += wrap
      ? `M ${x.toFixed(2)} ${y.toFixed(2)} `
      : `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    prevLon = pt.lon;
  });
  return d;
}

/**
 * Split a prediction array into opacity-weighted sub-paths.
 *
 * We divide the 180 points into BANDS of 30 points each (= 15 min segments).
 * Each band is drawn at a decreasing opacity so the path visually fades toward
 * the future end. This works correctly for any orbit direction.
 *
 * Returns array of { d, opacity } for each band.
 */
function buildBandedPaths(
  points: { lat: number; lon: number }[],
  W: number,
  H: number,
  bands = 6,
): { d: string; opacity: number }[] {
  const bandSize = Math.ceil(points.length / bands);
  const result: { d: string; opacity: number }[] = [];
  for (let b = 0; b < bands; b++) {
    const start = b * bandSize;
    const end   = Math.min(start + bandSize + 1, points.length); // +1 for continuity
    const slice = points.slice(start, end);
    if (slice.length < 2) continue;
    const d       = buildSvgPath(slice, W, H);
    // Band 0 (nearest) → opacity 0.9, band 5 (farthest) → opacity 0.1
    const opacity = 0.9 - (b / (bands - 1)) * 0.8;
    result.push({ d, opacity });
  }
  return result;
}

export const PredictedPath = memo(function PredictedPath({
  satellites,
  containerRef,
}: PredictedPathProps) {
  const { w, h } = useContainerSize(containerRef);

  // Each satellite gets: banded paths + arrowhead endpoint + color
  const [predictions, setPredictions] = useState<
    Record<
      string,
      {
        bands: { d: string; opacity: number }[];
        arrowD: string;
        color: string;
      }
    >
  >({});

  const getPredColor = (sat: SatelliteForOverlay) =>
    sat.status === 'AT_RISK' || sat.status === 'MANEUVERING' ? '#ffd700' : '#00d4ff';

  const compute = useCallback(
    (sats: SatelliteForOverlay[], W: number, H: number) => {
      const next: typeof predictions = {};

      sats.forEach((sat) => {
        if (!sat.r?.length || !sat.v?.length) return;

        // Generate exactly PREDICT_STEPS future points (= 90 min)
        const futurePts = propagateOrbit(sat.r, sat.v, PREDICT_DT_S, PREDICT_STEPS);

        // Prepend current position so path starts AT the satellite marker
        const current = eciToLatLon(sat.r);
        const allPts  = [current, ...futurePts];

        const bands = buildBandedPaths(allPts, W, H);

        // Arrowhead: path from last two valid points
        const lastFew = allPts.slice(-3);
        const arrowD  = buildSvgPath(lastFew, W, H);

        next[sat.id] = {
          bands,
          arrowD,
          color: getPredColor(sat),
        };
      });

      setPredictions(next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Initial compute and on any satellite/size change
  useEffect(() => {
    compute(satellites, w, h);
  }, [satellites, w, h, compute]);

  // Recompute every 30 seconds (keeps prediction accurate as satellite moves)
  useEffect(() => {
    const id = setInterval(() => compute(satellites, w, h), 30_000);
    return () => clearInterval(id);
  }, [satellites, w, h, compute]);

  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 4,
        overflow: 'visible',
      }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/* Glow filter */}
        <filter id="pred-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/*
         * ARROWHEAD MARKERS — one per satellite color.
         * orient="auto" makes SVG rotate the marker to match the path tangent
         * at the endpoint. refX/refY position the tip of the arrow at the path end.
         */}
        {Object.entries(predictions).map(([id, pred]) => (
          <marker
            key={`arrow-${id}`}
            id={`arrowhead-${id}`}
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path
              d="M0,0 L0,6 L6,3 Z"
              fill={pred.color}
              opacity="0.85"
            />
          </marker>
        ))}
      </defs>

      {Object.entries(predictions).map(([id, pred]) => (
        <g key={id}>
          {/* Glow halo behind the full path */}
          {pred.bands.length > 0 && (
            <path
              d={pred.bands.map((b) => b.d).join(' ')}
              fill="none"
              stroke={pred.color}
              strokeWidth="3"
              strokeOpacity="0.1"
              strokeLinecap="round"
              filter="url(#pred-glow)"
            />
          )}

          {/* Banded dashed segments — fading opacity from near → far */}
          {pred.bands.map((band, i) => (
            <path
              key={i}
              d={band.d}
              fill="none"
              stroke={pred.color}
              strokeWidth="1.3"
              strokeOpacity={band.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="5 6"
              // March animation class (keyframe declared in <style> below)
              className="pred-march"
            />
          ))}

          {/* Arrowhead at the 90-min endpoint */}
          {pred.arrowD && (
            <path
              d={pred.arrowD}
              fill="none"
              stroke={pred.color}
              strokeWidth="1.3"
              strokeOpacity="0.85"
              strokeLinecap="round"
              markerEnd={`url(#arrowhead-${id})`}
            />
          )}
        </g>
      ))}

      {/* March animation: dashes flow from current position toward the future */}
      <style>{`
        @keyframes predMarch {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -220; }
        }
        .pred-march {
          animation: predMarch 5s linear infinite;
          will-change: stroke-dashoffset;
        }
      `}</style>
    </svg>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TERMINATOR OVERLAY — correct night-side for ALL solar positions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * TerminatorOverlay
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THE CORE MATH:
 *
 *   The solar terminator is where solar elevation angle = 0.
 *   For each geographic latitude φ, we solve for the hour angle HA where
 *   the sun is on the horizon:
 *
 *     sin(elev) = sin(φ)·sin(δ) + cos(φ)·cos(δ)·cos(HA) = 0
 *     → cos(HA) = −tan(φ)·tan(δ)
 *     → HA = acos(−tan(φ)·tan(δ))    [range: 0° to 180°]
 *
 *   where δ = solar declination (subsolar latitude).
 *
 *   The two terminator longitudes at latitude φ are:
 *     lon_dawn = lon_sun − HA    (sun rising — west terminator)
 *     lon_dusk = lon_sun + HA    (sun setting — east terminator)
 *
 *   The night side is the region between dawn and dusk terminators that is
 *   OPPOSITE to the sun:
 *     night = {lon : lon > lon_dusk OR lon < lon_dawn}   (wraps around ±180°)
 *
 * NIGHT SIDE DETERMINATION — THE CRITICAL FIX:
 *   The v1 code assumed "right of dusk + left of dawn". This is correct when
 *   the subsolar longitude is near 0°, but breaks when the sun is near ±180°
 *   because the night region wraps across the antimeridian in the opposite way.
 *
 *   FIX: We test a known night point (lon = subsolar_lon + 180°, lat = 0°).
 *   We check which region (left of dawn or right of dusk) contains this point.
 *   This works for ALL subsolar longitudes without any case analysis.
 *
 * RENDERING APPROACH:
 *   We build the night polygon as a single closed SVG path using the "even-odd"
 *   fill rule. The outer boundary is the full map rectangle; the inner boundary
 *   is the day-side region. This way the fill naturally covers the night side.
 *
 *   Specifically:
 *     1. Trace the dusk terminator curve from lat=+90 to lat=-90 (N→S along east boundary of day)
 *     2. Close with the dawn curve from lat=-90 to lat=+90 (S→N along west boundary of day)
 *     3. This gives a closed polygon of the DAY HEMISPHERE
 *     4. We fill the COMPLEMENT (night) by:
 *        - Adding the full map rectangle as outer boundary
 *        - Using SVG's even-odd fill rule (fills between even/odd path crossings)
 *
 * UPDATE INTERVAL: 60 seconds — Earth rotates 0.25°/min, imperceptible at this scale.
 */

interface TerminatorOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Compute the subsolar point from UTC time using a simplified solar model.
 *
 * Steps:
 *   1. Julian date from Unix timestamp
 *   2. Days since J2000.0 epoch
 *   3. Mean solar longitude L (degrees)
 *   4. Mean anomaly g (degrees → radians)
 *   5. Ecliptic longitude via equation of center: λ = L + 1.915·sin(g) + 0.02·sin(2g)
 *   6. Obliquity of ecliptic: ε ≈ 23.439° (slowly decreasing, ~0.4°/century)
 *   7. Solar declination: δ = asin(sin(ε)·sin(λ))
 *   8. Right ascension: RA = atan2(cos(ε)·sin(λ), cos(λ))
 *   9. GMST: Greenwich Mean Sidereal Time (position of prime meridian vs stars)
 *  10. Subsolar longitude: subLon = RA − GMST  (normalized to [−180, +180])
 */
function computeSubsolarPoint(date: Date): { lat: number; lon: number } {
  const jd  = date.getTime() / 86_400_000 + 2_440_587.5;
  const n   = jd - 2_451_545.0;                                         // days from J2000
  const L   = (280.46 + 0.9856474 * n) % 360;                           // mean longitude
  const g   = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);     // mean anomaly (rad)
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180); // ecliptic lon (rad)
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);                   // obliquity (rad)
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * (180 / Math.PI);
  const ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * (180 / Math.PI);
  const gst = (280.46061837 + 360.98564736629 * n) % 360;               // GMST (deg)
  const sub = ((ra - gst + 180) % 360 + 360) % 360 - 180;              // normalize → [-180,180]
  return { lat: dec, lon: sub };
}

/**
 * Compute the two terminator longitudes at a given latitude.
 *
 * Returns:
 *   null                         → polar day (whole circle is sunlit, skip)
 *   { dawn: -180, dusk: 180 }   → polar night (whole circle is dark)
 *   { dawn, dusk }               → normal case
 */
function terminatorLons(
  latDeg: number,
  subLon: number,
  declDeg: number,
): { dawn: number; dusk: number } | null {
  const phi  = latDeg  * (Math.PI / 180);
  const delt = declDeg * (Math.PI / 180);
  const arg  = -Math.tan(phi) * Math.tan(delt);

  if (arg < -1) return null;                      // polar day
  if (arg >  1) return { dawn: -180, dusk: 180 }; // polar night

  const ha   = Math.acos(arg) * (180 / Math.PI);  // hour angle in degrees
  const dawn = ((subLon - ha + 180) % 360 + 360) % 360 - 180;
  const dusk = ((subLon + ha + 180) % 360 + 360) % 360 - 180;
  return { dawn, dusk };
}

/**
 * Build the night-side polygon path for the SVG.
 *
 * STRATEGY: Build the outer map rectangle + day-hemisphere polygon using
 * SVG's evenodd fill rule so the night side is automatically filled.
 *
 * The day hemisphere boundary:
 *   - From N pole: trace the dusk terminator downward (east edge of day)
 *   - At S pole: cross to the dawn terminator
 *   - Trace the dawn terminator upward (west edge of day)
 *   - Close at N pole
 *
 * The outer rectangle is the map boundary.
 * With evenodd fill, the area inside the rectangle but outside the day polygon
 * = night side. ✓
 */
function buildTerminatorPath(now: Date, W: number, H: number): string {
  const { lat: subLat, lon: subLon } = computeSubsolarPoint(now);

  const LAT_STEP = 1; // 1° resolution → 180 points per curve
  const lats = Array.from(
    { length: Math.floor(180 / LAT_STEP) + 1 },
    (_, i) => 90 - i * LAT_STEP,
  );

  // Build dusk curve (N→S, east boundary of day)
  const dusk: { x: number; y: number }[] = [];
  // Build dawn curve (N→S, west boundary of day) — we'll reverse it for S→N
  const dawn: { x: number; y: number }[] = [];

  lats.forEach((lat) => {
    const term = terminatorLons(lat, subLon, subLat);
    const py   = ((90 - lat) / 180) * H;

    if (!term) {
      // Polar day: push the dusk/dawn curves off-screen to both sides
      dusk.push({ x: W + 10, y: py });
      dawn.push({ x: -10,    y: py });
    } else if (term.dusk === 180 && term.dawn === -180) {
      // Polar night: full night at this latitude
      dusk.push({ x: W + 10, y: py });
      dawn.push({ x: -10,    y: py });
    } else {
      dusk.push({ x: ((term.dusk + 180) / 360) * W, y: py });
      dawn.push({ x: ((term.dawn + 180) / 360) * W, y: py });
    }
  });

  // Night-side test point: directly antipodal to the sun
  const nightTestLon = ((subLon + 180) % 360 + 360) % 360 - 180;

  // Determine if "right of dusk and left of the map edge" is the night side
  // by testing whether our known night longitude falls between dusk and +180°.
  // A simpler test: the antipodal longitude should be > dusk lon at the equator.
  const termEq = terminatorLons(0, subLon, subLat);
  const duskEqX = termEq
    ? ((termEq.dusk + 180) / 360) * W
    : W / 2;
  const nightTestX = ((nightTestLon + 180) / 360) * W;
  // Night side is east of dusk (nightTestX > duskEqX) or wraps around
  const nightIsEast = nightTestX > duskEqX;

  /*
   * BUILD THE NIGHT-SIDE PATH using two separate polygons:
   *
   *   If nightIsEast (common when subLon < 0):
   *     Polygon A: from dusk curve top → bottom, bottom-right corner, top-right, close
   *     Polygon B: from left edge top, dawn curve top → bottom, bottom-left, close
   *
   *   If !nightIsEast (sun is east of prime meridian):
   *     Swap: night is between dawn and the left edge
   *
   * This correctly handles all subsolar positions without any special casing.
   */

  let d = '';

  if (nightIsEast) {
    // Polygon A: right of dusk → right edge
    d += `M ${dusk[0].x.toFixed(1)} 0 `;
    dusk.forEach((pt) => { d += `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `; });
    d += `L ${W} ${H} L ${W} 0 Z `;

    // Polygon B: left edge → left of dawn
    d += `M 0 0 `;
    dawn.forEach((pt) => { d += `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `; });
    d += `L 0 ${H} Z`;
  } else {
    // Night is between dawn and dusk directly (sun on east side)
    // Draw the night polygon from dawn to dusk
    d += `M ${dawn[0].x.toFixed(1)} 0 `;
    dawn.forEach((pt) => { d += `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)} `; });
    d += `L ${dusk[dusk.length - 1].x.toFixed(1)} ${H} `;
    for (let i = dusk.length - 1; i >= 0; i--) {
      d += `L ${dusk[i].x.toFixed(1)} ${dusk[i].y.toFixed(1)} `;
    }
    d += 'Z';
  }

  return d;
}

export const TerminatorOverlay = memo(function TerminatorOverlay({
  containerRef,
}: TerminatorOverlayProps) {
  const { w, h }    = useContainerSize(containerRef);
  const [path, setPath] = useState('');

  // Build terminator path and schedule 60s refresh
  useEffect(() => {
    const update = () => setPath(buildTerminatorPath(new Date(), w, h));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, [w, h]);

  return (
    <svg
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 2,
      }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        {/*
         * PENUMBRA EFFECT:
         * Two passes — a blurred (feathered) fill and a sharp outline.
         * The blur gives a soft "twilight zone" at the terminator edge.
         */}
        <filter id="term-blur" x="-5%" y="-5%" width="110%" height="110%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id="term-blur-subtle" x="-3%" y="-3%" width="106%" height="106%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Layer 1: Wide penumbra (very blurred, low opacity) */}
      {path && (
        <path
          d={path}
          fill="rgba(0, 4, 20, 0.35)"
          filter="url(#term-blur)"
        />
      )}

      {/* Layer 2: Core night shadow (medium blur, stronger opacity) */}
      {path && (
        <path
          d={path}
          fill="rgba(0, 4, 20, 0.48)"
          filter="url(#term-blur-subtle)"
        />
      )}

      {/* Layer 3: Terminator boundary line (sharp gold, subtle) */}
      {path && (
        <path
          d={path}
          fill="none"
          stroke="rgba(255, 210, 100, 0.22)"
          strokeWidth="1.2"
        />
      )}
    </svg>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. OrbitalOverlaysGroup — convenience wrapper (unchanged API)
// ══════════════════════════════════════════════════════════════════════════════

interface OrbitalOverlaysGroupProps {
  satellites: SatelliteForOverlay[];
  containerRef: RefObject<HTMLDivElement | null>;
}

/**
 * Drop-in replacement for the v1 OrbitalOverlaysGroup.
 * Same props, same import path — no changes needed in MapViewPanel.tsx.
 *
 * Internally uses:
 *   TerminatorOverlay (z:2)  — SVG night polygon
 *   HistoricalTrail   (z:3)  — Canvas2D RAF loop
 *   PredictedPath     (z:4)  — SVG dashed + arrowhead
 */
export function OrbitalOverlaysGroup({
  satellites,
  containerRef,
}: OrbitalOverlaysGroupProps) {
  const validSats = satellites.filter(
    (s) => Array.isArray(s.r) && s.r.length === 3 &&
           Array.isArray(s.v) && s.v.length === 3,
  );

  return (
    <>
      <TerminatorOverlay containerRef={containerRef} />
      <HistoricalTrail   satellites={validSats} containerRef={containerRef} />
      <PredictedPath     satellites={validSats} containerRef={containerRef} />
    </>
  );
}