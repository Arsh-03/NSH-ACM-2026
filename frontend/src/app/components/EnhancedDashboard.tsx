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

// ── Three.js Globe ───────────────────────────────────────────────────────────
function GlobeView({
  satellites, debrisList, selectedId, onSelect
}: {
  satellites: Satellite[];
  debrisList: {id:string; r:number[]}[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<any>(null);
  const cameraRef   = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const globeRef    = useRef<any>(null);
  const groupRef    = useRef<any>(null);   // globe + satellites group
  const rafRef      = useRef<number>(0);
  const dragRef     = useRef({ dragging: false, lastX: 0, lastY: 0, velX: 0, velY: 0 });
  const rotRef      = useRef({ x: 0.3, y: 0 });
  const autoSpinRef = useRef(true);
  const satMeshesRef = useRef<Record<string, any>>({});
  const orbitLinesRef = useRef<Record<string, any>>({});
  const debrisMeshesRef = useRef<Record<string, any>>({});
  const [THREE, setTHREE] = useState<any>(null);
  const [ready, setReady] = useState(false);

  // Load Three.js dynamically
  useEffect(() => {
    import('three').then(mod => {
      setTHREE(mod);
    });
  }, []);

  // Init scene
  useEffect(() => {
    if (!THREE || !mountRef.current) return;
    const el = mountRef.current;
    const W = el.clientWidth || 800;
    const H = el.clientHeight || 500;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 1000);
    camera.position.set(0, 0, 2.8);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Group to rotate everything together
    const group = new THREE.Group();
    scene.add(group);
    groupRef.current = group;

    // Earth sphere
    const geo  = new THREE.SphereGeometry(1, 64, 64);
    const loader = new THREE.TextureLoader();
    const tex  = loader.load(imgFrame3);
    const mat  = new THREE.MeshPhongMaterial({ map: tex, specular: new THREE.Color(0x222244), shininess: 15 });
    const globe = new THREE.Mesh(geo, mat);
    group.add(globe);
    globeRef.current = globe;

    // Atmosphere glow
    const atmoGeo = new THREE.SphereGeometry(1.06, 64, 64);
    const atmoMat = new THREE.MeshPhongMaterial({
      color: new THREE.Color(0x3a7fff),
      transparent: true, opacity: 0.08,
      side: THREE.FrontSide,
    });
    group.add(new THREE.Mesh(atmoGeo, atmoMat));

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    // Resize observer
    const obs = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    obs.observe(el);

    // Animate loop
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      // Auto-spin when not dragging
      if (autoSpinRef.current && !dragRef.current.dragging) {
        rotRef.current.y += 0.0015;
      }
      // Apply inertia
      if (!dragRef.current.dragging) {
        dragRef.current.velX *= 0.92;
        dragRef.current.velY *= 0.92;
        rotRef.current.x += dragRef.current.velX;
        rotRef.current.y += dragRef.current.velY;
        rotRef.current.x = Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, rotRef.current.x));
      }
      group.rotation.x = rotRef.current.x;
      group.rotation.y = rotRef.current.y;
      renderer.render(scene, camera);
    };
    animate();
    setReady(true);

    return () => {
      cancelAnimationFrame(rafRef.current);
      obs.disconnect();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [THREE]);

  // Convert ECI to Three.js 3D position on sphere surface
  const eciToThree = useCallback((r: number[], altitude = 0): [number, number, number] => {
    const RE = 6378.137;
    const rMag = Math.sqrt(r[0]**2+r[1]**2+r[2]**2);
    const rn = r.map(x => x / rMag);
    const rad = 1 + altitude / RE * 0.8; // scale altitude visually
    return [rn[0]*rad, rn[2]*rad, -rn[1]*rad]; // ECI→Three axes swap
  }, []);

  // Update satellite meshes + orbits + debris
  useEffect(() => {
    if (!THREE || !groupRef.current || !ready) return;
    const group = groupRef.current;
    const loader = new THREE.TextureLoader();

    // ── Satellites ──
    satellites.forEach(sat => {
      if (!sat.r || sat.r.length < 3) return;
      const isSelected = sat.id === selectedId;
      const isAtRisk = sat.status === 'AT_RISK' || sat.status === 'MANEUVERING';
      const color = isAtRisk ? 0xff4444 : isSelected ? 0x3a7fff : 0x00ccff;
      const orbitColor = isAtRisk ? 0xff6644 : isSelected ? 0x9747ff : 0x3a7fff;

      // Satellite sprite (uses imgSatellite texture)
      if (!satMeshesRef.current[sat.id]) {
        const tex = loader.load(imgSatellite);
        const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(mat);
        sprite.userData.satId = sat.id;
        group.add(sprite);
        satMeshesRef.current[sat.id] = sprite;
      }
      const sprite = satMeshesRef.current[sat.id];
      const [x, y, z] = eciToThree(sat.r, norm3(sat.r) - 6378.137);
      sprite.position.set(x, y, z);
      sprite.material.color.setHex(color);
      const scale = isSelected ? 0.10 : 0.065;
      sprite.scale.set(scale, scale, scale);

      // Orbit line — only for selected, color-coded by status
      if (isSelected) {
        if (orbitLinesRef.current[sat.id]) group.remove(orbitLinesRef.current[sat.id]);
        const rMag = norm3(sat.r);
        const ru = [sat.r[0]/rMag, sat.r[1]/rMag, sat.r[2]/rMag];
        const v = sat.v && sat.v.length>=3 ? sat.v : [0,1,0];
        const h = [ru[1]*v[2]-ru[2]*v[1], ru[2]*v[0]-ru[0]*v[2], ru[0]*v[1]-ru[1]*v[0]];
        const hMag = Math.sqrt(h[0]**2+h[1]**2+h[2]**2) || 1;
        const hn = h.map((x: number)=>x/hMag);
        const perp = [hn[1]*ru[2]-hn[2]*ru[1], hn[2]*ru[0]-hn[0]*ru[2], hn[0]*ru[1]-hn[1]*ru[0]];
        const pts: any[] = [];
        for (let i = 0; i <= 128; i++) {
          const a = (i/128)*2*Math.PI;
          const pr = [
            rMag*(ru[0]*Math.cos(a)+perp[0]*Math.sin(a)),
            rMag*(ru[1]*Math.cos(a)+perp[1]*Math.sin(a)),
            rMag*(ru[2]*Math.cos(a)+perp[2]*Math.sin(a)),
          ];
          const [px,py,pz] = eciToThree(pr, rMag-6378.137);
          pts.push(new THREE.Vector3(px,py,pz));
        }
        const orbitGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const orbitMat = new THREE.LineBasicMaterial({ color: orbitColor, transparent: true, opacity: 0.75 });
        const line = new THREE.Line(orbitGeo, orbitMat);
        group.add(line);
        orbitLinesRef.current[sat.id] = line;
      } else if (orbitLinesRef.current[sat.id]) {
        group.remove(orbitLinesRef.current[sat.id]);
        delete orbitLinesRef.current[sat.id];
      }
    });

    // Remove stale satellite sprites
    Object.keys(satMeshesRef.current).forEach(id => {
      if (!satellites.find(s => s.id === id)) {
        group.remove(satMeshesRef.current[id]);
        delete satMeshesRef.current[id];
      }
    });

    // ── Debris ──
    debrisList.forEach(deb => {
      if (!deb.r || deb.r.length < 3) return;
      if (!debrisMeshesRef.current[deb.id]) {
        const geo = new THREE.SphereGeometry(0.008, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: 0x888888 });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        debrisMeshesRef.current[deb.id] = mesh;
      }
      const mesh = debrisMeshesRef.current[deb.id];
      const [x, y, z] = eciToThree(deb.r, norm3(deb.r) - 6378.137);
      mesh.position.set(x, y, z);
    });

    // Remove stale debris meshes
    Object.keys(debrisMeshesRef.current).forEach(id => {
      if (!debrisList.find(d => d.id === id)) {
        group.remove(debrisMeshesRef.current[id]);
        delete debrisMeshesRef.current[id];
      }
    });

  }, [THREE, satellites, debrisList, selectedId, ready, eciToThree]);

  // Mouse handlers
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current.dragging = true;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    dragRef.current.velX = 0;
    dragRef.current.velY = 0;
    autoSpinRef.current = false;
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.lastX;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.velY = dx * 0.008;
    dragRef.current.velX = dy * 0.008;
    rotRef.current.y += dx * 0.008;
    rotRef.current.x += dy * 0.008;
    rotRef.current.x = Math.max(-Math.PI/2.2, Math.min(Math.PI/2.2, rotRef.current.x));
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };
  const onMouseUp = () => {
  dragRef.current.dragging = false;
  autoSpinRef.current = true;
};

  // Click to select satellite
  const onCanvasClick = (e: React.MouseEvent) => {
    if (!THREE || !cameraRef.current || !groupRef.current) return;
    const el = mountRef.current!;
    const rect = el.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, cameraRef.current);
    const meshes = [...Object.values(satMeshesRef.current)];
    const hits = raycaster.intersectObjects(meshes);
    if (hits.length > 0) {
      const id = hits[0].object.userData.satId;
      if (id) onSelect(id);
    }
  };

  return (
    <div style={{ position: 'absolute', inset: 0, borderRadius: 5, overflow: 'hidden' }}>
      {/* Starfield background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[5px]">
        <img alt="" className="absolute h-[133.97%] left-[-1.15%] max-w-none top-[-33.97%] w-[139.11%]" src={imgFrame2} />
      </div>
      {/* Three.js mount */}
      <div ref={mountRef} style={{ position: 'absolute', inset: 0, cursor: dragRef.current.dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove}
        onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
        onClick={onCanvasClick} />
      {/* Satellite name labels */}
      {ready && satellites.map(sat => {
        if (!sat.r || sat.r.length < 3 || !cameraRef.current || !rendererRef.current) return null;
        const isSelected = sat.id === selectedId;
        if (!isSelected) return null;
        // Project 3D position to screen
        if (!THREE) return null;
        const [x,y,z] = eciToThree(sat.r, norm3(sat.r)-6378.137);
        const vec = new THREE.Vector3(x,y,z);
        const group = groupRef.current;
        if (group) vec.applyEuler(group.rotation);
        vec.project(cameraRef.current);
        const el = rendererRef.current.domElement;
        const sx = (vec.x+1)/2 * el.clientWidth;
        const sy = (-vec.y+1)/2 * el.clientHeight;
        if (vec.z > 1) return null; // behind globe
        return (
          <div key={sat.id} style={{
            position: 'absolute', left: sx+12, top: sy-6,
            color: '#3a7fff', fontSize: 10, fontFamily: 'Azeret Mono, monospace',
            pointerEvents: 'none', whiteSpace: 'nowrap',
            textShadow: '0 0 6px rgba(58,127,255,0.8)',
          }}>
            {sat.name}
          </div>
        );
      })}
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
  return (
    <div style={{
  height: '100%',
  display: 'flex',
  flexDirection: 'column',

  padding: '16px',        // inner space (you already had some)
  margin: '15px',         // space outside
  border: '2px solid black', // border
  borderRadius:'10px',


  background: '#0B1124',
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
          if (dist > 5000) return null;
          const sc = R / 5000;
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
        {[['1000km',CX+4,CY-R*0.25+5],['2500km',CX+4,CY-R*0.5+5],['3750km',CX+4,CY-R*0.75+5],['5000km',CX+4,CY-R+5]].map(([l,x,y])=>(
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

  padding: '6px 16px 16px 16px',          // inner spacing
  margin: '15px',           // space outside
  border: '2px solid black', // border
  borderRadius:'10px',

  background: '#0A1124',
  boxSizing: 'border-box'
}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, background:'#0E1B2E' , marginBottom: 10, padding:5 }}>
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

  padding: '16px',           // inner spacing
  margin: '16px',            // outer spacing
  // full border
  border: alert?'1px solid red':'2px solid black',
  borderRadius:'10px',

  background: '#0A1124',
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

  const tableRows = liveSats.map(satToRow);
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
              onSelectSatellite={handleSelectTab}
              onCloseSatellite={handleCloseTab}
              onAddSatellite={() => setShowAddModal(true)}
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
          // gridTemplateRows: '3fr 1fr 1fr',
          gridTemplateRows: '3fr 1.5fr 1.5fr', 
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