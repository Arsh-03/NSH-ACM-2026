import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ContentArea } from './components/ContentArea';
import { SatelliteSelector } from './components/SatelliteSelector';
import type { TelemetryData } from './components/SatellitePanel';

const WS_URL = 'ws://localhost:8000/ws';
const API_BASE = 'http://localhost:8000/api';

// Icons component
const Icons = {
  Sparkles: () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M21 17v4"/><path d="M19 19h4"/>
  </svg>),
};

interface SatelliteData {
  id: string;
  name: string;
  telemetry: TelemetryData;
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
  // Initialize with empty satellites - users will select from available list
  const initializeSatellites = (): SatelliteData[] => [];

  const [satellites, setSatellites] = useState<SatelliteData[]>(initializeSatellites());
  const [activeTabId, setActiveTabId] = useState('');
  const [aiInsight, setAiInsight] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [isSatelliteSelectorOpen, setIsSatelliteSelectorOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

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

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleWebSocketMessage = (data: WebSocketMessage) => {
    switch (data.type) {
      case 'initial_data':
      case 'telemetry_update':
      case 'simulation_update':
      case 'maneuver_executed':
        console.log('WebSocket message:', data.type);
        break;
      default:
        console.log('Unknown message type:', data.type);
    }
  };

  // Simulate telemetry updates for all satellites
  useEffect(() => {
    const interval = setInterval(() => {
      setSatellites(prev =>
        prev.map(sat => ({
          ...sat,
          telemetry: {
            ...sat.telemetry,
            fuel: Math.max(0, sat.telemetry.fuel - 0.0001),
            altitude: parseFloat((sat.telemetry.altitude + (Math.random() * 0.1 - 0.05)).toFixed(1))
          }
        }))
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const generateAiInsight = useCallback(async () => {
    const activeSat = satellites.find(s => s.id === activeTabId);
    if (!activeSat) return;

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
            content: `As a Senior Orbital Dynamics Mission Commander, provide a very brief (2-3 sentences), professional strategic update based on current telemetry:\nSatellite: ${activeSat.name}\nFuel: ${activeSat.telemetry.fuel.toFixed(2)}kg, Velocity: ${activeSat.telemetry.velocity.toFixed(2)}km/s, Altitude: ${activeSat.telemetry.altitude.toFixed(1)}km, Status: NOMINAL.\nKeep it sounding like an aerospace expert briefing. Start with "COMMANDER BRIEFING:".`,
          }],
        }),
      });

      const data = await response.json();
      const text = data.content?.map((b: any) => b.text || "").join("") || "Strategic assessment failed. Check uplink.";
      setAiInsight(text);

      // Add log entry
      setSatellites(prev =>
        prev.map(sat =>
          sat.id === activeTabId
            ? {
                ...sat,
                telemetry: {
                  ...sat.telemetry,
                  logs: [...sat.telemetry.logs, {
                    id: Date.now(),
                    time: new Date().toLocaleTimeString(),
                    msg: "AI Advisory received: Mission status updated."
                  }]
                }
              }
            : sat
        )
      );
    } catch (error) {
      setAiInsight("Error retrieving AI strategic assessment.");
    } finally {
      setIsAiLoading(false);
    }
  }, [satellites, activeTabId]);

  const executeManeuver = async (satelliteId: string, dv: { x: number; y: number; z: number }) => {
    try {
      const response = await fetch(`${API_BASE}/maneuver/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const handleTabChange = (tabId: string) => {
    setActiveTabId(tabId);
    setAiInsight(""); // Clear AI insight when switching tabs
  };

  const handleTabClose = (tabId: string) => {
    const newSatellites = satellites.filter(s => s.id !== tabId);
    setSatellites(newSatellites);

    if (activeTabId === tabId) {
      setActiveTabId(newSatellites.length > 0 ? newSatellites[0].id : '');
    }
  };

  const handleAddTab = () => {
    setIsSatelliteSelectorOpen(true);
  };

  const handleSatelliteSelect = (satellite: SatelliteData) => {
    setSatellites([...satellites, satellite]);
    setActiveTabId(satellite.id);
  };

  return (
    <div style={{ background: "#050508", color: "#94a3b8", fontFamily: "'JetBrains Mono', 'Courier New', monospace", width: "100vw", height: "100vh" }} className="flex overflow-hidden select-none">

      {/* Sidebar Component */}
      <Sidebar />

      {/* Main Layout Container */}
      <div className="flex flex-col flex-1 min-h-0">

        {/* Header Component */}
        <Header
          connectionStatus={connectionStatus}
          isAiLoading={isAiLoading}
          onGetAIStrategy={generateAiInsight}
        />

        {/* Content Area Component */}
        <ContentArea
          satellites={satellites}
          activeTabId={activeTabId}
          aiInsight={aiInsight}
          onTabChange={handleTabChange}
          onAddTab={handleAddTab}
          onCloseTab={handleTabClose}
          onExecuteManeuver={(satelliteId, _maneuverType) => executeManeuver(satelliteId, { x: 0, y: 0, z: 0 })}
        />

        {/* Satellite Selector Modal */}
        <SatelliteSelector
          isOpen={isSatelliteSelectorOpen}
          onClose={() => setIsSatelliteSelectorOpen(false)}
          onSelectSatellite={handleSatelliteSelect}
          currentSatellites={satellites}
        />
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
