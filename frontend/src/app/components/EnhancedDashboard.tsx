import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as THREE from 'three';
import { SatelliteTabs } from './SatelliteTabs';
import { TelemetryLog } from './TelemetryLog';

const imgFrame2 = new URL('../../assets/9394663ed06f79040e5fccebf1cd472a901e3df0.png', import.meta.url).href;
const imgFrame3 = new URL('../../assets/earth_globe.jpg', import.meta.url).href;
const imgSatellite = new URL('../../assets/6292a4c2f7fce59afb681a45c010a7b66e40fa69.png', import.meta.url).href;
const imgWarning = new URL('../../assets/f85026c63fdf650839667e94cb9920852e2d6935.png', import.meta.url).href;
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

function satToRow(sat: LiveSat): Satellite {
  const RE  = 6378.137;
  const alt = norm3(sat.r) - RE;
  const vel = norm3(sat.v);
  const rn  = sat.r.map(x => x / norm3(sat.r));
  const lat = Math.asin(Math.max(-1, Math.min(1, rn[2]))) * 180 / Math.PI;
  const lon = Math.atan2(rn[1], rn[0]) * 180 / Math.PI;
  const az  = (Math.atan2(sat.r[1], sat.r[0]) * 180 / Math.PI + 360) % 360;
  const el  = Math.asin(Math.max(-1, Math.min(1, sat.r[2] / norm3(sat.r)))) * 180 / Math.PI;
  const fuelPct = Math.min(100, (sat.fuel / 50) * 100);
  return {
    id: sat.id, name: sat.id,
    az: `${az.toFixed(1)}°`, el: `${el.toFixed(1)}°`,
    altitude:   `${alt.toFixed(1)} km`,
    latitude:   `${lat.toFixed(4)}°`,
    longitude:  `${lon.toFixed(4)}°`,
    velocity:   `${vel.toFixed(2)} km/s`,
    propellant: `${sat.fuel.toFixed(2)} kg`,
    debris:     '0',
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

// ── Canvas Globe ───────────────────────────────────────────────────────────
function GlobeView({
  satellites, debrisList, selectedId, onSelect
}: {
  satellites: Satellite[];
  debrisList: {id:string; r:number[]}[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const CX = 655, CY = 308, GLOBE_R = 170;
  const satColors: Record<string, string> = {
    'NOMINAL': '#3a7fff', 'AT_RISK': '#ff0000', 'MANEUVERING': '#f70'
  };

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const orbitLineRef = useRef<THREE.Line | null>(null);
  const selectedIdRef = useRef<string>(selectedId);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  const satellitesRef = useRef<Satellite[]>(satellites);
  const debrisRef = useRef<{id:string;r:number[]}[]>(debrisList);

  const [satCoords, setSatCoords] = useState<{id:string; px:number; py:number; visible:boolean;}[]>([]);
  const [debCoords, setDebCoords] = useState<{id:string; px:number; py:number; visible:boolean;}[]>([]);

  useEffect(() => { satellitesRef.current = satellites; }, [satellites]);
  useEffect(() => { debrisRef.current = debrisList; }, [debrisList]);

  useEffect(() => {
    if (!wrapperRef.current || !canvasRef.current) return;

    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, wrapper.clientWidth / wrapper.clientHeight, 0.1, 2000);

    renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);

    camera.position.set(0, 0, 650);

    const globeGeometry = new THREE.SphereGeometry(GLOBE_R, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    const earthTexture = textureLoader.load(imgFrame3);
    const globeMaterial = new THREE.MeshPhongMaterial({ map: earthTexture, shininess: 15 });

    const globe = new THREE.Mesh(globeGeometry, globeMaterial);
    scene.add(globe);

    const orbitMaterial = new THREE.LineBasicMaterial({ color: 0x9747ff, linewidth: 1, transparent: true, opacity: 0.8 });
    const orbitGeometry = new THREE.BufferGeometry();
    const orbitLine = new THREE.Line(orbitGeometry, orbitMaterial);
    orbitLine.visible = false;
    scene.add(orbitLine);
    orbitLineRef.current = orbitLine;

    const ambientLight = new THREE.AmbientLight(0x888888, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(2, 2, 2);
    scene.add(directionalLight);

    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRotY = 0;
    let dragStartRotX = 0;
    const autoRotateSpeed = 0.0015;

    const onPointerDown = (event: PointerEvent) => {
      isDragging = true;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragStartRotY = globe.rotation.y;
      dragStartRotX = globe.rotation.x;
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!isDragging) return;
      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      globe.rotation.y = dragStartRotY + deltaX * 0.005;
      globe.rotation.x = Math.max(-Math.PI * 0.45, Math.min(Math.PI * 0.45, dragStartRotX + deltaY * 0.005));
    };

    const onPointerUp = (event: PointerEvent) => {
      isDragging = false;
      canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointerleave', onPointerUp);

    const handleResize = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    window.addEventListener('resize', handleResize);

    const [cameraDir] = [new THREE.Vector3(0,0,1)];

    const updateOrbitLine = () => {
      const orbitLine = orbitLineRef.current;
      if (!orbitLine) return;
      const selected = satellitesRef.current.find(s => s.id === selectedIdRef.current);
      if (!selected || !selected.r || !selected.v) {
        orbitLine.visible = false;
        return;
      }

      const p = new THREE.Vector3(selected.r[0], selected.r[1], selected.r[2]);
      const v = new THREE.Vector3(selected.v[0], selected.v[1], selected.v[2]);
      const n = p.clone().cross(v).normalize();
      if (n.length() < 1e-6) {
        orbitLine.visible = false;
        return;
      }

      const u = p.clone().normalize();
      const w = n.clone().cross(u).normalize();
      const orbitRadius = p.length() * (GLOBE_R / 6378.137);
      const points: THREE.Vector3[] = [];
      const segments = 128;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const point = u.clone().multiplyScalar(Math.cos(theta)).add(w.clone().multiplyScalar(Math.sin(theta))).multiplyScalar(orbitRadius);
        points.push(point);
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      orbitLine.geometry.dispose();
      orbitLine.geometry = geometry;
      orbitLine.visible = true;
    };

    const updateOverlay = () => {
      const w = wrapper.clientWidth;
      const h = wrapper.clientHeight;

      const toScreen = (lat:number, lon:number, sphereRadius:number) => {
        const base = new THREE.Vector3(
          Math.cos(lat) * Math.cos(lon),
          Math.cos(lat) * Math.sin(lon),
          Math.sin(lat)
        );
        const rotated = base.clone().applyEuler(globe.rotation);
        const worldPoint = rotated.clone().multiplyScalar(sphereRadius);
        const projected = worldPoint.clone().project(camera);
        const px = (projected.x + 1) * 0.5 * w;
        const py = (1 - projected.y) * 0.5 * h;
        const visible = rotated.dot(cameraDir) > 0;
        return { px, py, visible };
      };

      const satPositions = satellitesRef.current.map(sat => {
        const rn = sat.r.map(x => x / norm3(sat.r));
        const lat = Math.asin(Math.max(-1, Math.min(1, rn[2])));
        const lon = Math.atan2(rn[1], rn[0]);
        return { id: sat.id, ...toScreen(lat, lon, GLOBE_R + 40) };
      });

      const debPositions = debrisRef.current.map(deb => {
        if (!deb.r || deb.r.length < 3) return { id: deb.id, px: 0, py: 0, visible:false };
        const rn = deb.r.map(x => x / norm3(deb.r));
        const lat = Math.asin(Math.max(-1, Math.min(1, rn[2])));
        const lon = Math.atan2(rn[1], rn[0]);
        return { id: deb.id, ...toScreen(lat, lon, GLOBE_R + 30) };
      });

      setSatCoords(satPositions);
      setDebCoords(debPositions);
    };

    const animate = () => {
      animationRef.current = requestAnimationFrame(animate);
      if (!isDragging) {
        globe.rotation.y += autoRotateSpeed;
      }
      updateOrbitLine();
      updateOverlay();
      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointerleave', onPointerUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      renderer.dispose();
      globeGeometry.dispose();
      globeMaterial.dispose();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="absolute inset-0 overflow-hidden rounded-[5px]">
      {/* Starfield background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
        <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
      </div>

      {/* Three.js globe canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ pointerEvents: 'auto' }}
      />


      {/* All satellites as interactive dots */}
      {satellites.map((sat, i) => {
        const coords = satCoords.find(c => c.id === sat.id);
        if (!coords || !coords.visible) return null;
        const { px, py } = coords;
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
        const coords = debCoords.find(c => c.id === deb.id);
        if (!coords || !coords.visible) return null;
        const { px, py } = coords;
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
          <div className="grid grid-cols-2 gap-[8px] text-[12px] font-['SF_Pro_Rounded:Regular',sans-serif]">
            <p className="text-[#777]">Satellite</p><p className="text-white">{alert.name}</p>
            <p className="text-[#777]">Altitude</p><p className="text-white">{alert.altitude}</p>
            <p className="text-[#777]">Fuel</p><p className="text-white">{alert.propellant}</p>
            <p className="text-[#777]">Velocity</p><p className="text-white">{alert.velocity}</p>
          </div>
        ) : (
          <p className="text-[#444] text-[11px]">No active conjunction threats detected.</p>
        )}
        {atRisk.length > 1 && (
          <p className="text-[#ff8800] text-[10px] mt-[8px]">+{atRisk.length-1} more satellites at risk</p>
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
  const RADAR_RANGE_KM = 1200;
  return (
    <div style={{
  height: '100%',
  display: 'flex',
  flexDirection: 'column',

  padding: '14px',
  margin: '12px',
  border: '1px solid rgba(73, 117, 188, 0.35)',
  borderRadius:'12px',
  background: 'linear-gradient(180deg, rgba(12,21,44,0.92), rgba(8,15,32,0.95))',
  boxShadow: 'inset 0 1px 0 rgba(137, 185, 255, 0.15), 0 10px 24px rgba(0, 0, 0, 0.35)',
  boxSizing: 'border-box'
}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3a7fff', flexShrink: 0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: '#3a7fff', fontSize: 13, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          BULLSEYE — {satellite?.name ?? 'NO TARGET'}
        </p>
      </div>
      <svg viewBox="-60 0 480 410" style={{ width: '100%', flex: 1, minHeight: 0, display: 'block' }}>
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
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${CX} ${CY}`}
              to={`360 ${CX} ${CY}`}
              dur="3s"
              repeatCount="indefinite"
            />
          </line>
        </g>
        <image href={imgSatellite} x={CX-18} y={CY-18} width="36" height="36" />
        {satellite && debrisList.map((deb, idx) => {
          if (!deb.r || deb.r.length < 3 || !satellite.r || satellite.r.length < 3) return null;
          const dx = deb.r[0]-satellite.r[0], dy = deb.r[1]-satellite.r[1], dz = deb.r[2]-satellite.r[2];
          const dist = Math.sqrt(dx*dx+dy*dy+dz*dz);
          if (dist > RADAR_RANGE_KM) return null;
          const sc = R / RADAR_RANGE_KM;
          const rx = CX + dx * sc, ry = CY - dz * sc;
          if (rx < 5 || rx > 415 || ry < 5 || ry > 405) return null;
          const isClose = dist < 100;

          return (
            <g key={deb.id}>
              <line x1={CX} y1={CY} x2={rx} y2={ry}
                stroke={isClose ? '#ff6644' : '#f59e0b'}
                strokeWidth="0.8" opacity="0.4" strokeDasharray="3 3" />
              <motion.circle cx={rx} cy={ry} r={isClose ? 5 : 4}
                fill={isClose ? '#ff4444' : '#f59e0b'}
                animate={{ opacity: isClose ? [1,0.2,1] : [0.5,1,0.5] }}
                transition={{ duration: isClose ? 0.8 : 2, repeat: Infinity }} />
              <text x={rx+6} y={ry-4} fill={isClose ? '#ff6644' : '#f59e0b'}
                fontSize="13" fontFamily="Azeret Mono, monospace">
                BT-{String(idx+1).padStart(3,'0')}
              </text>
              <text x={rx+6} y={ry+8} fill={isClose ? '#ff4444' : '#8892a4'}
  fontSize="12" fontFamily="Azeret Mono, monospace">
  {dist < 1000 ? `${dist.toFixed(0)}km` : `${(dist/1000).toFixed(1)}Mm`}
</text>
            </g>
          );
        })}
        {[['300km',CX+4,CY-R*0.25+5],['600km',CX+4,CY-R*0.5+5],['900km',CX+4,CY-R*0.75+5],['1200km',CX+4,CY-R+5]].map(([l,x,y])=>(
          <text key={l as string} x={x as number} y={y as number} fill="#8892a4" fontSize="9" fontFamily="Azeret Mono, monospace">{l}</text>
        ))}
        {/* Stats overlay — bottom LEFT of SVG canvas (fixed viewBox coords 0 0 420 410) */}
        {satellite && (
          <g>
            <rect x="-125" y="342" width="165" height="70" rx="5" fill="#0e1b2e" opacity="0.92" />
            {/* <line x1="8" y1="373" x2="138" y2="373" stroke="#1a2a45" strokeWidth="0.7" /> */}
            {/* <line x1="73" y1="342" x2="73" y2="404" stroke="#1a2a45" strokeWidth="0.7" /> */}
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
    </div>
  );
}

function TelemetryStatsPanelInline({ satellite }: { satellite: Satellite | undefined }) {
  const sat = satellite;
  const fuelPct = sat?.fuelPct ?? 0;
  const isAtRisk = sat?.status === 'AT_RISK' || sat?.status === 'MANEUVERING';
  return (
    <div style={{
  height: '100%',
  display: 'flex',
  flexDirection: 'column',

  padding: '10px 14px 14px 14px',
  margin: '12px',
  border: '1px solid rgba(73, 117, 188, 0.35)',
  borderRadius:'12px',
  background: 'linear-gradient(180deg, rgba(12,21,44,0.92), rgba(8,15,32,0.95))',
  boxShadow: 'inset 0 1px 0 rgba(137, 185, 255, 0.15), 0 10px 24px rgba(0, 0, 0, 0.35)',
  boxSizing: 'border-box'
}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background:'rgba(18,31,53,0.9)' , marginBottom: 10, padding:'6px 8px', borderRadius: 8, border: '1px solid rgba(85, 126, 196, 0.25)' }}>
        <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: isAtRisk ? '#ff4444' : '#00ff88', flexShrink: 0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: 'white', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Telemetry: {sat?.name ?? '— Select satellite'}
        </p>
        {isAtRisk && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#ff4444', color: 'white', padding: '2px 5px', borderRadius: 3, fontWeight: 700, flexShrink: 0 }}>{sat?.status}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px 12px', flex: 1 }}>
        {[['Altitude',sat?.altitude??'—'],['Longitude',sat?.longitude??'—'],['Propellant',sat?.propellant??'—'],
          ['Latitude',sat?.latitude??'—'],['Velocity',sat?.velocity??'—'],['Status',sat?.status??'NOMINAL']
        ].map(([label,value])=>(
          <div key={label}>
            <p style={{ color: '#444', fontSize: 9, marginBottom: 2 }}>{label}</p>
            <p style={{ fontSize: 12, color: label==='Status'&&isAtRisk?'#ff4444':'white', fontWeight: 500 }}>{value}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
          <p style={{ color: '#666', fontSize: 10 }}>Fuel Reserve</p>
          <p style={{ color: 'white', fontSize: 10 }}>{fuelPct.toFixed(0)}%</p>
        </div>
        <div style={{ height: 5, background: '#1a2540', borderRadius: 3, overflow: 'hidden' }}>
          <motion.div style={{ height: '100%', borderRadius: 3, background: fuelPct>50?'linear-gradient(to right,#00ff88,#00cc66)':fuelPct>20?'linear-gradient(to right,#ff8800,#ffaa00)':'linear-gradient(to right,#ff4444,#ff8800)' }}
            animate={{ width:`${fuelPct}%` }} transition={{ duration:1, ease:'easeOut' }} />
        </div>
      </div>
    </div>
  );
}

function AlertPanelInline({ satellites }: { satellites: Satellite[] }) {
  const atRisk = satellites.filter(s => s.status==='AT_RISK'||s.status==='MANEUVERING');
  const alert = atRisk[0];
  return (
    <motion.div style={{ 
  height: '100%',

  padding: '14px',
  margin: '12px',
  border: alert ? '1px solid rgba(255, 87, 87, 0.55)' : '1px solid rgba(73, 117, 188, 0.35)',
  borderRadius:'12px',
  background: 'linear-gradient(180deg, rgba(12,21,44,0.92), rgba(8,15,32,0.95))',
  boxShadow: 'inset 0 1px 0 rgba(137, 185, 255, 0.15), 0 10px 24px rgba(0, 0, 0, 0.35)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column'
}}
      animate={{ boxShadow: alert?['0 0 6px rgba(255,68,66,0.15)','0 0 12px rgba(255,68,66,0.3)','0 0 6px rgba(255,68,66,0.15)']:'none' }}
      transition={{ duration:2, repeat: alert?Infinity:0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, }}>
        <p style={{ color: '#d2d2d2', fontSize: 13, fontWeight: 600 }}>
          {alert ? `⚠ ALERT: ${alert.name}` : '✓ All Systems Nominal'}
        </p>
        <div style={{ border: `1px solid ${alert?'#ff4442':'#00ff88'}`, borderRadius: 4, padding: '2px 6px', flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: alert?'#ff4442':'#00ff88' }}>{alert?alert.status:'NOMINAL'}</p>
        </div>
      </div>
      {alert ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 8px', fontSize: 12 }}>
          <p style={{ color: '#555' }}>Satellite</p><p style={{ color: 'white' }}>{alert.name}</p>
          <p style={{ color: '#555' }}>Altitude</p><p style={{ color: 'white' }}>{alert.altitude}</p>
          <p style={{ color: '#555' }}>Fuel</p><p style={{ color: 'white' }}>{alert.propellant}</p>
          <p style={{ color: '#555' }}>Velocity</p><p style={{ color: 'white' }}>{alert.velocity}</p>
        </div>
      ) : (
        <p style={{ color: '#2a2a3a', fontSize: 13 }}>No active conjunction threats detected.</p>
      )}
      {atRisk.length > 1 && <p style={{ color: '#ff8800', fontSize: 12, marginTop: 'auto', paddingTop: 6 }}>+{atRisk.length-1} more satellites at risk</p>}
    </motion.div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function EnhancedDashboard() {
  const { satellites: liveSats, debrisList, counts, connected, istTime } = useLiveData();
  const [selectedId, setSelectedId] = useState<string>('');
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);

  const DEBRIS_PROXIMITY_KM = 300;
  const tableRows = liveSats.map((sat) => {
    const row = satToRow(sat);
    const closeDebris = debrisList.reduce((count, deb) => {
      if (!deb.r || deb.r.length < 3) return count;
      const dx = deb.r[0] - sat.r[0];
      const dy = deb.r[1] - sat.r[1];
      const dz = deb.r[2] - sat.r[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return dist <= DEBRIS_PROXIMITY_KM ? count + 1 : count;
    }, 0);

    return {
      ...row,
      debris: String(closeDebris),
    };
  });
  const selectedSat = tableRows.find(s => s.id === selectedId) || tableRows[0];

  // Auto-open first satellite tab when data arrives
  useEffect(() => {
    if (tableRows.length > 0 && openTabIds.length === 0) {
      const firstId = tableRows[0].id;
      setOpenTabIds([firstId]);
      setSelectedId(firstId);
    }
  }, [tableRows.length]);

  const activeTabs = openTabIds
    .map(id => tableRows.find(s => s.id === id))
    .filter(Boolean)
    .map(s => ({ id: s!.id, name: s!.name }));

  const handleSelectTab = (id: string) => setSelectedId(id);

  const handleCloseTab = (id: string) => {
    const remaining = openTabIds.filter(t => t !== id);
    setOpenTabIds(remaining);
    if (selectedId === id) setSelectedId(remaining[remaining.length - 1] ?? '');
  };

  const handleAddSatellite = (id: string) => {
    if (!openTabIds.includes(id)) setOpenTabIds(prev => [...prev, id]);
    setSelectedId(id);
    setShowAddModal(false);
  };

  return (
    <Tooltip.Provider>
      {/* ── ROOT: fills parent App container ── */}
      <div style={{
        background: 'radial-gradient(1200px 700px at 22% -8%, #1a2d54 0%, #0a1228 38%, #050913 100%)',
        width: '100%',
        minHeight: '100vh', 
        gridTemplateRows: '48px 500px 200px',
        display: 'grid',
        gridTemplateColumns: '1fr 38%',
        fontFamily: 'Azeret Mono, SF Compact Rounded, sans-serif',
        boxSizing: 'border-box',
        position: 'relative',
        color: '#e6eeff',
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'linear-gradient(rgba(110,150,220,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(110,150,220,0.08) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          opacity: 0.22,
        }} />

        {/* ══ ROW 1: HEADER ══ */}
        <div style={{
          gridRow: 1,
          gridColumn: '1 / 3',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'center',
          borderBottom: '1px solid rgba(77, 118, 186, 0.35)',
          padding: '0 16px',
          gap: 12,
          background: 'linear-gradient(180deg, rgba(9,14,30,0.98), rgba(6,10,22,0.94))',
          boxShadow: '0 10px 30px rgba(0,0,0,0.45), inset 0 -1px 0 rgba(137, 185, 255, 0.15)',
          zIndex: 4,
        }}>
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ color: '#f3f7ff', fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Project Aether</p>
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
              onSelectSatellite={handleSelectTab}
              onCloseSatellite={handleCloseTab}
              onAddSatellite={() => setShowAddModal(true)}
            />
          </div>

          {/* Stats + clock */}
          <div style={{ display: 'flex', gap: 20, alignItems: 'center', background: 'rgba(11, 19, 39, 0.72)', border: '1px solid rgba(90,135,210,0.25)', borderRadius: 10, padding: '6px 10px' }}>
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
                  <p style={{ color: '#8ba4cf', fontSize: 10, lineHeight: 1 }}>{item.label}</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: (item as any).alert ? '#ff4444' : 'white', lineHeight: 1.3 }}>{item.value}</p>
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
              <svg viewBox="0 0 27 29" fill="none" style={{ width: 20, height: 20 }}>
                <path d={svgPaths.p3cc36df0} fill="white" />
              </svg>
              <div>
                <p style={{ color: '#8ba4cf', fontSize: 10, lineHeight: 1 }}>IST Time</p>
                <p style={{ color: '#f8fbff', fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>{istTime}</p>
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
          borderRight: '1px solid rgba(77, 118, 186, 0.25)',
          background: 'linear-gradient(180deg, rgba(8,12,24,0.7), rgba(4,7,14,0.9))',
        }}>
          <GlobeView satellites={tableRows} debrisList={debrisList} selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {/* ══ RIGHT COLUMN: spans ROW 2 + ROW 3 ══ */}
        <div style={{
          gridRow: '2 / 4',
          gridColumn: 2,
          display: 'grid',
          // gridTemplateRows: '3fr 1fr 1fr',
          gridTemplateRows: '3fr 1.5fr 1.5fr', 
          overflow: 'hidden',
          background: 'linear-gradient(180deg, rgba(7,11,22,0.95), rgba(5,8,18,0.98))',
          borderLeft: '1px solid rgba(77, 118, 186, 0.25)',
          boxShadow: 'inset 1px 0 0 rgba(137, 185, 255, 0.08)',
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
          borderTop: '1px solid rgba(77, 118, 186, 0.25)',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, rgba(5,8,16,0.96), rgba(4,6,13,0.98))',
          boxShadow: 'inset 0 1px 0 rgba(137, 185, 255, 0.08)',
        }}>
          {/* Section label */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid rgba(73,117,188,0.2)', background: 'rgba(8,14,28,0.85)' }}>
            <p style={{ color: '#9ec2ff', fontSize: 10, fontFamily: 'Azeret Mono, monospace', letterSpacing: 2 }}>SATELLITES TRACKING GRID</p>
          </div>

          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 0.5fr 0.5fr 1fr 1fr 1fr 1fr 1fr 0.6fr',
            alignItems: 'center',
            padding: '0 16px',
            borderBottom: '1px solid rgba(73,117,188,0.2)',
            background: 'rgba(8,14,28,0.7)',
          }}>
            {['Satellite','Az','El','Altitude','Latitude','Longitude','Velocity','Propellant','Debris'].map(h => (
              <p key={h} style={{ color: '#7f94bb', fontSize: 10, fontFamily: 'Azeret Mono, monospace', letterSpacing: 0.5 }}>{h}</p>
            ))}
          </div>

          {/* Table rows */}
          <div style={{ overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#2a2a3a #05050e' }}>
            {tableRows.length === 0 ? (
              <p style={{ color: '#5f79a8', fontSize: 11, padding: '6px 16px' }}>Waiting for telemetry from backend...</p>
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
                      background: isSelected ? 'rgba(58,127,255,0.12)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #54a2ff' : '2px solid transparent',
                      borderBottom: '1px solid rgba(62, 94, 145, 0.12)',
                      color: isAtRisk ? '#ffb26d' : '#dce8ff',
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

      {/* ── Add Satellite Modal ── */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowAddModal(false)}>
          <div style={{ background: '#0a0d1a', border: '1px solid #1f3c5e', borderRadius: 10, padding: '20px 24px', minWidth: 300, maxHeight: 400, overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <p style={{ color: 'white', fontSize: 13, fontWeight: 600, marginBottom: 14, letterSpacing: 1 }}>SELECT SATELLITE</p>
            {tableRows.filter(s => !openTabIds.includes(s.id)).length === 0 ? (
              <p style={{ color: '#8892a4', fontSize: 11 }}>All satellites already open.</p>
            ) : (
              tableRows.filter(s => !openTabIds.includes(s.id)).map(s => (
                <div key={s.id}
                  onClick={() => handleAddSatellite(s.id)}
                  style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: '#0e1a2e', border: '1px solid #1f3c5e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#3a7fff')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#1f3c5e')}>
                  <p style={{ color: 'white', fontSize: 12 }}>{s.name}</p>
                  <p style={{ color: '#8892a4', fontSize: 10 }}>{s.altitude}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

    </Tooltip.Provider>
  );
}