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
  // Track last logged status per satellite to avoid duplicate log spam.
  // Only emit a log when a satellite's status actually CHANGES.
  const lastLoggedStatusRef = useRef<Map<string, string>>(new Map());
  // Enforce a per-satellite cooldown (ms) so rapid status flapping doesn't flood.
  const lastLogTimeRef      = useRef<Map<string, number>>(new Map());
  const LOG_COOLDOWN_MS     = 5000; // minimum gap between logs for the same sat

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
            const now_ms = Date.now();

            // Only log when a satellite's status CHANGES — never on repeat ticks.
            sats.forEach((s: any) => {
              const prev      = lastLoggedStatusRef.current.get(s.id);
              const lastTime  = lastLogTimeRef.current.get(s.id) ?? 0;
              const tooRecent = (now_ms - lastTime) < LOG_COOLDOWN_MS;

              // Skip if status hasn't changed, or if we logged this sat too recently
              if (s.status === prev || tooRecent) return;

              // Status transition — decide log level and message
              if (s.status === 'MANEUVERING') {
                addLog('critical', `BURN EXECUTED: ${s.id} — collision avoidance maneuver active`);
              } else if (s.status === 'AT_RISK') {
                addLog('warning', `CONJUNCTION ALERT: ${s.id} — debris within danger zone`);
              } else if (s.status === 'RECOVERING' && prev === 'MANEUVERING') {
                addLog('info', `THREAT CLEARED: ${s.id} — returning to nominal slot`);
              } else if (s.status === 'EOL' || s.status === 'EOL_STANDBY') {
                addLog('warning', `EOL TRIGGERED: ${s.id} — fuel critical, graveyard maneuver pending`);
              } else if (s.status === 'GRAVEYARD') {
                addLog('critical', `GRAVEYARD BURN: ${s.id} — decommissioned to safe orbit`);
              } else if (s.status === 'NOMINAL' && prev && prev !== 'NOMINAL') {
                addLog('info', `${s.id} — status nominal, back in orbital slot`);
              }

              // Record the new status and log time
              lastLoggedStatusRef.current.set(s.id, s.status);
              lastLogTimeRef.current.set(s.id, now_ms);
            });

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
    <div className="bg-[#05070d] border border-[#1f3c5e] rounded-[6px] p-[10px] h-full flex flex-col font-['JetBrains_Mono',monospace]">
      <style>{`
        #telemetry-log::-webkit-scrollbar {
          width: 8px;
        }
        #telemetry-log::-webkit-scrollbar-track {
          background: transparent;
        }
        #telemetry-log::-webkit-scrollbar-thumb {
          background: #1f3c5e;
          border-radius: 4px;
        }
        #telemetry-log::-webkit-scrollbar-thumb:hover {
          background: #2a5a9f;
        }
      `}</style>
      {/* Header */}
      <div className="flex items-center justify-between mb-[8px] pb-[6px] border-b border-[#1f3c5e]">
        <div className="flex items-center gap-[8px]">
          <div className={`w-[8px] h-[8px] rounded-full ${wsConnected ? 'bg-[#00ff88] animate-pulse' : 'bg-[#ff4444]'}`} />
          <p className="text-[#00ff88] text-[11px] font-semibold">
            LIVE SYSTEM LOG / TELEMETRY FEED
          </p>
        </div>
        <p className="text-[#666] text-[10px]">
          System Uptime: {String(uptime.hours).padStart(2,'0')}:
          {String(uptime.minutes).padStart(2,'0')}:
          {String(uptime.seconds).padStart(2,'0')}
        </p>
      </div>

      {/* Log entries */}
      <div ref={logRef} id="telemetry-log"
        className="flex-1 overflow-y-auto"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#1f3c5e transparent' }}>
        <AnimatePresence initial={false}>
          {logs.map((log, index) => (
            <motion.div key={log.id}
              initial={{ opacity:0, y:5 }} animate={{ opacity:1, y:0 }}
              transition={{ duration:0.2 }}
              className="text-[11px] mb-[3px] leading-[1.35]">
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