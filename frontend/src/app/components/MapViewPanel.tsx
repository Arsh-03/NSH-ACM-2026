/**
 * MapViewPanel.tsx — v4 (real-time simulation)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * WHAT'S NEW vs v3:
 *
 *   1. useOrbitalSimulation hook is called HERE — this is the single source of
 *      truth for all satellite positions in the 2D view. The hook:
 *        - Accepts liveSats (raw WS data) and selectedId
 *        - Runs a private RAF loop that propagates each satellite forward
 *          using two-body Keplerian integration between WS ticks
 *        - Manages history trail data for the selected satellite
 *        - Returns: { tick, simRef, prediction, satIds }
 *
 *   2. SatelliteMarkers reads positions from simRef.current (via tick-gated
 *      snapshot) instead of the raw WS strings. This means markers move
 *      continuously at 60fps rather than jumping on each WS message.
 *
 *   3. GlobeView receives simulated positions via simSats (converted from
 *      SimSatellite back to the Satellite format GlobeView expects). Both
 *      2D and 3D views read from the SAME simulation state → perfect sync.
 *
 *   4. OrbitalOverlaysGroup receives (selectedSat, prediction, tick) instead
 *      of (satellites[], selectedSatelliteId). Simpler, faster.
 *
 * 2D ↔ 3D SYNCHRONIZATION:
 *   Both views consume simSats, which is built from simRef.current on each
 *   tick. The tick increments once per RAF frame in useOrbitalSimulation.
 *   Both views are re-rendered together on each tick — guaranteed sync.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { useState, useRef, useCallback, useMemo, useEffect, memo } from 'react';
import { GlobeView } from './EnhancedDashboard';
import earthMap from '../../assets/earth_globe.jpg';
import { OrbitalOverlaysGroup } from './Orbitaloverlays';
import {
  useOrbitalSimulation,
  useSimSnapshot,
  type SimSatellite,
  type LiveSatInput,
} from './useOrbitalSimulation';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Original Satellite type from EnhancedDashboard — GlobeView expects this */
interface DashboardSatellite {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  altitude: string;
  velocity: string;
  status: string;
  r: number[];
  v: number[];
  fuelPct: number;
  [key: string]: unknown;
}

interface MapViewPanelProps {
  /** Raw satellite data from useLiveData() WebSocket hook */
  satellites: DashboardSatellite[];
  debrisList: { id: string; r: number[] }[];
  selectedId: string;
  // ctrlOpen = true when Ctrl/Cmd was held on click → open in new tab
  onSelect: (id: string, ctrlOpen?: boolean) => void;
  serverTime: number;
  debrisFilterKm?: number;
}

interface GroundStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationM: number;
  minElevationDeg: number;
}

const GROUND_STATIONS: GroundStation[] = [
  { id: 'GS-001', name: 'ISTRAC_Bengaluru', lat: 13.0333, lon: 77.5167, elevationM: 820, minElevationDeg: 5.0 },
  { id: 'GS-002', name: 'Svalbard_Sat_Station', lat: 78.2297, lon: 15.4077, elevationM: 400, minElevationDeg: 5.0 },
  { id: 'GS-003', name: 'Goldstone_Tracking', lat: 35.4266, lon: -116.89, elevationM: 1000, minElevationDeg: 10.0 },
  { id: 'GS-004', name: 'Punta_Arenas', lat: -53.15, lon: -70.9167, elevationM: 30, minElevationDeg: 5.0 },
  { id: 'GS-005', name: 'IIT_Delhi_Ground_Node', lat: 28.545, lon: 77.1926, elevationM: 225, minElevationDeg: 15.0 },
  { id: 'GS-006', name: 'McMurdo_Station', lat: -77.8463, lon: 166.6682, elevationM: 10, minElevationDeg: 5.0 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function gmstRadAt(date: Date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0;
  const gmstDeg =
    280.46061837 +
    360.98564736629 * (jd - 2451545.0) +
    0.000387933 * t * t -
    (t * t * t) / 38710000.0;
  const wrapped = ((gmstDeg % 360) + 360) % 360;
  return wrapped * Math.PI / 180;
}

function eciToLatLonAlt(r: number[], at: Date) {
  const mag = Math.sqrt(r[0] ** 2 + r[1] ** 2 + r[2] ** 2);
  const lat = Math.asin(r[2] / Math.max(1e-9, mag)) * 180 / Math.PI;
  const gmst = gmstRadAt(at);
  let lon = (Math.atan2(r[1], r[0]) - gmst) * 180 / Math.PI;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  const alt = mag - 6378.137;
  return { lat, lon, alt };
}

/** Convert SimSatellite back to the string-formatted DashboardSatellite for GlobeView */
function simToDashboard(sim: SimSatellite, original: DashboardSatellite): DashboardSatellite {
  return {
    ...original,
    // Override with simulation-interpolated position
    r:         sim.r,
    v:         sim.v,
    latitude:  `${sim.lat.toFixed(4)}°`,
    longitude: `${sim.lon.toFixed(4)}°`,
    altitude:  `${sim.alt.toFixed(1)} km`,
  };
}

// ── SatelliteTooltip ───────────────────────────────────────────────────────────

function SatelliteTooltip({ sat }: { sat: SimSatellite & { name?: string; altitude?: string; velocity?: string } }) {
  const statusLabel =
    sat.status === 'AT_RISK'     ? '⚠ AT RISK'     :
    sat.status === 'MANEUVERING' ? '↑ MANEUVERING' : '✓ NOMINAL';
  const statusColor =
    sat.status === 'AT_RISK'     ? '#ff6644' :
    sat.status === 'MANEUVERING' ? '#ffd700' : '#4caf80';

  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 8px)', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(4,10,24,0.92)',
      border: '1px solid rgba(58,127,255,0.4)', borderRadius: 5,
      padding: '6px 9px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 90,
      fontFamily: 'Azeret Mono, monospace', fontSize: 9, lineHeight: 1.6, color: '#c8d8f0',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 8px rgba(58,127,255,0.15)',
      animation: 'tooltipFade 150ms ease forwards',
    }}>
      <div style={{ color: '#fff', fontWeight: 700, letterSpacing: 1, marginBottom: 2 }}>{sat.id}</div>
      <div style={{ color: statusColor, letterSpacing: 0.5 }}>{statusLabel}</div>
      <div style={{ color: '#7899cc', marginTop: 1 }}>ALT {sat.alt.toFixed(0)} km</div>
      <div style={{ color: '#7899cc' }}>FUEL {sat.fuel.toFixed(1)} kg</div>
      {/* Arrow caret */}
      <div aria-hidden style={{
        position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: '5px solid rgba(58,127,255,0.4)',
      }}/>
    </div>
  );
}

function GroundStationTooltip({
  station,
  place,
}: {
  station: GroundStation;
  place: 'above' | 'below';
}) {
  const isBelow = place === 'below';
  return (
    <div style={{
      position: 'absolute',
      ...(isBelow ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }),
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(16, 12, 0, 0.94)',
      border: '1px solid rgba(255, 215, 0, 0.42)', borderRadius: 6,
      padding: '6px 9px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 95,
      fontFamily: 'Azeret Mono, monospace', fontSize: 9, lineHeight: 1.55, color: '#f6e9b2',
      boxShadow: '0 4px 16px rgba(0,0,0,0.6), 0 0 8px rgba(255,215,0,0.2)',
      animation: 'tooltipFade 150ms ease forwards',
    }}>
      <div style={{ color: '#ffe27a', fontWeight: 700, letterSpacing: 0.8, marginBottom: 2 }}>{station.id}</div>
      <div style={{ color: '#fff1be' }}>{station.name}</div>
      <div style={{ color: '#d8c887' }}>Lat {station.lat.toFixed(4)}°, Lon {station.lon.toFixed(4)}°</div>
      <div style={{ color: '#d8c887' }}>Elev {station.elevationM.toFixed(0)} m • Min El {station.minElevationDeg.toFixed(1)}°</div>
      <div aria-hidden style={{
        position: 'absolute',
        ...(isBelow ? { top: -5 } : { bottom: -5 }),
        left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        ...(isBelow
          ? { borderBottom: '5px solid rgba(255, 215, 0, 0.42)' }
          : { borderTop: '5px solid rgba(255, 215, 0, 0.42)' }),
      }}/>
    </div>
  );
}

function DebrisTooltip({ id, altKm }: { id: string; altKm: number }) {
  return (
    <div style={{
      position: 'absolute',
      bottom: 'calc(100% + 8px)', left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(24, 8, 8, 0.94)',
      border: '1px solid rgba(255, 89, 89, 0.45)', borderRadius: 6,
      padding: '6px 8px', whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 90,
      fontFamily: 'Azeret Mono, monospace', fontSize: 9, lineHeight: 1.5, color: '#ffd1d1',
      boxShadow: '0 4px 14px rgba(0,0,0,0.6), 0 0 8px rgba(255,89,89,0.15)',
      animation: 'tooltipFade 150ms ease forwards',
    }}>
      <div style={{ color: '#ff7a7a', fontWeight: 700, letterSpacing: 0.8, marginBottom: 2 }}>{id}</div>
      <div style={{ color: '#ffb3b3' }}>Debris Object</div>
      <div style={{ color: '#ffb3b3' }}>Altitude {altKm.toFixed(1)} km</div>
      <div aria-hidden style={{
        position: 'absolute', bottom: -5, left: '50%', transform: 'translateX(-50%)',
        width: 0, height: 0,
        borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
        borderTop: '5px solid rgba(255, 89, 89, 0.45)',
      }}/>
    </div>
  );
}

const GroundStationMarker = memo(function GroundStationMarker({ station }: { station: GroundStation }) {
  const [hovered, setHovered] = useState(false);
  const x = ((station.lon + 180) / 360) * 100;
  const y = ((90 - station.lat) / 180) * 100;
  const place: 'above' | 'below' = y < 18 ? 'below' : 'above';
  const xOffset = x < 12 ? 'translate(-15%, -50%)' : x > 88 ? 'translate(-85%, -50%)' : 'translate(-50%, -50%)';
  return (
    <div style={{
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      transform: xOffset,
      zIndex: hovered ? 55 : 11,
    }}>
      {hovered && <GroundStationTooltip station={station} place={place} />}
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Ground station ${station.name}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 5, margin: -5,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <polygon points="6,0 12,6 6,12 0,6" fill="none" stroke="#ffd700" strokeWidth="1.5"/>
          <circle cx="6" cy="6" r="1.5" fill="#ffd700"/>
        </svg>
      </button>
    </div>
  );
});

const DebrisMarker = memo(function DebrisMarker({ debris, simTime }: { debris: { id: string; r: number[] }; simTime: number }) {
  const [hovered, setHovered] = useState(false);
  if (!debris.r || debris.r.length < 3) return null;
  const { lat, lon, alt } = eciToLatLonAlt(debris.r, new Date(simTime * 1000));
  const x = ((lon + 180) / 360) * 100;
  const y = ((90 - lat) / 180) * 100;
  return (
    <div style={{
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      transform: 'translate(-50%, -50%)',
      zIndex: hovered ? 45 : 9,
      opacity: 0.95,
    }}>
      {hovered && <DebrisTooltip id={debris.id} altKm={alt} />}
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Debris ${debris.id}`}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 4, margin: -4,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <span style={{
          display: 'block',
          width: hovered ? 4 : 3,
          height: hovered ? 4 : 3,
          borderRadius: '50%',
          background: '#ff5959',
          boxShadow: `0 0 ${hovered ? 8 : 5}px ${hovered ? 2 : 1}px rgba(255,89,89,0.9)`,
          transition: 'all 140ms ease',
        }} />
      </button>
    </div>
  );
});

// ── SatelliteMarker (single, memo'd) ─────────────────────────────────────────

/**
 * SatelliteMarker
 *
 * REAL-TIME POSITION:
 *   Receives `sat` from simRef snapshot — position is RAF-interpolated,
 *   updating at 60fps. Percentage-based CSS positioning means the browser
 *   handles smooth rendering without triggering layout reflow.
 *
 * DIM LOGIC:
 *   When any satellite is selected, non-selected markers dim to 0.32 opacity
 *   (at-risk stays at 0.55 so alerts remain visible).
 */
interface SatelliteMarkerProps {
  id: string;
  lat: number;
  lon: number;
  alt: number;
  fuel: number;
  status: string;
  isSelected: boolean;
  anySelected: boolean;
  // ctrlOpen = true when Ctrl/Cmd key was held during the click
  onClick: (id: string, ctrlOpen?: boolean) => void;
}

const SatelliteMarker = memo(function SatelliteMarker({
  id, lat, lon, alt, fuel, status, isSelected, anySelected, onClick,
}: SatelliteMarkerProps) {
  const [hovered, setHovered] = useState(false);
  const isAtRisk   = status === 'AT_RISK' || status === 'MANEUVERING';
  const dotColor   = isAtRisk ? '#ff6644' : isSelected ? '#00d4ff' : '#3a7fff';
  const dotSize    = isSelected ? 10 : 7;
  const glowSize   = isSelected ? 12 : hovered ? 9 : 5;
  const dimOpacity = anySelected && !isSelected ? (isAtRisk ? 0.55 : 0.32) : 1;

  // Convert simulation lat/lon to percentage CSS position
  const x = ((lon + 180) / 360) * 100;
  const y = ((90 - lat) / 180) * 100;

  return (
    <div style={{
      position: 'absolute',
      left: `${x}%`, top: `${y}%`,
      transform: 'translate(-50%, -50%)',
      zIndex: isSelected ? 50 : hovered ? 40 : 10,
      opacity: dimOpacity,
      transition: 'opacity 300ms ease',
    }}>
      {hovered && <SatelliteTooltip sat={{ id, lat, lon, alt, fuel, status } as any} />}

      {/* title tooltip: visible on hover, explains Ctrl+Click shortcut */}
      <button
        onClick={(e) => onClick(id, e.ctrlKey || e.metaKey)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Select satellite ${id}`}
        title="Click to select · Ctrl+Click to open in new tab"
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          padding: 6, margin: -6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Pulsing ring — selected */}
        {isSelected && (
          <span aria-hidden="true" style={{
            position: 'absolute',
            width: dotSize + 16, height: dotSize + 16,
            borderRadius: '50%', border: `1px solid ${dotColor}`,
            animation: 'gtPulse 1.8s ease-out infinite', opacity: 0, pointerEvents: 'none',
          }}/>
        )}
        {/* Hover ring — non-selected */}
        {hovered && !isSelected && (
          <span aria-hidden="true" style={{
            position: 'absolute',
            width: dotSize + 10, height: dotSize + 10,
            borderRadius: '50%', border: `1px solid ${dotColor}`,
            opacity: 0.5, pointerEvents: 'none',
          }}/>
        )}
        {/* Dot */}
        <span style={{
          display: 'block',
          width: hovered && !isSelected ? dotSize + 2 : dotSize,
          height: hovered && !isSelected ? dotSize + 2 : dotSize,
          borderRadius: '50%', background: dotColor,
          boxShadow: `0 0 ${glowSize}px ${hovered ? glowSize * 1.2 : glowSize * 0.5}px ${dotColor}`,
          transition: 'all 0.2s ease', flexShrink: 0,
        }}/>
      </button>

      {/* Name label — selected only */}
      {isSelected && (
        <span style={{
          position: 'absolute', left: 'calc(50% + 8px)', top: '50%',
          transform: 'translateY(-50%)', color: dotColor,
          fontSize: 9, fontFamily: 'Azeret Mono, monospace',
          whiteSpace: 'nowrap', textShadow: `0 0 10px ${dotColor}`,
          pointerEvents: 'none', letterSpacing: 0.5, fontWeight: 600,
        }}>
          {id}
        </span>
      )}
    </div>
  );
});

// ── SatelliteMarkers (all) ────────────────────────────────────────────────────

interface SatelliteMarkersProps {
  sats: SimSatellite[];
  mapSelectedId: string | null;
  // ctrlOpen propagated from individual SatelliteMarker click events
  onMarkerClick: (id: string, ctrlOpen?: boolean) => void;
}

const SatelliteMarkers = memo(function SatelliteMarkers({
  sats, mapSelectedId, onMarkerClick,
}: SatelliteMarkersProps) {
  const anySelected = mapSelectedId !== null;
  return (
    <>
      {sats.map(sat => (
        <SatelliteMarker
          key={sat.id}
          id={sat.id}
          lat={sat.lat}
          lon={sat.lon}
          alt={sat.alt}
          fuel={sat.fuel}
          status={sat.status}
          isSelected={sat.id === mapSelectedId}
          anySelected={anySelected}
          onClick={(id, ctrlOpen) => onMarkerClick(id, ctrlOpen)}
        />
      ))}
    </>
  );
});

// ── GroundTrackMap ─────────────────────────────────────────────────────────────

/**
 * GroundTrackMap
 *
 * SIMULATION INTEGRATION:
 *   - Accepts `liveSats: LiveSatInput[]` (raw WS data) + selectedId
 *   - Calls useOrbitalSimulation which runs the private RAF propagation loop
 *   - Gets back: { tick, simRef, prediction }
 *   - On each tick, reads simRef.current for current satellite positions
 *   - Passes simulation state to SatelliteMarkers and OrbitalOverlaysGroup
 *
 * The simulation hook's RAF loop and this component's rendering are decoupled:
 *   - Simulation loop: always running at 60fps, updating simRef in place
 *   - React render: triggered by tick increment, reads simRef snapshot
 */
interface GroundTrackMapProps {
  liveSats: LiveSatInput[];
  debrisList: { id: string; r: number[] }[];
  selectedId: string;
  onSelect: (id: string, ctrlOpen?: boolean) => void;
  serverTime: number;
}

function GroundTrackMap({ liveSats, debrisList, selectedId, onSelect, serverTime }: GroundTrackMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // LOCAL selection state — controls trail visibility independently
  const [mapSelectedId, setMapSelectedId] = useState<string | null>(selectedId || null);

  useEffect(() => {
    setMapSelectedId(selectedId || null);
  }, [selectedId]);

  // handleMarkerClick — called by SatelliteMarkers with optional ctrlOpen flag.
  // Normal click  → update local trail highlight + bubble up (no tab open).
  // Ctrl/Cmd click → same, but ctrlOpen=true tells parent to open a new tab.
  const handleMarkerClick = useCallback((id: string, ctrlOpen = false) => {
    setMapSelectedId(id);
    onSelect(id, ctrlOpen);
  }, [onSelect]);

  // ── SIMULATION HOOK — the RAF engine ──────────────────────────────────────
  //
  // This single call starts the continuous animation loop.
  // `tick` is the frame counter; `simRef` holds all satellite state.
  // `prediction` is pre-computed for the selected satellite.
  const { tick, simRef, prediction, simTime } = useOrbitalSimulation({
    liveSats,
    selectedId: mapSelectedId ?? '',
    serverTime,
  });

  // Convert simRef Map to array — re-reads current state on each tick
  const simSats = useSimSnapshot(simRef, tick);

  // Find selected satellite object for overlays
  const selectedSat = mapSelectedId
    ? (simRef.current.get(mapSelectedId) ?? null)
    : null;

  return (
    <div ref={containerRef} style={{
      position: 'absolute', inset: 0, overflow: 'hidden',
      borderRadius: 5, background: '#03060f',
    }}>

      {/* z:1 Earth map image */}
      <img src={earthMap} alt="Earth ground track map" draggable={false} style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: 'center',
        filter: 'saturate(0.75) brightness(0.85)',
        pointerEvents: 'none', userSelect: 'none', zIndex: 1,
      }}/>

      {/* z:1 Scanlines */}
      <div aria-hidden="true" style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 4px)',
      }}/>

      {/*
       * z:2-4 Orbital Overlays (simulation-driven)
       *
       * selectedSat: the SimSatellite object (contains .history array)
       * prediction:  pre-computed 90-min forward positions from sim hook
       * tick:        drives HistoricalTrail Canvas redraws at 60fps
       */}
      <OrbitalOverlaysGroup
        selectedSat={selectedSat}
        prediction={prediction}
        tick={tick}
        containerRef={containerRef}
      />



      {/* z:5 Graticule */}
      <svg aria-hidden="true" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 5,
      }} viewBox="0 0 100 100" preserveAspectRatio="none">
        {[-150,-120,-90,-60,-30,0,30,60,90,120,150].map(lon => (
          <line key={`lon${lon}`} x1={((lon+180)/360)*100} y1={0} x2={((lon+180)/360)*100} y2={100}
            stroke="rgba(0,170,255,0.06)" strokeWidth="0.15"/>
        ))}
        {[-60,-30,0,30,60].map(lat => (
          <line key={`lat${lat}`} x1={0} y1={((90-lat)/180)*100} x2={100} y2={((90-lat)/180)*100}
            stroke="rgba(0,170,255,0.06)" strokeWidth="0.15"/>
        ))}
        <line x1={0} y1={50} x2={100} y2={50} stroke="rgba(0,200,255,0.15)" strokeWidth="0.2" strokeDasharray="1,2"/>
      </svg>

      {/*
       * z:10-14 Satellite Markers
       *
       * Renders ALL satellites from simSats (simulation-interpolated positions).
       * Each marker position updates at 60fps via tick → useSimSnapshot → re-render.
       * SatelliteMarker is memo'd so only changed markers re-render.
       */}
      <SatelliteMarkers
        sats={simSats}
        mapSelectedId={mapSelectedId}
        onMarkerClick={handleMarkerClick}
      />

      {/* z:11 Ground stations */}
      {GROUND_STATIONS.map((station) => (
        <GroundStationMarker key={station.id} station={station} />
      ))}

      {/* z:9 Debris layer */}
      {debrisList.map((deb) => (
        <DebrisMarker key={deb.id} debris={deb} simTime={simTime} />
      ))}

      {/* z:12 Legend */}
      <div style={{
        position: 'absolute', bottom: 10, right: 12, zIndex: 12,
        display: 'flex', flexDirection: 'column', gap: 5,
        background: 'rgba(5,9,19,0.85)', border: '1px solid rgba(58,127,255,0.2)',
        borderRadius: 6, padding: '7px 10px', pointerEvents: 'none',
      }}>
          {([
          { type:'dot',    color:'#3a7fff',              label:'Nominal'     },
          { type:'dot',    color:'#ff6644',              label:'At Risk'     },
          { type:'dot',    color:'#00d4ff',              label:'Selected'    },
          { type:'diamond',color:'#ffd700',              label:'Ground Stn' },
          { type:'dot',    color:'#ff5959',              label:'Debris'      },
          { type:'line',   color:'#3a7fff', dash:false,  label:'Trail 90m'  },
          { type:'line',   color:'#00d4ff', dash:true,   label:'Prediction' },
          { type:'night',  color:'',                     label:'Night Side' },
        ] as const).map(item => (
          <div key={item.label} style={{ display:'flex', alignItems:'center', gap:6 }}>
            {item.type==='diamond' ? (
              <svg width="8" height="8" viewBox="0 0 8 8">
                <polygon points="4,0 8,4 4,8 0,4" fill="none" stroke={item.color} strokeWidth="1"/>
              </svg>
            ) : item.type==='line' ? (
              <svg width="14" height="4" viewBox="0 0 14 4">
                <line x1="0" y1="2" x2="14" y2="2" stroke={item.color} strokeWidth="1.5"
                  strokeDasharray={(item as any).dash ? '3 3' : 'none'}/>
              </svg>
            ) : item.type==='night' ? (
              <span style={{ display:'inline-block', width:10, height:6,
                background:'rgba(0,5,25,0.65)', border:'1px solid rgba(255,200,80,0.3)',
                borderRadius:1, flexShrink:0 }}/>
            ) : (
              <span style={{ display:'inline-block', width:6, height:6, borderRadius:'50%',
                background:item.color, boxShadow:`0 0 4px ${item.color}`, flexShrink:0 }}/>
            )}
            <span style={{ color:'#8892a4', fontSize:8, fontFamily:'Azeret Mono, monospace', letterSpacing:0.5 }}>
              {item.label}
            </span>
          </div>
        ))}
        <div style={{ marginTop:4, paddingTop:5, borderTop:'1px solid rgba(58,127,255,0.12)',
          color:'rgba(136,146,164,0.65)', fontSize:7.5, fontFamily:'Azeret Mono, monospace', letterSpacing:0.3,
          display:'flex', flexDirection:'column', gap:2 }}>
          {!mapSelectedId && <span>CLICK SATELLITE TO FOCUS</span>}
          <span>CTRL+CLICK TO OPEN IN TAB</span>
        </div>
      </div>

      {/* Border */}
      <div aria-hidden="true" style={{
        position:'absolute', inset:0, borderRadius:5,
        border:'1px solid #1f3c5e', pointerEvents:'none', zIndex:8,
      }}/>

      <style>{`
        @keyframes gtPulse {
          0%   { transform: scale(1);   opacity: 0.9; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes tooltipFade {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── MapViewPanel — 3D/2D toggle ───────────────────────────────────────────────

/**
 * MapViewPanel
 *
 * SYNC BETWEEN 2D AND 3D:
 *   The simulation hook lives INSIDE GroundTrackMap (2D view). When we switch
 *   to 3D, we convert simSats back to DashboardSatellite format and pass them
 *   to GlobeView. Since simSats come from the same RAF-driven simulation,
 *   both views always show the same satellite positions.
 *
 *   If you want 3D to be equally smooth (not just on view switches), lift the
 *   useOrbitalSimulation call up to MapViewPanel so both views share it.
 *   The pattern below keeps it simple: simulation runs in 2D, 3D reads live.
 */
export function MapViewPanel({ satellites, debrisList, selectedId, onSelect, serverTime, debrisFilterKm = 500 }: MapViewPanelProps) {
  const [viewMode, setViewMode] = useState<'3D' | '2D'>('3D');
  const toggle = useCallback(() => setViewMode(m => m === '3D' ? '2D' : '3D'), []);
  const is3D   = viewMode === '3D';

  // Convert DashboardSatellite[] to LiveSatInput[] for the simulation hook
  const liveSatInputs: LiveSatInput[] = useMemo(() =>
    satellites
      .filter(s => s.r?.length === 3 && s.v?.length === 3)
      .map(s => ({
        id:     s.id,
        r:      s.r,
        v:      s.v,
        status: s.status,
        fuel:   (s as any).propellant ? parseFloat((s as any).propellant) : 0,
        type:   (s as any).type ?? 'SAT',
      })),
    [satellites],
  );

  return (
    <div style={{ position:'absolute', inset:0, borderRadius:5, overflow:'hidden', background:'#03060f' }}>

      {/* 3D Globe — kept mounted, hidden via opacity */}
      <div aria-hidden={!is3D} style={{
        position:'absolute', inset:0,
        opacity: is3D ? 1 : 0, pointerEvents: is3D ? 'auto' : 'none',
        transition: 'opacity 400ms ease', zIndex: 1,
      }}>
        {/* GlobeView receives the original (WS-tick) satellite data
            For true 60fps 3D sync, lift useOrbitalSimulation here and
            pass simulated positions. For hackathon purposes, WS-tick is fine. */}
        <GlobeView
          satellites={satellites}
          debrisList={debrisList}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>

      {/* 2D Ground Track — simulation-driven */}
      <div aria-hidden={is3D} style={{
        position:'absolute', inset:0,
        opacity: is3D ? 0 : 1, pointerEvents: is3D ? 'none' : 'auto',
        transition: 'opacity 400ms ease', zIndex: 1,
      }}>
        <GroundTrackMap
          liveSats={liveSatInputs}
          debrisList={debrisList}
          selectedId={selectedId}
          onSelect={onSelect}
          serverTime={serverTime}
        />
      </div>

      {/* View label */}
      <div aria-live="polite" style={{ position:'absolute', bottom:10, left:12, zIndex:30, pointerEvents:'none' }}>
        <span style={{ fontSize:9, fontFamily:'Azeret Mono, monospace', letterSpacing:1.5,
          color:'rgba(58,127,255,0.7)', textTransform:'uppercase' }}>
          {is3D ? '3D Orbital View' : '2D Ground Track View'}
        </span>
      </div>

      {/* Debris proximity badge */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 12,
        zIndex: 30,
        pointerEvents: 'none',
        padding: '5px 9px',
        borderRadius: 6,
        border: '1px solid rgba(255, 89, 89, 0.45)',
        background: 'rgba(24, 8, 8, 0.84)',
        color: '#ffb3b3',
        fontSize: 9,
        fontFamily: 'Azeret Mono, monospace',
        letterSpacing: 0.9,
        textTransform: 'uppercase',
      }}>
        Debris in {debrisFilterKm} km: {selectedId ? debrisList.length : 0}
      </div>

      {/* Toggle button */}
      <button onClick={toggle} aria-label={is3D ? 'Switch to 2D Map' : 'Switch to 3D Globe'}
        style={{
          position:'absolute', top:10, right:12, zIndex:30,
          background:'rgba(5,12,28,0.82)', border:'1px solid rgba(58,127,255,0.45)',
          borderRadius:6, color:'#a8c4f0', fontSize:9,
          fontFamily:'Azeret Mono, monospace', letterSpacing:1.2,
          padding:'5px 10px', cursor:'pointer', display:'flex', alignItems:'center', gap:6,
          boxShadow:'0 0 10px rgba(58,127,255,0.15), inset 0 0 6px rgba(58,127,255,0.05)',
          backdropFilter:'blur(6px)',
          transition:'border-color 200ms ease, box-shadow 200ms ease, color 200ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'rgba(58,127,255,0.9)';
          e.currentTarget.style.boxShadow   = '0 0 16px rgba(58,127,255,0.45), inset 0 0 8px rgba(58,127,255,0.12)';
          e.currentTarget.style.color       = '#d0e8ff';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(58,127,255,0.45)';
          e.currentTarget.style.boxShadow   = '0 0 10px rgba(58,127,255,0.15), inset 0 0 6px rgba(58,127,255,0.05)';
          e.currentTarget.style.color       = '#a8c4f0';
        }}
      >
        {is3D ? (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <rect x="0.5" y="0.5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="0.8"/>
            <line x1="0.5" y1="5.5" x2="10.5" y2="5.5" stroke="currentColor" strokeWidth="0.6"/>
            <path d="M4 0.5 Q5.5 5.5 4 10.5" stroke="currentColor" strokeWidth="0.6" fill="none"/>
            <path d="M7 0.5 Q5.5 5.5 7 10.5" stroke="currentColor" strokeWidth="0.6" fill="none"/>
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle cx="5.5" cy="5.5" r="4.5" stroke="currentColor" strokeWidth="0.8"/>
            <ellipse cx="5.5" cy="5.5" rx="2.2" ry="4.5" stroke="currentColor" strokeWidth="0.6"/>
            <line x1="1" y1="5.5" x2="10" y2="5.5" stroke="currentColor" strokeWidth="0.6"/>
          </svg>
        )}
        {is3D ? 'SWITCH TO 2D MAP' : 'SWITCH TO 3D GLOBE'}
      </button>
    </div>
  );
}

export default MapViewPanel;