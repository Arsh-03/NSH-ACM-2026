import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SatelliteTabs } from './SatelliteTabs';
import { TelemetryLog } from './TelemetryLog';
import imgFrame2 from "../../assets/9394663ed06f79040e5fccebf1cd472a901e3df0.png";
import imgFrame3 from "../../assets/ab200c4fdecc0a845ba3d8d89b9708fc96134892.png";
import imgSatellite from "../../assets/6292a4c2f7fce59afb681a45c010a7b66e40fa69.png";
import imgWarning from "../../assets/f85026c63fdf650839667e94cb9920852e2d6935.png";
import svgPaths from "../../imports/svg-2gbe90s142";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveSat {
  id: string; r: number[]; v: number[];
  fuel: number; status: string; type: string;
}

interface Satellite {
  id: string; name: string; az: string; el: string;
  altitude: string; latitude: string; longitude: string;
  velocity: string; propellant: string; debris: string;
  status: string; fuelPct: number;
  r: number[]; v: number[];
}

// ── Math helpers ──────────────────────────────────────────────────────────────
const norm3 = (v: number[]) => Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);

function eciToGlobe(r: number[], cx: number, cy: number, radius: number) {
  const RE  = 6378.137;
  const rn  = r.map(x => x / norm3(r));
  const lat = Math.asin(Math.max(-1, Math.min(1, rn[2])));
  const lon = Math.atan2(rn[1], rn[0]);
  // Equirectangular projection onto globe circle
  const px = cx + radius * Math.cos(lat) * Math.cos(lon);
  const py = cy - radius * Math.sin(lat);
  return { px, py, lat, lon };
}

function satToRow(sat: LiveSat): Satellite {
  const RE  = 6378.137;
  const alt = norm3(sat.r) - RE;
  const vel = norm3(sat.v);
  const rn  = sat.r.map(x => x / norm3(sat.r));
  const lat = Math.asin(Math.max(-1, Math.min(1, rn[2]))) * 180 / Math.PI;
  const lon = Math.atan2(rn[1], rn[0]) * 180 / Math.PI;
  const fuelPct = Math.min(100, (sat.fuel / 50) * 100);
  return {
    id: sat.id, name: sat.id,
    az: '—', el: '—',
    altitude:   `${alt.toFixed(1)} km`,
    latitude:   `${lat.toFixed(4)}°`,
    longitude:  `${lon.toFixed(4)}°`,
    velocity:   `${vel.toFixed(2)} km/s`,
    propellant: `${sat.fuel.toFixed(2)} kg`,
    debris:     '—',
    status:     sat.status || 'NOMINAL',
    fuelPct,
    r: sat.r, v: sat.v,
  };
}

// ── Live data hook ────────────────────────────────────────────────────────────
function useLiveData() {
  const [satellites,  setSatellites]  = useState<LiveSat[]>([]);
  const [debrisList,  setDebrisList]  = useState<{id:string;r:number[];v:number[]}[]>([]);
  const [counts,      setCounts]      = useState({ satellites:0, debris:0, at_risk:0 });
  const [connected,   setConnected]   = useState(false);
  const [istTime,     setIstTime]     = useState('--:--:--');
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const clock = setInterval(() => {
      const ist = new Date(Date.now() + 5.5*3600000);
      setIstTime(
        `${String(ist.getUTCHours()).padStart(2,'0')}:` +
        `${String(ist.getUTCMinutes()).padStart(2,'0')}:` +
        `${String(ist.getUTCSeconds()).padStart(2,'0')}`
      );
    }, 1000);

    const connect = () => {
      const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws`);
      wsRef.current = ws;
      ws.onopen  = () => { setConnected(true); ws.send(JSON.stringify({type:'get_state'})); };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'state_update') {
            setSatellites(msg.satellites || []);
            setDebrisList(msg.debris || []);
            setCounts({
              satellites: msg.sat_count || 0,
              debris:     msg.debris_count || 0,
              at_risk:    (msg.satellites||[]).filter((s:LiveSat) =>
                s.status==='AT_RISK'||s.status==='MANEUVERING').length,
            });
          }
        } catch(_){}
      };
      ws.onclose = () => { setConnected(false); setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    };
    connect();

    const poll = setInterval(async () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      try {
        const r = await fetch('/api/telemetry/count');
        if (r.ok) { const d = await r.json(); setCounts({satellites:d.satellites||0,debris:d.debris||0,at_risk:d.at_risk||0}); }
      } catch(_){}
    }, 3000);

    return () => { clearInterval(clock); clearInterval(poll); wsRef.current?.close(); };
  }, []);

  return { satellites, debrisList, counts, connected, istTime };
}

// ── Globe with all satellites ─────────────────────────────────────────────────
function GlobeView({
  satellites, debrisList, selectedId, onSelect
}: {
  satellites: Satellite[];
  debrisList: {id:string; r:number[]}[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // Globe center and radius in the 1310x616 container
  const CX = 655, CY = 308, GLOBE_R = 165;

  const satColors: Record<string, string> = {
    NOMINAL:     '#3a7fff',
    AT_RISK:     '#ff8800',
    MANEUVERING: '#ff4444',
    RECOVERING:  '#00ff88',
  };

  return (
    <div className="absolute h-[616px] left-[43px] rounded-[5px] top-[94px] w-[1310px]">
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
        <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
      </div>

      <div className="overflow-clip relative rounded-[inherit] size-full">
        {/* Rotating Globe */}
        <motion.div
          className="absolute overflow-clip rounded-[414px]"
          style={{ width:330, height:340, left: CX-165, top: CY-170 }}
          animate={{ rotate:360 }}
          transition={{ duration:120, repeat:Infinity, ease:"linear" }}>
          <div className="absolute inset-0 overflow-hidden rounded-[414px]">
            <img alt="" className="absolute h-[112.89%] left-[-4.62%] max-w-none top-[-7.4%] w-[111.22%]" src={imgFrame3} />
          </div>
        </motion.div>

        {/* Orbit path */}
        <motion.div className="absolute" style={{ left:500, top:147, width:260, height:218 }}
          animate={{ opacity:[0.6,1,0.6], filter:['drop-shadow(0 0 4px rgba(151,71,255,0.5))','drop-shadow(0 0 8px rgba(151,71,255,0.8))','drop-shadow(0 0 4px rgba(151,71,255,0.5))'] }}
          transition={{ duration:3, repeat:Infinity }}>
          <svg className="block size-full" fill="none" viewBox="0 0 259.946 217.681">
            <path d={svgPaths.p3420b500} stroke="#9747FF" strokeWidth="2" />
          </svg>
        </motion.div>

        {/* All satellites as interactive dots */}
        {satellites.map((sat, i) => {
          const { px, py } = eciToGlobe(sat.r, CX, CY, GLOBE_R + 40);
          const isSelected = sat.id === selectedId;
          const color      = satColors[sat.status] || '#3a7fff';
          const isAtRisk   = sat.status === 'AT_RISK' || sat.status === 'MANEUVERING';

          return (
            <Tooltip.Root key={sat.id}>
              <Tooltip.Trigger asChild>
                <motion.div
                  className="absolute cursor-pointer"
                  style={{ left: px - 14, top: py - 14, width: 28, height: 28, zIndex: isSelected ? 20 : 10 }}
                  onClick={() => onSelect(sat.id)}
                  animate={isAtRisk ? {
                    filter: [`drop-shadow(0 0 6px ${color})`, `drop-shadow(0 0 14px ${color})`, `drop-shadow(0 0 6px ${color})`]
                  } : {
                    filter: [`drop-shadow(0 0 4px ${color})`, `drop-shadow(0 0 10px ${color})`, `drop-shadow(0 0 4px ${color})`]
                  }}
                  transition={{ duration: isSelected ? 1 : 2, repeat: Infinity, delay: i * 0.15 }}
                  whileHover={{ scale: 1.4 }}
                >
                  <img alt={sat.id} className="size-full object-contain pointer-events-none"
                    src={imgSatellite}
                    style={{ filter: isSelected
                      ? `brightness(1.5) drop-shadow(0 0 8px ${color})`
                      : `brightness(0.8) hue-rotate(${i*30}deg)` }}
                  />
                  {/* Selected ring */}
                  {isSelected && (
                    <motion.div
                      className="absolute rounded-full border-2"
                      style={{ inset:-6, borderColor: color }}
                      animate={{ scale:[1,1.2,1], opacity:[0.8,0.4,0.8] }}
                      transition={{ duration:1.5, repeat:Infinity }}
                    />
                  )}
                  {/* AT_RISK pulse */}
                  {isAtRisk && (
                    <motion.div
                      className="absolute rounded-full"
                      style={{ inset:-4, background: color, opacity:0.15 }}
                      animate={{ scale:[1,1.8,1], opacity:[0.15,0,0.15] }}
                      transition={{ duration:1.5, repeat:Infinity }}
                    />
                  )}
                </motion.div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className="bg-[#0b1124] border border-[#3a7fff] rounded-[6px] px-[12px] py-[8px] text-[12px] z-50"
                  sideOffset={5}>
                  <p className="text-white font-bold">{sat.id}</p>
                  <p className="text-[#aaa]">Alt: {sat.altitude}</p>
                  <p className="text-[#aaa]">Vel: {sat.velocity}</p>
                  <p className="text-[#aaa]">Fuel: {sat.propellant}</p>
                  <p style={{ color }} className="font-semibold">{sat.status}</p>
                  <Tooltip.Arrow className="fill-[#3a7fff]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}

        {/* Live debris dots from backend */}
        {debrisList.map((deb, i) => {
          if (!deb.r || deb.r.length < 3) return null;
          const { px, py } = eciToGlobe(deb.r, CX, CY, GLOBE_R + 30);
          // Only show if within canvas bounds
          if (px < 0 || px > 1310 || py < 0 || py > 616) return null;
          return (
            <Tooltip.Root key={deb.id}>
              <Tooltip.Trigger asChild>
                <motion.div className="absolute cursor-pointer"
                  style={{ left: px-7, top: py-7, width:14, height:14 }}
                  whileHover={{ scale:1.6 }}
                  animate={{ opacity:[0.4,0.9,0.4] }}
                  transition={{ duration:2+i*0.1, delay:(i%8)*0.2, repeat:Infinity }}>
                  <svg className="size-full" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" fill="#888" r="7" />
                    <circle cx="7" cy="7" fill="#bbb" r="3" />
                  </svg>
                </motion.div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="bg-[#0b1124] border border-[#606060] rounded-[6px] px-[10px] py-[6px] text-[11px] z-50" sideOffset={4}>
                  <p className="text-white font-semibold">{deb.id}</p>
                  <p className="text-[#aaa]">Alt: {(norm3(deb.r)-6378.137).toFixed(0)} km</p>
                  <Tooltip.Arrow className="fill-[#606060]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}

        {/* Legend */}
        {[['#ff0000','High Risk'],['#f70','Medium Risk'],['#00a21e','Low Risk']].map(([color,label],i) => (
          <div key={i} className="absolute flex gap-[8px] items-center left-[24px]"
            style={{ top:`${490+i*23}px` }}>
            <div className="h-[2px] rounded w-[24px]" style={{ background:color }} />
            <p className="text-white text-[14px] font-['SF_Compact_Rounded:Regular',sans-serif]">{label}</p>
          </div>
        ))}

        {/* Bottom legend */}
        <div className="absolute flex gap-[24px] items-center left-[24px] bottom-[12px]">
          <div className="flex items-center gap-[8px]">
            <img src={imgSatellite} className="w-[20px] h-[20px]" alt="" />
            <p className="text-white text-[14px]">Satellite</p>
          </div>
          <div className="flex items-center gap-[8px]">
            <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" fill="#aaa" r="7"/></svg>
            <p className="text-white text-[14px]">Debris</p>
          </div>
          <div className="flex items-center gap-[8px]">
            <div className="w-[24px] h-[2px] bg-[#9747FF]" />
            <p className="text-white text-[14px]">Orbit Path</p>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#1f3c5e] inset-0 pointer-events-none rounded-[5px]" />
    </div>
  );
}

// ── Bullseye Radar (shows selected satellite's proximity) ─────────────────────
function BullseyeRadar({ satellite, debrisList }: { 
  satellite: Satellite | undefined;
  debrisList: {id:string; r:number[]}[];
}) {
  return (
    <div className="absolute bg-[#0b1124] h-[479px] left-[1390px] overflow-clip rounded-[6px] top-[94px] w-[592px]"
      style={{ boxShadow:'0 4px 20px rgba(0,0,0,0.3)' }}>

      {/* Header */}
      <div className="absolute left-[16px] top-[12px] flex items-center gap-[8px]">
        <motion.div className="w-[8px] h-[8px] rounded-full bg-[#3a7fff]"
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p className="text-[#3a7fff] text-[12px] font-['Azeret_Mono:Regular',sans-serif] font-semibold tracking-wider">
          BULLSEYE RADAR — {satellite?.name ?? 'NO TARGET'}
        </p>
      </div>

      <div className="absolute left-[64px] top-[40px] w-[480px] h-[420px]">
        {/* Concentric rings */}
        {[
          {path:svgPaths.p3a3bbf80, viewBox:"0 0 365.003 364",    pos:{h:'280px',l:'80px', t:'60px', w:'280px'}},
          {path:svgPaths.p27b37480, viewBox:"0 0 287.002 286",    pos:{h:'210px',l:'115px',t:'95px', w:'210px'}},
          {path:svgPaths.p175a2000, viewBox:"0 0 207.002 206",    pos:{h:'150px',l:'145px',t:'125px',w:'150px'}},
          {path:svgPaths.p1e5e29c8, viewBox:"0 0 124.002 124.5",  pos:{h:'90px', l:'175px',t:'155px',w:'90px'}},
        ].map((c,i) => (
          <motion.div key={i} className="absolute"
            style={{ height:c.pos.h, left:c.pos.l, top:c.pos.t, width:c.pos.w }}
            animate={{ opacity:[0.3,0.6,0.3] }} transition={{ duration:3, delay:i*0.4, repeat:Infinity }}>
            <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox={c.viewBox}>
              <path d={c.path} stroke="#1f3c5e" />
            </svg>
          </motion.div>
        ))}

        {/* Cross-hairs */}
        <div className="absolute bg-[#1f3c5e] h-px" style={{ left:20, top:200, width:400 }} />
        <div className="absolute bg-[#1f3c5e] w-px" style={{ left:220, top:10, height:390 }} />

        {/* Rotating scan line */}
        <motion.div className="absolute h-[2px] bg-gradient-to-r from-[#3a7fff] to-transparent"
          style={{ left:220, top:200, width:180, transformOrigin:'0 50%' }}
          animate={{ rotate:360 }} transition={{ duration:3, repeat:Infinity, ease:"linear" }} />

        {/* Center satellite */}
        <motion.div className="absolute" style={{ left:206, top:186, width:28, height:28 }}
          animate={{ scale:[1,1.1,1], filter:['drop-shadow(0 0 6px #3a7fff)','drop-shadow(0 0 14px #3a7fff)','drop-shadow(0 0 6px #3a7fff)'] }}
          transition={{ duration:2, repeat:Infinity }}>
          <img src={imgSatellite} className="size-full" alt="" />
        </motion.div>

        {/* Live debris on radar relative to selected satellite */}
        {satellite && debrisList.map((deb, i) => {
          if (!deb.r || deb.r.length < 3 || !satellite.r || satellite.r.length < 3) return null;
          // Relative position in km
          const dx = deb.r[0] - satellite.r[0];
          const dy = deb.r[1] - satellite.r[1];
          const dz = deb.r[2] - satellite.r[2];
          const distKm = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (distKm > 500) return null; // only show within 500km
          // Scale: radar radius 180px = 200km
          const scale = 180 / 200;
          const rx = 220 + dx * scale * 0.5;
          const ry = 200 - dz * scale * 0.5;
          if (rx < 10 || rx > 440 || ry < 10 || ry > 400) return null;
          const isClose = distKm < 50;
          return (
            <motion.div key={deb.id} className="absolute"
              style={{ left: rx-5, top: ry-5, width:10, height:10 }}
              animate={{ opacity: isClose ? [1,0.3,1] : [0.4,0.8,0.4] }}
              transition={{ duration: isClose ? 0.8 : 2, repeat:Infinity }}>
              <svg viewBox="0 0 10 10" className="size-full">
                <circle cx="5" cy="5" r="5" fill={isClose ? '#ff4444' : '#888'} />
              </svg>
              {isClose && (
                <p className="absolute text-[8px] text-[#ff4444] whitespace-nowrap" style={{left:12,top:-2}}>
                  {distKm.toFixed(0)}km
                </p>
              )}
            </motion.div>
          );
        })}

        {/* Compass */}
        {[['N',216,8],['E',426,194],['S',216,396],['W',8,194]].map(([d,x,y]) => (
          <p key={d as string} className="absolute text-[#aaa] text-[11px] font-['Azeret_Mono:Regular',sans-serif]"
            style={{ left:x as number, top:y as number }}>{d}</p>
        ))}

        {/* Distance rings labels */}
        {[['50km',216,160],['100km',216,120],['150km',216,80],['200km',216,42]].map(([label,x,y]) => (
          <p key={label as string} className="absolute text-[#555] text-[9px] font-['Azeret_Mono:Regular',sans-serif]"
            style={{ left:x as number, top:y as number }}>{label}</p>
        ))}

        {/* Selected satellite info */}
        {satellite && (
          <div className="absolute bottom-[-20px] left-0 w-full">
            <div className="grid grid-cols-2 gap-[8px] px-[8px]">
              {[
                ['Altitude', satellite.altitude],
                ['Velocity', satellite.velocity],
                ['Latitude', satellite.latitude],
                ['Longitude', satellite.longitude],
              ].map(([k,v]) => (
                <div key={k} className="bg-[#0d1829] rounded px-[8px] py-[4px]">
                  <p className="text-[#555] text-[10px] font-['Azeret_Mono:Regular',sans-serif]">{k}</p>
                  <p className="text-white text-[12px] font-['Azeret_Mono:Regular',sans-serif]">{v}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Telemetry Stats Panel ─────────────────────────────────────────────────────
function TelemetryStatsPanel({ satellite }: { satellite: Satellite | undefined }) {
  const sat     = satellite;
  const fuelPct = sat?.fuelPct ?? 0;
  const isAtRisk = sat?.status === 'AT_RISK' || sat?.status === 'MANEUVERING';

  return (
    <div className="absolute left-[1390px] top-[597px] w-[592px]">
      <div className="bg-[#0e1a2d] px-[22px] py-[10px] rounded-t-[6px] border-t border-x border-[#1f3c5e] flex items-center gap-[8px]">
        <motion.div className="w-[6px] h-[6px] rounded-full"
          style={{ background: isAtRisk ? '#ff4444' : '#00ff88' }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p className="font-['SF_Compact_Rounded:Regular',sans-serif] text-[15px] text-white">
          Telemetry: {sat?.name ?? '— Select a satellite'}
        </p>
        {isAtRisk && (
          <span className="ml-auto text-[11px] bg-[#ff4444] text-white px-[6px] py-[2px] rounded font-bold animate-pulse">
            {sat?.status}
          </span>
        )}
      </div>
      <div className="bg-[#0b1124] border border-[#1f3c5e] rounded-b-[6px] px-[22px] py-[16px]">
        <div className="grid grid-cols-3 gap-[16px] mb-[16px]">
          {[
            ['Altitude',   sat?.altitude   ?? '—'],
            ['Longitude',  sat?.longitude  ?? '—'],
            ['Propellant', sat?.propellant ?? '—'],
            ['Latitude',   sat?.latitude   ?? '—'],
            ['Velocity',   sat?.velocity   ?? '—'],
            ['Status',     sat?.status     ?? 'NOMINAL'],
          ].map(([label,value]) => (
            <div key={label} className="flex flex-col gap-[3px]">
              <p className="text-[#555] text-[11px] font-['SF_Compact_Rounded:Regular',sans-serif]">{label}</p>
              <p className={`text-[14px] font-['SF_Compact_Rounded:Regular',sans-serif] ${
                label==='Status' && isAtRisk ? 'text-[#ff4444]' : 'text-white'
              }`}>{value}</p>
            </div>
          ))}
        </div>
        <div>
          <div className="flex justify-between mb-[6px]">
            <p className="text-[#aaa] text-[12px] font-['SF_Compact_Rounded:Regular',sans-serif]">Fuel Reserve</p>
            <p className="text-white text-[12px] font-['SF_Compact_Rounded:Regular',sans-serif]">{fuelPct.toFixed(0)}%</p>
          </div>
          <div className="h-[6px] bg-[#1a2540] rounded-full overflow-hidden">
            <motion.div className="h-full rounded-full"
              style={{ background: fuelPct>50 ? 'linear-gradient(to right,#00ff88,#00cc66)' : fuelPct>20 ? 'linear-gradient(to right,#ff8800,#ffaa00)' : 'linear-gradient(to right,#ff4444,#ff8800)' }}
              animate={{ width:`${fuelPct}%` }} transition={{ duration:1, ease:'easeOut' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Alert Panel ───────────────────────────────────────────────────────────────
function AlertPanel({ satellites }: { satellites: Satellite[] }) {
  const atRisk = satellites.filter(s => s.status==='AT_RISK'||s.status==='MANEUVERING');
  const alert  = atRisk[0];
  return (
    <div className="absolute left-[1390px] top-[797px] w-[592px]">
      <motion.div className="bg-[#0d1422] rounded-[6px] border p-[18px]"
        style={{ borderColor: alert ? '#ff4442' : '#1f3c5e' }}
        animate={{ boxShadow: alert
          ? ['0 0 8px rgba(255,68,66,0.2)','0 0 16px rgba(255,68,66,0.4)','0 0 8px rgba(255,68,66,0.2)']
          : 'none' }}
        transition={{ duration:2, repeat: alert ? Infinity : 0 }}>
        <div className="flex items-center justify-between mb-[10px]">
          <p className="text-[#d2d2d2] text-[20px] font-['SF_Pro_Rounded:Regular',sans-serif]">
            {alert ? `⚠ ALERT: ${alert.name}` : '✓ All Systems Nominal'}
          </p>
          <div className={`border rounded-[6px] px-[8px] py-[3px] ${alert?'border-[#ff4442]':'border-[#00ff88]'}`}>
            <p className={`text-[13px] font-bold ${alert?'text-[#ff4442]':'text-[#00ff88]'}`}>
              {alert ? alert.status : 'NOMINAL'}
            </p>
          </div>
        </div>
        {alert ? (
          <div className="grid grid-cols-2 gap-[8px] text-[13px] font-['SF_Pro_Rounded:Regular',sans-serif]">
            <p className="text-[#777]">Satellite</p><p className="text-white">{alert.name}</p>
            <p className="text-[#777]">Altitude</p><p className="text-white">{alert.altitude}</p>
            <p className="text-[#777]">Fuel</p><p className="text-white">{alert.propellant}</p>
            <p className="text-[#777]">Velocity</p><p className="text-white">{alert.velocity}</p>
          </div>
        ) : (
          <p className="text-[#444] text-[12px]">No active conjunction threats detected.</p>
        )}
        {atRisk.length > 1 && (
          <p className="text-[#ff8800] text-[11px] mt-[8px]">+{atRisk.length-1} more satellites at risk</p>
        )}
      </motion.div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function EnhancedDashboard() {
  const { satellites: liveSats, debrisList, counts, connected, istTime } = useLiveData();
  const [selectedId, setSelectedId] = useState<string>('');

  const tableRows = liveSats.map(satToRow);
  const selectedSat = tableRows.find(s => s.id === selectedId) || tableRows[0];

  // Auto-select first satellite
  useEffect(() => {
    if (!selectedId && tableRows.length > 0) {
      setSelectedId(tableRows[0].id);
    }
  }, [tableRows.length]);

  const activeTabs = tableRows.slice(0, 4).map(s => ({ id:s.id, name:s.name }));

  return (
    <Tooltip.Provider>
      <div className="bg-[#03020e] relative size-full overflow-auto">

        {/* Header */}
        <div className="absolute flex gap-[10px] items-center left-[30px] top-[24px]">
          <p className="font-['SF_Compact_Rounded:Regular',sans-serif] text-[32px] text-white whitespace-nowrap">
            Project Aether
          </p>
          <img alt="" src={imgSatellite} className="w-[28px] h-[28px]" />
          <motion.div
            className="w-[10px] h-[10px] rounded-full ml-[4px]"
            style={{ background: connected ? '#00ff88' : '#ff4444' }}
            animate={{ opacity: connected ? [1,0.5,1] : 1 }}
            transition={{ duration:1.5, repeat: connected ? Infinity : 0 }}
            title={connected ? 'Backend connected' : 'Disconnected'}
          />
        </div>

        {/* Satellite tabs */}
        <div className="absolute left-[299px] top-[28px] right-[400px]">
          <SatelliteTabs
            satellites={activeTabs}
            activeSatelliteId={selectedId}
            onSelectSatellite={setSelectedId}
            onCloseSatellite={() => {}}
            onAddSatellite={() => {}}
          />
        </div>

        {/* Top stats */}
        <div className="absolute flex gap-[32px] items-center right-[30px] top-[20px]">
          {[
            { icon: imgSatellite, label:'Satellites', value: String(counts.satellites).padStart(2,'0'), img:true },
            { label:'Debris',    value: String(counts.debris).padStart(2,'0'),    color:'#D9D9D9' },
            { icon: imgWarning,  label:'Alerts',      value: String(counts.at_risk).padStart(2,'0'), img:true, alert: counts.at_risk > 0 },
          ].map((item, i) => (
            <div key={i} className="flex gap-[10px] items-center">
              <div className="w-[28px] h-[28px] flex items-center justify-center">
                {item.img ? (
                  <motion.img src={(item as any).icon} className="w-full h-full"
                    animate={(item as any).alert ? { opacity:[1,0.5,1] } : {}}
                    transition={{ duration:1, repeat: Infinity }} />
                ) : (
                  <svg viewBox="0 0 28 28" className="w-full h-full">
                    <circle cx="14" cy="14" r="14" fill={(item as any).color || '#888'} />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-[#d2d2d2] text-[16px] font-['SF_Compact_Rounded:Regular',sans-serif]">{item.label}</p>
                <p className={`text-[18px] font-['SF_Compact_Rounded:Regular',sans-serif] ${(item as any).alert ? 'text-[#ff4444]' : 'text-white'}`}>
                  {item.value}
                </p>
              </div>
            </div>
          ))}
          {/* IST clock */}
          <div className="flex gap-[10px] items-center">
            <div className="w-[28px] h-[28px]">
              <svg viewBox="0 0 27 29" fill="none" className="w-full h-full">
                <path d={svgPaths.p3cc36df0} fill="white" />
              </svg>
            </div>
            <div>
              <p className="text-[#d2d2d2] text-[16px] font-['SF_Compact_Rounded:Regular',sans-serif]">IST Time</p>
              <p className="text-white text-[18px] font-['SF_Compact_Rounded:Regular',sans-serif]">{istTime}</p>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="absolute h-px bg-[#606060] left-[31px] right-[31px] top-[70px]" />

        {/* Globe */}
        <GlobeView satellites={tableRows} debrisList={debrisList} selectedId={selectedId} onSelect={setSelectedId} />

        {/* Bullseye Radar — shows selected satellite */}
        <BullseyeRadar satellite={selectedSat} debrisList={debrisList} />

        {/* Satellite Table */}
        <div className="absolute left-[31px] top-[758px] w-[1333px]">
          <p className="absolute font-['Azeret_Mono:Regular',sans-serif] text-[12px] text-white left-[16px] top-[10px]">Satellites</p>
          <div className="absolute h-px bg-[#606060] left-0 right-0 top-[37px]" />

          {/* Header */}
          <div className="absolute grid left-0 right-0 top-[37px] h-[32px] items-center px-[20px] text-[#777] text-[13px]"
            style={{ gridTemplateColumns:'2fr 0.8fr 0.8fr 1fr 1fr 1fr 1fr 1.2fr 0.8fr' }}>
            {['Satellite','Az','El','Altitude','Latitude','Longitude','Velocity','Propellant','Debris'].map(h=>(
              <p key={h} className="font-['SF_Compact_Rounded:Regular',sans-serif] truncate">{h}</p>
            ))}
          </div>

          {/* Rows */}
          {tableRows.length === 0 ? (
            <div className="absolute left-0 right-0 top-[69px] h-[32px] flex items-center px-[20px]">
              <p className="text-[#444] text-[13px]">Waiting for telemetry from backend...</p>
            </div>
          ) : (
            tableRows.map((sat, i) => {
              const isSelected = sat.id === selectedId;
              const isAtRisk   = sat.status==='AT_RISK'||sat.status==='MANEUVERING';
              return (
                <motion.div key={sat.id}
                  className="absolute grid left-0 right-0 h-[32px] items-center px-[20px] cursor-pointer text-[13px]"
                  style={{
                    top: `${69+i*33}px`,
                    gridTemplateColumns:'2fr 0.8fr 0.8fr 1fr 1fr 1fr 1fr 1.2fr 0.8fr',
                    background: isSelected ? 'rgba(58,127,255,0.12)' : 'transparent',
                    borderLeft: isSelected ? '2px solid #3a7fff' : '2px solid transparent',
                    color: isAtRisk ? '#ff9944' : 'white',
                  }}
                  onClick={() => setSelectedId(sat.id)}
                  whileHover={{ backgroundColor:'rgba(255,255,255,0.04)' }}
                  transition={{ duration:0.15 }}>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.name}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.az}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.el}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.altitude}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.latitude}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.longitude}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.velocity}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.propellant}</p>
                  <p className="truncate font-['SF_Compact_Rounded:Regular',sans-serif]">{sat.debris}</p>
                </motion.div>
              );
            })
          )}
        </div>

        {/* Telemetry Log */}
        <div className="absolute left-[31px] top-[920px] w-[1333px]">
          <TelemetryLog selectedSatellite={selectedSat} />
        </div>

        {/* Right panels */}
        <TelemetryStatsPanel satellite={selectedSat} />
        <AlertPanel satellites={tableRows} />
      </div>
    </Tooltip.Provider>
  );
}