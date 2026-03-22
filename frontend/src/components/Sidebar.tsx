import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SatelliteTabs } from './SatelliteTabs';
import { TelemetryLog } from './TelemetryLog';
import imgFrame2 from "../../assets/9394663ed06f79040e5fccebf1cd472a901e3df0.png";
import imgFrame3 from "../../assets/earth_globe.jpg";
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

// ── Canvas Globe — true Y-axis Earth rotation ─────────────────────────────────
function GlobeCanvas({ cx, cy, radius, textureSrc }: {
  cx: number; cy: number; radius: number; textureSrc: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef    = useRef<HTMLImageElement | null>(null);
  const offsetRef = useRef(0);
  const rafRef    = useRef<number>(0);
  const D = radius * 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = textureSrc;
    imgRef.current = img;

    const draw = () => {
      // Decrease offset → texture scrolls right, globe appears to spin left-to-right
      offsetRef.current = (offsetRef.current - (D * 2) / (60 * 60) + D * 2) % (D * 2);
      const off = offsetRef.current;

      ctx.clearRect(0, 0, D + 20, D + 20);

      ctx.save();
      ctx.beginPath();
      ctx.arc(radius + 10, radius + 10, radius, 0, Math.PI * 2);
      ctx.clip();

      if (img.complete && img.naturalWidth > 0) {
        const tw = D * 2;
        const th = D;
        ctx.drawImage(img, 10 - off,          10, tw, th);
        ctx.drawImage(img, 10 + tw - off,      10, tw, th);
        ctx.drawImage(img, 10 - tw - off + tw, 10, tw, th);
      } else {
        ctx.fillStyle = "#0a1628";
        ctx.fillRect(0, 0, D + 20, D + 20);
      }

      // Terminator — thin night crescent on left edge only, globe mostly fully lit
      const cx2 = radius + 10;
      const cy2 = radius + 10;

      // Main shadow: darkens only the left rim, fades quickly toward center
      const shadow = ctx.createRadialGradient(
      cx2 * 1.45, cy2, radius * 0.1,   // light source on RIGHT ✅
      cx2 * 1.4,  cy2, radius * 1.02   // bring darkness closer to LEFT EDGE
      );
      shadow.addColorStop(0,    "rgba(0,0,0,0)");
      shadow.addColorStop(0.55, "rgba(0,0,0,0)");
      shadow.addColorStop(0.72, "rgba(0,0,10,0.30)");
      shadow.addColorStop(0.87, "rgba(0,0,15,0.68)");
      shadow.addColorStop(1,    "rgba(0,0,20,0.90)");
      ctx.fillStyle = shadow;
      ctx.fillRect(0, 0, D + 20, D + 20);

      // Specular highlight — top-right, light source from east
      const spec = ctx.createRadialGradient(
        (radius + 10) * 1.62, (radius + 10) * 0.32, 0,
        (radius + 10) * 1.62, (radius + 10) * 0.32, radius * 0.48
      );
      spec.addColorStop(0,   "rgba(200,220,255,0.10)");
      spec.addColorStop(0.3, "rgba(180,200,255,0.04)");
      spec.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, D + 20, D + 20);

      // Edge darkening — strong dark rim
      // const edge = ctx.createRadialGradient(radius+10, radius+10, radius * 0.65, radius+10, radius+10, radius);
      // edge.addColorStop(0,    "rgba(0,0,8,0)");
      // edge.addColorStop(0.6,  "rgba(0,0,8,0.10)");
      // edge.addColorStop(1,    "rgba(0,0,8,0.82)");
      // ctx.fillStyle = edge;
      // ctx.fillRect(0, 0, D + 20, D + 20);
      const edge = ctx.createRadialGradient(
        radius+10, radius+10, radius * 0.85,
        radius+10, radius+10, radius
      );
      edge.addColorStop(0,   "rgba(0,0,0,0)");
      edge.addColorStop(1,   "rgba(0,0,0,0.25)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, D + 20, D + 20);

      ctx.restore();

      // Atmosphere rim — vivid thin blue ring around entire globe edge
      // Atmosphere — OUTWARD glow (correct NASA style)
      const atmo = ctx.createRadialGradient(
        radius+10, radius+10, radius * 0.98,   // start EXACTLY at edge
        radius+10, radius+10, radius * 1.08    // expand OUTWARD
      );

      atmo.addColorStop(0,    "rgba(80,140,255,0.0)");  // no glow inside
      atmo.addColorStop(0.1,  "rgba(80,140,255,0.6)");  // strong rim
      atmo.addColorStop(0.25, "rgba(60,120,255,0.8)");  // peak glow
      atmo.addColorStop(0.45, "rgba(50,100,255,0.5)");  // fading
      atmo.addColorStop(0.7,  "rgba(30,70,220,0.25)");  // soft fade
      atmo.addColorStop(1,    "rgba(0,0,0,0)");         // fully gone

      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(radius+10, radius+10, radius * 1.25, 0, Math.PI * 2);
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    img.onload  = () => { rafRef.current = requestAnimationFrame(draw); };
    img.onerror = () => { rafRef.current = requestAnimationFrame(draw); };

    return () => cancelAnimationFrame(rafRef.current);
  }, [textureSrc, D, radius]);

  const size = D + 20;
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        position: "absolute",
        left: cx - radius - 10,
        top:  cy - radius - 10,
        pointerEvents: "none",
      }}
    />
  );
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 900, h: 500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        setDims({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const CX = dims.w * 0.45;
  const CY = dims.h * 0.50;
  const GLOBE_R = Math.min(dims.w * 0.28, dims.h * 0.42, 200);

  const satColors: Record<string, string> = {
    NOMINAL:     '#3a7fff',
    AT_RISK:     '#ff8800',
    MANEUVERING: '#ff4444',
    RECOVERING:  '#00ff88',
  };

  return (
    <div ref={containerRef} style={{ position: 'absolute', inset: 0, borderRadius: 5 }}>
      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
        <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
      </div>

      <div className="overflow-clip relative rounded-[inherit] size-full">
        {/* Rotating Globe — canvas-based horizontal scroll (true Y-axis Earth spin) */}
        <GlobeCanvas cx={CX} cy={CY} radius={165} textureSrc={imgFrame3} />

        {/* Orbit path — positioned relative to globe center */}
        <motion.div className="absolute" style={{ left: CX - 155, top: CY - 161, width: 260, height: 218 }}
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
            style={{ bottom: `${70 + i*23}px` }}>
            <div className="h-[2px] rounded w-[24px]" style={{ background:color }} />
            <p className="text-white text-[12px] font-['SF_Compact_Rounded:Regular',sans-serif]">{label}</p>
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

// ── Inline panel variants (sized for 320px right column) ─────────────────────
function BullseyeRadarInline({ satellite, debrisList }: {
  satellite: Satellite | undefined;
  debrisList: {id:string; r:number[]}[];
}) {
  const CX = 210, CY = 205, R = 178;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 14px', background: '#08090f', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <motion.div style={{ width: 7, height: 7, borderRadius: '50%', background: '#3a7fff', flexShrink: 0 }}
          animate={{ opacity:[1,0.2,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: '#3a7fff', fontSize: 10, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          BULLSEYE — {satellite?.name ?? 'NO TARGET'}
        </p>
      </div>
      <svg viewBox="0 0 420 410" style={{ width: '100%', flex: 1, minHeight: 0, display: 'block' }}>
        {[R, R*0.75, R*0.5, R*0.25].map((r, i) => (
          <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="#1a2d4a" strokeWidth={i===0?1.5:1} opacity={0.8} />
        ))}
        <line x1={CX-R-18} y1={CY} x2={CX+R+18} y2={CY} stroke="#1a2d4a" strokeWidth="0.8" />
        <line x1={CX} y1={CY-R-18} x2={CX} y2={CY+R+18} stroke="#1a2d4a" strokeWidth="0.8" />
        {[['N',CX-5,CY-R-20],['S',CX-4,CY+R+26],['W',CX-R-26,CY+5],['E',CX+R+10,CY+5]].map(([d,x,y])=>(
          <text key={d as string} x={x as number} y={y as number} fill="#3a5070" fontSize="12" fontFamily="Azeret Mono, monospace" fontWeight="600">{d}</text>
        ))}
        {[['50km',CX+4,CY-R*0.25-4],['100km',CX+4,CY-R*0.5-4],['200km',CX+4,CY-R-4]].map(([l,x,y])=>(
          <text key={l as string} x={x as number} y={y as number} fill="#2a3d55" fontSize="9" fontFamily="Azeret Mono, monospace">{l}</text>
        ))}
        <motion.line x1={CX} y1={CY} x2={CX+R} y2={CY} stroke="#3a7fff" strokeWidth="1.5" opacity="0.8"
          style={{ transformOrigin: `${CX}px ${CY}px` }}
          animate={{ rotate: 360 }} transition={{ duration: 3, repeat: Infinity, ease: 'linear' }} />
        <circle cx={CX} cy={CY} r="6" fill="#3a7fff" opacity="0.25" />
        <image href={imgSatellite} x={CX-10} y={CY-10} width="20" height="20" />
        {satellite && debrisList.map((deb) => {
          if (!deb.r || deb.r.length < 3 || !satellite.r || satellite.r.length < 3) return null;
          const dx = deb.r[0]-satellite.r[0], dy = deb.r[1]-satellite.r[1], dz = deb.r[2]-satellite.r[2];
          const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (dist > 500) return null;
          const sc = R / 200;
          const rx = CX + dx*sc*0.5, ry = CY - dz*sc*0.5;
          if (rx<10||rx>410||ry<10||ry>400) return null;
          const close = dist < 50;
          return (
            <g key={deb.id}>
              {close && <circle cx={rx} cy={ry} r="9" fill="#ff4444" opacity="0.15" />}
              <motion.circle cx={rx} cy={ry} r={close?5:3.5} fill={close?'#ff4444':'#4a6080'}
                animate={{ opacity: close?[1,0.3,1]:[0.5,0.9,0.5] }}
                transition={{ duration: close?0.8:2.5, repeat:Infinity }} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function TelemetryStatsPanelInline({ satellite }: { satellite: Satellite | undefined }) {
  const sat = satellite;
  const fuelPct = sat?.fuelPct ?? 0;
  const isAtRisk = sat?.status === 'AT_RISK' || sat?.status === 'MANEUVERING';
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 14px', background: '#08090f', boxSizing: 'border-box', borderTop: '1px solid #12182a' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={isAtRisk?'#ff4444':'#00ff88'} strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <p style={{ color: 'white', fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', letterSpacing: 0.3 }}>
          Telemetry: {sat?.name ?? 'SAT — 001'}
        </p>
        {isAtRisk && <span style={{ marginLeft: 'auto', fontSize: 9, background: 'rgba(255,68,68,0.15)', border: '1px solid #ff4444', color: '#ff4444', padding: '2px 7px', borderRadius: 3, fontWeight: 700, flexShrink: 0, letterSpacing: 0.5 }}>{sat?.status}</span>}
      </div>
      {/* Stats grid — label top, value below */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 8px', flex: 1 }}>
        {[
          ['Latitude',   sat?.latitude??'—'],
          ['Longitude',  sat?.longitude??'—'],
          ['Propellant', sat?.propellant??'—'],
          ['Altitude',   sat?.altitude??'—'],
          ['Velocity',   sat?.velocity??'—'],
          ['Debris',     sat?.debris??'—'],
        ].map(([label,value])=>(
          <div key={label} style={{ background: '#0b0d18', borderRadius: 4, padding: '6px 8px', border: '1px solid #12182a' }}>
            <p style={{ color: '#3a4a60', fontSize: 9, marginBottom: 3, fontFamily: 'Azeret Mono, monospace', letterSpacing: 0.5 }}>{label}</p>
            <p style={{ fontSize: 12, color: label==='Debris'&&sat?.debris&&sat.debris!=='—'?'#ff8800':'#e8e8e8', fontWeight: 600, fontFamily: 'Azeret Mono, monospace' }}>{value}</p>
          </div>
        ))}
      </div>
      {/* Fuel bar */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <p style={{ color: '#3a4a60', fontSize: 9, fontFamily: 'Azeret Mono, monospace', letterSpacing: 0.5 }}>Fuel Remaining</p>
          <p style={{ color: '#e8e8e8', fontSize: 10, fontWeight: 600, fontFamily: 'Azeret Mono, monospace' }}>{fuelPct.toFixed(0)}%</p>
        </div>
        <div style={{ height: 4, background: '#12182a', borderRadius: 2, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', borderRadius: 2, background: fuelPct>50?'linear-gradient(to right,#00ff88,#00cc66)':fuelPct>20?'linear-gradient(to right,#ff8800,#ffaa00)':'linear-gradient(to right,#ff4444,#ff8800)' }}
            animate={{ width:`${fuelPct}%` }} transition={{ duration:1, ease:'easeOut' }} />
        </div>
      </div>
    </div>
  );
}

function AlertPanelInline({ satellites }: { satellites: Satellite[] }) {
  const atRisk = satellites.filter(s => s.status==='AT_RISK'||s.status==='MANEUVERING');
  const alert = atRisk[0];
  // Generate a fake alert number for display
  const alertNum = alert ? String(Math.abs(alert.name.charCodeAt(alert.name.length-1) % 20)).padStart(3,'0') : '000';
  return (
    <motion.div style={{ height: '100%', padding: '12px 14px', background: '#08090f', borderTop: `1px solid ${alert?'rgba(255,68,66,0.3)':'#12182a'}`, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8 }}
      animate={{ boxShadow: alert?['0 0 8px rgba(255,68,66,0.1)','0 0 16px rgba(255,68,66,0.25)','0 0 8px rgba(255,68,66,0.1)']:'none' }}
      transition={{ duration:2, repeat: alert?Infinity:0 }}>
      {/* Alert header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: alert?'#ff6644':'#00ff88', fontSize: 12, fontWeight: 700, letterSpacing: 0.3 }}>
          {alert ? `Alert #${alertNum}` : '✓ All Systems Nominal'}
        </p>
        <div style={{ background: alert?'rgba(255,68,68,0.15)':'rgba(0,255,136,0.1)', border: `1px solid ${alert?'#ff4444':'#00ff88'}`, borderRadius: 3, padding: '2px 8px' }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: alert?'#ff4444':'#00ff88', letterSpacing: 1 }}>{alert?'High Risk':'NOMINAL'}</p>
        </div>
      </div>
      {alert ? (
        <>
          {/* Alert detail table */}
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', fontSize: 11 }}>
            <p style={{ color: '#3a4a60', fontFamily: 'Azeret Mono, monospace', fontSize: 10 }}>Satellite:</p>
            <p style={{ color: '#e8e8e8', fontFamily: 'Azeret Mono, monospace', fontSize: 10 }}>{alert.name}</p>
            <p style={{ color: '#3a4a60', fontFamily: 'Azeret Mono, monospace', fontSize: 10 }}>Debris:</p>
            <p style={{ color: '#e8e8e8', fontFamily: 'Azeret Mono, monospace', fontSize: 10 }}>{alert.debris ?? 'DEB-' + alertNum}</p>
          </div>
          {/* TCA row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto', paddingTop: 4, borderTop: '1px solid #12182a' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff4444', flexShrink: 0 }} />
            <p style={{ color: '#3a4a60', fontSize: 10, fontFamily: 'Azeret Mono, monospace' }}>TCA</p>
            <p style={{ color: '#ff8866', fontSize: 10, fontFamily: 'Azeret Mono, monospace', marginLeft: 'auto' }}>
              {new Date().toTimeString().slice(0,8)}
            </p>
          </div>
          {atRisk.length > 1 && (
            <p style={{ color: '#ff8800', fontSize: 9, fontFamily: 'Azeret Mono, monospace' }}>+{atRisk.length-1} more at risk</p>
          )}
        </>
      ) : (
        <p style={{ color: '#2a3040', fontSize: 11, fontFamily: 'Azeret Mono, monospace' }}>No active conjunction threats.</p>
      )}
    </motion.div>
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
      {/* ── ROOT: fills parent App container ── */}
      <div style={{
        background: '#03020e',
        width: '100%',
        minHeight: '100vh', 
        gridTemplateRows: '48px 500px 200px',
        display: 'grid',
        gridTemplateColumns: '1fr 38%',
        fontFamily: 'SF Compact Rounded, sans-serif',
        boxSizing: 'border-box',
      }}>

        {/* ══ ROW 1: HEADER ══ */}
        <div style={{
          gridRow: 1,
          gridColumn: '1 / 3',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          borderBottom: '1px solid #1e1e30',
          padding: '0 16px',
          gap: 12,
          background: '#06060f',
        }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ color: 'white', fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}>Project Aether</p>
            <img alt="" src={imgSatellite} style={{ width: 18, height: 18 }} />
            <motion.div
              style={{ width: 7, height: 7, borderRadius: '50%', background: connected ? '#00ff88' : '#ff4444' }}
              animate={{ opacity: connected ? [1, 0.4, 1] : 1 }}
              transition={{ duration: 1.5, repeat: connected ? Infinity : 0 }}
              title={connected ? 'Backend connected' : 'Disconnected'}
            />
          </div>

          {/* Satellite tabs */}
          <div style={{ overflow: 'hidden', minWidth: 0 }}>
            <SatelliteTabs
              satellites={activeTabs}
              activeSatelliteId={selectedId}
              onSelectSatellite={setSelectedId}
              onCloseSatellite={() => {}}
              onAddSatellite={() => {}}
            />
          </div>

          {/* Stats + clock */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            {[
              { icon: imgSatellite, label: 'Satellites', value: String(counts.satellites).padStart(2,'0'), img: true },
              { label: 'Debris',    value: String(counts.debris).padStart(2,'0'), color: '#D9D9D9' },
              { icon: imgWarning,   label: 'Alerts',     value: String(counts.at_risk).padStart(2,'0'), img: true, alert: counts.at_risk > 0 },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                <div style={{ width: 20, height: 20 }}>
                  {item.img ? (
                    <motion.img src={(item as any).icon} style={{ width: '100%', height: '100%' }}
                      animate={(item as any).alert ? { opacity:[1,0.5,1] } : {}}
                      transition={{ duration:1, repeat: Infinity }} />
                  ) : (
                    <svg viewBox="0 0 20 20" style={{ width: '100%', height: '100%' }}>
                      <circle cx="10" cy="10" r="10" fill={(item as any).color || '#888'} />
                    </svg>
                  )}
                </div>
                <div>
                  <p style={{ color: '#888', fontSize: 10, lineHeight: 1 }}>{item.label}</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: (item as any).alert ? '#ff4444' : 'white', lineHeight: 1.3 }}>{item.value}</p>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <svg viewBox="0 0 27 29" fill="none" style={{ width: 20, height: 20 }}>
                <path d={svgPaths.p3cc36df0} fill="white" />
              </svg>
              <div>
                <p style={{ color: '#888', fontSize: 10, lineHeight: 1 }}>IST Time</p>
                <p style={{ color: 'white', fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{istTime}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ══ ROW 2: GLOBE (left column only) ══ */}
        <div style={{
          gridRow: 2,
          gridColumn: 1,
          position: 'relative',
          overflow: 'hidden',
          borderRight: '1px solid #1a1a2e',
        }}>
          <GlobeView satellites={tableRows} debrisList={debrisList} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {/* ══ RIGHT COLUMN: spans ROW 2 + ROW 3 ══ */}
        <div style={{
          gridRow: '2 / 4',
          gridColumn: 2,
          display: 'grid',
          gridTemplateRows: '3fr 1fr 1fr',
          overflow: 'hidden',
          background: '#07070f',
          borderLeft: '1px solid #1a1a2e',
        }}>
          {/* Bullseye Radar */}
          <div style={{ overflow: 'hidden', borderBottom: '1px solid #1a1a2e' }}>
            <BullseyeRadarInline satellite={selectedSat} debrisList={debrisList} />
          </div>
          {/* Telemetry Stats */}
          <div style={{ overflow: 'hidden', borderBottom: '1px solid #1a1a2e' }}>
            <TelemetryStatsPanelInline satellite={selectedSat} />
          </div>
          {/* Alert Panel */}
          <div style={{ overflow: 'hidden' }}>
            <AlertPanelInline satellites={tableRows} />
          </div>
        </div>

        {/* ══ ROW 3: SATELLITE TABLE + TELEMETRY LOG (left column only) ══ */}
        <div style={{
          gridRow: 3,
          gridColumn: 1,
          display: 'grid',
          gridTemplateRows: '24px 26px 1fr 80px',  
          borderTop: '1px solid #1e1e30',
          overflow: 'hidden',
          background: '#05050e',
        }}>
          {/* Section label */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid #151522' }}>
            <p style={{ color: '#555', fontSize: 10, fontFamily: 'Azeret Mono, monospace', letterSpacing: 2 }}>SATELLITES</p>
          </div>

          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 0.6fr',
            alignItems: 'center',
            padding: '0 16px',
            borderBottom: '1px solid #151522',
          }}>
            {['Satellite','Az','El','Altitude','Latitude','Longitude','Velocity','Propellant','Debris'].map(h => (
              <p key={h} style={{ color: '#444', fontSize: 10, fontFamily: 'Azeret Mono, monospace', letterSpacing: 0.5 }}>{h}</p>
            ))}
          </div>

          {/* Table rows */}
          <div style={{ overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2a2a3a #05050e' }}>
            {tableRows.length === 0 ? (
              <p style={{ color: '#2a2a3a', fontSize: 11, padding: '6px 16px' }}>Waiting for telemetry from backend...</p>
            ) : (
              tableRows.map((sat) => {
                const isSelected = sat.id === selectedId;
                const isAtRisk   = sat.status === 'AT_RISK' || sat.status === 'MANEUVERING';
                return (
                  <motion.div key={sat.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 0.6fr',
                      alignItems: 'center',
                      padding: '3px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(58,127,255,0.09)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #3a7fff' : '2px solid transparent',
                      color: isAtRisk ? '#ff9944' : '#e0e0e0',
                      fontSize: 11,
                    }}
                    onClick={() => setSelectedId(sat.id)}
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    {[sat.name,sat.az,sat.el,sat.altitude,sat.latitude,sat.longitude,sat.velocity,sat.propellant,sat.debris].map((v, j) => (
                      <p key={j} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</p>
                    ))}
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Telemetry log strip */}
          <div style={{ borderTop: '1px solid #151522', overflow: 'visible' }}>
            <TelemetryLog selectedSatellite={selectedSat} />
          </div>
        </div>

      </div>
    </Tooltip.Provider>
  );
}