/**
 * OrbitalOverlays.tsx — v4 (simulation-driven)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * KEY CHANGES FROM v3:
 *   • HistoricalTrail reads history from SimSatellite.history (managed by the
 *     RAF loop in useOrbitalSimulation). No more internal trail buffer or
 *     sampling interval — the simulation hook owns all position data.
 *
 *   • PredictedPath receives pre-computed PredictPoint[] from useOrbitalSimulation
 *     instead of running its own propagator. Pure renderer only.
 *
 *   • OrbitalOverlaysGroup now accepts (selectedSat, prediction, tick) instead
 *     of (satellites[], selectedSatelliteId). Caller resolves the selected sat.
 *
 *   • TerminatorOverlay: unchanged.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useRef, RefObject, memo } from 'react';
import type { SimSatellite, PredictPoint } from './useOrbitalSimulation';

export type { SimSatellite, PredictPoint };

// ── Constants ──────────────────────────────────────────────────────────────────

const TRAIL_WINDOW_MS = 90 * 60 * 1000;

// ── Shared math ───────────────────────────────────────────────────────────────

function toPixel(lat: number, lon: number, W: number, H: number) {
  return { x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H };
}

function buildSvgPath(points: { lat: number; lon: number }[], W: number, H: number): string {
  if (!points.length) return '';
  let d = '', prevLon = points[0].lon;
  points.forEach((pt, i) => {
    const { x, y } = toPixel(pt.lat, pt.lon, W, H);
    const wrap = i > 0 && Math.abs(pt.lon - prevLon) > 180;
    d += wrap ? `M ${x.toFixed(2)} ${y.toFixed(2)} ` : `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    prevLon = pt.lon;
  });
  return d;
}

function hexToRgb(hex: string) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 58, g: 127, b: 255 };
}

const trailColor = (s: string) => s === 'AT_RISK' || s === 'MANEUVERING' ? '#ff6644' : '#3a7fff';
const predColor  = (s: string) => s === 'AT_RISK' || s === 'MANEUVERING' ? '#ffd700' : '#00d4ff';

function useContainerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. HISTORICAL TRAIL — Canvas2D, reads SimSatellite.history
// ══════════════════════════════════════════════════════════════════════════════

/**
 * HistoricalTrail
 *
 * Data flow:
 *   useOrbitalSimulation RAF loop
 *     → appends to selectedSat.history every 5s
 *     → increments tick
 *     → React re-renders MapViewPanel
 *     → HistoricalTrail receives new selectedSat ref + tick
 *     → Canvas re-draws with latest history
 *
 * The `tick` prop is the only signal that causes a redraw.
 * We read from selectedSat.history directly — no copy, no extra state.
 *
 * "Live end" dot:
 *   We draw a small dot at selectedSat.{lat,lon} (the RAF-interpolated current
 *   position, not the last history sample). This keeps the trail visually
 *   connected to the satellite marker even between 5s sampling intervals.
 */
interface HistoricalTrailProps {
  selectedSat: SimSatellite | null;
  tick: number; // from useOrbitalSimulation — drives Canvas redraws
  containerRef: RefObject<HTMLDivElement | null>;
}

export const HistoricalTrail = memo(function HistoricalTrail({
  selectedSat,
  tick,
  containerRef,
}: HistoricalTrailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { w, h }  = useContainerSize(containerRef);

  // Draw on every tick (driven by simulation RAF, ~60fps)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, w, h);

    if (!selectedSat || selectedSat.history.length < 2) return;

    const now   = Date.now();
    const trail = selectedSat.history.filter(pt => now - pt.timestamp <= TRAIL_WINDOW_MS);
    if (trail.length < 2) return;

    const color = trailColor(selectedSat.status);
    const { r: cr, g: cg, b: cb } = hexToRgb(color);
    let prevLon = trail[0].lon;

    for (let i = 0; i < trail.length - 1; i++) {
      const ptA = trail[i], ptB = trail[i + 1];
      if (Math.abs(ptB.lon - prevLon) > 180) { prevLon = ptB.lon; continue; }
      prevLon = ptB.lon;

      // Per-segment opacity based on age (0=new, 1=90min old)
      const midAge  = (ptA.timestamp + ptB.timestamp) / 2;
      const ageFrac = Math.max(0, Math.min(1, (now - midAge) / TRAIL_WINDOW_MS));
      const opacity = Math.pow(1 - ageFrac, 0.6); // ease: keeps mid-trail visible

      const { x: ax, y: ay } = toPixel(ptA.lat, ptA.lon, w, h);
      const { x: bx, y: by } = toPixel(ptB.lat, ptB.lon, w, h);

      // Pass 1: glow halo (wide, faint)
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${(opacity * 0.22).toFixed(3)})`;
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.stroke();

      // Pass 2: core line (sharp, bright)
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`;
      ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.stroke();
    }

    // Live-end connector: bridges gap between last sample and current position
    const lastPt = trail[trail.length - 1];
    const { x: lx, y: ly } = toPixel(selectedSat.lat, selectedSat.lon, w, h);
    
    // Draw connecting line from last history point to the current 60fps RAF position
    // This prevents the "floating dot" effect where the icon outruns the trail.
    if (Math.abs(selectedSat.lon - lastPt.lon) < 180) {
      const { x: px, y: py } = toPixel(lastPt.lat, lastPt.lon, w, h);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(lx, ly);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.8;
      ctx.stroke();
    }

    // Live-end dot
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, selectedSat, w, h]); // tick is the primary driver

  return (
    <canvas ref={canvasRef} width={w} height={h} style={{
      position: 'absolute', inset: 0,
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 3,
      opacity: selectedSat ? 1 : 0,
      transition: 'opacity 350ms ease',
    }} />
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. PREDICTED PATH — pure renderer, receives PredictPoint[] from sim hook
// ══════════════════════════════════════════════════════════════════════════════

/**
 * PredictedPath
 *
 * Pure rendering component. No propagation happens here.
 * The useOrbitalSimulation hook computes and updates `prediction` every
 * PREDICT_REGEN_FRAMES (~6s) and on selection change.
 *
 * Banded opacity: 180 points split into 6 bands of 30, opacity 0.9 → 0.1.
 * This correctly fades toward the future regardless of orbit inclination.
 */
interface PredictedPathProps {
  selectedSat: SimSatellite | null;
  prediction: PredictPoint[];
  containerRef: RefObject<HTMLDivElement | null>;
}

function buildBandedPaths(pts: PredictPoint[], W: number, H: number, bands = 6) {
  const sz = Math.ceil(pts.length / bands);
  return Array.from({ length: bands }, (_, b) => ({
    d:       buildSvgPath(pts.slice(b * sz, b * sz + sz + 1), W, H),
    opacity: 0.9 - (b / (bands - 1)) * 0.8,
  })).filter(b => b.d.length > 3);
}

export const PredictedPath = memo(function PredictedPath({
  selectedSat,
  prediction,
  containerRef,
}: PredictedPathProps) {
  const { w, h } = useContainerSize(containerRef);

  if (!selectedSat || prediction.length === 0) return null;

  const color  = predColor(selectedSat.status);
  const bands  = buildBandedPaths(prediction, w, h);
  const arrowD = buildSvgPath(prediction.slice(-3), w, h);

  return (
    <svg aria-hidden="true" style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 4, overflow: 'visible',
      opacity: 1, transition: 'opacity 350ms ease',
    }} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <filter id="pred-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <marker id="pred-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L6,3 Z" fill={color} opacity="0.9" />
        </marker>
      </defs>

      {/* Full-path glow halo */}
      <path d={bands.map(b => b.d).join(' ')} fill="none" stroke={color}
        strokeWidth="3" strokeOpacity="0.1" strokeLinecap="round" filter="url(#pred-glow)" />

      {/* Banded dashed lines */}
      {bands.map((band, i) => (
        <path key={i} d={band.d} fill="none" stroke={color}
          strokeWidth="1.3" strokeOpacity={band.opacity}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="5 6" className="pred-march" />
      ))}

      {/* Arrowhead at 90-min end */}
      {arrowD && (
        <path d={arrowD} fill="none" stroke={color}
          strokeWidth="1.3" strokeOpacity="0.9"
          strokeLinecap="round" markerEnd="url(#pred-arrow)" />
      )}

      <style>{`
        @keyframes predMarch { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -220; } }
        .pred-march { animation: predMarch 5s linear infinite; will-change: stroke-dashoffset; }
      `}</style>
    </svg>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. TERMINATOR OVERLAY — photorealistic day/night mask
//
// VISUAL REFERENCE: NASA "Blue Marble" day/night composite
//
// RENDERING LAYERS (composited on a single canvas):
//   Layer A — Deep-black night fill       rgba(0, 0, 8,  0–220)
//   Layer B — Atmospheric glow halo       rgba(180,210,255, 0–60) at terminator
//   Layer C — Polar atmospheric vignette  rgba(200,230,255, 0–40) at poles
//
// TRANSITION ZONES (in cos-zenith space):
//   cosZ ≥  0.08   →  pure daylight          (fully transparent)
//   cosZ in [0.00, 0.08]  →  civil twilight  (soft glow, rising opacity)
//   cosZ in [-0.10, 0.00] →  nautical/astro  (deep blue darkening fast)
//   cosZ ≤ -0.10   →  full night            (near-opaque black, rgba 0,0,8)
//
// ASTRONOMICAL CALCULATION:
//   Julian Day → Mean anomaly → Ecliptic longitude → Declination + RA →
//   Greenwich Sidereal Time → Subsolar geographic point →
//   Per-pixel dot product (Spherical Law of Cosines) → cosZenith
//
// PERFORMANCE:
//   • Float32 LUTs for sin/cos of all latitudes and longitudes
//   • Single putImageData call per draw (no per-row canvas ops)
//   • 60-second setInterval (terminator moves ~0.25°/min ≈ 1–2px imperceptible)
//   • memo() wrapper — zero re-renders from parent unless containerRef changes
// ══════════════════════════════════════════════════════════════════════════════

interface TerminatorOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>;
  serverTime: number;
}

/**
 * computeSubsolarPoint
 *
 * Low-precision solar coordinates (accuracy ≈ 0.01°) sufficient for a map
 * overlay. Returns the geographic lat/lon (°) where the Sun is directly overhead.
 *
 *   JD  → n (days from J2000.0)
 *   n   → L (mean longitude°), g (mean anomaly rad)
 *   g   → λ (ecliptic longitude rad, equation-of-centre corrected)
 *   λ   → ε (obliquity), δ (declination = subsolar lat), α (right ascension)
 *   α,n → θ_GST (Greenwich Sidereal Time) → subsolar longitude = α − θ_GST
 */
function computeSubsolarPoint(date: Date): { lat: number; lon: number } {
  const jd  = date.getTime() / 86_400_000 + 2_440_587.5;
  const n   = jd - 2_451_545.0;                                   // days from J2000.0
  const L   = (280.46 + 0.9856474 * n) % 360;                     // mean longitude (°)
  const g   = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);// mean anomaly (rad)
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180); // ecliptic lon
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);              // obliquity (rad)
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * (180 / Math.PI);            // declination (°)
  const ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * (180 / Math.PI); // RA (°)
  const gst = (280.46061837 + 360.98564736629 * n) % 360;         // Greenwich Sidereal Time (°)
  const lon = ((ra - gst + 180) % 360 + 360) % 360 - 180;         // subsolar longitude (°)
  return { lat: dec, lon };
}

/**
 * computePixelRGBA
 *
 * Given a pixel's cosine-of-solar-zenith-angle, returns [R, G, B, A] that
 * matches the reference NASA Blue-Marble day/night composite:
 *
 * ZONE BREAKDOWN:
 *
 *   cosZ ≥ 0.08  →  DAYLIGHT — fully transparent (A = 0)
 *                    The underlying earth map shows through unobstructed.
 *
 *   cosZ [0.00 → 0.08]  →  CIVIL TWILIGHT / ATMOSPHERIC GLOW
 *                    A soft warm-white / blue-white halo at the terminator.
 *                    Alpha ramps from 0 (sun side) to 30 (shadow side).
 *                    Colour: pale blue-white (200, 220, 255) mimicking the
 *                    scattering of sunlight through the atmosphere.
 *
 *   cosZ [-0.12 → 0.00]  →  NAUTICAL + ASTRONOMICAL TWILIGHT
 *                    Rapid darkening. Alpha climbs from 30 → 200.
 *                    Colour transitions from deep indigo to near-black.
 *                    Uses a smoothstep curve for the characteristic
 *                    "soft S-curve" seen at real terminator edges.
 *
 *   cosZ ≤ -0.12  →  DEEP NIGHT — near-opaque (A = 210, R=0, G=0, B=8)
 *                    Almost-black with a faint blue tint so city lights
 *                    from the underlying map canvas can still faintly glow
 *                    through the overlay (the reference image shows this).
 *
 * ATMOSPHERIC HALO:
 *   At cosZ ≈ 0 the real atmosphere scatters light, producing a bright
 *   ring visible from space. We approximate this by adding a white-blue
 *   glow layer whose peak is at cosZ = 0.01 and falls off on both sides
 *   with a Gaussian curve (σ ≈ 0.04). This is composited additively on
 *   top of the dark fill so it brightens both day and night edges.
 */
function computePixelRGBA(cosZ: number): [number, number, number, number] {
  // ── Pure daylight — FULLY transparent, no colour emitted ─────────────────
  // Critical: cosZ >= 0 means the point is on the sunlit hemisphere.
  // We must return alpha=0 here — any non-zero alpha causes a visible
  // blue-white glow band on the lit side of the terminator (incorrect).
  if (cosZ >= 0.0) return [0, 0, 0, 0];

  // ── Deep night ────────────────────────────────────────────────────────────
  // Dark overlay with slight blue tint (2, 6, 20).
  // Alpha 185 ≈ 73% — dark enough to read as night, light enough that the
  // underlying map texture (city lights etc.) faintly shows through.
  if (cosZ <= -0.065) return [2, 6, 20, 185];

  // ── Twilight band: cosZ ∈ (−0.065, 0) ───────────────────────────────────
  // Width 0.065 in cos-zenith ≈ 3.7° of arc — sharp but not a hard step.
  // t: 0 at the terminator line (cosZ = 0), 1 at the night boundary (-0.065)
  const t  = (-cosZ) / 0.065;
  // smoothstep S-curve: slow start (near terminator) → fast → slow end
  const s  = t * t * (3 - 2 * t);

  // Colour fades from near-transparent grey-blue → solid night tint
  const r  = Math.round(8  * (1 - s));
  const g  = Math.round(12 * (1 - s));
  const b  = Math.round(30 * (1 - s) + 20 * s);
  // Alpha: 0 at the lit edge → 185 at the night edge
  const a  = Math.round(185 * s);
  return [r, g, b, a];
}

/**
 * atmosphericHaloAlpha
 *
 * Additive bright ring at the terminator — models atmospheric scattering
 * visible from orbit as the bright arc at the day/night boundary.
 *
 * Gaussian peak centred at cosZ = 0.01 (just inside the lit side),
 * width σ = 0.045.  Peak alpha ≈ 55 (roughly 22% opacity white).
 */
function atmosphericHaloAlpha(cosZ: number): number {
  // Guard: strictly shadow side only — prevents any glow on the sunlit hemisphere
  if (cosZ >= 0.0) return 0;
  // Gaussian peak just inside the shadow boundary (cosZ = -0.008 ≈ 0.5° past terminator).
  // Tighter sigma (0.018 vs 0.045) gives a thin crisp arc, not a wide blurry band.
  const peak  = -0.008;
  const sigma = 0.018;
  const dz    = cosZ - peak;
  return Math.round(38 * Math.exp(-(dz * dz) / (2 * sigma * sigma)));
}

export const TerminatorOverlay = memo(function TerminatorOverlay({ containerRef, serverTime }: TerminatorOverlayProps) {
  const { w, h } = useContainerSize(containerRef);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas || w <= 0 || h <= 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width  = w;
        canvas.height = h;
      }

      // ── Subsolar point → ECEF unit sun vector ────────────────────────────
      const simDate = new Date(serverTime * 1000);
      const { lat: subLat, lon: subLon } = computeSubsolarPoint(simDate);
      const φs = subLat * (Math.PI / 180);
      const λs = subLon * (Math.PI / 180);
      const sx = Math.cos(φs) * Math.cos(λs);
      const sy = Math.cos(φs) * Math.sin(λs);
      const sz = Math.sin(φs);

      // ── LUTs: precompute cos/sin for all pixel columns (lon) and rows (lat) ─
      const lonCos = new Float32Array(w);
      const lonSin = new Float32Array(w);
      for (let x = 0; x < w; x++) {
        const λ = ((x / (w - 1)) * 360 - 180) * (Math.PI / 180);
        lonCos[x] = Math.cos(λ);
        lonSin[x] = Math.sin(λ);
      }
      const latCos = new Float32Array(h);
      const latSin = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        const φ = (90 - (y / (h - 1)) * 180) * (Math.PI / 180);
        latCos[y] = Math.cos(φ);
        latSin[y] = Math.sin(φ);
      }

      // ── Pixel loop ────────────────────────────────────────────────────────
      // Two-pass composite: dark fill + additive atmospheric halo
      //
      // cosZ = dot(pixelUnitVector, sunUnitVector)
      //   > 0  → sunlit hemisphere
      //   < 0  → night hemisphere
      //   ≈ 0  → terminator (great circle)
      //
      // Seasonal shape is automatic:
      //   sz > 0 (June)  → sz·pz term boosts North Pole → lit
      //   sz < 0 (Dec)   → South Pole lit
      //   sz = 0 (equinox) → terminator = prime-meridian great circle
      const img  = ctx.createImageData(w, h);
      const buf  = img.data;
      let   i    = 0;

      for (let y = 0; y < h; y++) {
        const cφ = latCos[y];
        const sφ = latSin[y];
        for (let x = 0; x < w; x++) {
          // Unit vector for this geographic pixel
          const px = cφ * lonCos[x];
          const py = cφ * lonSin[x];
          const pz = sφ;
          // Solar zenith cosine via Spherical Law of Cosines dot product
          const cosZ = px * sx + py * sy + pz * sz;

          // ── Layer A: night fill / twilight gradient ───────────────────────
          const [fr, fg, fb, fa] = computePixelRGBA(cosZ);

          // ── Layer B: atmospheric halo glow (thin arc at shadow boundary) ──
          // Only evaluated near the terminator — shadow side only (cosZ < 0).
          // The halo models the bright arc of forward-scattered sunlight visible
          // at Earth's limb. Colour: cool blue-white (200, 218, 255).
          let hr = 0, hg = 0, hb = 0, ha = 0;
          if (cosZ < 0.0 && cosZ > -0.08) {
            ha = atmosphericHaloAlpha(cosZ);
            if (ha > 0) {
              hr = 200; hg = 218; hb = 255;
            }
          }

          // ── Alpha-composite: halo over dark fill (src-over) ───────────────
          // out_a = ha + fa*(1 - ha/255)
          // out_c = (hc*ha + fc*fa*(1-ha/255)) / out_a
          if (fa === 0 && ha === 0) {
            // Full daylight — completely transparent
            buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 0;
          } else if (ha === 0) {
            // No halo — just the dark fill
            buf[i] = fr; buf[i+1] = fg; buf[i+2] = fb; buf[i+3] = fa;
          } else {
            // Composite halo on top of dark fill
            const haF  = ha / 255;
            const faF  = fa / 255;
            const outA = haF + faF * (1 - haF);
            if (outA < 0.001) {
              buf[i] = 0; buf[i+1] = 0; buf[i+2] = 0; buf[i+3] = 0;
            } else {
              const inv = 1 / outA;
              buf[i]   = Math.round((hr * haF + fr * faF * (1 - haF)) * inv);
              buf[i+1] = Math.round((hg * haF + fg * faF * (1 - haF)) * inv);
              buf[i+2] = Math.round((hb * haF + fb * faF * (1 - haF)) * inv);
              buf[i+3] = Math.round(outA * 255);
            }
          }
          i += 4;
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(img, 0, 0);
    };

    draw();
    const timerId = setInterval(draw, 2_000); // Update night mask every 2s to match motion
    return () => clearInterval(timerId);
  }, [w, h]);

  return (
    <canvas
      ref={canvasRef}
      width={w}
      height={h}
      aria-hidden="true"
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    />
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. OrbitalOverlaysGroup — updated API
// ══════════════════════════════════════════════════════════════════════════════

interface OrbitalOverlaysGroupProps {
  selectedSat: SimSatellite | null;
  prediction: PredictPoint[];
  tick: number;
  serverTime: number;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function OrbitalOverlaysGroup({ selectedSat, prediction, tick, serverTime, containerRef }: OrbitalOverlaysGroupProps) {
  return (
    <>
      <TerminatorOverlay containerRef={containerRef} serverTime={serverTime} />
      <HistoricalTrail selectedSat={selectedSat} tick={tick} containerRef={containerRef} />
      <PredictedPath selectedSat={selectedSat} prediction={prediction} containerRef={containerRef} />
    </>
  );
}