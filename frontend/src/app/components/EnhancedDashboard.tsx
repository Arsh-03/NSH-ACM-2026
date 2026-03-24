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
  const rn  = r.map(x => x / norm3(r));
  const lat = Math.asin(Math.max(-1, Math.min(1, rn[2])));
  const lon = Math.atan2(rn[1], rn[0]);
  const px  = cx + radius * Math.cos(lat) * Math.cos(lon);
  const py  = cy - radius * Math.sin(lat);
  return { px, py, lat, lon };
}

// ── Az/El from ISTRAC Bengaluru (GS-001) ─────────────────────────────────────
const GS_LAT = 13.0333 * Math.PI / 180;
const GS_LON = 77.5167 * Math.PI / 180;
const GS_ALT = 0.820;

function getAzEl(satR: number[]): { az: string; el: string } {
  const RE = 6378.137;
  const gsX = (RE+GS_ALT)*Math.cos(GS_LAT)*Math.cos(GS_LON);
  const gsY = (RE+GS_ALT)*Math.cos(GS_LAT)*Math.sin(GS_LON);
  const gsZ = (RE+GS_ALT)*Math.sin(GS_LAT);

  const rx = satR[0]-gsX, ry = satR[1]-gsY, rz = satR[2]-gsZ;
  const rangeMag = Math.sqrt(rx*rx+ry*ry+rz*rz);

  const sinLat=Math.sin(GS_LAT), cosLat=Math.cos(GS_LAT);
  const sinLon=Math.sin(GS_LON), cosLon=Math.cos(GS_LON);

  const ex=-sinLon,   ey=cosLon,            ez=0;
  const nx=-sinLat*cosLon, ny=-sinLat*sinLon, nz=cosLat;
  const zx= cosLat*cosLon, zy= cosLat*sinLon, zz=sinLat;

  const E=rx*ex+ry*ey+rz*ez;
  const N=rx*nx+ry*ny+rz*nz;
  const Z=rx*zx+ry*zy+rz*zz;

  const elDeg=(Math.asin(Z/rangeMag))*180/Math.PI;
  if (elDeg < 0) return { az:'—', el:'—' };

  let azDeg=Math.atan2(E,N)*180/Math.PI;
  if (azDeg<0) azDeg+=360;
  return { az:azDeg.toFixed(1), el:elDeg.toFixed(1) };
}

function countNearbyDebris(satR: number[], debrisList: {r:number[]}[]): number {
  return debrisList.filter(d => {
    if (!d.r||d.r.length<3) return false;
    const dx=d.r[0]-satR[0], dy=d.r[1]-satR[1], dz=d.r[2]-satR[2];
    return Math.sqrt(dx*dx+dy*dy+dz*dz) < 500;
  }).length;
}

function satToRow(sat: LiveSat, debrisList: {id:string;r:number[];v:number[]}[] = []): Satellite {
  const RE   = 6378.137;
  const alt  = norm3(sat.r) - RE;
  const vel  = norm3(sat.v);
  const rn   = sat.r.map(x => x / norm3(sat.r));
  const lat  = Math.asin(Math.max(-1,Math.min(1,rn[2])))*180/Math.PI;
  const lon  = Math.atan2(rn[1],rn[0])*180/Math.PI;
  const fuelPct = Math.min(100,(sat.fuel/50)*100);
  const { az, el } = getAzEl(sat.r);
  const nearbyDebris = countNearbyDebris(sat.r, debrisList);
  return {
    id: sat.id, name: sat.id,
    az, el,
    altitude:   `${alt.toFixed(1)} km`,
    latitude:   `${lat.toFixed(4)}°`,
    longitude:  `${lon.toFixed(4)}°`,
    velocity:   `${vel.toFixed(2)} km/s`,
    propellant: `${sat.fuel.toFixed(2)} kg`,
    debris:     String(nearbyDebris),
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

// ── Canvas Globe ──────────────────────────────────────────────────────────────
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
      offsetRef.current = (offsetRef.current - (D * 2) / (60 * 60) + D * 2) % (D * 2);
      const off = offsetRef.current;
      ctx.clearRect(0, 0, D + 20, D + 20);
      ctx.save();
      ctx.beginPath();
      ctx.arc(radius + 10, radius + 10, radius, 0, Math.PI * 2);
      ctx.clip();

      if (img.complete && img.naturalWidth > 0) {
        const tw = D * 2, th = D;
        ctx.drawImage(img, 10 - off,          10, tw, th);
        ctx.drawImage(img, 10 + tw - off,      10, tw, th);
        ctx.drawImage(img, 10 - tw - off + tw, 10, tw, th);
      } else {
        ctx.fillStyle = "#0a1628";
        ctx.fillRect(0, 0, D + 20, D + 20);
      }

      const shadow = ctx.createRadialGradient(
        (radius+10)*1.45, radius+10, radius*0.1,
        (radius+10)*1.4,  radius+10, radius*1.02
      );
      shadow.addColorStop(0,    "rgba(0,0,0,0)");
      shadow.addColorStop(0.55, "rgba(0,0,0,0)");
      shadow.addColorStop(0.72, "rgba(0,0,10,0.30)");
      shadow.addColorStop(0.87, "rgba(0,0,15,0.68)");
      shadow.addColorStop(1,    "rgba(0,0,20,0.90)");
      ctx.fillStyle = shadow;
      ctx.fillRect(0, 0, D + 20, D + 20);

      const spec = ctx.createRadialGradient(
        (radius+10)*1.62, (radius+10)*0.32, 0,
        (radius+10)*1.62, (radius+10)*0.32, radius*0.48
      );
      spec.addColorStop(0,   "rgba(200,220,255,0.10)");
      spec.addColorStop(0.3, "rgba(180,200,255,0.04)");
      spec.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = spec;
      ctx.fillRect(0, 0, D + 20, D + 20);

      const edge = ctx.createRadialGradient(radius+10, radius+10, radius*0.85, radius+10, radius+10, radius);
      edge.addColorStop(0, "rgba(0,0,0,0)");
      edge.addColorStop(1, "rgba(0,0,0,0.25)");
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, D + 20, D + 20);
      ctx.restore();

      const atmo = ctx.createRadialGradient(
        radius+10, radius+10, radius*0.98,
        radius+10, radius+10, radius*1.08
      );
      atmo.addColorStop(0,    "rgba(80,140,255,0.0)");
      atmo.addColorStop(0.1,  "rgba(80,140,255,0.6)");
      atmo.addColorStop(0.25, "rgba(60,120,255,0.8)");
      atmo.addColorStop(0.45, "rgba(50,100,255,0.5)");
      atmo.addColorStop(0.7,  "rgba(30,70,220,0.25)");
      atmo.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = atmo;
      ctx.beginPath();
      ctx.arc(radius+10, radius+10, radius*1.25, 0, Math.PI*2);
      ctx.fill();

      rafRef.current = requestAnimationFrame(draw);
    };

    img.onload  = () => { rafRef.current = requestAnimationFrame(draw); };
    img.onerror = () => { rafRef.current = requestAnimationFrame(draw); };
    return () => cancelAnimationFrame(rafRef.current);
  }, [textureSrc, D, radius]);

  const size = D + 20;
  return (
    <canvas ref={canvasRef} width={size} height={size}
      style={{ position:"absolute", left:cx-radius-10, top:cy-radius-10, pointerEvents:"none" }} />
  );
}

// ── Globe View ────────────────────────────────────────────────────────────────
function GlobeView({ satellites, debrisList, selectedId, onSelect }: {
  satellites: Satellite[];
  debrisList: {id:string; r:number[]}[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w:900, h:500 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(entries => {
      for (const e of entries) setDims({ w:e.contentRect.width, h:e.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const CX = dims.w * 0.45;
  const CY = dims.h * 0.50;
  const GLOBE_R = Math.min(dims.w*0.28, dims.h*0.42, 200);

  const satColors: Record<string,string> = {
    NOMINAL:'#3a7fff', AT_RISK:'#ff8800', MANEUVERING:'#ff4444', RECOVERING:'#00ff88',
  };

  return (
    <div ref={containerRef} style={{ position:'absolute', inset:0, borderRadius:5 }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
        <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
      </div>

      <div className="overflow-clip relative rounded-[inherit] size-full">
        <GlobeCanvas cx={CX} cy={CY} radius={165} textureSrc={imgFrame3} />

        {/* Orbit path */}
        <motion.div className="absolute" style={{ left:CX-155, top:CY-161, width:260, height:218 }}
          animate={{ opacity:[0.6,1,0.6] }} transition={{ duration:3, repeat:Infinity }}>
          <svg className="block size-full" fill="none" viewBox="0 0 259.946 217.681">
            <path d={svgPaths.p3420b500} stroke="#9747FF" strokeWidth="2" />
          </svg>
        </motion.div>

        {/* Satellites */}
        {satellites.map((sat, i) => {
          const { px, py } = eciToGlobe(sat.r, CX, CY, GLOBE_R+40);
          const isSelected = sat.id === selectedId;
          const color      = satColors[sat.status] || '#3a7fff';
          const isAtRisk   = sat.status==='AT_RISK'||sat.status==='MANEUVERING';
          return (
            <Tooltip.Root key={sat.id}>
              <Tooltip.Trigger asChild>
                <motion.div className="absolute cursor-pointer"
                  style={{ left:px-14, top:py-14, width:28, height:28, zIndex:isSelected?20:10 }}
                  onClick={() => onSelect(sat.id)}
                  animate={{ filter:[`drop-shadow(0 0 ${isAtRisk?6:4}px ${color})`,`drop-shadow(0 0 ${isAtRisk?14:10}px ${color})`,`drop-shadow(0 0 ${isAtRisk?6:4}px ${color})`] }}
                  transition={{ duration:isSelected?1:2, repeat:Infinity, delay:i*0.15 }}
                  whileHover={{ scale:1.4 }}>
                  <img alt={sat.id} className="size-full object-contain pointer-events-none"
                    src={imgSatellite}
                    style={{ filter:isSelected?`brightness(1.5) drop-shadow(0 0 8px ${color})`:`brightness(0.8) hue-rotate(${i*30}deg)` }} />
                  {isSelected && (
                    <motion.div className="absolute rounded-full border-2"
                      style={{ inset:-6, borderColor:color }}
                      animate={{ scale:[1,1.2,1], opacity:[0.8,0.4,0.8] }}
                      transition={{ duration:1.5, repeat:Infinity }} />
                  )}
                  {isAtRisk && (
                    <motion.div className="absolute rounded-full"
                      style={{ inset:-4, background:color, opacity:0.15 }}
                      animate={{ scale:[1,1.8,1], opacity:[0.15,0,0.15] }}
                      transition={{ duration:1.5, repeat:Infinity }} />
                  )}
                </motion.div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="bg-[#0b1124] border border-[#3a7fff] rounded-[6px] px-[12px] py-[8px] text-[12px] z-50" sideOffset={5}>
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

        {/* Live debris */}
        {debrisList.map((deb, i) => {
          if (!deb.r||deb.r.length<3) return null;
          const { px, py } = eciToGlobe(deb.r, CX, CY, GLOBE_R+30);
          if (px<0||px>dims.w||py<0||py>dims.h) return null;
          return (
            <Tooltip.Root key={deb.id}>
              <Tooltip.Trigger asChild>
                <motion.div className="absolute cursor-pointer"
                  style={{ left:px-7, top:py-7, width:14, height:14 }}
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
            style={{ bottom:`${70+i*23}px` }}>
            <div className="h-[2px] rounded w-[24px]" style={{ background:color }} />
            <p className="text-white text-[12px]">{label}</p>
          </div>
        ))}
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

// ── Bullseye Radar Inline ─────────────────────────────────────────────────────
function BullseyeRadarInline({ satellite, debrisList }: {
  satellite: Satellite | undefined;
  debrisList: {id:string; r:number[]}[];
}) {
  const CX = 210, CY = 205, R = 178;
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', padding:'10px 16px', margin:'10px', border:'1px solid #1a2a3a', borderRadius:'8px', background:'#0B1124', boxSizing:'border-box' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:4 }}>
        <motion.div style={{ width:6, height:6, borderRadius:'50%', background:'#3a7fff', flexShrink:0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color:'#3a7fff', fontSize:13, fontFamily:'Azeret Mono, monospace', letterSpacing:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          BULLSEYE — {satellite?.name ?? 'NO TARGET'}
        </p>
      </div>
      <svg viewBox="-60 0 480 410" style={{ width:'100%', flex:1, minHeight:0, display:'block' }}>
        {[R, R*0.75, R*0.5, R*0.25].map((r, i) => (
          <circle key={i} cx={CX} cy={CY} r={r} fill="none" stroke="#B3B3B3" strokeWidth="1" opacity={0.7} />
        ))}
        <line x1={CX-R-14} y1={CY} x2={CX+R+14} y2={CY} stroke="#B3B3B3" strokeWidth="0.7" />
        <line x1={CX} y1={CY-R-14} x2={CX} y2={CY+R+14} stroke="#B3B3B3" strokeWidth="0.7" />
        {[['N',CX-5,CY-R-16],['S',CX-5,CY+R+22],['W',CX-R-22,CY+5],['E',CX+R+8,CY+5]].map(([d,x,y])=>(
          <text key={d as string} x={x as number} y={y as number} fill="#555" fontSize="11" fontFamily="Azeret Mono, monospace">{d}</text>
        ))}
        <g>
          <line x1={CX} y1={CY} x2={CX+R} y2={CY} stroke="#3a7fff" strokeWidth="1.5" opacity="0.6">
            <animateTransform attributeName="transform" type="rotate"
              from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="3s" repeatCount="indefinite" />
          </line>
        </g>
        <image href={imgSatellite} x={CX-18} y={CY-18} width="36" height="36" />

        {/* Live debris on radar */}
        {satellite && debrisList.map((deb, idx) => {
          if (!deb.r||deb.r.length<3||!satellite.r||satellite.r.length<3) return null;
          const dx=deb.r[0]-satellite.r[0], dy=deb.r[1]-satellite.r[1], dz=deb.r[2]-satellite.r[2];
          const dist=Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (dist>5000) return null;
          const sc=R/5000;
          const rx=CX+dx*sc, ry=CY-dz*sc;
          if (rx<5||rx>415||ry<5||ry>405) return null;
          const isClose=dist<100;
          return (
            <g key={deb.id}>
              <line x1={CX} y1={CY} x2={rx} y2={ry}
                stroke={isClose?'#ff6644':'#f59e0b'} strokeWidth="0.8" opacity="0.4" strokeDasharray="3 3" />
              <circle cx={rx} cy={ry} r={isClose?5:4} fill={isClose?'#ff4444':'#f59e0b'} opacity={isClose?0.9:0.6}>
                {isClose && <animate attributeName="opacity" values="1;0.2;1" dur="0.8s" repeatCount="indefinite" />}
              </circle>
              <text x={rx+6} y={ry-4} fill={isClose?'#ff6644':'#f59e0b'} fontSize="13" fontFamily="Azeret Mono, monospace">
                {deb.id.replace('DEBRIS-','DEB-')}
              </text>
              {isClose && (
                <text x={rx+6} y={ry+8} fill="#ff6644" fontSize="9" fontFamily="Azeret Mono, monospace">
                  {dist.toFixed(0)}km
                </text>
              )}
            </g>
          );
        })}

        {/* Distance labels */}
        {[['1000km',CX+4,CY-R*0.25+5],['2500km',CX+4,CY-R*0.5+5],['5000km',CX+4,CY-R+5]].map(([l,x,y])=>(
          <text key={l as string} x={x as number} y={y as number} fill="#2a3a55" fontSize="9" fontFamily="Azeret Mono, monospace">{l}</text>
        ))}

        {/* Satellite stats overlay */}
        {satellite && (
          <g>
            <rect x="-125" y="342" width="165" height="70" rx="5" fill="#0e1b2e" opacity="0.92" />
            <text x="-36"  y="357" fill="#8892a4" fontSize="9"  fontFamily="Azeret Mono, monospace">Alt</text>
            <text x="-36"  y="370" fill="white"   fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.altitude}</text>
            <text x="-120" y="357" fill="#8892a4" fontSize="9"  fontFamily="Azeret Mono, monospace">Vel</text>
            <text x="-120" y="370" fill="white"   fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.velocity}</text>
            <text x="-36"  y="389" fill="#8892a4" fontSize="9"  fontFamily="Azeret Mono, monospace">Lat</text>
            <text x="-36"  y="402" fill="white"   fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.latitude}</text>
            <text x="-120" y="389" fill="#8892a4" fontSize="9"  fontFamily="Azeret Mono, monospace">Lon</text>
            <text x="-120" y="402" fill="white"   fontSize="12" fontFamily="Azeret Mono, monospace">{satellite.longitude}</text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Telemetry Stats Inline ────────────────────────────────────────────────────
function TelemetryStatsPanelInline({ satellite }: { satellite: Satellite | undefined }) {
  const sat=satellite, fuelPct=sat?.fuelPct??0;
  const isAtRisk=sat?.status==='AT_RISK'||sat?.status==='MANEUVERING';
  return (
    <div style={{ height:'100%', display:'flex', flexDirection:'column', padding:'8px 16px 12px 16px', margin:'10px', border:'1px solid #1a2a3a', borderRadius:'8px', background:'#0A1124', boxSizing:'border-box', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', gap:6, background:'#0E1B2E', marginBottom:10, padding:5 }}>
        <motion.div style={{ width:6, height:6, borderRadius:'50%', background:isAtRisk?'#ff4444':'#00ff88', flexShrink:0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color:'white', fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          Telemetry: {sat?.name??'— Select satellite'}
        </p>
        {isAtRisk && <span style={{ marginLeft:'auto', fontSize:9, background:'#ff4444', color:'white', padding:'2px 5px', borderRadius:3, fontWeight:700, flexShrink:0 }}>{sat?.status}</span>}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'6px 10px', marginBottom:6 }}>
        {[['Altitude',sat?.altitude??'—'],['Longitude',sat?.longitude??'—'],['Propellant',sat?.propellant??'—'],
          ['Latitude',sat?.latitude??'—'],['Velocity',sat?.velocity??'—'],['Status',sat?.status??'NOMINAL'],
        ].map(([label,value])=>(
          <div key={label}>
            <p style={{ color:'#444', fontSize:9, marginBottom:1 }}>{label}</p>
            <p style={{ fontSize:11, color:label==='Status'&&isAtRisk?'#ff4444':'white', fontWeight:500 }}>{value}</p>
          </div>
        ))}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'4px 10px', marginBottom:6 }}>
        {[['Az (ISTRAC)',sat?.az??'—'],['El (ISTRAC)',sat?.el??'—'],['Nearby Debris',sat?.debris??'0']].map(([label,value])=>(
          <div key={label}>
            <p style={{ color:'#444', fontSize:9, marginBottom:1 }}>{label}</p>
            <p style={{ fontSize:11, color:'white', fontWeight:500 }}>{value}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop:4 }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
          <p style={{ color:'#666', fontSize:10 }}>Fuel Reserve</p>
          <p style={{ color:'white', fontSize:10 }}>{fuelPct.toFixed(0)}%</p>
        </div>
        <div style={{ height:5, background:'#1a2540', borderRadius:3, overflow:'hidden' }}>
          <motion.div style={{ height:'100%', borderRadius:3, background:fuelPct>50?'linear-gradient(to right,#00ff88,#00cc66)':fuelPct>20?'linear-gradient(to right,#ff8800,#ffaa00)':'linear-gradient(to right,#ff4444,#ff8800)' }}
            animate={{ width:`${fuelPct}%` }} transition={{ duration:1, ease:'easeOut' }} />
        </div>
      </div>
    </div>
  );
}

// ── Alert Panel Inline ────────────────────────────────────────────────────────
function AlertPanelInline({ satellites }: { satellites: Satellite[] }) {
  const atRisk=satellites.filter(s=>s.status==='AT_RISK'||s.status==='MANEUVERING');
  const alert=atRisk[0];
  return (
    <motion.div style={{ height:'calc(100% - 28px)', padding:'14px 18px', margin:'10px 10px 18px 10px', border:alert?'1px solid #ff4442':'1px solid #1a2a3a', borderRadius:'8px', background:'#0A1124', boxSizing:'border-box', display:'flex', flexDirection:'column' }}
      animate={{ boxShadow:alert?['0 0 6px rgba(255,68,66,0.15)','0 0 12px rgba(255,68,66,0.3)','0 0 6px rgba(255,68,66,0.15)']:'none' }}
      transition={{ duration:2, repeat:alert?Infinity:0 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <p style={{ color:'#d2d2d2', fontSize:15, fontWeight:600 }}>
          {alert?`⚠ ALERT: ${alert.name}`:'✓ All Systems Nominal'}
        </p>
        <div style={{ border:`1px solid ${alert?'#ff4442':'#00ff88'}`, borderRadius:4, padding:'2px 6px', flexShrink:0 }}>
          <p style={{ fontSize:10, fontWeight:700, color:alert?'#ff4442':'#00ff88' }}>{alert?alert.status:'NOMINAL'}</p>
        </div>
      </div>
      {alert ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 8px', fontSize:13 }}>
          <p style={{ color:'#555' }}>Satellite</p><p style={{ color:'white' }}>{alert.name}</p>
          <p style={{ color:'#555' }}>Altitude</p><p style={{ color:'white' }}>{alert.altitude}</p>
          <p style={{ color:'#555' }}>Fuel</p><p style={{ color:'white' }}>{alert.propellant}</p>
          <p style={{ color:'#555' }}>Velocity</p><p style={{ color:'white' }}>{alert.velocity}</p>
          <p style={{ color:'#555' }}>Nearby Debris</p><p style={{ color:'#ff8800' }}>{alert.debris}</p>
        </div>
      ) : (
        <p style={{ color:'#2a2a3a', fontSize:14 }}>No active conjunction threats detected.</p>
      )}
      {atRisk.length>1 && <p style={{ color:'#ff8800', fontSize:12, marginTop:'auto', paddingTop:6 }}>+{atRisk.length-1} more satellites at risk</p>}
    </motion.div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function EnhancedDashboard() {
  const { satellites:liveSats, debrisList, counts, connected, istTime } = useLiveData();
  const [selectedId,    setSelectedId]    = useState<string>('');
  const [openTabIds,    setOpenTabIds]    = useState<string[]>([]);
  const [showAddModal,  setShowAddModal]  = useState(false);

  // Pass debrisList to satToRow for debris count
  const tableRows = liveSats.map(sat => satToRow(sat, debrisList));
  const selectedSat = tableRows.find(s=>s.id===selectedId)||tableRows[0];

  useEffect(() => {
    if (tableRows.length>0 && openTabIds.length===0) {
      setOpenTabIds([tableRows[0].id]);
      setSelectedId(tableRows[0].id);
    }
  }, [tableRows.length]);

  const activeTabs = openTabIds
    .map(id=>tableRows.find(s=>s.id===id))
    .filter(Boolean)
    .map(s=>({ id:s!.id, name:s!.name }));

  const handleCloseTab = (id: string) => {
    const remaining = openTabIds.filter(t=>t!==id);
    setOpenTabIds(remaining);
    if (selectedId===id) setSelectedId(remaining[remaining.length-1]??'');
  };

  const handleAddSatellite = (id: string) => {
    if (!openTabIds.includes(id)) setOpenTabIds(prev=>[...prev,id]);
    setSelectedId(id);
    setShowAddModal(false);
  };

  return (
    <Tooltip.Provider>
      <div style={{ background:'#03020e', width:'100%', minHeight:'100vh', display:'grid',
        gridTemplateColumns:'1fr 38%', gridTemplateRows:'48px 480px 220px',
        fontFamily:'SF Compact Rounded, sans-serif', boxSizing:'border-box' }}>

        {/* Header */}
        <div style={{ gridRow:1, gridColumn:'1/3', display:'grid', gridTemplateColumns:'auto 1fr auto',
          alignItems:'center', borderBottom:'1px solid #1e1e30', padding:'0 16px', gap:12, background:'#06060f' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <p style={{ color:'white', fontSize:18, fontWeight:600, whiteSpace:'nowrap', letterSpacing:'0.04em' }}>Project Aether</p>
            <img alt="" src={imgSatellite} style={{ width:18, height:18 }} />
            <motion.div style={{ width:7, height:7, borderRadius:'50%', background:connected?'#00ff88':'#ff4444' }}
              animate={{ opacity:connected?[1,0.4,1]:1 }} transition={{ duration:1.5, repeat:connected?Infinity:0 }}
              title={connected?'Backend connected':'Disconnected'} />
          </div>
          <div style={{ overflow:'hidden', minWidth:0 }}>
            <SatelliteTabs satellites={activeTabs} activeSatelliteId={selectedId}
              onSelectSatellite={setSelectedId} onCloseSatellite={handleCloseTab}
              onAddSatellite={()=>setShowAddModal(true)} />
          </div>
          <div style={{ display:'flex', gap:20, alignItems:'center' }}>
            {[
              { icon:imgSatellite, label:'Satellites', value:String(counts.satellites).padStart(2,'0'), img:true },
              { label:'Debris',    value:String(counts.debris).padStart(2,'0'), color:'#D9D9D9' },
              { icon:imgWarning,   label:'Alerts',     value:String(counts.at_risk).padStart(2,'0'), img:true, alert:counts.at_risk>0 },
            ].map((item,i)=>(
              <div key={i} style={{ display:'flex', gap:7, alignItems:'center' }}>
                <div style={{ width:20, height:20 }}>
                  {item.img?(
                    <motion.img src={(item as any).icon} style={{ width:'100%', height:'100%' }}
                      animate={(item as any).alert?{opacity:[1,0.5,1]}:{}} transition={{ duration:1, repeat:Infinity }} />
                  ):(
                    <svg viewBox="0 0 20 20" style={{ width:'100%', height:'100%' }}>
                      <circle cx="10" cy="10" r="10" fill={(item as any).color||'#888'} />
                    </svg>
                  )}
                </div>
                <div>
                  <p style={{ color:'#888', fontSize:10, lineHeight:1 }}>{item.label}</p>
                  <p style={{ fontSize:13, fontWeight:600, color:(item as any).alert?'#ff4444':'white', lineHeight:1.3 }}>{item.value}</p>
                </div>
              </div>
            ))}
            <div style={{ display:'flex', gap:7, alignItems:'center' }}>
              <svg viewBox="0 0 27 29" fill="none" style={{ width:20, height:20 }}>
                <path d={svgPaths.p3cc36df0} fill="white" />
              </svg>
              <div>
                <p style={{ color:'#888', fontSize:10, lineHeight:1 }}>IST Time</p>
                <p style={{ color:'white', fontSize:13, fontWeight:600, lineHeight:1.3 }}>{istTime}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Globe */}
        <div style={{ gridRow:2, gridColumn:1, position:'relative', overflow:'hidden', borderRight:'1px solid #1a1a2e' }}>
          <GlobeView satellites={tableRows} debrisList={debrisList} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {/* Right column */}
        <div style={{ gridRow:'2/4', gridColumn:2, display:'grid', gridTemplateRows:'2fr 1.8fr 2fr',
          overflow:'auto', background:'#07070f', borderLeft:'1px solid #1a1a2e', paddingBottom:'16px' }}>
          <div style={{ overflow:'hidden', borderBottom:'1px solid #1a1a2e' }}>
            <BullseyeRadarInline satellite={selectedSat} debrisList={debrisList} />
          </div>
          <div style={{ overflow:'hidden', borderBottom:'1px solid #1a1a2e' }}>
            <TelemetryStatsPanelInline satellite={selectedSat} />
          </div>
          <div style={{ overflow:'hidden' }}>
            <AlertPanelInline satellites={tableRows} />
          </div>
        </div>

        {/* Table + Log */}
        <div style={{ gridRow:3, gridColumn:1, display:'grid', gridTemplateRows:'24px 26px 1fr 80px',
          borderTop:'1px solid #1e1e30', overflow:'hidden', background:'#05050e' }}>
          <div style={{ display:'flex', alignItems:'center', padding:'0 16px', borderBottom:'1px solid #151522' }}>
            <p style={{ color:'#555', fontSize:10, fontFamily:'Azeret Mono, monospace', letterSpacing:2 }}>SATELLITES</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 0.6fr',
            alignItems:'center', padding:'0 16px', borderBottom:'1px solid #151522' }}>
            {['Satellite','Az','El','Altitude','Latitude','Longitude','Velocity','Propellant','Debris'].map(h=>(
              <p key={h} style={{ color:'#444', fontSize:10, fontFamily:'Azeret Mono, monospace', letterSpacing:0.5 }}>{h}</p>
            ))}
          </div>
          <div style={{ overflowY:'auto', scrollbarWidth:'thin', scrollbarColor:'#2a2a3a #05050e' }}>
            {tableRows.length===0?(
              <p style={{ color:'#2a2a3a', fontSize:11, padding:'6px 16px' }}>Waiting for telemetry...</p>
            ):(
              tableRows.map(sat=>{
                const isSelected=sat.id===selectedId;
                const isAtRisk=sat.status==='AT_RISK'||sat.status==='MANEUVERING';
                return (
                  <motion.div key={sat.id}
                    style={{ display:'grid', gridTemplateColumns:'2fr 0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 0.6fr',
                      alignItems:'center', padding:'3px 16px', cursor:'pointer',
                      background:isSelected?'rgba(58,127,255,0.09)':'transparent',
                      borderLeft:isSelected?'2px solid #3a7fff':'2px solid transparent',
                      color:isAtRisk?'#ff9944':'#e0e0e0', fontSize:11 }}
                    onClick={()=>setSelectedId(sat.id)}
                    whileHover={{ backgroundColor:'rgba(255,255,255,0.03)' }}>
                    {[sat.name,sat.az,sat.el,sat.altitude,sat.latitude,sat.longitude,sat.velocity,sat.propellant,sat.debris].map((v,j)=>(
                      <p key={j} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</p>
                    ))}
                  </motion.div>
                );
              })
            )}
          </div>
          <div style={{ borderTop:'1px solid #151522', overflow:'visible' }}>
            <TelemetryLog selectedSatellite={selectedSat} />
          </div>
        </div>
      </div>

      {/* Add Satellite Modal */}
      {showAddModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={()=>setShowAddModal(false)}>
          <div style={{ background:'#0a0d1a', border:'1px solid #1f3c5e', borderRadius:10, padding:'20px 24px', minWidth:300, maxHeight:400, overflowY:'auto' }}
            onClick={e=>e.stopPropagation()}>
            <p style={{ color:'white', fontSize:13, fontWeight:600, marginBottom:14, letterSpacing:1 }}>SELECT SATELLITE</p>
            {tableRows.filter(s=>!openTabIds.includes(s.id)).length===0?(
              <p style={{ color:'#8892a4', fontSize:11 }}>All satellites already open.</p>
            ):(
              tableRows.filter(s=>!openTabIds.includes(s.id)).map(s=>(
                <div key={s.id} onClick={()=>handleAddSatellite(s.id)}
                  style={{ padding:'8px 12px', borderRadius:6, cursor:'pointer', marginBottom:4, background:'#0e1a2e', border:'1px solid #1f3c5e', display:'flex', justifyContent:'space-between', alignItems:'center' }}
                  onMouseEnter={e=>(e.currentTarget.style.borderColor='#3a7fff')}
                  onMouseLeave={e=>(e.currentTarget.style.borderColor='#1f3c5e')}>
                  <p style={{ color:'white', fontSize:12 }}>{s.name}</p>
                  <p style={{ color:'#8892a4', fontSize:10 }}>{s.altitude}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </Tooltip.Provider>
  );
}