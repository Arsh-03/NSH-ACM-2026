/**
 * ExpandedRadar.tsx
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Adds an expandable fullscreen radar modal to the existing BullseyeRadarInline.
 *
 * USAGE — replace BullseyeRadarInline in EnhancedDashboard.tsx:
 *
 *   // Before:
 *   <BullseyeRadarInline satellite={selectedSat} debrisList={debrisList} />
 *
 *   // After:
 *   <ExpandableBullseye satellite={selectedSat} debrisList={debrisList} />
 *
 * ARCHITECTURE:
 *   ExpandableBullseye
 *     ├── BullseyeRadarInline   (existing component, untouched, always shown)
 *     ├── ExpandButton          (top-right of the inline panel)
 *     └── RadarModal            (portal-rendered, shown only when expanded)
 *           └── ExpandedRadarSVG (full-resolution radar with zoomed scale)
 *
 * IMPORTANT — nothing in BullseyeRadarInline is modified. This file only adds
 * new components that wrap around it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

// ── Types (mirror what EnhancedDashboard already defines) ─────────────────────

interface Satellite {
  id: string;
  name: string;
  altitude: string;
  latitude: string;
  longitude: string;
  velocity: string;
  propellant: string;
  status: string;
  fuelPct: number;
  r: number[];
  v: number[];
  debris?: string;
}

interface DebrisItem {
  id: string;
  r: number[];
}

// ── Radar geometry constants ───────────────────────────────────────────────────

/**
 * NORMAL mode (matches BullseyeRadarInline exactly):
 *   R = 178px  maps to  5000 km  →  scale = 178/5000 = 0.0356 px/km
 *   Rings at 25%, 50%, 75%, 100% of R → 1250, 2500, 3750, 5000 km
 *
 * EXPANDED mode (zoomed in):
 *   R = 280px  maps to  2000 km  →  scale = 280/2000 = 0.14 px/km
 *   Objects farther than 2000 km are clipped (shown at edge)
 *   Rings at 500, 1000, 1500, 2000 km — 4× finer resolution
 *
 * WHY THIS MATTERS:
 *   At normal scale, two debris items at 80 km and 120 km separation are
 *   only 1.4 px apart — indistinguishable. Expanded scale puts them 5.6 px
 *   apart and makes threat proximity clear.
 */

const NORMAL = {
  R:        178,     // radius in px (SVG units)
  MAX_KM:   5000,    // 1 ring = R at 5000 km
  CX:       210,     // SVG center X
  CY:       205,     // SVG center Y
  RINGS:    [0.25, 0.5, 0.75, 1.0] as const,          // as fraction of R
  RING_LABELS: ['1250km', '2500km', '3750km', '5000km'] as const,
} as const;

const EXPANDED = {
  R:        280,
  MAX_KM:   500,     // 1x base range; higher zoom levels reduce this range.
  CX:       300,
  CY:       300,
  RINGS:    [0.25, 0.5, 0.75, 1.0] as const,
} as const;

const ZOOM_LEVELS = [1, 2, 4, 8] as const;
type ZoomLevel = typeof ZOOM_LEVELS[number];

// ── Distance normalization ─────────────────────────────────────────────────────

/**
 * Project a debris item's ECI delta onto the radar SVG plane.
 *
 * COORDINATE MAPPING:
 *   We project into the X-Z plane of ECI (same as BullseyeRadarInline):
 *     radar_x = CX + dx * scale
 *     radar_y = CY - dz * scale   (dz maps to vertical, Y-up in SVG terms)
 *
 *   dy (depth) is intentionally ignored — this gives a top-down view of the
 *   orbital plane, which is the standard for proximity operations displays.
 *
 * NORMALIZATION:
 *   scale = R / maxRangeKm
 *   At NORMAL: scale = 178/5000 = 0.0356 px/km
 *   At EXPANDED: scale = 280/2000 = 0.140 px/km  (4× magnification)
 */
function projectDebris(
  deb: DebrisItem,
  sat: Satellite,
  config: { R: number; MAX_KM: number; CX: number; CY: number },
): { rx: number; ry: number; distKm: number; inRange: boolean } {
  const dx = deb.r[0] - sat.r[0];
  const dy = deb.r[1] - sat.r[1];
  const dz = deb.r[2] - sat.r[2];
  const distKm = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // px/km scale factor for this radar mode
  const scale = config.R / config.MAX_KM;

  const rx = config.CX + dx * scale;
  const ry = config.CY - dz * scale;

  // Clip to radar circle boundary
  const relX = rx - config.CX;
  const relY = ry - config.CY;
  const relDist = Math.sqrt(relX * relX + relY * relY);
  const inRange = relDist <= config.R && distKm <= config.MAX_KM;

  return { rx, ry, distKm, inRange };
}

// ── Scan line (SVG animated) ───────────────────────────────────────────────────

function ScanLine({ cx, cy, r, color = '#3a7fff' }: { cx: number; cy: number; r: number; color?: string }) {
  return (
    <g>
      {/* Scan sweep line */}
      <line x1={cx} y1={cy} x2={cx + r} y2={cy} stroke={color} strokeWidth="1.5" opacity="0.7">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`0 ${cx} ${cy}`}
          to={`360 ${cx} ${cy}`}
          dur="3s"
          repeatCount="indefinite"
        />
      </line>
      {/* Fading wake — a wider, dimmer sector */}
      <line x1={cx} y1={cy} x2={cx + r * 0.85} y2={cy} stroke={color} strokeWidth="8" opacity="0.06">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from={`-20 ${cx} ${cy}`}
          to={`340 ${cx} ${cy}`}
          dur="3s"
          repeatCount="indefinite"
        />
      </line>
    </g>
  );
}

// ── ExpandedRadarSVG — the full modal radar ────────────────────────────────────

/**
 * ExpandedRadarSVG
 *
 * Renders the zoomed radar in EXPANDED mode. All positions are recalculated
 * using EXPANDED.R and EXPANDED.MAX_KM instead of the normal 5000 km range.
 *
 * KEY FEATURES vs inline radar:
 *   - 4× tighter scale (2000 km max range vs 5000 km)
 *   - Debris items appear 4× farther from center → easy to distinguish
 *   - Hover tooltip shows exact distance
 *   - Closest object highlighted with pulsing red ring
 *   - 4 labeled rings at 500 / 1000 / 1500 / 2000 km
 *   - Threat count badge in corner
 */
const ExpandedRadarSVG = memo(function ExpandedRadarSVG({
  satellite,
  debrisList,
  zoom,
}: {
  satellite: Satellite;
  debrisList: DebrisItem[];
  zoom: ZoomLevel;
}) {
  const { R, CX, CY } = EXPANDED;
  const MAX_KM = EXPANDED.MAX_KM / zoom;
  const ringKm = [0.25, 0.5, 0.75, 1].map((f) => MAX_KM * f);
  const criticalKm = Math.min(100, MAX_KM * 0.4);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // ── Optimization: Candidate Pool ──
  const candidateDebris = useMemo(() => {
    if (!satellite.r || !debrisList.length) return [];
    return debrisList.filter((d: DebrisItem) => {
      if (!d.r) return false;
      const dx = d.r[0] - satellite.r[0];
      const dy = d.r[1] - satellite.r[1];
      const dz = d.r[2] - satellite.r[2];
      return (dx*dx + dy*dy + dz*dz) < 1000000; // 1000km buffer
    });
  }, [debrisList, satellite.id]);

  // Project candidates into expanded coordinates
  const projected = useMemo(() => {
    return candidateDebris
      .filter((d: DebrisItem) => d.r?.length === 3)
      .map((deb: DebrisItem) => ({
        deb,
        ...projectDebris(deb, satellite, { ...EXPANDED, MAX_KM }),
      }))
      .filter((d) => d.distKm <= MAX_KM)
      .sort((a, b) => a.distKm - b.distKm); // SORT BY DISTANCE
  }, [candidateDebris, satellite.r, MAX_KM]);

  // Find closest debris for highlight
  const closest = projected.length > 0
    ? projected.reduce((a, b) => (a.distKm < b.distKm ? a : b))
    : null;

  const isAtRisk = satellite.status === 'AT_RISK' || satellite.status === 'MANEUVERING';

  return (
    <svg
      viewBox={`0 0 600 600`}
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {/* ── Background ── */}
      <rect x="0" y="0" width="600" height="600" fill="#070d1a" rx="8" />

      {/* ── Subtle radial fill (gives depth to the "sky") ── */}
      <defs>
        <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor="#0d1f3c" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#070d1a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="scan-wake" cx="0%" cy="50%" r="100%">
          <stop offset="0%"   stopColor="#3a7fff" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#3a7fff" stopOpacity="0" />
        </radialGradient>
        <filter id="glow-red">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-blue">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <circle cx={CX} cy={CY} r={R} fill="url(#radar-bg)" />

      {/* ── Concentric distance rings ──────────────────────────────────────────
       * 4 rings evenly spaced at 500 km intervals (vs 1250 km in normal mode).
       * Each ring represents half the distance of the normal radar — much finer
       * resolution for conjunction analysis.
       */}
      {ringKm.map((km, i) => {
        const ringR = (km / MAX_KM) * R;
        return (
          <g key={km}>
            <circle
              cx={CX} cy={CY} r={ringR}
              fill="none"
              stroke={i === 3 ? '#1f3c5e' : '#162238'}
              strokeWidth={i === 3 ? 1 : 0.7}
              opacity={0.8}
            />
            {/* Ring distance label — positioned at top of each ring */}
            <text
              x={CX + 5}
              y={CY - ringR + 11}
              fill="#3a5a80"
              fontSize="10"
              fontFamily="Azeret Mono, monospace"
            >
              {km < 1000 ? `${km.toFixed(1)}km` : `${(km / 1000).toFixed(2)}Mm`}
            </text>
          </g>
        );
      })}

      {/* ── Cross-hairs ── */}
      <line x1={CX - R - 16} y1={CY} x2={CX + R + 16} y2={CY} stroke="#1f3c5e" strokeWidth="0.7" />
      <line x1={CX} y1={CY - R - 16} x2={CX} y2={CY + R + 16} stroke="#1f3c5e" strokeWidth="0.7" />

      {/* ── Diagonal guides (45°) ── */}
      {[45, 135, 225, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={angle}
            x1={CX} y1={CY}
            x2={CX + Math.cos(rad) * (R + 10)}
            y2={CY + Math.sin(rad) * (R + 10)}
            stroke="#111e34"
            strokeWidth="0.5"
            strokeDasharray="4 4"
          />
        );
      })}

      {/* ── Compass labels ── */}
      {([['N', CX - 5, CY - R - 18],
         ['S', CX - 5, CY + R + 26],
         ['W', CX - R - 24, CY + 5],
         ['E', CX + R + 10, CY + 5]] as const).map(([d, x, y]) => (
        <text key={d} x={x} y={y} fill="#4a6080" fontSize="12" fontFamily="Azeret Mono, monospace">{d}</text>
      ))}

      {/* ── Scan line ── */}
      <ScanLine cx={CX} cy={CY} r={R} color={isAtRisk ? '#ff6644' : '#3a7fff'} />

      {/* ── Debris objects ──────────────────────────────────────────────────────
       * POSITION MATH:
       *   scale = R / MAX_KM = 280 / 2000 = 0.14 px/km
       *   rx = CX + dx * scale
       *   ry = CY - dz * scale
       *
       * Items within 100 km are highlighted in red; between 100-500 km amber;
       * beyond 500 km grey. Closest object gets a pulsing outer ring.
       */}
      {projected.map(({ deb, rx, ry, distKm, inRange }) => {
        if (!inRange) return null;

        const isClosestObj = closest?.deb.id === deb.id;
        const isVeryClose  = distKm < criticalKm;
        const isClose      = distKm < MAX_KM;
        const isHovered    = hoveredId === deb.id;

        const dotColor = isVeryClose ? '#ff4444' : isClose ? '#f59e0b' : '#8892a4';
        const dotR     = isVeryClose ? 6 : isClose ? 5 : 4;

        return (
          <g
            key={deb.id}
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => setHoveredId(deb.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Connector line from center */}
            <line
              x1={CX} y1={CY} x2={rx} y2={ry}
              stroke={dotColor}
              strokeWidth="0.6"
              opacity="0.3"
              strokeDasharray="3 4"
            />

            {/* Closest object: outer pulsing ring */}
            {isClosestObj && (
              <circle cx={rx} cy={ry} r={dotR + 5} fill="none" stroke="#ff4444" strokeWidth="1" opacity="0.5">
                <animate attributeName="r" values={`${dotR + 5};${dotR + 11};${dotR + 5}`} dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.6;0;0.6" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Glow filter for very close objects */}
            <circle
              cx={rx} cy={ry} r={dotR + 2}
              fill={dotColor}
              opacity="0.2"
              filter={isVeryClose ? 'url(#glow-red)' : undefined}
            />

            {/* Main dot */}
            <circle cx={rx} cy={ry} r={dotR} fill={dotColor}>
              {isVeryClose && (
                <animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite" />
              )}
            </circle>

            {/* Debris ID label */}
            <text
              x={rx + 8} y={ry - 4}
              fill={dotColor}
              fontSize="11"
              fontFamily="Azeret Mono, monospace"
            >
              {deb.id}
            </text>

            {/* Distance label (always visible in expanded mode) */}
            <text
              x={rx + 8} y={ry + 9}
              fill={isVeryClose ? '#ff4444' : '#8892a4'}
              fontSize="10"
              fontFamily="Azeret Mono, monospace"
            >
              {distKm < 1000 ? `${distKm.toFixed(0)}km` : `${(distKm / 1000).toFixed(2)}Mm`}
            </text>

            {/* Hover tooltip box */}
            {isHovered && (
              <g>
                <rect
                  x={rx + 8} y={ry + 14}
                  width="110" height="42" rx="4"
                  fill="#0e1b2e" stroke="#1f3c5e" strokeWidth="0.7"
                />
                <text x={rx + 14} y={ry + 29} fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">DISTANCE</text>
                <text x={rx + 14} y={ry + 42} fill="white" fontSize="11" fontFamily="Azeret Mono, monospace">
                  {distKm.toFixed(2)} km
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* ── Center satellite icon + glow ── */}
      <circle cx={CX} cy={CY} r={20} fill="#3a7fff" opacity="0.08">
        <animate attributeName="r" values="18;24;18" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.08;0.18;0.08" dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Satellite represented as a crosshair target */}
      <circle cx={CX} cy={CY} r={8} fill="none" stroke="#3a7fff" strokeWidth="1.5" />
      <circle cx={CX} cy={CY} r={2} fill="#3a7fff" />
      <line x1={CX - 14} y1={CY} x2={CX - 10} y2={CY} stroke="#3a7fff" strokeWidth="1.5" />
      <line x1={CX + 10} y1={CY} x2={CX + 14} y2={CY} stroke="#3a7fff" strokeWidth="1.5" />
      <line x1={CX} y1={CY - 14} x2={CX} y2={CY - 10} stroke="#3a7fff" strokeWidth="1.5" />
      <line x1={CX} y1={CY + 10} x2={CX} y2={CY + 14} stroke="#3a7fff" strokeWidth="1.5" />

      {/* ── Telemetry overlay (bottom-left) ── */}
      <rect x="12" y="510" width="180" height="78" rx="6" fill="#0e1b2e" opacity="0.92" />
      <text x="22" y="526" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">ALTITUDE</text>
      <text x="22" y="540" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.altitude}</text>
      <text x="22" y="557" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">VELOCITY</text>
      <text x="22" y="571" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.velocity}</text>
      <text x="100" y="526" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">LAT</text>
      <text x="100" y="540" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.latitude}</text>
      <text x="100" y="557" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">LON</text>
      <text x="100" y="571" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.longitude}</text>

      {/* ── Threat count badge (top-right) ── */}
      <rect x="480" y="12" width="108" height="44" rx="6" fill="#0e1b2e" opacity="0.92" />
      <text x="490" y="28" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">IN-RANGE</text>
      <text
        x="490" y="46"
        fill={projected.length > 0 ? '#ff6644' : '#00ff88'}
        fontSize="20"
        fontFamily="Azeret Mono, monospace"
        fontWeight="bold"
      >
        {projected.length} OBJ
      </text>

      {/* ── Status badge (top-left) ── */}
      <rect x="12" y="12" width="148" height="28" rx="4" fill={isAtRisk ? 'rgba(255,68,68,0.12)' : 'rgba(0,255,136,0.08)'} />
      <text x="22" y="30" fill={isAtRisk ? '#ff4444' : '#00ff88'} fontSize="11" fontFamily="Azeret Mono, monospace" fontWeight="bold">
        {satellite.status ?? 'NOMINAL'}
      </text>

      {/* Outer boundary ring */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="#1f3c5e" strokeWidth="1" opacity="0.8" />
    </svg>
  );
});

// ── RadarModal — the fullscreen overlay ───────────────────────────────────────

/**
 * RadarModal
 *
 * Rendered via React Portal into document.body so it:
 *   - Sits above ALL dashboard elements (no z-index battles)
 *   - Doesn't affect layout flow of the dashboard grid
 *   - Can animate from/to the radar's DOM position
 *
 * ANIMATION DESIGN:
 *   - Background overlay: fade from opacity 0 → 0.82 (400ms)
 *   - Modal card: scale 0.85 → 1.0 + opacity 0 → 1 (350ms ease-out)
 *   - Exit: reverse (scale 0.9, opacity 0, 250ms)
 *   Framer Motion's AnimatePresence handles mount/unmount timing.
 *
 * CLOSE TRIGGERS:
 *   1. Click the ✕ button (top-right of modal)
 *   2. Click the backdrop (outside the modal card)
 *   3. Press Escape key
 */
function RadarModal({
  satellite,
  debrisList,
  onClose,
}: {
  satellite: Satellite;
  debrisList: DebrisItem[];
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState<ZoomLevel>(1);
  const maxKm = EXPANDED.MAX_KM / zoom;
  const ringKm = maxKm * 0.25;
  const criticalKm = Math.min(100, maxKm * 0.4);

  // Escape key listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return createPortal(
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="radar-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.35 }}
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          background: 'rgba(2, 5, 18, 0.88)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Modal card — stop propagation so clicking inside doesn't close */}
        <motion.div
          key="radar-modal"
          initial={{ scale: 0.82, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.88, opacity: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }} // custom spring-like easing
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            width: 'min(80vw, 80vh)',
            height: 'min(80vw, 80vh)',
            background: '#070d1a',
            border: '1px solid #1f3c5e',
            borderRadius: 12,
            boxShadow: '0 0 60px rgba(58,127,255,0.12), 0 20px 60px rgba(0,0,0,0.7)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* ── Modal header ── */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            borderBottom: '1px solid #1a2a45',
            background: '#090f1f',
            flexShrink: 0,
          }}>
            {/* Pulsing live dot */}
            <motion.div
              style={{ width: 8, height: 8, borderRadius: '50%', background: '#3a7fff', flexShrink: 0 }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <p style={{ color: '#3a7fff', fontSize: 13, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1.5, fontWeight: 600 }}>
              BULLSEYE RADAR — EXPANDED VIEW
            </p>
            <p style={{ color: '#8892a4', fontSize: 11, fontFamily: 'Azeret Mono, monospace', marginLeft: 4 }}>
              {satellite.name} · {maxKm.toFixed(1)} km RANGE · {ringKm.toFixed(1)} km RINGS
            </p>

            <div style={{
              display: 'flex',
              gap: 6,
              marginLeft: 12,
              alignItems: 'center',
              flexShrink: 0,
            }}>
              {ZOOM_LEVELS.map((level) => {
                const active = zoom === level;
                return (
                  <button
                    key={level}
                    onClick={() => setZoom(level)}
                    style={{
                      background: active ? 'rgba(58,127,255,0.22)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${active ? 'rgba(58,127,255,0.8)' : '#1f3c5e'}`,
                      color: active ? '#3a7fff' : '#8892a4',
                      borderRadius: 4,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontFamily: 'Azeret Mono, monospace',
                      cursor: 'pointer',
                    }}
                  >
                    {level}x
                  </button>
                );
              })}
            </div>

            {/* Scale indicator badge */}
            <div style={{
              marginLeft: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}>
              <div style={{
                background: 'rgba(58,127,255,0.1)',
                border: '1px solid rgba(58,127,255,0.3)',
                borderRadius: 4,
                padding: '3px 8px',
                fontSize: 10,
                color: '#3a7fff',
                fontFamily: 'Azeret Mono, monospace',
                letterSpacing: 0.5,
              }}>
                {zoom}x ZOOM
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                aria-label="Close radar"
                style={{
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid #1f3c5e',
                  borderRadius: 6,
                  color: '#8892a4',
                  width: 30,
                  height: 30,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  lineHeight: 1,
                  transition: 'background 150ms, color 150ms',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,68,68,0.15)';
                  e.currentTarget.style.color = '#ff6644';
                  e.currentTarget.style.borderColor = '#ff6644';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.color = '#8892a4';
                  e.currentTarget.style.borderColor = '#1f3c5e';
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* ── Radar SVG area ── */}
          <div style={{ flex: 1, minHeight: 0, padding: 16 }}>
            <ExpandedRadarSVG satellite={satellite} debrisList={debrisList} zoom={zoom} />
          </div>

          {/* ── Footer info bar ── */}
          <div style={{
            borderTop: '1px solid #1a2a45',
            background: '#090f1f',
            padding: '8px 16px',
            display: 'flex',
            gap: 24,
            flexShrink: 0,
          }}>
            {[
              { color: '#ff4444', label: `< ${criticalKm.toFixed(1)} km — CRITICAL` },
              { color: '#f59e0b', label: `< ${maxKm.toFixed(1)} km — WARNING` },
              { color: '#8892a4', label: `< ${maxKm.toFixed(1)} km — TRACKED` },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ color: '#8892a4', fontSize: 9, fontFamily: 'Azeret Mono, monospace' }}>{label}</span>
              </div>
            ))}
            <span style={{ marginLeft: 'auto', color: '#444', fontSize: 9, fontFamily: 'Azeret Mono, monospace' }}>
              PRESS ESC TO CLOSE
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

// ── ExpandButton ──────────────────────────────────────────────────────────────

function ExpandButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Expand radar"
      aria-label="Open expanded radar view"
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        background: hovered ? 'rgba(58,127,255,0.18)' : 'rgba(58,127,255,0.08)',
        border: `1px solid ${hovered ? 'rgba(58,127,255,0.7)' : 'rgba(58,127,255,0.25)'}`,
        borderRadius: 5,
        width: 26,
        height: 26,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 150ms, border-color 150ms',
        padding: 0,
      }}
    >
      {/* Expand icon — two outward-pointing corner arrows */}
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M9 2h3v3" stroke={hovered ? '#3a7fff' : '#4a6080'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2 9v3h3"  stroke={hovered ? '#3a7fff' : '#4a6080'} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 2L8 6" stroke={hovered ? '#3a7fff' : '#4a6080'} strokeWidth="1.2" strokeLinecap="round" />
        <path d="M2 12l4-4"  stroke={hovered ? '#3a7fff' : '#4a6080'} strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

// ── ExpandableBullseye — the drop-in replacement ──────────────────────────────

/**
 * ExpandableBullseye
 *
 * Drop-in replacement for BullseyeRadarInline.
 * Renders the existing inline radar UNCHANGED, then adds:
 *   1. An expand button (top-right corner)
 *   2. A modal overlay (via portal) when expanded
 *
 * STATE:
 *   isExpanded: boolean — controls modal visibility
 *   Framer Motion AnimatePresence handles mount/unmount with animation.
 *
 * PERFORMANCE:
 *   The modal and its SVG are only mounted when isExpanded=true.
 *   ExpandedRadarSVG is memo'd to prevent unnecessary re-renders.
 *   Debris projection math only runs for the 2000 km subset.
 */
export function ExpandableBullseye({
  satellite,
  debrisList,
}: {
  satellite: Satellite | undefined;
  debrisList: DebrisItem[];
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const open  = useCallback(() => setIsExpanded(true),  []);
  const close = useCallback(() => setIsExpanded(false), []);

  // ── Inline radar (existing, untouched) — re-implemented here so this file
  // is self-contained. You can instead import BullseyeRadarInline from
  // EnhancedDashboard if you export it.
  const CX = 210, CY = 205, R = 178;
  const RADAR_MAX_KM = 250;
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '10px',
      margin: '8px',
      border: '1px solid #1f3c5e',
      borderRadius: '8px',
      background: '#0B1124',
      boxSizing: 'border-box',
      minHeight: 0,
      position: 'relative'
    }}>
      {/* Expand button (top right) */}
      {satellite && <ExpandButton onClick={open} />}
      
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3a7fff', flexShrink: 0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: '#3a7fff', fontSize: 13, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          RADAR — {satellite?.name ?? 'NO TARGET'}
        </p>
      </div>
      <svg viewBox="-60 0 480 410" style={{ width: '100%', height: '100%', display: 'block' }}>
        {[R, R*0.75, R*0.5, R*0.25].map((r, i) => (
          <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="#B3B3B3" strokeWidth="1" opacity={0.7} />
        ))}
        <line x1={CX-R-14} y1={CY} x2={CX+R+14} y2={CY} stroke="#B3B3B3" strokeWidth="0.7" />
        <line x1={CX} y1={CY-R-14} x2={CX} y2={CY+R+14} stroke="#B3B3B3" strokeWidth="0.7" />
        {[['N',CX-5,CY-R-16],['S',CX-5,CY+R+22],['W',CX-R-22,CY+5],['E',CX+R+8,CY+5]].map(([d,x,y])=>(
          <text key={d as string} x={x as number} y={y as number} fill="#555" fontSize="11" fontFamily="Azeret Mono, monospace">{d}</text>
        ))}
        {[['62.5km',CX+4,CY-R*0.25+5],['125km',CX+4,CY-R*0.5+5],['187.5km',CX+4,CY-R*0.75+5],['250km',CX+4,CY-R+5]].map(([l,x,y])=>(
          <text key={l as string} x={x as number} y={y as number} fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">{l}</text>
        ))}
        <g>
          <line x1={CX} y1={CY} x2={CX+R} y2={CY} stroke="#3a7fff" strokeWidth="1.5" opacity="0.6">
            <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="3s" repeatCount="indefinite" />
          </line>
        </g>
        <circle cx={CX} cy={CY} r={8} fill="none" stroke="#3a7fff" strokeWidth="1.5" />
        <circle cx={CX} cy={CY} r={2} fill="#3a7fff" />

        {/* ── Optimization: Inline Candidate Pool ── */}
        {(() => {
          if (!satellite || !satellite.r) return null;
          const inRange = debrisList.filter(deb => {
            if (!deb.r) return false;
            const dx = deb.r[0] - satellite.r[0];
            const dy = deb.r[1] - satellite.r[1];
            const dz = deb.r[2] - satellite.r[2];
            return (dx*dx+dy*dy+dz*dz) < (RADAR_MAX_KM*RADAR_MAX_KM);
          }).slice(0, 40);

          return inRange.map((deb, idx) => {
            const dx = deb.r[0] - satellite.r[0], dy = deb.r[1] - satellite.r[1], dz = deb.r[2] - satellite.r[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const sc = R / RADAR_MAX_KM;
            const rx = CX + dx * sc, ry = CY - dz * sc;
            if (rx < 5 || rx > 415 || ry < 5 || ry > 405) return null;
            const isVeryClose = dist < 150;
            return (
              <g key={deb.id}>
                <line x1={CX} y1={CY} x2={rx} y2={ry} stroke={isVeryClose ? '#ff6644' : '#f59e0b'} strokeWidth="0.8" opacity="0.4" strokeDasharray="3 3" />
                <motion.circle cx={rx} cy={ry} r={isVeryClose ? 5 : 4} fill={isVeryClose ? '#ff4444' : '#f59e0b'}
                  animate={{ opacity: isVeryClose ? [1, 0.2, 1] : [0.5, 1, 0.5] }}
                  transition={{ duration: isVeryClose ? 0.8 : 2, repeat: Infinity }} />
                <text x={rx + 6} y={ry - 1} fill={isVeryClose ? '#ff6644' : '#f59e0b'} fontSize="11" fontFamily="Azeret Mono, monospace">
                  DEB-{deb.id.slice(-4)}
                </text>
                <text x={rx + 6} y={ry + 9} fill={isVeryClose ? '#ff4444' : '#8892a4'} fontSize="10" fontFamily="Azeret Mono, monospace">
                  {dist.toFixed(0)}km
                </text>
              </g>
            );
          });
        })()}
          {satellite && (
            <g>
              <rect x="-125" y="342" width="165" height="70" rx="5" fill="#0e1b2e" opacity="0.92" />
              <text x="-36" y="357" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">Alt</text>
              <text x="-36" y="370" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.altitude}</text>
              <text x="-120" y="357" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">Vel</text>
              <text x="-120" y="370" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.velocity}</text>
              <text x="-36" y="389" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">Lat</text>
              <text x="-36" y="402" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.latitude}</text>
              <text x="-120" y="389" fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">Lon</text>
              <text x="-120" y="402" fill="white" fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.longitude}</text>
            </g>
          )}
        </svg>
      {/* ── Modal (portal, only mounted when isExpanded) ── */}
      <AnimatePresence>
        {isExpanded && satellite && (
          <RadarModal
            satellite={satellite}
            debrisList={debrisList}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default ExpandableBullseye;