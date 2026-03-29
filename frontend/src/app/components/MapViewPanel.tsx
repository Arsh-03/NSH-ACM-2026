/**
 * MapViewPanel.tsx  (updated — v2)
 * ═══════════════════════════════════════════════════════════════════════════════
 * Extends the existing 2D Ground Track Map with:
 *   - TerminatorOverlay  (day/night solar shadow, z:2)
 *   - TrailRenderer      (90-min historical orbit trail, z:3)
 *   - PredictionRenderer (90-min predicted trajectory dashed, z:4)
 *
 * The existing satellite marker logic and map image are UNCHANGED.
 * New overlays are injected via <OrbitalOverlaysGroup> after the background
 * image and before the satellite dot markers.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useRef, useCallback } from 'react';
import { GlobeView } from './EnhancedDashboard';
import earthMap from '../../assets/earth_globe.jpg';
// [NEW] Three overlay components bundled in one import
import { OrbitalOverlaysGroup } from './OrbitalOverlays';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Satellite {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  status: string;
  r: number[];   // ECI position [x, y, z] km
  v: number[];   // ECI velocity [vx, vy, vz] km/s
  [key: string]: unknown;
}

interface MapViewPanelProps {
  satellites: Satellite[];
  debrisList: { id: string; r: number[] }[];
  selectedId: string;
  onSelect: (id: string) => void;
}

// ── GroundTrackMap ─────────────────────────────────────────────────────────────
function GroundTrackMap({
  satellites,
  selectedId,
  onSelect,
}: {
  satellites: Satellite[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // containerRef is shared with OrbitalOverlaysGroup so overlays can measure
  // live pixel dimensions and project lat/lon → pixel accurately.
  const containerRef = useRef<HTMLDivElement>(null);

  const parseDeg = (s: string): number => parseFloat(s.replace('°', '')) || 0;
  const latLonToPercent = (lat: number, lon: number) => ({
    x: ((lon + 180) / 360) * 100,
    y: ((90 - lat) / 180) * 100,
  });

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: 5, background: '#03060f' }}
    >
      {/* ─── z:1 Earth map image ─── */}
      <img
        src={earthMap}
        alt="Earth ground track map"
        draggable={false}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          objectFit: 'cover', objectPosition: 'center',
          filter: 'saturate(0.75) brightness(0.85)',
          pointerEvents: 'none', userSelect: 'none',
          zIndex: 1,
        }}
      />

      {/* ─── z:1 Scanline atmosphere texture ─── */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)',
      }} />

      {/*
       * ─── z:2–4  [NEW] Orbital overlays ───────────────────────────────────
       *
       * OrbitalOverlaysGroup renders three SVG layers in order:
       *   z:2 — TerminatorOverlay  (night-side dark polygon)
       *   z:3 — TrailRenderer      (past 90-min solid glow lines)
       *   z:4 — PredictionRenderer (next 90-min dashed marching lines)
       *
       * containerRef is passed so each overlay can ResizeObserver the map div
       * and reproject whenever the panel is resized (responsive-safe).
       *
       * satellites[] already contains .r and .v from the live WebSocket feed
       * — no additional data plumbing is required.
       */}
      <OrbitalOverlaysGroup satellites={satellites} containerRef={containerRef} />

      {/* ─── z:5 Graticule grid (above overlays for readability) ─── */}
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}
        viewBox="0 0 100 100" preserveAspectRatio="none">
        {[-150,-120,-90,-60,-30,0,30,60,90,120,150].map(lon => (
          <line key={`lon${lon}`} x1={((lon+180)/360)*100} y1={0} x2={((lon+180)/360)*100} y2={100}
            stroke="rgba(0,170,255,0.06)" strokeWidth="0.15" />
        ))}
        {[-60,-30,0,30,60].map(lat => (
          <line key={`lat${lat}`} x1={0} y1={((90-lat)/180)*100} x2={100} y2={((90-lat)/180)*100}
            stroke="rgba(0,170,255,0.06)" strokeWidth="0.15" />
        ))}
        <line x1={0} y1={50} x2={100} y2={50} stroke="rgba(0,200,255,0.15)" strokeWidth="0.2" strokeDasharray="1,2" />
      </svg>

      {/* ─── z:10 Satellite dot markers (unchanged) ─── */}
      {satellites.map(sat => {
        const lat = parseDeg(sat.latitude);
        const lon = parseDeg(sat.longitude);
        const { x, y } = latLonToPercent(lat, lon);
        const isSelected = sat.id === selectedId;
        const isAtRisk = sat.status === 'AT_RISK' || sat.status === 'MANEUVERING';
        const dotColor = isAtRisk ? '#ff6644' : isSelected ? '#00d4ff' : '#3a7fff';

        return (
          <button key={sat.id} onClick={() => onSelect(sat.id)} title={sat.name}
            style={{ position: 'absolute', left: `${x}%`, top: `${y}%`,
              transform: 'translate(-50%, -50%)', background: 'none', border: 'none',
              cursor: 'pointer', padding: 0, zIndex: isSelected ? 12 : 10 }}>
            {isSelected && (
              <span aria-hidden="true" style={{
                position: 'absolute', inset: -8, borderRadius: '50%',
                border: `1px solid ${dotColor}`,
                animation: 'gtPulse 1.6s ease-out infinite', opacity: 0, pointerEvents: 'none',
              }} />
            )}
            <span style={{
              display: 'block',
              width: isSelected ? 10 : 7, height: isSelected ? 10 : 7,
              borderRadius: '50%', background: dotColor,
              boxShadow: `0 0 ${isSelected ? 10 : 6}px 2px ${dotColor}`,
              transition: 'all 0.25s ease', position: 'relative',
            }} />
            {isSelected && (
              <span style={{
                position: 'absolute', left: '100%', top: '50%',
                transform: 'translateY(-50%)', marginLeft: 7,
                color: dotColor, fontSize: 9, fontFamily: 'Azeret Mono, monospace',
                whiteSpace: 'nowrap', textShadow: `0 0 8px ${dotColor}`,
                pointerEvents: 'none', letterSpacing: 0.5,
              }}>
                {sat.name}
              </span>
            )}
          </button>
        );
      })}

      {/* ─── z:11 Ground station marker — Bengaluru ─── */}
      <div title="Ground Station – Bengaluru" style={{
        position: 'absolute',
        left: `${((77.52+180)/360)*100}%`,
        top: `${((90-13.03)/180)*100}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none', zIndex: 11,
      }}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,0 12,6 6,12 0,6" fill="none" stroke="#ffd700" strokeWidth="1.5" />
          <circle cx="6" cy="6" r="1.5" fill="#ffd700" />
        </svg>
      </div>

      {/* ─── z:20 Legend (updated to include new overlay entries) ─── */}
      <div style={{
        position: 'absolute', bottom: 10, right: 12, zIndex: 20,
        display: 'flex', flexDirection: 'column', gap: 5,
        background: 'rgba(5,9,19,0.82)', border: '1px solid rgba(58,127,255,0.2)',
        borderRadius: 6, padding: '7px 10px', pointerEvents: 'none',
      }}>
        {([
          { type: 'dot',      color: '#3a7fff',              label: 'Nominal'       },
          { type: 'dot',      color: '#ff6644',              label: 'At Risk'       },
          { type: 'dot',      color: '#00d4ff',              label: 'Selected'      },
          { type: 'diamond',  color: '#ffd700',              label: 'Ground Stn'   },
          { type: 'line',     color: '#3a7fff', dash: false,  label: 'Trail (90m)'  },
          { type: 'line',     color: '#00d4ff', dash: true,   label: 'Prediction'   },
          { type: 'night',    color: '',                      label: 'Night Side'   },
        ] as const).map(item => (
          <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {item.type === 'diamond' ? (
              <svg width="8" height="8" viewBox="0 0 8 8">
                <polygon points="4,0 8,4 4,8 0,4" fill="none" stroke={item.color} strokeWidth="1" />
              </svg>
            ) : item.type === 'line' ? (
              <svg width="14" height="4" viewBox="0 0 14 4">
                <line x1="0" y1="2" x2="14" y2="2" stroke={item.color} strokeWidth="1.5"
                  strokeDasharray={(item as any).dash ? '3 3' : 'none'} />
              </svg>
            ) : item.type === 'night' ? (
              <span style={{
                display: 'inline-block', width: 10, height: 6,
                background: 'rgba(0,5,25,0.65)',
                border: '1px solid rgba(255,200,80,0.3)', borderRadius: 1, flexShrink: 0,
              }} />
            ) : (
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: item.color, boxShadow: `0 0 4px ${item.color}`, flexShrink: 0,
              }} />
            )}
            <span style={{ color: '#8892a4', fontSize: 8, fontFamily: 'Azeret Mono, monospace', letterSpacing: 0.5 }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Border */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, borderRadius: 5,
        border: '1px solid #1f3c5e', pointerEvents: 'none', zIndex: 20,
      }} />

      <style>{`
        @keyframes gtPulse {
          0%   { transform: scale(1);   opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0;   }
        }
      `}</style>
    </div>
  );
}

// ── MapViewPanel — toggle wrapper (unchanged structure) ────────────────────────
export function MapViewPanel({ satellites, debrisList, selectedId, onSelect }: MapViewPanelProps) {
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const toggle = useCallback(() => setViewMode(m => m === '3D' ? '2D' : '3D'), []);
  const is3D = viewMode === '3D';

  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 5, overflow: 'hidden', background: '#03060f' }}>

      {/* 3D Globe — kept mounted, hidden via opacity when inactive */}
      <div aria-hidden={!is3D} style={{
        position: 'absolute', inset: 0,
        opacity: is3D ? 1 : 0, pointerEvents: is3D ? 'auto' : 'none',
        transition: 'opacity 400ms ease', zIndex: 1,
      }}>
        <GlobeView satellites={satellites} debrisList={debrisList} selectedId={selectedId} onSelect={onSelect} />
      </div>

      {/* 2D Ground Track — with orbital overlays */}
      <div aria-hidden={is3D} style={{
        position: 'absolute', inset: 0,
        opacity: is3D ? 0 : 1, pointerEvents: is3D ? 'none' : 'auto',
        transition: 'opacity 400ms ease', zIndex: 1,
      }}>
        <GroundTrackMap satellites={satellites} selectedId={selectedId} onSelect={onSelect} />
      </div>

      {/* View label */}
      <div aria-live="polite" style={{ position: 'absolute', bottom: 10, left: 12, zIndex: 30, pointerEvents: 'none' }}>
        <span style={{ fontSize: 9, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1.5,
          color: 'rgba(58,127,255,0.7)', textTransform: 'uppercase' }}>
          {is3D ? '3D Orbital View' : '2D Ground Track View'}
        </span>
      </div>

      {/* Toggle button */}
      <button onClick={toggle} aria-label={is3D ? 'Switch to 2D Map' : 'Switch to 3D Globe'}
        style={{
          position: 'absolute', top: 10, right: 12, zIndex: 30,
          background: 'rgba(5,12,28,0.82)', border: '1px solid rgba(58,127,255,0.45)',
          borderRadius: 6, color: '#a8c4f0', fontSize: 9,
          fontFamily: 'Azeret Mono, monospace', letterSpacing: 1.2,
          padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          boxShadow: '0 0 10px rgba(58,127,255,0.15), inset 0 0 6px rgba(58,127,255,0.05)',
          backdropFilter: 'blur(6px)',
          transition: 'border-color 200ms ease, box-shadow 200ms ease, color 200ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(58,127,255,0.9)';
          e.currentTarget.style.boxShadow = '0 0 16px rgba(58,127,255,0.45), inset 0 0 8px rgba(58,127,255,0.12)';
          e.currentTarget.style.color = '#d0e8ff';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(58,127,255,0.45)';
          e.currentTarget.style.boxShadow = '0 0 10px rgba(58,127,255,0.15), inset 0 0 6px rgba(58,127,255,0.05)';
          e.currentTarget.style.color = '#a8c4f0';
        }}
      >
        {is3D ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="0.8" />
            <line x1="0.5" y1="5.5" x2="10.5" y2="5.5" stroke="currentColor" strokeWidth="0.6" />
            <path d="M4 0.5 Q5.5 5.5 4 10.5" stroke="currentColor" strokeWidth="0.6" fill="none" />
            <path d="M7 0.5 Q5.5 5.5 7 10.5" stroke="currentColor" strokeWidth="0.6" fill="none" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="0.8" />
            <ellipse cx="5.5" cy="5.5" rx="2.2" ry="4.5" stroke="currentColor" strokeWidth="0.6" />
            <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="0.6" />
          </svg>
        )}
        {is3D ? 'SWITCH TO 2D MAP' : 'SWITCH TO 3D GLOBE'}
      </button>
    </div>
  );
}

export default MapViewPanel;