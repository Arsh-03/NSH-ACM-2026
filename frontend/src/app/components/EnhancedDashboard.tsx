import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { SatelliteTabs } from './SatelliteTabs';
import { TelemetryLog } from './TelemetryLog';
import { MapViewPanel } from './MapViewPanel';
import { ExpandableBullseye } from './ExpandedRadar';
import imgFrame2 from "../../assets/9394663ed06f79040e5fccebf1cd472a901e3df0.png";
import imgFrame3 from "../../assets/earth_globe.jpg";
import imgSatellite from "../../assets/6292a4c2f7fce59afb681a45c010a7b66e40fa69.png";
import imgWarning from "../../assets/f85026c63fdf650839667e94cb9920852e2d6935.png";
import svgPaths from "../../imports/svg-2gbe90s142";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LiveSat {
  id: string; r: number[]; v: number[];
  fuel: number; status: string; type: string;
  lastUpdate: number;
}

interface TrackPoint {
  t: number;
  lat: number;
  lon: number;
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

const DEFAULT_GROUND_STATION = {
  latDeg: 13.0333,
  lonDeg: 77.5167,
  elevM: 820,
};

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

function eciToAzEl(
  rEciKm: number[],
  observerLatDeg: number,
  observerLonDeg: number,
  observerElevM: number,
  at: Date,
) {
  if (!rEciKm || rEciKm.length < 3) return { azDeg: NaN, elDeg: NaN };

  const lat = observerLatDeg * Math.PI / 180;
  const lon = observerLonDeg * Math.PI / 180;
  const theta = gmstRadAt(at);

  // Rotate ECI -> ECEF around Earth Z axis.
  const x = rEciKm[0], y = rEciKm[1], z = rEciKm[2];
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const xEcef = cosT * x + sinT * y;
  const yEcef = -sinT * x + cosT * y;
  const zEcef = z;

  const RE = 6378.137;
  const obsR = RE + observerElevM / 1000;
  const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
  const cosLon = Math.cos(lon), sinLon = Math.sin(lon);

  const obsX = obsR * cosLat * cosLon;
  const obsY = obsR * cosLat * sinLon;
  const obsZ = obsR * sinLat;

  const dx = xEcef - obsX;
  const dy = yEcef - obsY;
  const dz = zEcef - obsZ;

  const east = -sinLon * dx + cosLon * dy;
  const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
  const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

  const range = Math.sqrt(east * east + north * north + up * up);
  if (!Number.isFinite(range) || range < 1e-9) return { azDeg: NaN, elDeg: NaN };

  let azDeg = Math.atan2(east, north) * 180 / Math.PI;
  if (azDeg < 0) azDeg += 360;
  const elDeg = Math.asin(Math.max(-1, Math.min(1, up / range))) * 180 / Math.PI;

  return { azDeg, elDeg };
}

function nearestDebrisDistanceKm(
  satR: number[],
  debrisList: { id: string; r: number[] }[],
) {
  if (!satR || satR.length < 3 || !debrisList || debrisList.length === 0) return NaN;
  let minDist = Number.POSITIVE_INFINITY;
  debrisList.forEach((deb) => {
    if (!deb.r || deb.r.length < 3) return;
    const dx = satR[0] - deb.r[0];
    const dy = satR[1] - deb.r[1];
    const dz = satR[2] - deb.r[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < minDist) minDist = d;
  });
  return Number.isFinite(minDist) ? minDist : NaN;
}

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

function eciToLatLonAlt(r: number[]) {
  const mag = Math.sqrt(r[0]**2 + r[1]**2 + r[2]**2);
  const lat = Math.asin(r[2] / Math.max(1e-9, mag)) * 180 / Math.PI;
  const gmst = gmstRadAt(new Date());
  let lon = (Math.atan2(r[1], r[0]) - gmst) * 180 / Math.PI;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  const alt = mag - 6378.137;
  return { lat, lon, alt };
}

function satToRow(sat: LiveSat, debrisList: { id: string; r: number[] }[], at: Date): Satellite {
  const { lat, lon, alt } = eciToLatLonAlt(sat.r);
  const vel = norm3(sat.v);
  const fuelPct = Math.min(100, (sat.fuel / 50) * 100);
  const { azDeg, elDeg } = eciToAzEl(
    sat.r,
    DEFAULT_GROUND_STATION.latDeg,
    DEFAULT_GROUND_STATION.lonDeg,
    DEFAULT_GROUND_STATION.elevM,
    at,
  );
  const nearestDebrisKm = nearestDebrisDistanceKm(sat.r, debrisList);
  return {
    id: sat.id, name: sat.id,
    az: Number.isFinite(azDeg) ? `${azDeg.toFixed(1)}°` : '—',
    el: Number.isFinite(elDeg) ? `${elDeg.toFixed(1)}°` : '—',
    altitude:   `${alt.toFixed(1)} km`,
    latitude:   `${lat.toFixed(4)}°`,
    longitude:  `${lon.toFixed(4)}°`,
    velocity:   `${vel.toFixed(2)} km/s`,
    propellant: `${sat.fuel.toFixed(2)} kg`,
    debris:     Number.isFinite(nearestDebrisKm) ? `${nearestDebrisKm.toFixed(1)} km` : '—',
    status:     sat.status || 'NOMINAL',
    fuelPct,
    r: sat.r, v: sat.v,
  };
}

function parseNumericValue(value: string) {
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// ── Live data hook ────────────────────────────────────────────────────────────
function useLiveData() {
  const [satellites,    setSatellites]    = useState<LiveSat[]>([]);
  const [debrisList,    setDebrisList]    = useState<{id:string;r:number[];v:number[]}[]>([]);
  const [counts,        setCounts]        = useState({ satellites:0, debris:0, at_risk:0 });
  const [connected,     setConnected]     = useState(false);
  const [istTime,       setIstTime]       = useState('--:--:--');
  const [liveDataReady, setLiveDataReady] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // ── Stability tracking ─────────────────────────────────────────────────────
  // The mock grader init loop posts 50 satellites one-by-one. The backend
  // broadcasts a state_update after EACH post, so early messages carry
  // partially-populated fleets (e.g. 1 real + 49 stale DB positions).
  //
  // Strategy: buffer every incoming update but only commit to React state
  // (and flip liveDataReady) once the satellite count has been the SAME
  // for STABLE_COUNT_HITS_REQUIRED consecutive messages AND ≥ MIN_SAT_COUNT.
  // This waits for the entire init loop to settle before showing anything.
  //
  // "Same count" is the stability signal: the count grows during init,
  // then plateaus. That plateau = all satellites registered = safe to render.
  const prevStaleCountRef = useRef<number | null>(null);
  const stableHitsRef     = useRef<number>(0);
  const firstMsgTimeRef   = useRef<number | null>(null);
  const pendingSatsRef    = useRef<LiveSat[]>([]);
  const pendingDebrisRef  = useRef<{id:string;r:number[];v:number[]}[]>([]);

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
      // Reset stability state on reconnect
      prevStaleCountRef.current = null;
      stableHitsRef.current     = 0;
      firstMsgTimeRef.current   = null;
      pendingSatsRef.current    = [];
      pendingDebrisRef.current  = [];

      const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws`);
      wsRef.current = ws;
      ws.onopen = () => { setConnected(true); ws.send(JSON.stringify({type:'get_state'})); };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'state_update') {
            const incomingSats  = msg.satellites || [];
            const compact       = msg.debris_compact || [];
            const satCount      = incomingSats.length;

            // Always update the header counts (cheap, always visible)
            setCounts({
              satellites: msg.sat_count || satCount,
              debris:     msg.debris_count || compact.length,
              at_risk:    incomingSats.filter((s:LiveSat) =>
                s.status==='AT_RISK'||s.status==='MANEUVERING').length,
            });

            // Buffer the latest payload — we'll commit it once stable
            pendingSatsRef.current = incomingSats;
            if (compact.length > 0) {
              pendingDebrisRef.current = compact.map((d: any) => ({
                id: d[0], r: [d[1], d[2], d[3]]
              }));
            }

            // ── Fleet freshness check (Definitive 'live' signal) ─────────────
            // We only flip liveDataReady=true once the mock grader has finished
            // its initial population loop. We detect this by checking if every
            // sat is fresh, OR if the stale count has plateaued.
            const nowSeconds   = Date.now() / 1000;
            const freshSats    = incomingSats.filter((s: LiveSat) => (nowSeconds - s.lastUpdate) < 30);
            const staleCount   = incomingSats.length - freshSats.length;

            if (firstMsgTimeRef.current === null) {
              firstMsgTimeRef.current = nowSeconds;
            }

            // Track if the stale count is still dropping (grader still working)
            if (staleCount < (prevStaleCountRef.current ?? 9999)) {
              stableHitsRef.current = 0;
            } else if (incomingSats.length > 0) {
              stableHitsRef.current += 1;
            }
            prevStaleCountRef.current = staleCount;

            const isStable = stableHitsRef.current >= 4;
            const hasData  = freshSats.length >= 5;
            const timeout  = (nowSeconds - (firstMsgTimeRef.current || 0)) > 12;

            // Switch to LIVE if everyone is fresh, plateaued, or timeout reached
            if (staleCount === 0 || (isStable && hasData) || timeout) {
              if (timeout && !liveDataReady) {
                console.warn(`[TELEMETRY] Failsafe triggered — forcing map load (Stale: ${staleCount})`);
              }
              setSatellites(pendingSatsRef.current);
              if (pendingDebrisRef.current.length > 0) {
                setDebrisList(pendingDebrisRef.current);
              }
              setLiveDataReady(true);
            } else if (!liveDataReady) {
              console.log(`[TELEMETRY] Population loop active... (Fresh: ${freshSats.length}, Stale: ${staleCount}, Stable: ${stableHitsRef.current})`);
            } else {
              // Already live? Keep updating normally.
              setSatellites(pendingSatsRef.current);
              if (pendingDebrisRef.current.length > 0) {
                setDebrisList(pendingDebrisRef.current);
              }
            }
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

  return { satellites, debrisList, counts, connected, istTime, liveDataReady };
}


// ── Three.js Globe ───────────────────────────────────────────────────────────
export function GlobeView({
  satellites, debrisList, selectedId, onSelect
}: {
  satellites: Satellite[];
  debrisList: {id:string; r:number[]}[];
  selectedId: string;
  // ctrlOpen: true when Ctrl/Cmd was held — parent decides whether to open a new tab
  onSelect: (id: string, ctrlOpen?: boolean) => void;
}) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const sceneRef    = useRef<any>(null);
  const cameraRef   = useRef<any>(null);
  const rendererRef = useRef<any>(null);
  const globeRef    = useRef<any>(null);
  const earthRef    = useRef<any>(null);
  const debrisPointsRef = useRef<any>(null);
  const groupRef    = useRef<any>(null);   // globe + satellites group
  const rafRef      = useRef<number>(0);
  const dragRef     = useRef({ dragging: false, lastX: 0, lastY: 0, velX: 0, velY: 0 });
  const rotRef      = useRef({ x: 0.3, y: 0 });
  const centerTargetRef = useRef<{ x: number; y: number } | null>(null);
  const centeredSelectionRef = useRef<string>('');
  const autoSpinRef = useRef(true);
  const satMeshesRef = useRef<Record<string, any>>({});
  const orbitLinesRef = useRef<Record<string, any>>({});
  const glowTextureRef = useRef<any>(null);
  const ringTextureRef = useRef<any>(null);
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
    const mat  = new THREE.MeshPhongMaterial({ map: tex, specular: new THREE.Color(0x111122), shininess: 8 });
    const globe = new THREE.Mesh(geo, mat);
    earthRef.current = globe;
    group.add(globe);
    globeRef.current = globe;

    // GPU-Optimized Debris (Points + BufferGeometry)
    const pointsGeo = new THREE.BufferGeometry();
    const pointsMat = new THREE.PointsMaterial({ color: 0xff4d4d, size: 0.014, sizeAttenuation: true });
    const pointsMesh = new THREE.Points(pointsGeo, pointsMat);
    group.add(pointsMesh);
    debrisPointsRef.current = pointsMesh;

    // Build a dedicated radial texture so glow is visible beyond the satellite icon edges.
    if (!glowTextureRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const grad = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
        grad.addColorStop(0, 'rgba(255,255,255,0.45)');
        grad.addColorStop(0.25, 'rgba(140,200,255,0.35)');
        grad.addColorStop(0.6, 'rgba(70,130,255,0.14)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 128, 128);
      }
      const glowTex = new THREE.CanvasTexture(canvas);
      glowTex.needsUpdate = true;
      glowTextureRef.current = glowTex;
    }

    if (!ringTextureRef.current) {
      const ringCanvas = document.createElement('canvas');
      ringCanvas.width = 128;
      ringCanvas.height = 128;
      const ringCtx = ringCanvas.getContext('2d');
      if (ringCtx) {
        const cx = 64;
        const cy = 64;
        const outer = 58;
        const inner = 42;
        ringCtx.clearRect(0, 0, 128, 128);
        ringCtx.beginPath();
        ringCtx.arc(cx, cy, outer, 0, Math.PI * 2);
        ringCtx.arc(cx, cy, inner, 0, Math.PI * 2, true);
        ringCtx.closePath();
        const grad = ringCtx.createRadialGradient(cx, cy, inner, cx, cy, outer);
        grad.addColorStop(0, 'rgba(255,255,255,0.0)');
        grad.addColorStop(0.55, 'rgba(255,255,255,0.65)');
        grad.addColorStop(1, 'rgba(255,255,255,0.0)');
        ringCtx.fillStyle = grad;
        ringCtx.fill();
      }
      const ringTex = new THREE.CanvasTexture(ringCanvas);
      ringTex.needsUpdate = true;
      ringTextureRef.current = ringTex;
    }

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
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (earthRef.current) {
        earthRef.current.rotation.y = gmstRadAt(new Date());
      }
      if (!dragRef.current.dragging && centerTargetRef.current) {
        const tx = centerTargetRef.current.x;
        const ty = centerTargetRef.current.y;
        const dy = ((ty - rotRef.current.y + Math.PI) % (2 * Math.PI)) - Math.PI;
        rotRef.current.x += (tx - rotRef.current.x) * 0.14;
        rotRef.current.y += dy * 0.14;
        dragRef.current.velX *= 0.7;
        dragRef.current.velY *= 0.7;
        if (Math.abs(tx - rotRef.current.x) < 0.0015 && Math.abs(dy) < 0.0015) {
          centerTargetRef.current = null;
        }
      } else {
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
      }
      group.rotation.x = rotRef.current.x;
      group.rotation.y = rotRef.current.y;

      // Pulse the satellite glow to mimic realistic bloom in the reference UI
      const t = performance.now() * 0.002;
      Object.values(satMeshesRef.current).forEach((sprite: any) => {
        const glow = sprite?.userData?.glow;
        const glowOuter = sprite?.userData?.glowOuter;
        const ring = sprite?.userData?.ring;
        const ringGlow = sprite?.userData?.ringGlow;
        if (!glow || !glowOuter || !ring || !ringGlow) return;
        const base = sprite.userData?.isAtRisk ? 1.08 : sprite.userData?.isRecovering ? 0.98 : sprite.userData?.isSelected ? 1.00 : 0.72;
        const pulse = 0.12 * (0.5 + 0.5 * Math.sin(t + (sprite.userData?.phase || 0)));
        const k = base + pulse;
        // Halo sprites are children of the satellite sprite, so compensate for parent scale.
        const invScale = 1 / Math.max(sprite.scale.x, 0.001);
        glow.scale.set((0.085 * k) * invScale, (0.085 * k) * invScale, 1);
        glowOuter.scale.set((0.145 * k) * invScale, (0.145 * k) * invScale, 1);
        ring.scale.set((0.115 * k) * invScale, (0.115 * k) * invScale, 1);
        ringGlow.scale.set((0.145 * k) * invScale, (0.145 * k) * invScale, 1);
        glow.material.opacity = sprite.userData?.isAtRisk ? 0.74 : sprite.userData?.isSelected ? 0.66 : 0.18;
        glowOuter.material.opacity = sprite.userData?.isAtRisk ? 0.42 : sprite.userData?.isSelected ? 0.34 : 0.08;
        ring.material.opacity = sprite.userData?.isAtRisk ? 0.95 : sprite.userData?.isRecovering ? 0.82 : sprite.userData?.isSelected ? 0.78 : 0.55;
        ringGlow.material.opacity = sprite.userData?.isAtRisk ? 0.52 : sprite.userData?.isRecovering ? 0.42 : sprite.userData?.isSelected ? 0.36 : 0.2;
      });

      renderer.render(scene, camera);
    };
    loop();
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
      const isRecovering = sat.status === 'RECOVERING';
      const orbitColor = isAtRisk ? 0xff6644 : isSelected ? 0x9747ff : 0x3a7fff;

      // Satellite sprite (uses imgSatellite texture)
      if (!satMeshesRef.current[sat.id]) {
        const tex = loader.load(imgSatellite);
        const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff, transparent: true, depthTest: true, sizeAttenuation: true });
        const sprite = new THREE.Sprite(mat);
        sprite.userData.satId = sat.id;

        // Soft glow halo layered behind the satellite image
        const glowMat = new THREE.SpriteMaterial({
          map: glowTextureRef.current || tex,
          color: 0x3a7fff,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Sprite(glowMat);
        glow.renderOrder = 10;

        // Larger outer bloom ring for long-distance visibility.
        const glowOuterMat = new THREE.SpriteMaterial({
          map: glowTextureRef.current || tex,
          color: 0x4ea0ff,
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        });
        const glowOuter = new THREE.Sprite(glowOuterMat);
        glowOuter.renderOrder = 9;

        const ringMat = new THREE.SpriteMaterial({
          map: ringTextureRef.current,
          color: 0x66aaff,
          transparent: true,
          opacity: 0.7,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        });
        const ring = new THREE.Sprite(ringMat);
        ring.renderOrder = 12;

        const ringGlowMat = new THREE.SpriteMaterial({
          map: glowTextureRef.current,
          color: 0x66aaff,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
          depthTest: false,
          toneMapped: false,
          blending: THREE.AdditiveBlending,
        });
        const ringGlow = new THREE.Sprite(ringGlowMat);
        ringGlow.renderOrder = 11;

        sprite.add(glow);
        sprite.add(glowOuter);
        sprite.add(ringGlow);
        sprite.add(ring);
        sprite.userData.glow = glow;
        sprite.userData.glowOuter = glowOuter;
        sprite.userData.ring = ring;
        sprite.userData.ringGlow = ringGlow;
        sprite.userData.phase = Math.random() * Math.PI * 2;

        group.add(sprite);
        satMeshesRef.current[sat.id] = sprite;
      }
      const sprite = satMeshesRef.current[sat.id];
      const [x, y, z] = eciToThree(sat.r, norm3(sat.r) - 6378.137);
      sprite.position.set(x, y, z);
      sprite.material.color.setHex(0xffffff);
      const scale = isSelected ? 0.10 : 0.065;
      sprite.scale.set(scale, scale, scale);
      sprite.userData.isSelected = isSelected;
      sprite.userData.isAtRisk = isAtRisk;
      sprite.userData.isRecovering = isRecovering;

      const glow = sprite.userData.glow;
      const glowOuter = sprite.userData.glowOuter;
      const ring = sprite.userData.ring;
      const ringGlow = sprite.userData.ringGlow;
      if (glow && glowOuter && ring && ringGlow) {
        const glowColor = isAtRisk ? 0xff5d2a : isRecovering ? 0xffb347 : isSelected ? 0x57a6ff : 0x4e98ff;
        const outerColor = isAtRisk ? 0xff954d : isRecovering ? 0xffcf73 : isSelected ? 0x8cc7ff : 0x8fc1ff;
        const ringColor = isAtRisk ? 0xff3d2a : isRecovering ? 0xffb347 : 0x5ea8ff;
        glow.material.color.setHex(glowColor);
        glowOuter.material.color.setHex(outerColor);
        ring.material.color.setHex(ringColor);
        ringGlow.material.color.setHex(ringColor);
      }

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

    // Debris Visualization (Optimized Points loop)
    if (debrisPointsRef.current && debrisList.length > 0) {
      const positions = new Float32Array(debrisList.length * 3);
      debrisList.forEach((deb, i) => {
        if (!deb.r) return;
        const [x, y, z] = eciToThree(deb.r, norm3(deb.r) - 6378.137);
        positions[i*3] = x;
        positions[i*3+1] = y;
        positions[i*3+2] = z;
      });
      debrisPointsRef.current.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      debrisPointsRef.current.geometry.attributes.position.needsUpdate = true;
    }
  }, [THREE, satellites, debrisList, selectedId, ready, eciToThree]);

  // Auto-center selected satellite in 3D globe view on selection change.
  useEffect(() => {
    if (!THREE || !ready || !selectedId) return;
    if (centeredSelectionRef.current === selectedId) return;

    const sat = satellites.find((s) => s.id === selectedId);
    if (!sat?.r || sat.r.length < 3) return;

    const [sx, sy, sz] = eciToThree(sat.r, norm3(sat.r) - 6378.137);
    // Solve yaw then pitch so the selected satellite moves to camera center (+Z in scene).
    const targetY = Math.atan2(-sx, sz);
    const cosY = Math.cos(targetY);
    const sinY = Math.sin(targetY);
    const zAfterY = -sinY * sx + cosY * sz;
    const targetX = Math.atan2(sy, zAfterY);

    centerTargetRef.current = {
      x: Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, targetX)),
      y: targetY,
    };
    centeredSelectionRef.current = selectedId;
    dragRef.current.velX = 0;
    dragRef.current.velY = 0;
  }, [THREE, ready, selectedId, satellites, eciToThree]);

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
  // Normal click → select only (no new tab)
  // Ctrl/Cmd + click → open in new tab (handled by parent via ctrlKey flag)
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
      if (id) {
        // Pass ctrlKey (Windows/Linux) or metaKey (Mac) flag to parent
        const isCtrl = e.ctrlKey || e.metaKey;
        onSelect(id, isCtrl);
      }
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

      {/* 3D legend */}
      <div style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        zIndex: 5,
        padding: '8px 10px',
        borderRadius: 6,
        border: '1px solid rgba(58,127,255,0.25)',
        background: 'rgba(5,9,19,0.82)',
        color: '#a7b8d1',
        fontSize: 9,
        fontFamily: 'Azeret Mono, monospace',
        letterSpacing: 0.5,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 138,
      }}>
        <div style={{ color: '#7f94b4', fontSize: 8, letterSpacing: 1.1 }}>3D GUIDE</div>
        <div style={{ color: 'rgba(136,146,164,0.65)', fontSize: 7.5, letterSpacing: 0.3,
          borderBottom: '1px solid rgba(58,127,255,0.12)', paddingBottom: 5, marginBottom: 2 }}>
          CLICK · SELECT&nbsp;&nbsp;CTRL+CLICK · TAB
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#3a7fff',
            boxShadow: '0 0 6px rgba(58,127,255,0.9)',
            flexShrink: 0,
          }} />
          <span>Satellite</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#ff4d4d',
            boxShadow: '0 0 5px rgba(255,77,77,0.9)',
            flexShrink: 0,
          }} />
          <span>Debris</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 14,
            height: 0,
            borderTop: '2px solid #9747ff',
            opacity: 0.9,
            flexShrink: 0,
          }} />
          <span>Selected Orbit Path</span>
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
    <div className="absolute bg-[#0b1124] h-[350px] left-[1390px] overflow-clip rounded-[6px] top-[94px] w-[592px]"
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
  height: 'auto',
  display: 'flex',
  flexDirection: 'column',
  padding: '10px',
  margin: '8px',
  border: '1px solid #1f3c5e',
  borderRadius:'8px',
  background: '#0B1124',
  boxSizing: 'border-box',
  minHeight: 0,
}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3a7fff', flexShrink: 0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: '#3a7fff', fontSize: 13, fontFamily: 'Azeret Mono, monospace', letterSpacing: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          BULLSEYE — {satellite?.name ?? 'NO TARGET'}
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
  padding: '6px 8px 7px 8px',
  margin: 0,
  border: '1px solid #1f3c5e',
  borderRadius:'8px',
  background: '#0A1124',
  fontFamily: 'SF Compact Rounded, sans-serif',
  boxSizing: 'border-box',
  minHeight: 0,
}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, background:'#0E1B2E' , marginBottom: 5, padding:'3px 5px' }}>
        <motion.div style={{ width: 6, height: 6, borderRadius: '50%', background: isAtRisk ? '#ff4444' : '#00ff88', flexShrink: 0 }}
          animate={{ opacity:[1,0.3,1] }} transition={{ duration:1.5, repeat:Infinity }} />
        <p style={{ color: '#d2d2d2', fontSize: 11, fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Telemetry: {sat?.name ?? '— Select satellite'}
        </p>
        {isAtRisk && <span style={{ marginLeft: 'auto', fontSize: 9, background: '#ff4444', color: 'white', padding: '1px 5px', borderRadius: 3, fontWeight: 700, flexShrink: 0 }}>{sat?.status}</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px 5px', fontSize: 11, lineHeight: 1.08, alignContent: 'start', gridAutoRows: 'min-content', flex: '0 0 auto' }}>
        {[['Altitude',sat?.altitude??'—'],['Longitude',sat?.longitude??'—'],['Propellant',sat?.propellant??'—'],
          ['Latitude',sat?.latitude??'—'],['Velocity',sat?.velocity??'—'],['Status',sat?.status??'NOMINAL']
        ].map(([label,value])=>(
          <div key={label}>
            <p style={{ color: '#555', fontSize: 11, marginBottom: 1, lineHeight: 1.08 }}>{label}</p>
            <p style={{ fontSize: 11, color: label==='Status'&&isAtRisk?'#ff4444':'white', lineHeight: 1.08 }}>{value}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <p style={{ color: '#666', fontSize: 10 }}>Fuel Reserve</p>
          <p style={{ color: 'white', fontSize: 10 }}>{fuelPct.toFixed(0)}%</p>
        </div>
        <div style={{ height: 4, background: '#1a2540', borderRadius: 3, overflow: 'hidden' }}>
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

  padding: '6px',
  margin: 0,
  border: alert ? '1px solid #ff4442' : '1px solid #1f3c5e',
  borderRadius:'8px',
  background: '#0A1124',
  fontFamily: 'SF Compact Rounded, sans-serif',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
}}
      animate={{ boxShadow: alert?['0 0 6px rgba(255,68,66,0.15)','0 0 12px rgba(255,68,66,0.3)','0 0 6px rgba(255,68,66,0.15)']:'none' }}
      transition={{ duration:2, repeat: alert?Infinity:0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, }}>
        <p style={{ color: '#d2d2d2', fontSize: 11, fontWeight: 600, lineHeight: 1.15 }}>
          {alert ? `⚠ ALERT: ${alert.name}` : '✓ All Systems Nominal'}
        </p>
        <div style={{ border: `1px solid ${alert?'#ff4442':'#00ff88'}`, borderRadius: 4, padding: '1px 6px', flexShrink: 0 }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: alert?'#ff4442':'#00ff88' }}>{alert?alert.status:'NOMINAL'}</p>
        </div>
      </div>
      {alert ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 5px', fontSize: 11, lineHeight: 1.08, overflowY: 'auto', minHeight: 0, flex: 1, paddingRight: 2, scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}>
          <p style={{ color: '#555' }}>Satellite</p><p style={{ color: 'white' }}>{alert.name}</p>
          <p style={{ color: '#555' }}>Altitude</p><p style={{ color: 'white' }}>{alert.altitude}</p>
          <p style={{ color: '#555' }}>Fuel</p><p style={{ color: 'white' }}>{alert.propellant}</p>
          <p style={{ color: '#555' }}>Velocity</p><p style={{ color: 'white' }}>{alert.velocity}</p>
        </div>
      ) : (
        <p style={{ color: '#2a2a3a', fontSize: 11 }}>No active conjunction threats detected.</p>
      )}
      {atRisk.length > 1 && <p style={{ color: '#ff8800', fontSize: 10, marginTop: 3, lineHeight: 1.05 }}>+{atRisk.length-1} more satellites at risk</p>}
    </motion.div>
  );
}

function GroundTrackModule({ liveSats, selectedId }: { liveSats: LiveSat[]; selectedId?: string }) {
  const [trails, setTrails] = useState<Record<string, TrackPoint[]>>({});
  const [projectionMode, setProjectionMode] = useState<'mercator' | 'equirect'>('mercator');

  useEffect(() => {
    const now = Date.now();
    setTrails((prev) => {
      const next: Record<string, TrackPoint[]> = { ...prev };
      liveSats.forEach((s) => {
        if (!s.r || s.r.length < 3) return;
        const p = eciToLatLonAlt(s.r);
        const arr = next[s.id] ? [...next[s.id], { t: now, lat: p.lat, lon: p.lon }] : [{ t: now, lat: p.lat, lon: p.lon }];
        next[s.id] = arr.filter((x) => now - x.t <= 90 * 60 * 1000).slice(-220);
      });
      return next;
    });
  }, [liveSats]);

  const project = (lat: number, lon: number) => {
    const x = ((lon + 180) / 360) * 100;
    const y = projectionMode === 'equirect'
      ? ((90 - lat) / 180) * 50
      : (() => {
          const latRad = Math.max(-85, Math.min(85, lat)) * Math.PI / 180;
          const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
          return (1 - (mercN / Math.PI)) * 50;
        })();
    return { x, y };
  };

  // ── Compute proper astronomical day/night terminator ──────────────────────
  // Uses the subsolar point (where the Sun is directly overhead) to compute
  // the real terminator boundary. This is timezone-independent — new Date()
  // gives the correct UTC instant for astronomical computation.
  const nightPolygonPath = useMemo(() => {
    const now = new Date();
    const jd = now.getTime() / 86_400_000 + 2_440_587.5;
    const n = jd - 2_451_545.0;
    const L = (280.46 + 0.9856474 * n) % 360;
    const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
    const lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
    const eps = (23.439 - 4e-7 * n) * (Math.PI / 180);
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const gst = ((280.46061837 + 360.98564736629 * n) % 360) * (Math.PI / 180);
    const subSolarLon = ((ra - gst) * 180 / Math.PI + 180) % 360 - 180 + 360;

    // Build terminator polygon in SVG viewBox coords (0-100 x, 0-50 y)
    const STEPS = 72;
    const nightPoints: string[] = [];

    for (let i = 0; i <= STEPS; i++) {
      const latDeg = 90 - (i / STEPS) * 180;
      const latRad = latDeg * (Math.PI / 180);
      const cosDec = Math.cos(dec);
      const cosLat = Math.cos(latRad);

      let haDeg: number;
      if (cosDec * cosLat === 0) {
        // Polar edge case
        haDeg = (Math.sin(dec) * Math.sin(latRad) > 0) ? 180 : 0;
      } else {
        const cosHA = -(Math.sin(dec) * Math.sin(latRad)) / (cosDec * cosLat);
        if (cosHA <= -1) {
          haDeg = 180; // Midnight sun — entire latitude is lit
        } else if (cosHA >= 1) {
          haDeg = 0; // Polar night — entire latitude is dark
        } else {
          haDeg = Math.acos(cosHA) * (180 / Math.PI);
        }
      }

      // Night side boundary longitude (anti-solar side)
      // The terminator is at subSolarLon ± haDeg
      // Night boundary: subSolarLon + haDeg (eastern edge of night)
      const nightBoundaryLon = ((subSolarLon + haDeg + 180) % 360 + 360) % 360;
      const x = (nightBoundaryLon / 360) * 100;
      const y = (i / STEPS) * 50;
      nightPoints.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }

    // Reverse pass: western edge of night
    for (let i = STEPS; i >= 0; i--) {
      const latDeg = 90 - (i / STEPS) * 180;
      const latRad = latDeg * (Math.PI / 180);
      const cosDec = Math.cos(dec);
      const cosLat = Math.cos(latRad);

      let haDeg: number;
      if (cosDec * cosLat === 0) {
        haDeg = (Math.sin(dec) * Math.sin(latRad) > 0) ? 180 : 0;
      } else {
        const cosHA = -(Math.sin(dec) * Math.sin(latRad)) / (cosDec * cosLat);
        if (cosHA <= -1) {
          haDeg = 180;
        } else if (cosHA >= 1) {
          haDeg = 0;
        } else {
          haDeg = Math.acos(cosHA) * (180 / Math.PI);
        }
      }

      // Western edge: subSolarLon - haDeg
      const nightBoundaryLon = ((subSolarLon - haDeg + 180) % 360 + 360) % 360;
      const x = (nightBoundaryLon / 360) * 100;
      const y = (i / STEPS) * 50;
      nightPoints.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }

    return nightPoints.join(' ');
  }, [Math.floor(Date.now() / 60000)]); // Recompute every minute

  const atRiskCount = liveSats.filter((s) => s.status === 'AT_RISK' || s.status === 'MANEUVERING').length;
  const selectedTrailCoverage = selectedId ? Math.min(100, Math.round(((trails[selectedId]?.length || 0) / 220) * 100)) : 0;
  const projectionLabel = projectionMode === 'mercator' ? 'Mercator' : 'Equirectangular';

  return (
    <div style={{ background: '#081022', border: '1px solid #1f3c5e', borderRadius: 8, padding: '6px 6px 4px 6px', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4, flexShrink: 0 }}>
        <p style={{ color: '#8aa8d8', fontSize: 11, letterSpacing: 1 }}>GROUND TRACK</p>
        <div style={{ display: 'flex', gap: 8, color: '#8ea3bf', fontSize: 10 }}>
          <button
            onClick={() => setProjectionMode((prev) => (prev === 'mercator' ? 'equirect' : 'mercator'))}
            style={{
              border: '1px solid #2f4b6b',
              borderRadius: 4,
              background: '#0f1e33',
              color: '#9fc2ea',
              fontSize: 9,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
            title="Toggle map projection"
          >
            {projectionLabel}
          </button>
          <span>Sat: {liveSats.length}</span>
          <span>Risk: {atRiskCount}</span>
          {selectedId && <span>Track: {selectedTrailCoverage}%</span>}
        </div>
      </div>
      <svg viewBox="0 0 100 50" style={{ width: '100%', flex: 1, minHeight: 0, background: 'linear-gradient(180deg,#09172d,#070b16)' }}>
        <polygon points={nightPolygonPath} fill="rgba(3,3,8,0.42)" />
        {[...Array(6)].map((_, i) => (
          <line key={`lat-${i}`} x1="0" x2="100" y1={i * 10} y2={i * 10} stroke="rgba(170,190,220,0.12)" strokeWidth="0.2" />
        ))}
        {[...Array(9)].map((_, i) => (
          <line key={`lon-${i}`} y1="0" y2="50" x1={i * 12.5} x2={i * 12.5} stroke="rgba(170,190,220,0.1)" strokeWidth="0.2" />
        ))}

        {liveSats.map((s) => {
          const trail = trails[s.id] || [];
          if (!s.r || s.r.length < 3) return null;
          const isSelected = Boolean(selectedId && s.id === selectedId);
          const cur = eciToLatLonAlt(s.r);
          const curP = project(cur.lat, cur.lon);

          // Trail: already capped at 90 min by the useEffect filter
          const trailPts = trail.map((p) => {
            const q = project(p.lat, p.lon);
            return `${q.x},${q.y}`;
          }).join(' ');

          // Prediction: 18 × 5-min steps = exactly 90 min ahead
          // Uses Keplerian two-body integration for curved path accuracy
          const MU_GT = 398600.4418;
          const pred: string[] = [];
          if (isSelected && s.v && s.v.length === 3) {
            const DT = 300; // 5 minutes in seconds
            const STEPS = 18; // 18 × 5 min = 90 min
            let pr = [...s.r];
            let pv = [...s.v];
            for (let step = 0; step < STEPS; step++) {
              const mag = Math.sqrt(pr[0]**2 + pr[1]**2 + pr[2]**2);
              const k = -MU_GT / (mag * mag * mag);
              pv = [pv[0] + k * pr[0] * DT, pv[1] + k * pr[1] * DT, pv[2] + k * pr[2] * DT];
              pr = [pr[0] + pv[0] * DT, pr[1] + pv[1] * DT, pr[2] + pv[2] * DT];
              const ll = eciToLatLonAlt(pr);
              const q = project(ll.lat, ll.lon);
              pred.push(`${q.x.toFixed(2)},${q.y.toFixed(2)}`);
            }
          }

          return (
            <g key={s.id}>
              {trailPts.length > 0 && <polyline points={trailPts} fill="none" stroke={isSelected ? 'rgba(128,204,255,0.9)' : 'rgba(84,161,255,0.55)'} strokeWidth={isSelected ? '0.5' : '0.35'} />}
              {isSelected && pred.length > 1 && <polyline points={pred.join(' ')} fill="none" stroke="rgba(255,185,96,0.75)" strokeDasharray="1 1" strokeWidth="0.35" />}
              {isSelected && <circle cx={curP.x} cy={curP.y} r="1.35" fill="none" stroke="white" strokeWidth="0.35" />}
              <circle cx={curP.x} cy={curP.y} r={isSelected ? '0.9' : '0.7'} fill={s.status === 'AT_RISK' || s.status === 'MANEUVERING' ? '#ff5b4d' : '#52a5ff'} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ResourceHeatmapModule({ satellites, selectedSatellite }: { satellites: Satellite[]; selectedSatellite?: Satellite }) {
  const risk = satellites.filter((s) => s.status === 'AT_RISK' || s.status === 'MANEUVERING').length;
  const lowFuelCount = satellites.filter((s) => s.fuelPct <= 25).length;
  const avgFuelPct = satellites.length ? satellites.reduce((acc, s) => acc + s.fuelPct, 0) / satellites.length : 0;
  const totalFuelUsed = satellites.reduce((acc, s) => {
    const propellantKg = parseNumericValue(s.propellant);
    return acc + Math.max(0, 50 - (Number.isFinite(propellantKg) ? propellantKg : 0));
  }, 0);
  const closeApproachCount = satellites.filter((s) => {
    const debrisKm = parseNumericValue(s.debris);
    return Number.isFinite(debrisKm) && debrisKm <= 500;
  }).length;
  const operationalScore = Math.max(0, Math.min(100, 100 - (risk * 12 + lowFuelCount * 5 + closeApproachCount * 3)));
  const autonomyHours = Math.max(4, Math.round((avgFuelPct / 100) * 72));

  const rankedRisk = useMemo(() => {
    return satellites
      .map((s) => {
        const debrisKm = parseNumericValue(s.debris);
        const debrisFactor = Number.isFinite(debrisKm) ? Math.max(0, (500 - Math.min(500, debrisKm)) / 5) : 0;
        const statusFactor = s.status === 'MANEUVERING' ? 25 : s.status === 'AT_RISK' ? 15 : 0;
        const fuelFactor = Math.max(0, 30 - s.fuelPct * 0.3);
        const score = Math.max(0, Math.min(100, debrisFactor + statusFactor + fuelFactor));
        return { id: s.id, debrisKm, score, status: s.status };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [satellites]);

  const selectedRiskScore = useMemo(() => {
    if (!selectedSatellite) return null;
    const match = rankedRisk.find((r) => r.id === selectedSatellite.id);
    return match?.score ?? null;
  }, [selectedSatellite, rankedRisk]);

  return (
    <div style={{ background: '#0a1124', border: '1px solid #1f3c5e', borderRadius: 8, height: '100%', overflow: 'hidden', display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr', boxSizing: 'border-box' }}>
      <style>{`
        #heatmap-scrollable::-webkit-scrollbar { width: 8px; }
        #heatmap-scrollable::-webkit-scrollbar-track { background: transparent; }
        #heatmap-scrollable::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 4px; }
        #heatmap-scrollable::-webkit-scrollbar-thumb:hover { background: #2a5a9f; }
        #threat-pressure-index::-webkit-scrollbar { width: 8px; }
        #threat-pressure-index::-webkit-scrollbar-track { background: transparent; }
        #threat-pressure-index::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 4px; }
        #threat-pressure-index::-webkit-scrollbar-thumb:hover { background: #2a5a9f; }
      `}</style>

      {/* Left: heading + scrollable fuel bars */}
      <div style={{ gridColumn: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #1a2a42', overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a2a42', flexShrink: 0, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ color: '#8aa8d8', fontSize: 11, letterSpacing: 1, margin: 0 }}>TELEMETRY & RESOURCE HEATMAP</p>
          <p style={{ color: '#89e0ff', fontSize: 10, margin: 0 }}>Score {operationalScore.toFixed(0)}/100</p>
        </div>
        <div id="heatmap-scrollable" style={{ overflowY: 'auto', padding: '8px 8px 8px 12px', flex: 1, scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}>
          {satellites.slice().sort((a, b) => a.fuelPct - b.fuelPct).slice(0, 16).map((s) => {
            const pct = Math.max(0, Math.min(100, s.fuelPct));
            const color = pct > 50 ? '#00d084' : pct > 20 ? '#ffad33' : '#ff5b4d';
            return (
              <div key={s.id} style={{ marginBottom: 7 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#97a9c6' }}>
                  <span>{s.id}</span><span>{pct.toFixed(0)}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 4, background: '#152238' }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: risk pressure + fleet KPIs */}
      <div style={{ gridColumn: 2, background: '#0e1a2f', padding: '8px 10px', display: 'flex', flexDirection: 'column', minHeight: 0, gap: 8 }}>
        <p style={{ margin: 0, color: '#9cb0cc', fontSize: 10, flexShrink: 0 }}>THREAT PRESSURE INDEX</p>
        <div id="threat-pressure-index" style={{ display: 'grid', gap: 6, overflowY: 'auto', minHeight: 0, paddingRight: 2, scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}>
          {rankedRisk.map((item) => (
            <div key={item.id} style={{ background: 'rgba(11,23,39,0.9)', border: '1px solid #203550', borderRadius: 6, padding: '5px 7px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#a7bdd8', marginBottom: 4 }}>
                <span style={{ color: selectedSatellite?.id === item.id ? '#8dd8ff' : '#d2e1f4' }}>{item.id}</span>
                <span>{item.score.toFixed(0)}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 4, background: '#152238', overflow: 'hidden' }}>
                <div style={{ width: `${item.score}%`, height: '100%', borderRadius: 4, background: item.score >= 70 ? '#ff5b4d' : item.score >= 40 ? '#ffad33' : '#4bb5ff' }} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 'auto', fontSize: 10 }}>
          <div style={{ background: '#11223a', borderRadius: 6, padding: '6px 7px', color: '#9cb0cc' }}>Avg Fuel: <span style={{ color: 'white' }}>{avgFuelPct.toFixed(1)}%</span></div>
          <div style={{ background: '#11223a', borderRadius: 6, padding: '6px 7px', color: '#9cb0cc' }}>Autonomy: <span style={{ color: 'white' }}>{autonomyHours}h</span></div>
          <div style={{ background: '#11223a', borderRadius: 6, padding: '6px 7px', color: '#9cb0cc' }}>Fuel Used: <span style={{ color: 'white' }}>{totalFuelUsed.toFixed(1)}kg</span></div>
          <div style={{ background: '#11223a', borderRadius: 6, padding: '6px 7px', color: '#9cb0cc' }}>Close Passes: <span style={{ color: 'white' }}>{closeApproachCount}</span></div>
        </div>
        {selectedSatellite && selectedRiskScore !== null && (
          <p style={{ margin: 0, fontSize: 10, color: '#89e0ff' }}>
            Selected {selectedSatellite.id} pressure score: {selectedRiskScore.toFixed(0)}%
          </p>
        )}
      </div>
    </div>
  );
}

const THERMAL_COOLDOWN_S = 600; // must match backend THERMAL_COOLDOWN
const MIN_VISIBLE_BURN_S = 30;

interface TimelineEvent {
  satellite_id: string;
  burn_id: string;
  burn_start: number;
  burn_end: number;
  cooldown_end: number;
  status: 'PENDING' | 'EXECUTED';
  synthetic?: boolean;
}

function ManeuverTimelineModule({ selectedId, satellites }: { selectedId?: string; satellites: Satellite[] }) {
  const [pending, setPending] = useState<any[]>([]);
  const [executed, setExecuted] = useState<any[]>([]);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  // Real per-satellite history fetched from /api/maneuver/history/{sat_id}
  const [satHistories, setSatHistories] = useState<Record<string, {
    last_burn_time: number | null;
    cooldown_active: boolean;
    cooldown_remaining: number;
  }>>({});

  // ── Poll /api/maneuver/timeline every 3s ──────────────────────────────────
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch('/api/maneuver/timeline');
        if (!r.ok) return;
        const d = await r.json();
        if (stop) return;
        setPending(d.pending || []);
        setExecuted(d.executed || []);
      } catch (_) {}
    };
    poll();
    const i = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(i); };
  }, []);

  // ── Fetch real burn history for every active/at-risk satellite ────────────
  // Uses /api/maneuver/history/{sat_id} which returns:
  //   { last_burn_time, cooldown_active, cooldown_remaining }
  useEffect(() => {
    const relevantSats = satellites.filter(
      (s) => s.status === 'MANEUVERING' || s.status === 'AT_RISK' || s.status === 'POST_BURN'
    );
    if (relevantSats.length === 0) return;

    let cancelled = false;
    const fetchHistories = async () => {
      const results: typeof satHistories = {};
      await Promise.all(
        relevantSats.map(async (s) => {
          try {
            const res = await fetch(`/api/maneuver/history/${encodeURIComponent(s.id)}`);
            if (!res.ok) return;
            const data = await res.json();
            results[s.id] = {
              last_burn_time:    data.last_burn_time   ?? null,
              cooldown_active:   data.cooldown_active  ?? false,
              cooldown_remaining: data.cooldown_remaining ?? 0,
            };
          } catch (_) {}
        })
      );
      if (!cancelled) setSatHistories((prev) => ({ ...prev, ...results }));
    };

    fetchHistories();
    const iv = setInterval(fetchHistories, 5000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [satellites]);

  // ── Synthesize timeline rows from satellite status when API returns nothing ─
  // Uses real last_burn_time / cooldown_remaining from satHistories where available.
  const synthesizedFromStatus = useMemo(() => {
    const nowTs = Date.now() / 1000;
    return satellites
      .filter((s) => s.status === 'MANEUVERING' || s.status === 'AT_RISK' || s.status === 'POST_BURN')
      .map((s, idx) => {
        const hist = satHistories[s.id];
        const isManeuvering = s.status === 'MANEUVERING' || s.status === 'POST_BURN';

        let burnStart: number;
        let burnEnd: number;
        let cooldownEnd: number;

        if (hist?.last_burn_time) {
          // ── Real data path ─────────────────────────────────────────────
          burnStart   = hist.last_burn_time;
          // Backend records burn_start === burn_end (instant impulse model)
          // We display a 30s window so the bar is visible on the chart
          burnEnd     = hist.last_burn_time + 30;
          cooldownEnd = hist.last_burn_time + THERMAL_COOLDOWN_S;
        } else if (isManeuvering) {
          // ── Fallback: satellite is burning right now, no history yet ───
          // Assume burn started ~30s ago (typical ACM burn window)
          burnStart   = nowTs - 30;
          burnEnd     = nowTs + 10;
          cooldownEnd = nowTs + THERMAL_COOLDOWN_S;
        } else {
          // ── AT_RISK: burn is scheduled, place bar in the future ────────
          // cooldown_remaining tells us how long until the thruster is free
          const eta   = hist?.cooldown_remaining ?? THERMAL_COOLDOWN_S;
          burnStart   = nowTs + eta;
          burnEnd     = burnStart + 30;
          cooldownEnd = burnEnd + THERMAL_COOLDOWN_S;
        }

        return {
          satellite_id: s.id,
          burn_id:      hist?.last_burn_time
            ? `HIST-${s.id}-${Math.round(hist.last_burn_time)}`
            : `LIVE-${idx + 1}`,
          burn_start:   burnStart,
          burn_end:     burnEnd,
          cooldown_end: cooldownEnd,
          status:       isManeuvering ? 'EXECUTED' : 'PENDING',
          synthetic:    !hist?.last_burn_time,
        };
      });
  }, [satellites, satHistories]);

  const normalizedApiItems = useMemo(() => {
    const normalize = (item: any, fallbackStatus: 'PENDING' | 'EXECUTED', idx: number): TimelineEvent | null => {
      const satId = String(item?.satellite_id ?? '').trim();
      if (!satId) return null;

      const rawStart = Number(item?.burn_start ?? item?.burn_time);
      if (!Number.isFinite(rawStart)) return null;

      const rawEnd = Number(item?.burn_end ?? rawStart);
      const burnStart = rawStart;
      const burnEnd = Number.isFinite(rawEnd) && rawEnd > burnStart
        ? rawEnd
        : burnStart + MIN_VISIBLE_BURN_S;

      const rawCooldownEnd = Number(item?.cooldown_end);
      const cooldownEnd = Number.isFinite(rawCooldownEnd) && rawCooldownEnd > burnEnd
        ? rawCooldownEnd
        : burnEnd + THERMAL_COOLDOWN_S;

      return {
        satellite_id: satId,
        burn_id: String(item?.burn_id ?? `${fallbackStatus}-${satId}-${idx + 1}`),
        burn_start: burnStart,
        burn_end: burnEnd,
        cooldown_end: cooldownEnd,
        status: fallbackStatus,
        synthetic: false,
      };
    };

    const normalizedPending = pending
      .map((item, idx) => normalize(item, 'PENDING', idx))
      .filter(Boolean) as TimelineEvent[];
    const normalizedExecuted = executed
      .map((item, idx) => normalize(item, 'EXECUTED', idx))
      .filter(Boolean) as TimelineEvent[];

    return [...normalizedExecuted, ...normalizedPending];
  }, [pending, executed]);

  const sourceItems: TimelineEvent[] = normalizedApiItems.length > 0
    ? normalizedApiItems
    : synthesizedFromStatus;

  const all = sourceItems
    .sort((a, b) => Number(a.burn_start) - Number(b.burn_start))
    .slice(-28);

  const now = Date.now() / 1000;
  const pendingCount  = sourceItems.filter((m) => m.status === 'PENDING').length;
  const executedCount = sourceItems.filter((m) => m.status === 'EXECUTED').length;

  const nextSelectedBurn = selectedId
    ? all.find((m) => m.satellite_id === selectedId && m.status === 'PENDING' && Number(m.burn_start) >= now)
    : null;
  const nextGlobalBurn = all.find((m) => m.status === 'PENDING' && Number(m.burn_start) >= now);

  const etaLabel = (event: any | null) => {
    if (!event) return 'none';
    const t = Number(event.burn_start ?? now);
    const delta = Math.round(t - now);
    if (delta <= 0) return 'now';
    const m = Math.floor(delta / 60);
    const s = delta % 60;
    return `${m}m ${s}s`;
  };

  const formatUtc = (sec: number) => {
    const d = new Date(sec * 1000);
    return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  };

  // ── Time-axis computation (unchanged logic) ───────────────────────────────
  const eventStarts = all.map((m) => Number(m.burn_start || now));
  const eventEnds   = all.map((m) => Number(m.cooldown_end || m.burn_end || now));
  const rawMin = eventStarts.length ? Math.min(...eventStarts) : now;
  const rawMax = eventEnds.length   ? Math.max(...eventEnds)   : now + 3600;
  const dynamicPad = Math.max(900, (rawMax - rawMin) * 0.18);
  const tMin = Math.min(now - 1200, rawMin - dynamicPad);
  const tMax = Math.max(now + 1800, rawMax + dynamicPad);
  const span = Math.max(1, tMax - tMin);

  // Pixel-% helper: returns 0-100 position inside the chart area
  const xPct = (t: number) => Math.max(0, Math.min(100, ((t - tMin) / span) * 100));

  // 8 evenly-spaced tick marks
  const NUM_TICKS = 8;
  const tickTimes = Array.from({ length: NUM_TICKS }, (_, i) => tMin + (span * i) / (NUM_TICKS - 1));

  // Layout constants
  const LABEL_W = 72; // px — fixed left label column

  return (
    <div style={{
      background: '#08101e',
      border: '1px solid #1a2d45',
      borderRadius: 8,
      /* ── Expand / collapse height ── */
      height: isExpanded ? '70vh' : 260,
      minHeight: isExpanded ? 400 : 220,
      transition: 'height 0.3s ease-in-out, min-height 0.3s ease-in-out',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      fontFamily: 'Azeret Mono, monospace',
      /* Stick to top of scroll container when expanded */
      position: isExpanded ? 'sticky' : 'relative',
      top: isExpanded ? 0 : 'auto',
      zIndex: isExpanded ? 20 : 'auto',
    }}>
      <style>{`
        #gantt-rows::-webkit-scrollbar { width: 5px; }
        #gantt-rows::-webkit-scrollbar-track { background: transparent; }
        #gantt-rows::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 3px; }
        #gantt-hscroll::-webkit-scrollbar { height: 4px; }
        #gantt-hscroll::-webkit-scrollbar-track { background: transparent; }
        #gantt-hscroll::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 3px; }
        .gantt-block { transition: filter 0.15s ease, box-shadow 0.15s ease; }
        .gantt-block:hover { filter: brightness(1.25) !important; }
        @keyframes gantt-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
        @keyframes gantt-march {
          from { background-position: 0 0; }
          to   { background-position: 28px 0; }
        }
      `}</style>

      {/* ── Top header bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px', borderBottom: '1px solid #1a2d45',
        flexShrink: 0, gap: 8,
      }}>
        {/* Left: icon + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect y="1" width="14" height="2" rx="1" fill="#4a7fc1"/>
            <rect y="6" width="10" height="2" rx="1" fill="#4a7fc1"/>
            <rect y="11" width="12" height="2" rx="1" fill="#4a7fc1"/>
          </svg>
          <span style={{ color: '#d0e4f7', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 }}>
            Maneuver Timeline
          </span>
          <span style={{ color: '#4a6a8a', fontSize: 10 }}>(Gantt Scheduler)</span>
        </div>
        {/* Right: counters + clock + expand button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 5, fontSize: 9 }}>
            <span style={{ background: '#11223a', borderRadius: 4, padding: '2px 6px', color: '#ffad33' }}>
              ⏳ {pendingCount}
            </span>
            <span style={{ background: '#11223a', borderRadius: 4, padding: '2px 6px', color: '#7bd88f' }}>
              ✓ {executedCount}
            </span>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#101c2e', border: '1px solid #1f3c5e',
            borderRadius: 5, padding: '2px 6px', fontSize: 9, color: '#8aa8d8',
          }}>
            <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
              <circle cx="6" cy="6" r="5" stroke="#4a7fc1" strokeWidth="1.5"/>
              <path d="M6 3v3l2 1.5" stroke="#4a7fc1" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            {formatUtc(now)} UTC
          </div>
          {/* ── Expand / Collapse button ── */}
          <button
            onClick={() => setIsExpanded(e => !e)}
            title={isExpanded ? 'Collapse timeline' : 'Expand timeline (Focus Mode)'}
            style={{
              background: isExpanded ? 'rgba(58,127,255,0.15)' : '#101c2e',
              border: `1px solid ${isExpanded ? '#3a7fff' : '#1f3c5e'}`,
              borderRadius: 5,
              color: isExpanded ? '#89d4ff' : '#6f87a8',
              fontSize: 13,
              lineHeight: 1,
              padding: '2px 7px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            {isExpanded ? (
              /* Collapse icon — two arrows pointing in */
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1l4 4M1 1h3M1 1v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M11 11l-4-4M11 11h-3M11 11v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            ) : (
              /* Expand icon — two arrows pointing out */
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M5 1H1v4M1 1l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                <path d="M7 11h4v-4M11 11l-4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            )}
            <span style={{ fontSize: 8, letterSpacing: 0.5 }}>
              {isExpanded ? 'COLLAPSE' : 'EXPAND'}
            </span>
          </button>
        </div>
      </div>

      {/* ── ETA mini-strip ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '4px 10px',
        borderBottom: '1px solid #111d2e', flexShrink: 0,
      }}>
        <div style={{ background: '#0e1b2e', borderRadius: 4, padding: '2px 8px', fontSize: 9, color: '#9cb0cc', flex: 1 }}>
          Next Fleet Burn: <span style={{ color: 'white' }}>{etaLabel(nextGlobalBurn)}</span>
        </div>
        <div style={{ background: '#0e1b2e', borderRadius: 4, padding: '2px 8px', fontSize: 9, color: '#9cb0cc', flex: 1 }}>
          Selected ETA: <span style={{ color: 'white' }}>{etaLabel(nextSelectedBurn)}</span>
        </div>
      </div>

      {/* ── Horizontal scroll container (time axis + rows scroll together) ── */}
      <div id="gantt-hscroll" style={{
        flex: 1,
        overflowX: 'auto',
        overflowY: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        scrollbarWidth: 'thin' as const,
        scrollbarColor: '#1f3c5e transparent',
      }}>
        {/* Min-width ensures time axis never compresses below readability */}
        <div style={{ minWidth: 520, flex: 1, display: 'flex', flexDirection: 'column' }}>

      {/* ── Time-axis header ── */}
      <div style={{
        display: 'flex', alignItems: 'stretch',
        borderBottom: '1px solid #1a2d45', flexShrink: 0,
        background: '#090f1c',
      }}>
        {/* Corner cell */}
        <div style={{
          width: LABEL_W, flexShrink: 0,
          borderRight: '1px solid #1a2d45',
          padding: '3px 6px', display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ color: '#4a6a8a', fontSize: 8, letterSpacing: 0.5 }}>Time</span>
          <span style={{
            background: '#11223a', borderRadius: 3,
            color: '#5a8abf', fontSize: 7, padding: '1px 4px',
          }}>UTC</span>
        </div>
        {/* Tick labels */}
        <div style={{ flex: 1, position: 'relative', height: 22, overflow: 'hidden' }}>
          {tickTimes.map((t, i) => (
            <span key={i} style={{
              position: 'absolute',
              left: `${(i / (NUM_TICKS - 1)) * 100}%`,
              transform: 'translateX(-50%)',
              color: '#4a6a8a', fontSize: 8, top: '50%', marginTop: -5,
              whiteSpace: 'nowrap', userSelect: 'none',
            }}>
              {formatUtc(t)}
            </span>
          ))}
        </div>
      </div>

      {/* ── Gantt rows ── */}
      {all.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#2a3a52', fontSize: 11 }}>No maneuvers scheduled / executed yet.</p>
        </div>
      ) : (
        <div id="gantt-rows" style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' as const, scrollbarColor: '#1f3c5e transparent' }}>
          {all.map((m, idx) => {
            const sat           = m.satellite_id || 'SAT';
            const isSelectedSat = Boolean(selectedId && sat === selectedId);
            const bStart        = Number(m.burn_start ?? now);
            const bEnd          = Number(m.burn_end   ?? bStart + MIN_VISIBLE_BURN_S);
            const cdEnd         = Number(m.cooldown_end ?? (bEnd + THERMAL_COOLDOWN_S));
            const statusLabel   = m.status || 'EXECUTED';
            const isPending     = statusLabel === 'PENDING';
            const isActive      = bStart <= now && now <= bEnd;
            const rowKey        = `${sat}-${idx}`;
            const isHovered     = hoveredKey === rowKey;

            // Block positions in %
            const burnL  = xPct(bStart);
            const burnR  = xPct(bEnd);
            const burnW  = Math.max(2, burnR - burnL);
            const cdL    = burnR;
            const cdW    = Math.max(1.5, xPct(cdEnd) - cdL);

            // Classify burn-start event type for colour
            const isAtRisk    = satellites.find(s => s.id === sat)?.status === 'AT_RISK';
            const isManeuvering = satellites.find(s => s.id === sat)?.status === 'MANEUVERING';

            // Colour scheme per block type
            const burnColor  = isAtRisk   ? '#c0392b'
                             : isManeuvering ? '#27ae60'
                             : isPending  ? 'rgba(39,174,96,0.55)'
                             : '#27ae60';
            const burnGlow   = isAtRisk   ? '0 0 8px rgba(192,57,43,0.6)'
                             : isActive   ? '0 0 8px rgba(39,174,96,0.55)'
                             : 'none';
            const cdColor    = '#e8b84b';  // yellow — burn-end / cooldown

            // Striped "marching ants" CSS for cooldown zone (orbital zone)
            const stripeBg = `repeating-linear-gradient(
              45deg,
              rgba(232,184,75,0.22) 0px, rgba(232,184,75,0.22) 6px,
              rgba(20,35,60,0.3) 6px, rgba(20,35,60,0.3) 14px
            )`;

            return (
              <div
                key={rowKey}
                style={{
                  display: 'flex', alignItems: 'stretch',
                  borderBottom: '1px solid #0f1c2e',
                  background: isSelectedSat
                    ? 'rgba(30,60,100,0.28)'
                    : isHovered ? 'rgba(255,255,255,0.02)' : 'transparent',
                  transition: 'background 0.15s',
                  minHeight: 32,
                }}
                onMouseEnter={() => setHoveredKey(rowKey)}
                onMouseLeave={() => setHoveredKey(null)}
              >
                {/* ── Satellite label column ── */}
                <div style={{
                  width: LABEL_W, flexShrink: 0,
                  borderRight: '1px solid #1a2d45',
                  display: 'flex', flexDirection: 'column',
                  justifyContent: 'center', padding: '0 6px',
                  gap: 1,
                }}>
                  <span style={{
                    color: isSelectedSat ? '#89d4ff' : '#c8ddf0',
                    fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {sat}
                  </span>
                  <span style={{ color: '#3a5272', fontSize: 8 }}>
                    {m.burn_id || 'BURN'}
                    {m.synthetic ? ' ·live' : ''}
                  </span>
                </div>

                {/* ── Timeline track ── */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', margin: '5px 0' }}>

                  {/* Vertical grid lines */}
                  {tickTimes.map((_, i) => (
                    <div key={i} style={{
                      position: 'absolute',
                      left: `${(i / (NUM_TICKS - 1)) * 100}%`,
                      top: 0, bottom: 0,
                      width: 1,
                      background: 'rgba(30,55,90,0.5)',
                      pointerEvents: 'none',
                    }} />
                  ))}

                  {/* "Now" marker */}
                  {now >= tMin && now <= tMax && (
                    <div style={{
                      position: 'absolute',
                      left: `${xPct(now)}%`,
                      top: -5, bottom: -5,
                      width: 1.5,
                      background: 'rgba(255,80,80,0.7)',
                      zIndex: 10,
                      pointerEvents: 'none',
                      boxShadow: '0 0 4px rgba(255,80,80,0.5)',
                    }} />
                  )}

                  {/* ── Burn window block ── */}
                  <div
                    className="gantt-block"
                    title={`Burn Window · ${formatUtc(bStart)}-${formatUtc(bEnd)} UTC`}
                    style={{
                      position: 'absolute',
                      left: `${burnL}%`,
                      width: `${burnW}%`,
                      top: 0, bottom: 0,
                      background: burnColor,
                      borderRadius: 4,
                      opacity: isPending ? 0.65 : 1,
                      boxShadow: burnGlow,
                      display: 'flex', alignItems: 'center', overflow: 'hidden',
                      cursor: 'default',
                      animation: isActive ? 'gantt-pulse 1.8s ease-in-out infinite' : 'none',
                    }}
                  >
                    <span style={{
                      color: 'white', fontSize: 8, paddingLeft: 5,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      display: 'flex', alignItems: 'center', gap: 3,
                    }}>
                      {isAtRisk ? '⚠' : '🔥'} Burn
                    </span>
                  </div>

                  {/* Burn-end marker */}
                  <div
                    title={`Burn End · ${formatUtc(bEnd)} UTC`}
                    style={{
                      position: 'absolute',
                      left: `${burnR}%`,
                      top: -1,
                      bottom: -1,
                      width: 2,
                      background: cdColor,
                      boxShadow: '0 0 5px rgba(232,184,75,0.65)',
                      zIndex: 6,
                      pointerEvents: 'none',
                    }}
                  />

                  {/* ── Cooldown / orbital zone (striped) ── */}
                  {cdW > 0 && (
                    <div
                      className="gantt-block"
                      title={`Cooldown / Orbital Zone · ends ${formatUtc(cdEnd)} UTC`}
                      style={{
                        position: 'absolute',
                        left: `${cdL}%`,
                        width: `${cdW}%`,
                        top: 1, bottom: 1,
                        background: stripeBg,
                        backgroundSize: '28px 28px',
                        borderRadius: 3,
                        border: '1px solid rgba(232,184,75,0.25)',
                        opacity: isPending ? 0.45 : 0.8,
                        display: 'flex', alignItems: 'center', overflow: 'hidden',
                        cursor: 'default',
                        animation: 'gantt-march 1.2s linear infinite',
                      }}
                    >
                      {cdW > 6 && (
                        <span style={{
                          color: '#e8b84b', fontSize: 7.5, paddingLeft: 5,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          ◎ Orbital Zone
                        </span>
                      )}
                    </div>
                  )}

                  {/* Status badge (far right of row) */}
                  <div style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    background: isPending ? 'rgba(255,173,51,0.15)' : 'rgba(123,216,143,0.12)',
                    border: `1px solid ${isPending ? 'rgba(255,173,51,0.3)' : 'rgba(123,216,143,0.25)'}`,
                    borderRadius: 3, padding: '1px 5px',
                    color: isPending ? '#ffad33' : '#7bd88f',
                    fontSize: 7, letterSpacing: 0.5, zIndex: 5,
                    pointerEvents: 'none',
                  }}>
                    {statusLabel}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

        </div>{/* end minWidth wrapper */}
      </div>{/* end gantt-hscroll */}
    </div>
  );
}

// ── Fuel Consumed vs Collisions Avoided Graph ─────────────────────────────────
function FuelCollisionGraph({ tableRows }: { tableRows: Satellite[] }) {
  const [search, setSearch]           = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Full processed dataset sorted by fuel desc
  const allChartData = useMemo(() =>
    tableRows
      .map(s => ({
        rawId: s.id,
        id: s.id.replace('SAT-', 'S'),
        fuel: Math.max(0, 50 - (parseFloat(s.propellant) || 0)),        // fuel CONSUMED = 50kg max - remaining
        risk: parseFloat(s.debris) > 0
          ? Math.max(0, Math.round((500 - Math.min(500, parseFloat(s.debris))) / 50))
          : 0,
      }))
      .sort((a, b) => b.fuel - a.fuel),
  [tableRows]);

  // Filtered dropdown options based on search
  const dropdownOptions = useMemo(() => {
    const q = search.toLowerCase();
    return allChartData.filter(d => d.rawId.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  }, [allChartData, search]);

  // Final chart data: selected override or top-10 default
  const chartData = useMemo(() => {
    if (selectedIds.length === 0) return allChartData.slice(0, 10);
    const set = new Set(selectedIds);
    const filtered = allChartData.filter(d => set.has(d.rawId));
    return filtered.length > 0 ? filtered : [];
  }, [allChartData, selectedIds]);

  const toggleId = (rawId: string) => {
    setSelectedIds(prev =>
      prev.includes(rawId) ? prev.filter(x => x !== rawId) : [...prev, rawId]
    );
  };

  const clearSelection = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds([]);
    setSearch('');
  };

  const pillLabel = selectedIds.length === 0
    ? 'Top 10 by Fuel'
    : selectedIds.length === 1
      ? selectedIds[0].replace('SAT-', 'S')
      : `${selectedIds.length} selected`;

  return (
    <div style={{
      overflow: 'hidden',
      height: '100%',
      background: '#0a1124',
      border: '1px solid #1f3c5e',
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 10px',
      boxSizing: 'border-box',
      position: 'relative',
    }}>
      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, flexShrink: 0 }}>
        <p style={{ color: '#8aa8d8', fontSize: 10, letterSpacing: 1 }}>
          FUEL CONSUMED vs COLLISIONS AVOIDED
        </p>

        {/* ── Dropdown trigger ── */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            onClick={() => { setDropdownOpen(o => !o); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: '#0e1b2e', border: '1px solid #1f3c5e',
              borderRadius: 5, padding: '2px 7px',
              color: selectedIds.length > 0 ? '#89d4ff' : '#6f87a8',
              fontSize: 9, cursor: 'pointer', whiteSpace: 'nowrap',
              maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pillLabel}</span>
            {selectedIds.length > 0 && (
              <span
                onClick={clearSelection}
                style={{ marginLeft: 2, color: '#ff5b4d', fontWeight: 700, fontSize: 10, lineHeight: 1, flexShrink: 0 }}
                title="Clear selection"
              >×</span>
            )}
            <span style={{ marginLeft: 2, flexShrink: 0, opacity: 0.6 }}>{dropdownOpen ? '▲' : '▼'}</span>
          </button>

          {/* ── Dropdown panel ── */}
          {dropdownOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 100,
              background: '#0e1b2e', border: '1px solid #1f3c5e',
              borderRadius: 6, marginTop: 3,
              width: 170, maxHeight: 180, display: 'flex', flexDirection: 'column',
              boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
            }}>
              {/* Search input */}
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search satellite…"
                style={{
                  background: '#0b1527', border: 'none', borderBottom: '1px solid #1a2a42',
                  color: 'white', fontSize: 10, padding: '5px 8px', outline: 'none',
                  borderRadius: '6px 6px 0 0', flexShrink: 0,
                }}
              />
              {/* Options list */}
              <div style={{ overflowY: 'auto', flex: 1, scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}>
                {dropdownOptions.length === 0 ? (
                  <p style={{ color: '#4a5568', fontSize: 10, padding: '6px 8px' }}>No satellites found</p>
                ) : dropdownOptions.map(d => {
                  const checked = selectedIds.includes(d.rawId);
                  return (
                    <div
                      key={d.rawId}
                      onClick={() => toggleId(d.rawId)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '4px 8px', cursor: 'pointer', fontSize: 10,
                        color: checked ? '#89d4ff' : '#a0b4cc',
                        background: checked ? 'rgba(58,127,255,0.1)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (!checked) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = checked ? 'rgba(58,127,255,0.1)' : 'transparent'; }}
                    >
                      <span style={{
                        width: 10, height: 10, borderRadius: 2, flexShrink: 0,
                        border: `1px solid ${checked ? '#3a7fff' : '#2a3f5e'}`,
                        background: checked ? '#3a7fff' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <span style={{ color: 'white', fontSize: 8, lineHeight: 1 }}>✓</span>}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.rawId}</span>
                      <span style={{ marginLeft: 'auto', color: '#4a5a72', flexShrink: 0 }}>{d.fuel.toFixed(0)}kg</span>
                    </div>
                  );
                })}
              </div>
              {/* Footer: clear all */}
              {selectedIds.length > 0 && (
                <div
                  onClick={clearSelection}
                  style={{
                    borderTop: '1px solid #1a2a42', padding: '4px 8px',
                    fontSize: 9, color: '#ff5b4d', cursor: 'pointer',
                    textAlign: 'center', flexShrink: 0,
                  }}
                >
                  Clear all ({selectedIds.length})
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Chart ── */}
      {chartData.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          <p style={{ color: '#3a4a62', fontSize: 10 }}>No data for selected satellites</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} barGap={2} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a2a42" vertical={false} />
              <XAxis dataKey="id" tick={{ fill: '#6f87a8', fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6f87a8', fontSize: 9 }} axisLine={false} tickLine={false} />
              <RechartsTooltip
                contentStyle={{ background: '#0e1a2f', border: '1px solid #1f3c5e', borderRadius: 6, fontSize: 10, color: '#d2e1f4' }}
                cursor={{ fill: 'rgba(58,127,255,0.06)' }}
              />
              <Bar dataKey="fuel" name="Fuel Consumed (kg)" fill="#3a7fff" radius={[3, 3, 0, 0]} maxBarSize={14} />
              <Bar dataKey="risk" name="Collisions Avoided" fill="#ff5b4d" radius={[3, 3, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Legend ── */}
      <div style={{ display: 'flex', gap: 12, flexShrink: 0, marginTop: 4, fontSize: 9, color: '#6f87a8' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#3a7fff', display: 'inline-block' }} />
          Fuel Consumed (kg)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#ff5b4d', display: 'inline-block' }} />
          Collisions Avoided
        </span>
        <span style={{ marginLeft: 'auto', color: '#3a4a62' }}>
          {selectedIds.length === 0 ? `top ${Math.min(10, allChartData.length)}` : `${chartData.length} sat`}
        </span>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function EnhancedDashboard() {
  const { satellites: liveSats, debrisList, counts, connected, istTime, liveDataReady } = useLiveData();
  const [selectedId,  setSelectedId]  = useState<string>('');
  const MAP_DEBRIS_RANGE_KM = 500;

  // Optimization: Prune 10k items to candidates once per selection/WS update
  const candidateRadarPool = useMemo(() => {
    const sel = liveSats.find(s => s.id === selectedId);
    if (!sel || !debrisList.length) return [];
    return debrisList.filter(deb => {
      const dx = deb.r[0] - sel.r[0];
      const dy = deb.r[1] - sel.r[1];
      const dz = deb.r[2] - sel.r[2];
      return (dx*dx+dy*dy+dz*dz) < 1000000; // 1000km range
    });
  }, [debrisList, selectedId, liveSats]);

  const mapDebrisList = useMemo(() => {
    const sel = liveSats.find(s => s.id === selectedId);
    if (!sel || !debrisList.length) return [];
    const maxDistSq = MAP_DEBRIS_RANGE_KM * MAP_DEBRIS_RANGE_KM;
    return debrisList.filter((deb) => {
      const dx = deb.r[0] - sel.r[0];
      const dy = deb.r[1] - sel.r[1];
      const dz = deb.r[2] - sel.r[2];
      return (dx * dx + dy * dy + dz * dz) <= maxDistSq;
    });
  }, [debrisList, selectedId, liveSats]);

  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSatQuery, setAddSatQuery] = useState('');
  const addSatInputRef = useRef<HTMLInputElement | null>(null);
  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1920,
    height: typeof window !== 'undefined' ? window.innerHeight : 1080,
  });

  useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const compactLayout = viewport.height <= 820 || viewport.width <= 1450;
  const rightColWidth = viewport.width <= 1650 ? '40%' : '38%';
  const rootRows = compactLayout
  ? '48px minmax(0, 2.3fr) minmax(0, 1.35fr) minmax(0, 1.15fr)'
  : '48px minmax(0, 2.2fr) minmax(0, 1.45fr) minmax(0, 1.2fr)';

  const now = new Date();
  const tableRows = liveSats.map((sat) => satToRow(sat, debrisList, now));
  const selectedSat = tableRows.find(s => s.id === selectedId) || tableRows[0];

  // Auto-open first satellite tab when data first arrives (one-time bootstrap only)
  useEffect(() => {
    if (tableRows.length > 0 && openTabIds.length === 0) {
      const firstId = tableRows[0].id;
      setOpenTabIds([firstId]);
      setSelectedId(firstId);
    }
  }, [tableRows.length]);

  // Keep only tabs that still exist in the latest live dataset.
  useEffect(() => {
    setOpenTabIds((prev) => {
      const valid = prev.filter((id) => tableRows.some((s) => s.id === id));
      return valid.length === prev.length ? prev : valid;
    });
  }, [tableRows]);

  // ── Unified satellite click handler ───────────────────────────────────────
  //
  // Normal click    → select the satellite; refreshes telemetry/radar/map/globe.
  //                   Does NOT create or switch tabs — keeps the workspace clean.
  //
  // Ctrl/Cmd click  → select the satellite AND open (or switch to) its tab.
  //                   Duplicate tabs are prevented: if the tab already exists we
  //                   simply activate it instead of appending another.
  //
  // Threaded into every interactive surface:
  //   • 2D map marker   (via MapViewPanel onSelect(id, ctrlOpen))
  //   • 3D globe click  (via GlobeView onSelect(id, ctrlOpen))
  //   • Satellite table row
  const handleSatelliteClick = useCallback((id: string, ctrlOpen = false) => {
    if (!tableRows.some(s => s.id === id)) return;

    // Always update selection — refreshes telemetry panel, bullseye radar,
    // ground-track highlight, 3D orbit overlay, and heatmap selection marker
    setSelectedId(id);

    if (ctrlOpen) {
      // Ctrl/Cmd + click: open in tab (no-op if tab already exists → just selects)
      setOpenTabIds(prev =>
        prev.includes(id) ? prev : [...prev, id]
      );
    }
    // Normal click: selection updated above, no tab mutation
  }, [tableRows]);

  const activeTabs = openTabIds
    .map(id => tableRows.find(s => s.id === id))
    .filter(Boolean)
    .map(s => ({ id: s!.id, name: s!.name }));

  const availableSatellites = useMemo(() => {
    const q = addSatQuery.trim().toLowerCase();
    const closedTabs = tableRows.filter((s) => !openTabIds.includes(s.id));
    if (!q) return closedTabs;

    const idOrNameMatches = closedTabs.filter((s) =>
      s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
    );
    if (idOrNameMatches.length > 0) return idOrNameMatches;

    // Fallback: allow altitude search only when no ID/name matches exist.
    return closedTabs.filter((s) => s.altitude.toLowerCase().includes(q));
  }, [tableRows, openTabIds, addSatQuery]);

  const matchedOpenSatellites = useMemo(() => {
    const q = addSatQuery.trim().toLowerCase();
    if (!q) return [];
    const openTabs = tableRows.filter((s) => openTabIds.includes(s.id));
    return openTabs.filter((s) =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q)
    );
  }, [tableRows, openTabIds, addSatQuery]);

  // Tab bar click: clicking an existing tab always selects that satellite
  // and updates all panels. The tab must already exist (user created it via
  // Ctrl+click or the Add Satellite modal).
  const handleSelectTab = (id: string) => {
    setSelectedId(id);
  };

  const handleCloseTab = (id: string) => {
    const remaining = openTabIds.filter(t => t !== id);
    setOpenTabIds(remaining);
    if (selectedId === id) setSelectedId(remaining[remaining.length - 1] ?? '');
  };

  const handleAddSatellite = (id: string) => {
    if (!openTabIds.includes(id)) setOpenTabIds(prev => [...prev, id]);
    setSelectedId(id);
    setAddSatQuery('');
    setShowAddModal(false);
  };

  const handleOpenExistingSatellite = (id: string) => {
    setSelectedId(id);
    setAddSatQuery('');
    setShowAddModal(false);
  };

  useEffect(() => {
    if (!showAddModal) return;
    const raf = requestAnimationFrame(() => {
      addSatInputRef.current?.focus();
      addSatInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [showAddModal]);

  return (
    <Tooltip.Provider>
      {/* ── ROOT: fills parent App container ── */}
      <div style={{
        background: '#03020e',
        width: '100%',
        height: '100vh',
        minHeight: '100vh',
        overflow: 'hidden',
        gridTemplateRows: rootRows,
        display: 'grid',
        gridTemplateColumns: `1fr ${rightColWidth}`,
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
              onAddSatellite={() => {
                setAddSatQuery('');
                setShowAddModal(true);
              }}
            />
          </div>

          {/* Stats + clock */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'center', justifyContent: 'flex-end' }}>
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
          minHeight: 0,
          borderRight: '1px solid #1a1a2e',
        }}>
          {/* Loading overlay — shown until first real live telemetry arrives */}
          {!liveDataReady && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 50,
              background: 'rgba(3,2,14,0.82)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 12, pointerEvents: 'none',
              backdropFilter: 'blur(2px)',
            }}>
              {/* Spinning satellite icon */}
              <motion.img
                src={imgSatellite}
                style={{ width: 36, height: 36, opacity: 0.7 }}
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
              />
              <p style={{
                color: '#3a7fff', fontSize: 11,
                fontFamily: 'Azeret Mono, monospace',
                letterSpacing: 1.5, opacity: 0.85,
              }}>
                AWAITING LIVE TELEMETRY
              </p>
              {/* Pulsing horizontal bar */}
              <div style={{ width: 160, height: 2, background: '#0d1d3a', borderRadius: 2, overflow: 'hidden' }}>
                <motion.div
                  style={{ height: '100%', background: '#3a7fff', borderRadius: 2 }}
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </div>
          )}
          <MapViewPanel
            key={liveDataReady ? 'live' : 'init'}
            satellites={liveDataReady ? tableRows : []}
            debrisList={liveDataReady ? mapDebrisList : []}
            selectedId={selectedId}
            // Pass handleSatelliteClick so MapViewPanel can forward ctrlKey flag
            onSelect={handleSatelliteClick}
            debrisFilterKm={MAP_DEBRIS_RANGE_KM}
          />
        </div>

        {/* ══ RIGHT COLUMN: flex column — pinned top + scrollable bottom ══ */}
        <div style={{
          gridRow: '2 / 5',
          gridColumn: 2,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: 0,
          background: '#07070f',
          borderLeft: '1px solid #1a1a2e',
          boxSizing: 'border-box',
        }}>

          {/* ╔══════════════════════════════════╗
              ║  TOP SECTION — always visible    ║
              ╚══════════════════════════════════╝
              Radar left | Telemetry+Alert right  */}
          <div style={{
            flexShrink: 0,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            padding: '8px 8px 4px 8px',
            boxSizing: 'border-box',
            /* Height: ~42% of viewport minus header */
            height: compactLayout ? '38%' : '40%',
            minHeight: 220,
          }}>
            {/* Radar */}
            <div style={{ overflow: 'hidden', borderRadius: 8, border: '1px solid #1a1a2e' }}>
              <ExpandableBullseye satellite={liveDataReady ? selectedSat : undefined} debrisList={liveDataReady ? debrisList : []} />
            </div>
            {/* Telemetry + Alert stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
              <div style={{ flex: '0 0 55%', overflow: 'hidden', border: '1px solid #1a1a2e', borderRadius: 8 }}>
                <TelemetryStatsPanelInline satellite={selectedSat} />
              </div>
              <div style={{ flex: '1 1 0', overflow: 'hidden', border: '1px solid #1a1a2e', borderRadius: 8 }}>
                <AlertPanelInline satellites={tableRows} />
              </div>
            </div>
          </div>

          {/* ╔══════════════════════════════════╗
              ║  BOTTOM SECTION — scrollable     ║
              ╚══════════════════════════════════╝ */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            scrollbarWidth: 'thin' as const,
            scrollbarColor: '#1f3c5e transparent',
            padding: '0 8px 8px 8px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            <style>{`
              /* bottom section scrollbar */
              .rc-bottom::-webkit-scrollbar { width: 5px; }
              .rc-bottom::-webkit-scrollbar-track { background: transparent; }
              .rc-bottom::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 3px; }
            `}</style>

            {/* Ground Track + Fuel graph — side by side */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 8,
              height: compactLayout ? 180 : 200,
              flexShrink: 0,
            }}>
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                <GroundTrackModule liveSats={liveDataReady ? liveSats : []} selectedId={selectedId} />
              </div>
              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                <FuelCollisionGraph tableRows={tableRows} />
              </div>
            </div>

            {/* Resource Heatmap — full width */}
            <div style={{ height: compactLayout ? 190 : 210, flexShrink: 0, overflow: 'hidden' }}>
              <ResourceHeatmapModule satellites={tableRows} selectedSatellite={selectedSat} />
            </div>

            {/* Maneuver Timeline — expandable */}
            <div style={{ flexShrink: 0 }}>
              <ManeuverTimelineModule selectedId={selectedId} satellites={tableRows} />
            </div>

          </div>
        </div>

        {/* ══ ROW 3: SATELLITE TABLE (left column only) ══ */}
        <div style={{
          gridRow: 3,
          gridColumn: 1,
          display: 'grid',
          gridTemplateRows: compactLayout ? '20px 22px minmax(0, 1fr)' : '22px 24px minmax(0, 1fr)',
          borderTop: '1px solid #1e1e30',
          overflow: 'hidden',
          minHeight: 0,
          background: '#05050e',
        }}>
          <style>{`
            #satellite-table-rows::-webkit-scrollbar { width: 8px; }
            #satellite-table-rows::-webkit-scrollbar-track { background: transparent; }
            #satellite-table-rows::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 4px; }
            #satellite-table-rows::-webkit-scrollbar-thumb:hover { background: #2a5a9f; }
          `}</style>
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
          <div id="satellite-table-rows" style={{ overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent', minHeight: 0 }}>
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
                      padding: '2px 16px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(58,127,255,0.09)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #3a7fff' : '2px solid transparent',
                      color: isAtRisk ? '#ff9944' : '#e0e0e0',
                      fontSize: 10.5,
                    }}
                    onClick={(e) => handleSatelliteClick(sat.id, e.ctrlKey || e.metaKey)}
                    title="Click to select · Ctrl+Click to open in new tab"
                    whileHover={{ backgroundColor: 'rgba(255,255,255,0.03)' }}>
                    {[sat.name,sat.az,sat.el,sat.altitude,sat.latitude,sat.longitude,sat.velocity,sat.propellant,sat.debris].map((v, j) => (
                      <p key={j} style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</p>
                    ))}
                  </motion.div>
                );
              })
            )}
          </div>
        </div>

        {/* ══ ROW 4: TELEMETRY LOG (left column only) ══ */}
        <div style={{
          gridRow: 4,
          gridColumn: 1,
          borderTop: '1px solid #151522',
          overflow: 'hidden',
          minHeight: 0,
          background: '#05050e',
        }}>
          <TelemetryLog selectedSatellite={selectedSat} />
        </div>

      </div>

      {/* ── Add Satellite Modal ── */}
      {showAddModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => {
            setAddSatQuery('');
            setShowAddModal(false);
          }}>
          <div id="add-satellite-list" style={{ background: '#0a0d1a', border: '1px solid #1f3c5e', borderRadius: 10, padding: '20px 24px', minWidth: 320, maxHeight: 430, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}
            onClick={e => e.stopPropagation()}>
            <style>{`
              #add-satellite-list::-webkit-scrollbar { width: 6px; }
              #add-satellite-list::-webkit-scrollbar-track { background: transparent; }
              #add-satellite-list::-webkit-scrollbar-thumb { background: #1f3c5e; border-radius: 4px; }
              #add-satellite-list::-webkit-scrollbar-thumb:hover { background: #2a5a9f; }
            `}</style>
            <p style={{ color: 'white', fontSize: 13, fontWeight: 600, marginBottom: 14, letterSpacing: 1 }}>SELECT SATELLITE</p>
            <input
              ref={addSatInputRef}
              type="text"
              value={addSatQuery}
              onChange={(e) => setAddSatQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && availableSatellites.length > 0) {
                  e.preventDefault();
                  handleAddSatellite(availableSatellites[0].id);
                } else if (e.key === 'Enter' && matchedOpenSatellites.length > 0) {
                  e.preventDefault();
                  handleOpenExistingSatellite(matchedOpenSatellites[0].id);
                }
              }}
              placeholder="Search satellite ID / name / altitude"
              style={{
                width: '100%',
                marginBottom: 12,
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #1f3c5e',
                background: '#0e1a2e',
                color: 'white',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {availableSatellites.length === 0 ? (
              matchedOpenSatellites.length > 0 ? (
                <div>
                  <p style={{ color: '#8892a4', fontSize: 11, marginBottom: 8 }}>
                    Satellite already open. Press Enter to switch tab.
                  </p>
                  {matchedOpenSatellites.map((s) => (
                    <div key={s.id}
                      onClick={() => handleOpenExistingSatellite(s.id)}
                      style={{ padding: '8px 12px', borderRadius: 6, cursor: 'pointer', marginBottom: 4, background: '#0e1a2e', border: '1px solid #3a7fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <p style={{ color: 'white', fontSize: 12 }}>{s.name}</p>
                      <p style={{ color: '#3a7fff', fontSize: 10 }}>Open tab</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#8892a4', fontSize: 11 }}>All satellites already open.</p>
              )
            ) : (
              availableSatellites.map(s => (
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