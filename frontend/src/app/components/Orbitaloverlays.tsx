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

    // Live-end connector dot: bridges gap between last sample and current position
    const { x: lx, y: ly } = toPixel(selectedSat.lat, selectedSat.lon, w, h);
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.65;
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
// 3. TERMINATOR OVERLAY — unchanged
// ══════════════════════════════════════════════════════════════════════════════

interface TerminatorOverlayProps { containerRef: RefObject<HTMLDivElement | null>; }

function computeSubsolarPoint(date: Date) {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5, n = jd - 2_451_545.0;
  const L   = (280.46 + 0.9856474 * n) % 360;
  const g   = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) * (180 / Math.PI);
  const ra  = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) * (180 / Math.PI);
  const gst = (280.46061837 + 360.98564736629 * n) % 360;
  return { lat: dec, lon: ((ra - gst + 180) % 360 + 360) % 360 - 180 };
}

function terminatorLons(latDeg: number, subLon: number, declDeg: number) {
  const phi = latDeg * (Math.PI / 180), delt = declDeg * (Math.PI / 180);
  const arg = -Math.tan(phi) * Math.tan(delt);
  if (arg < -1) return null;
  if (arg >  1) return { dawn: -180, dusk: 180 };
  const ha = Math.acos(arg) * (180 / Math.PI);
  return {
    dawn: ((subLon - ha + 180) % 360 + 360) % 360 - 180,
    dusk: ((subLon + ha + 180) % 360 + 360) % 360 - 180,
  };
}

function buildTerminatorPath(now: Date, W: number, H: number): string {
  const { lat: sLat, lon: sLon } = computeSubsolarPoint(now);
  const lats = Array.from({ length: 181 }, (_, i) => 90 - i);
  const dusk: {x:number;y:number}[] = [], dawn: {x:number;y:number}[] = [];
  lats.forEach(lat => {
    const t = terminatorLons(lat, sLon, sLat), py = ((90 - lat) / 180) * H;
    if (!t)                              { dusk.push({x:W+10,y:py}); dawn.push({x:-10,y:py}); }
    else if (t.dusk===180&&t.dawn===-180){ dusk.push({x:W+10,y:py}); dawn.push({x:-10,y:py}); }
    else { dusk.push({x:((t.dusk+180)/360)*W,y:py}); dawn.push({x:((t.dawn+180)/360)*W,y:py}); }
  });
  const nLon     = ((sLon+180)%360+360)%360-180;
  const tEq      = terminatorLons(0,sLon,sLat);
  const dEqX     = tEq ? ((tEq.dusk+180)/360)*W : W/2;
  const nTX      = ((nLon+180)/360)*W;
  const east     = nTX > dEqX;
  let d = '';
  if (east) {
    d += `M ${dusk[0].x.toFixed(1)} 0 `;
    dusk.forEach(p=>{d+=`L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;});
    d += `L ${W} ${H} L ${W} 0 Z M 0 0 `;
    dawn.forEach(p=>{d+=`L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;});
    d += `L 0 ${H} Z`;
  } else {
    d += `M ${dawn[0].x.toFixed(1)} 0 `;
    dawn.forEach(p=>{d+=`L ${p.x.toFixed(1)} ${p.y.toFixed(1)} `;});
    d += `L ${dusk[dusk.length-1].x.toFixed(1)} ${H} `;
    for(let i=dusk.length-1;i>=0;i--){d+=`L ${dusk[i].x.toFixed(1)} ${dusk[i].y.toFixed(1)} `;}
    d += 'Z';
  }
  return d;
}

export const TerminatorOverlay = memo(function TerminatorOverlay({ containerRef }: TerminatorOverlayProps) {
  const {w,h}           = useContainerSize(containerRef);
  const [path,setPath]  = useState('');
  useEffect(()=>{
    const u = () => setPath(buildTerminatorPath(new Date(), w, h));
    u(); const id = setInterval(u, 60_000); return ()=>clearInterval(id);
  },[w,h]);
  return (
    <svg aria-hidden="true" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:2}}
      viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <filter id="term-blur"        x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="8"/></filter>
        <filter id="term-blur-subtle" x="-3%" y="-3%" width="106%" height="106%"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>
      {path&&<path d={path} fill="rgba(0,4,20,0.35)"  filter="url(#term-blur)"/>}
      {path&&<path d={path} fill="rgba(0,4,20,0.48)"  filter="url(#term-blur-subtle)"/>}
      {path&&<path d={path} fill="none" stroke="rgba(255,210,100,0.22)" strokeWidth="1.2"/>}
    </svg>
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. OrbitalOverlaysGroup — updated API
// ══════════════════════════════════════════════════════════════════════════════

interface OrbitalOverlaysGroupProps {
  selectedSat: SimSatellite | null;
  prediction: PredictPoint[];
  tick: number;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function OrbitalOverlaysGroup({ selectedSat, prediction, tick, containerRef }: OrbitalOverlaysGroupProps) {
  return (
    <>
      <TerminatorOverlay containerRef={containerRef} />
      <HistoricalTrail selectedSat={selectedSat} tick={tick} containerRef={containerRef} />
      <PredictedPath selectedSat={selectedSat} prediction={prediction} containerRef={containerRef} />
    </>
  );
}