import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  id: number;
  type: 'info' | 'warning' | 'critical' | 'sync';
  message: string;
  timestamp: string;
}

const logTypeColors = {
  info:     '#00ff88',
  warning:  '#ffd700',
  critical: '#ff4444',
  sync:     '#00bfff',
};

const logTypeLabels = {
  info:     'INFO',
  warning:  'WARNING',
  critical: 'CRITICAL',
  sync:     'SYNC',
};

interface TelemetryLogProps { selectedSatellite?: { name: string; altitude: string; velocity: string; status: string; propellant: string; }; }

export function TelemetryLog({ selectedSatellite }: TelemetryLogProps = {}) {
  const [logs,        setLogs]        = useState<LogEntry[]>([]);
  const [uptime,      setUptime]      = useState({ hours:0, minutes:0, seconds:0 });
  const [showCursor,  setShowCursor]  = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const logRef    = useRef<HTMLDivElement>(null);
  const wsRef     = useRef<WebSocket | null>(null);
  const startTime = useRef(Date.now());

  const addLog = (type: LogEntry['type'], message: string) => {
    const now = new Date();
    const ts  = now.toTimeString().slice(0, 8);
    setLogs(prev => {
      const next = [...prev, { id: Date.now() + Math.random(), type, message, timestamp: ts }];
      return next.slice(-80); // keep last 80 entries
    });
  };

  // Uptime counter
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setUptime({
        hours:   Math.floor(elapsed / 3600),
        minutes: Math.floor((elapsed % 3600) / 60),
        seconds: elapsed % 60,
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Cursor blink
  useEffect(() => {
    const i = setInterval(() => setShowCursor(p => !p), 530);
    return () => clearInterval(i);
  }, []);

  // Log when selected satellite changes
  const prevSatRef = useRef<string>('');
  useEffect(() => {
    if (selectedSatellite && selectedSatellite.name !== prevSatRef.current) {
      prevSatRef.current = selectedSatellite.name;
      addLog('sync', `Target acquired: ${selectedSatellite.name}`);
      addLog('info', `Alt: ${selectedSatellite.altitude} | Vel: ${selectedSatellite.velocity} | Fuel: ${selectedSatellite.propellant}`);
      if (selectedSatellite.status === 'AT_RISK' || selectedSatellite.status === 'MANEUVERING') {
        addLog('critical', `${selectedSatellite.name} status: ${selectedSatellite.status} — collision avoidance active`);
      }
    }
  }, [selectedSatellite?.name]);

  // WebSocket — real backend events
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(`ws://${window.location.hostname}:8000/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        addLog('sync', 'WebSocket connection established');
        addLog('info', 'ACM backend online — awaiting telemetry stream');
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          if (msg.type === 'state_update') {
            const sats   = msg.satellites || [];
            const debris = msg.debris_count || 0;

            // Log fleet status updates
            const atRisk = sats.filter((s: any) =>
              s.status === 'AT_RISK' || s.status === 'MANEUVERING');

            if (atRisk.length > 0) {
              atRisk.forEach((s: any) => {
                if (s.status === 'MANEUVERING') {
                  addLog('critical', `BURN EXECUTED: ${s.id} — collision avoidance maneuver active`);
                } else {
                  addLog('warning', `CONJUNCTION ALERT: ${s.id} — debris within danger zone`);
                }
              });
            }

            // Periodic fleet summary (every ~10 updates)
            if (Math.random() < 0.1) {
              addLog('sync', `Fleet update — ${sats.length} satellites | ${debris} debris tracked`);
            }
          }

          if (msg.type === 'strategy') {
            addLog('info', msg.strategy);
          }

        } catch (_) {}
      };

      ws.onclose = () => {
        setWsConnected(false);
        addLog('warning', 'WebSocket disconnected — attempting reconnect...');
        setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    };

    // Boot messages
    addLog('info',  'System initialization complete');
    addLog('sync',  'PPO Agent loaded — weights synchronized');
    addLog('info',  'Physics engine online — J2 perturbation active');
    addLog('sync',  'KD-Tree spatial index ready');
    addLog('info',  'Ground station network: 6 stations online');

    connect();
    return () => wsRef.current?.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="bg-[#05070d] border border-[#1f3c5e] rounded-[6px] p-[16px] h-full flex flex-col font-['JetBrains_Mono',monospace]">
      {/* Header */}
      <div className="flex items-center justify-between mb-[12px] pb-[8px] border-b border-[#1f3c5e]">
        <div className="flex items-center gap-[8px]">
          <div className={`w-[8px] h-[8px] rounded-full ${wsConnected ? 'bg-[#00ff88] animate-pulse' : 'bg-[#ff4444]'}`} />
          <p className="text-[#00ff88] text-[12px] font-semibold">
            LIVE SYSTEM LOG / TELEMETRY FEED
          </p>
        </div>
        <p className="text-[#666] text-[11px]">
          System Uptime: {String(uptime.hours).padStart(2,'0')}:
          {String(uptime.minutes).padStart(2,'0')}:
          {String(uptime.seconds).padStart(2,'0')}
        </p>
      </div>

      {/* Log entries */}
      <div ref={logRef}
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-[#1f3c5e] scrollbar-track-transparent">
        <AnimatePresence initial={false}>
          {logs.map((log, index) => (
            <motion.div key={log.id}
              initial={{ opacity:0, y:5 }} animate={{ opacity:1, y:0 }}
              transition={{ duration:0.2 }}
              className="text-[12px] mb-[4px] leading-[1.6]">
              <span className="text-[#555]">[{log.timestamp}]</span>{' '}
              <span className="font-bold" style={{ color: logTypeColors[log.type] }}>
                [{logTypeLabels[log.type]}]
              </span>{' '}
              <span className="text-[#aaa]">{log.message}</span>
              {index === logs.length - 1 && (
                <span className="inline-block w-[8px] h-[14px] bg-[#00ff88] ml-[4px] align-text-top"
                  style={{ opacity: showCursor ? 1 : 0 }} />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
// Satellite selection effect — added at module level via patch