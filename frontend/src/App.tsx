import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import * as THREE from 'three';

const WS_URL = 'ws://localhost:8000/ws';
const API_BASE = 'http://localhost:8000/api';

const EARTH_RADIUS = 1.5;

// ── Icons ────────────────────────────────────────────────────────────────────
const Icons = {
  Satellite: ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m4.5 15.5 2 2"/><path d="m8.5 11.5 2 2"/><path d="m13 15 2 2"/><path d="M2 22 7.6 16.4"/><path d="m16.4 7.6 5.6-5.6"/>
    </svg>
  ),
  Shield: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
  </svg>),
  Zap: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 14.5 14 3l-2.25 8.5H20L10 21l2.25-8.5H4z"/>
  </svg>),
  Alert: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
  </svg>),
  Globe: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20"/><path d="M2 12h20"/>
  </svg>),
  Gauge: () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>
  </svg>),
  Terminal: () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>
  </svg>),
  Sparkles: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M21 17v4"/><path d="M19 19h4"/>
  </svg>),
};

// ── Three.js Globe ───────────────────────────────────────────────────────────
function GlobeScene({ canvasRef }: { canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.clientWidth, H = canvas.clientHeight;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 200);
    camera.position.set(3, 2, 5);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const pt = new THREE.PointLight(0x5D5CDE, 2);
    pt.position.set(10, 10, 10);
    scene.add(pt);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starVerts: number[] = [];
    for (let i = 0; i < 6000; i++) {
      starVerts.push((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200, (Math.random() - 0.5) * 200);
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(starVerts, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    // Earth core
    const earthCore = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS - 0.02, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x020617 })
    );
    scene.add(earthCore);

    // Earth wireframe
    const earthWire = new THREE.Mesh(
      new THREE.SphereGeometry(EARTH_RADIUS, 48, 48),
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        emissive: 0x1D4ED8,
        emissiveIntensity: 0.2,
        wireframe: true,
        transparent: true,
        opacity: 0.3
      })
    );
    scene.add(earthWire);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x1a1a1a, 0x1a1a1a);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    // Satellites
    const makeSat = (pos: [number, number, number], color: number, emissiveIntensity: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.1, 0.1),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity })
      );
      mesh.position.set(...pos);
      scene.add(mesh);
      return mesh;
    };

    const sat1 = makeSat([2.1, 0.4, 0.8], 0x5D5CDE, 0.8);
    const sat2 = makeSat([1.8, 0.6, 1.1], 0xFF4D4D, 2.5);

    // Conjunction line
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(2.1, 0.4, 0.8),
      new THREE.Vector3(1.8, 0.6, 1.1),
    ]);
    scene.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xFF4D4D, transparent: true, opacity: 0.7 })));

    // Orbit ring for sat1
    const orbitGeo = new THREE.RingGeometry(2.4, 2.42, 128);
    const orbitMat = new THREE.MeshBasicMaterial({ color: 0x5D5CDE, side: THREE.DoubleSide, transparent: true, opacity: 0.15 });
    const orbit = new THREE.Mesh(orbitGeo, orbitMat);
    orbit.rotation.x = Math.PI / 2.2;
    scene.add(orbit);

    // Mouse / orbit controls (manual)
    let isDragging = false, prevMouse = { x: 0, y: 0 };
    const spherical = { theta: 0.6, phi: 0.8, radius: 6.5 };

    const toCart = () => {
      camera.position.set(
        spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta),
        spherical.radius * Math.cos(spherical.phi),
        spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta)
      );
      camera.lookAt(0, 0, 0);
    };
    toCart();

    const onMouseDown = (e: MouseEvent) => { isDragging = true; prevMouse = { x: e.clientX, y: e.clientY }; };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      spherical.theta -= (e.clientX - prevMouse.x) * 0.005;
      spherical.phi = Math.max(0.2, Math.min(Math.PI - 0.2, spherical.phi + (e.clientY - prevMouse.y) * 0.005));
      prevMouse = { x: e.clientX, y: e.clientY };
      toCart();
    };
    const onMouseUp = () => { isDragging = false; };
    const onWheel = (e: WheelEvent) => {
      // Only zoom if Ctrl key is pressed to avoid interfering with page scroll
      if (e.ctrlKey) {
        e.preventDefault();
        spherical.radius = Math.max(3, Math.min(14, spherical.radius + e.deltaY * 0.01));
        toCart();
      }
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel);

    let frame = 0;
    let animId: number;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      frame++;

      // Auto-slow rotation when not dragging
      if (!isDragging) {
        spherical.theta += 0.001;
        toCart();
      }

      // Pulse danger sat
      sat2.material.emissiveIntensity = 1.5 + Math.sin(frame * 0.1) * 1.2;

      // Float sat1
      sat1.position.y = 0.4 + Math.sin(frame * 0.03) * 0.04;

      earthWire.rotation.y += 0.001;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, [canvasRef]);

  return null;
}

// ── Sub-components ────────────────────────────────────────────────────────────
const StatCard = ({ icon: Icon, label, value, unit, colorClass }: {
  icon: React.ComponentType<any>;
  label: string;
  value: string;
  unit: string;
  colorClass: string;
}) => (
  <div style={{ background: "rgba(15,15,25,0.7)", border: "1px solid rgba(255,255,255,0.07)" }} className="p-3 rounded-xl flex items-center gap-3 backdrop-blur-sm">
    <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}><Icon /></div>
    <div>
      <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: "#475569" }}>{label}</p>
      <p className="text-lg font-mono font-bold" style={{ color: "#f1f5f9" }}>
        {value}<span className="text-xs ml-1 font-normal" style={{ color: "#64748b" }}>{unit}</span>
      </p>
    </div>
  </div>
);

const ConjunctionItem = ({ id, dist, time, risk }: {
  id: string;
  dist: string;
  time: string;
  risk: string;
}) => (
  <div className="flex items-center justify-between p-2 rounded-lg transition-colors cursor-pointer" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
    <div className="flex items-center gap-3">
      <div className="w-1 h-8 rounded-full" style={{ background: risk === "HIGH" ? "#ef4444" : "#eab308" }}/>
      <div>
        <p className="text-xs font-mono font-bold" style={{ color: "#cbd5e1" }}>{id}</p>
        <p className="text-[10px]" style={{ color: "#64748b" }}>TCA: {time}s</p>
      </div>
    </div>
    <div className="text-right">
      <p className="text-xs font-mono font-bold" style={{ color: risk === "HIGH" ? "#f87171" : "#facc15" }}>{dist}m</p>
      <p className="text-[10px] uppercase font-bold tracking-tight" style={{ color: "#475569" }}>{risk} RISK</p>
    </div>
  </div>
);

// ── Main App ──────────────────────────────────────────────────────────────────
interface TelemetryData {
  fuel: number;
  velocity: number;
  altitude: number;
  logs: Array<{ id: number; time: string; msg: string }>;
}

interface WebSocketMessage {
  type: string;
  tracked_objects?: number;
  timestamp?: number;
  total_objects?: number;
  satellite_id?: string;
  dv_magnitude?: number;
  remaining_fuel?: number;
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    fuel: 48.90,
    velocity: 7.62,
    altitude: 542.1,
    logs: [
      { id: 1, time: "14:02:11", msg: "PPO Agent: Weights successfully synchronized." },
      { id: 2, time: "14:05:44", msg: "Physics: J2 Perturbation drift corrected." },
      { id: 3, time: "14:10:02", msg: "Alert: Conjunction detected in Orbit Plane 2." },
    ],
  });
  const [aiInsight, setAiInsight] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // WebSocket connection management
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          console.log('WebSocket connected');
          setConnectionStatus('connected');
        };

        ws.onmessage = (event) => {
          try {
            const data: WebSocketMessage = JSON.parse(event.data);
            handleWebSocketMessage(data);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setConnectionStatus('disconnected');
          // Attempt to reconnect after 3 seconds
          setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          setConnectionStatus('error');
        };
      } catch (error) {
        console.error('Failed to create WebSocket connection:', error);
        setConnectionStatus('error');
      }
    };

    connectWebSocket();

    // Cleanup on unmount
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleWebSocketMessage = (data: WebSocketMessage) => {
    switch (data.type) {
      case 'initial_data':
        if (typeof data.tracked_objects === 'number') {
          console.log('Initial data received:', data.tracked_objects);
        }
        break;
      case 'telemetry_update':
        if (typeof data.tracked_objects === 'number') {
          console.log('Telemetry updated:', data.tracked_objects);
        }
        break;
      case 'simulation_update':
        console.log('Simulation advanced:', data);
        break;
      case 'maneuver_executed':
        console.log('Maneuver executed:', data);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  };

  // Simulate telemetry updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(prev => ({
        ...prev,
        fuel: Math.max(0, prev.fuel - 0.0001),
        altitude: parseFloat((prev.altitude + (Math.random() * 0.1 - 0.05)).toFixed(1))
      }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [telemetry.logs]);

  const generateAiInsight = useCallback(async () => {
    setIsAiLoading(true);
    setAiInsight("");

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `As a Senior Orbital Dynamics Mission Commander, provide a very brief (2-3 sentences), professional strategic update based on current telemetry:\nFuel: ${telemetry.fuel.toFixed(2)}kg, Velocity: ${telemetry.velocity.toFixed(2)}km/s, Altitude: ${telemetry.altitude.toFixed(1)}km, Status: NOMINAL.\nKeep it sounding like an aerospace expert briefing. Start with "COMMANDER BRIEFING:".`,
          }],
        }),
      });

      const data = await response.json();
      const text = data.content?.map((b: any) => b.text || "").join("") || "Strategic assessment failed. Check uplink.";
      setAiInsight(text);
      setTelemetry(prev => ({
        ...prev,
        logs: [...prev.logs, { id: Date.now(), time: new Date().toLocaleTimeString(), msg: "AI Advisory received: Mission status updated." }]
      }));
    } catch (error) {
      setAiInsight("Error retrieving AI strategic assessment.");
    } finally {
      setIsAiLoading(false);
    }
  }, [telemetry.fuel, telemetry.velocity, telemetry.altitude]);

  const executeManeuver = async (satelliteId: string, dv: {x: number, y: number, z: number}) => {
    try {
      const response = await fetch(`${API_BASE}/maneuver/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          satellite_id: satelliteId,
          dv_x: dv.x,
          dv_y: dv.y,
          dv_z: dv.z,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log('Maneuver executed:', result);
    } catch (error) {
      console.error('Failed to execute maneuver:', error);
    }
  };

  const fuelPct = ((telemetry.fuel / 50) * 100).toFixed(1);

  return (
    <div style={{ background: "#050508", color: "#94a3b8", fontFamily: "'JetBrains Mono', 'Courier New', monospace", width: "100vw", height: "100vh" }} className="flex overflow-auto select-none">

      {/* Sidebar */}
      <div style={{ width: 56, background: "#08080f", borderRight: "1px solid rgba(255,255,255,0.05)" }} className="flex flex-col items-center py-5 gap-6 shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: "linear-gradient(135deg,#5D5CDE,#7c6ce8)", boxShadow: "0 0 20px rgba(93,92,222,0.4)" }}>
          <Icons.Globe />
        </div>
        <nav className="flex flex-col gap-3 opacity-40">
          {Array(5).fill(0).map((_, i) => (
            <button key={i} className="p-2 rounded-lg hover:opacity-100 transition-opacity" style={{ color: "#64748b" }}>
              <Icons.Satellite size={16}/>
            </button>
          ))}
        </nav>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0" style={{ flexGrow: 1, width: 0 }}>

        {/* Header */}
        <header style={{ height: 52, background: "rgba(8,8,15,0.9)", borderBottom: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(12px)" }} className="flex items-center justify-between px-6 shrink-0 z-20">
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold tracking-[0.3em] italic" style={{ color: "#f1f5f9" }}>PROJECT AETHER</span>
            <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }}/>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ color: "#818cf8", background: "rgba(93,92,222,0.1)", border: "1px solid rgba(93,92,222,0.2)" }}>
              LIVE OPS: SECTOR-01
            </span>
          </div>
          <div className="flex items-center gap-6 text-[11px]">
            <button onClick={generateAiInsight} disabled={isAiLoading} className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-white transition-all active:scale-95 disabled:opacity-50" style={{ background: isAiLoading ? "#3730a3" : "linear-gradient(135deg,#5D5CDE,#7c6ce8)", boxShadow: "0 0 15px rgba(93,92,222,0.3)" }}>
              <Icons.Sparkles />
              <span>{isAiLoading ? "ANALYZING..." : "GET AI STRATEGY"}</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: "#4ade80", boxShadow: "0 0 6px #4ade80" }}/>
              <span style={{ color: "#cbd5e1" }}>PPO MODEL v1.02</span>
            </div>
            <span style={{
              color: connectionStatus === 'connected' ? '#28a745' :
                     connectionStatus === 'error' ? '#dc3545' : '#ffc107',
              fontSize: '10px'
            }}>
              WS: {connectionStatus}
            </span>
          </div>
        </header>

        {/* Dashboard */}
        <main className="flex-1 p-5 overflow-y-auto w-full" style={{ width: '100%', minWidth: 0 }}>
          <div className="space-y-5">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-4 w-full" style={{ width: '100%' }}>
            <StatCard icon={Icons.Gauge} label="Propellant" value={telemetry.fuel.toFixed(2)} unit="kg" colorClass="text-emerald-400"/>
            <StatCard icon={Icons.Zap} label="Orbital Velocity" value={telemetry.velocity.toFixed(2)} unit="km/s" colorClass="text-yellow-400"/>
            <StatCard icon={Icons.Satellite} label="Mean Altitude" value={telemetry.altitude.toFixed(1)} unit="km" colorClass="text-indigo-400"/>
            <StatCard icon={Icons.Shield} label="Safety Rating" value="100.0" unit="%" colorClass="text-blue-400"/>
          </div>

          {/* Main content row */}
          <div className="grid grid-cols-4 gap-5 w-full" style={{ width: '100%', minHeight: 400 }}>

            {/* Globe - takes up 3 columns */}
            <div className="col-span-3 relative rounded-2xl overflow-hidden" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)", minHeight: 360, boxShadow: "0 0 60px rgba(93,92,222,0.05)" }}>

            {/* Tracking badge */}
            <div className="absolute top-4 left-4 z-10 flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: "rgba(0,0,0,0.7)", border: "1px solid rgba(255,255,255,0.06)", backdropFilter: "blur(12px)" }}>
              <div className="p-2 rounded-lg text-indigo-400" style={{ background: "rgba(93,92,222,0.1)" }}><Icons.Satellite /></div>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: "#475569" }}>Target Satellite</p>
                <p className="text-xs font-bold italic" style={{ color: "#f1f5f9" }}>ACM-AETHER-ARSH</p>
              </div>
            </div>

            {/* Canvas */}
            <canvas ref={canvasRef} className="w-full h-full block" style={{ cursor: "grab" }}/>
            <GlobeScene canvasRef={canvasRef}/>

            {/* Legend */}
            <div className="absolute bottom-4 right-4 flex items-center gap-5 px-4 py-2 rounded-full text-[10px] font-bold" style={{ background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(8px)" }}>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: "#5D5CDE" }}/>
                <span style={{ color: "#cbd5e1" }}>ACTIVE ASSET</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: "#FF4D4D" }}/>
                <span style={{ color: "#cbd5e1" }}>CONJUNCTION RISK</span>
              </span>
            </div>

            {/* Drag hint */}
            <div className="absolute top-4 right-4 text-[9px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.15)" }}>DRAG TO ROTATE · CTRL+SCROLL TO ZOOM</div>
          </div>

          {/* Right panel */}
          <div className="col-span-1 row-span-1 flex flex-col gap-4">

            {/* Conjunctions */}
            <div className="rounded-2xl p-4" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2" style={{ color: "#ef4444" }}>
                  <Icons.Alert />
                  <span className="text-[10px] font-bold uppercase tracking-widest italic">Critical Risks</span>
                </div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  2 ACTIVE
                </span>
              </div>
              <div className="space-y-1">
                <ConjunctionItem id="DEBRIS-882 → AETHER-01" dist="84.2" time="12" risk="HIGH"/>
                <ConjunctionItem id="BOOSTER-SL12 → AETHER-05" dist="422.5" time="145" risk="LOW"/>
              </div>
              <button className="w-full mt-3 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all" style={{ color: "#475569", border: "1px solid rgba(255,255,255,0.05)" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                Full Encounter Catalog
              </button>
            </div>

            {/* Bullseye Radar */}
            <div className="polar-chart-container rounded-2xl p-4 flex flex-col" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Icons.Gauge />
                <span className="text-[10px] font-bold uppercase tracking-widest italic" style={{ color: "#f1f5f9" }}>Bullseye Radar</span>
              </div>
              <div className="flex-1 flex items-center justify-center relative">
                {/* Radar display */}
                <div className="relative w-32 h-32">
                  {/* Radar rings */}
                  <div className="absolute inset-0 rounded-full border border-gray-600"></div>
                  <div className="absolute inset-2 rounded-full border border-gray-500"></div>
                  <div className="absolute inset-4 rounded-full border border-gray-400"></div>
                  <div className="absolute inset-6 rounded-full border border-gray-300"></div>

                  {/* Radar sweep */}
                  <div className="absolute inset-0 rounded-full overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-conic from-transparent via-green-500/20 to-transparent animate-spin" style={{ animationDuration: '3s' }}></div>
                  </div>

                  {/* Center dot */}
                  <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-green-400 rounded-full transform -translate-x-1/2 -translate-y-1/2 shadow-lg"></div>

                  {/* Target indicators */}
                  <div className="absolute top-3 left-8 w-1 h-1 bg-red-500 rounded-full animate-pulse"></div>
                  <div className="absolute bottom-4 right-6 w-1 h-1 bg-yellow-500 rounded-full animate-pulse"></div>
                </div>

                {/* Radar info */}
                <div className="absolute bottom-2 left-2 text-[8px] font-mono">
                  <div style={{ color: "#10b981" }}>● TARGET ACQUIRED</div>
                  <div style={{ color: "#f59e0b" }}>● TRACKING</div>
                </div>
              </div>
            </div>

            {/* Asset Profile */}
            <div className="flex-1 rounded-2xl p-4 flex flex-col" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-indigo-400" style={{ background: "rgba(93,92,222,0.1)", border: "1px solid rgba(93,92,222,0.2)" }}>
                  <Icons.Satellite />
                </div>
                <div>
                  <p className="text-xs font-bold italic" style={{ color: "#f1f5f9" }}>ACM-AETHER-ARSH</p>
                  <p className="text-[9px] uppercase tracking-widest" style={{ color: "#475569" }}>SLOT: LEO-800-ALPHA</p>
                </div>
              </div>

              {/* Fuel bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[9px] font-bold uppercase tracking-tight mb-1.5" style={{ color: "#64748b" }}>
                  <span>Propellant Integrity</span>
                  <span style={{ color: telemetry.fuel < 10 ? "#ef4444" : "#818cf8" }}>{fuelPct}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${fuelPct}%`, background: "linear-gradient(90deg,#4338ca,#818cf8,#4ade80)" }}/>
                </div>
              </div>

              {/* Specs */}
              <div className="grid grid-cols-2 gap-y-4 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                {[
                  ["Orbit Plane", "SSO-98.2°", "left"],
                  ["Apogee", "548.4km", "right"],
                  ["AI Mode", "AUTONOMOUS", "left", "#4ade80"],
                  ["Last Burn", "T-22.4m", "right"],
                ].map(([label, val, align, color]) => (
                  <div key={label} className={`space-y-0.5 ${align === "right" ? "text-right" : ""}`}>
                    <p className="text-[9px] font-bold uppercase tracking-tight" style={{ color: "#475569" }}>{label}</p>
                    <p className="text-[11px] font-bold italic" style={{ color: color || "#e2e8f0" }}>{val}</p>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="mt-auto pt-4 space-y-2">
                <button onClick={() => executeManeuver('SAT-001', {x: 0.001, y: 0, z: 0})} className="w-full py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-[0.3em] text-white transition-all active:scale-95" style={{ background: "linear-gradient(135deg,#4338ca,#5D5CDE)", boxShadow: "0 0 20px rgba(93,92,222,0.25)" }}>
                  Authorize Emergency Burn
                </button>
                <button className="w-full py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-[0.3em] transition-all active:scale-95" style={{ color: "#64748b", border: "1px solid rgba(255,255,255,0.07)" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  Diagnostic Report
                </button>
              </div>
            </div>

            {/* Telemetry */}
            <div className="telemetry-container rounded-2xl p-4" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Icons.Terminal />
                <span className="text-[10px] font-bold uppercase tracking-widest italic" style={{ color: "#f1f5f9" }}>System Telemetry</span>
              </div>
              <div className="space-y-2 text-[9px] font-mono">
                <div className="flex justify-between">
                  <span style={{ color: "#64748b" }}>CPU:</span>
                  <span style={{ color: "#10b981" }}>23%</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#64748b" }}>MEM:</span>
                  <span style={{ color: "#10b981" }}>67%</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#64748b" }}>TEMP:</span>
                  <span style={{ color: "#f59e0b" }}>42°C</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#64748b" }}>SIGNAL:</span>
                  <span style={{ color: "#10b981" }}>STRONG</span>
                </div>
                <div className="flex justify-between">
                  <span style={{ color: "#64748b" }}>UPLINK:</span>
                  <span style={{ color: "#10b981" }}>ACTIVE</span>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom: AI insight + telemetry log */}
          <div className="col-span-4 flex gap-5 w-full" style={{ width: '100%' }}>
            {aiInsight && (
              <div className="flex-1 p-4 rounded-2xl text-xs font-mono" style={{ background: "rgba(67,56,202,0.1)", border: "1px solid rgba(93,92,222,0.25)", color: "#c7d2fe", animation: "fadeIn 0.5s ease" }}>
                <div className="flex items-center gap-2 mb-2 font-bold uppercase tracking-widest text-[10px]" style={{ color: "#818cf8" }}>
                  <Icons.Sparkles /><span>Claude Strategic Advisory</span>
                </div>
                {aiInsight}
              </div>
            )}

            {/* Console */}
            <div className="flex-1 rounded-2xl p-4 flex flex-col font-mono" style={{ background: "#08080f", border: "1px solid rgba(255,255,255,0.06)", height: 160 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: "#475569" }}>
                  <Icons.Terminal /><span>Subsystem Telemetry</span>
                </div>
                <span className="text-[9px] font-bold uppercase" style={{ color: "rgba(93,92,222,0.4)" }}>Encrypted Stream</span>
              </div>
              <div className="flex-1 overflow-auto text-[11px] space-y-1.5">
                {telemetry.logs.map(log => (
                  <div key={log.id} className="flex gap-4" style={{ color: "#475569" }}>
                    <span>[{log.time}]</span>
                    <span style={{ color: "#94a3b8" }}>{" >> "}{log.msg}</span>
                  </div>
                ))}
                <div className="flex gap-4" style={{ color: "#5D5CDE", fontStyle: "italic" }}>
                  <span>[{new Date().toLocaleTimeString()}]</span>
                  <span>{" >> "} PPO INFERENCE TRIGGERED: Analyzing state vector...</span>
                </div>
                <div ref={logEndRef}/>
              </div>
            </div>
          </div>

          </div>

          </div>
        </main>
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(93,92,222,0.3); border-radius: 4px; }
      `}</style>
    </div>
  );
}

export default App;
