import React, { useState } from 'react';
import type { TelemetryData } from './SatellitePanel';

interface SatelliteData {
  id: string;
  name: string;
  telemetry: TelemetryData;
}

interface SatelliteSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSatellite: (satellite: SatelliteData) => void;
  currentSatellites: SatelliteData[];
}

// Predefined list of available satellites
const AVAILABLE_SATELLITES: SatelliteData[] = [
  {
    id: 'SAT-001',
    name: 'ACM-AETHER-ARSH',
    telemetry: {
      fuel: 48.90,
      velocity: 7.62,
      altitude: 542.1,
      logs: [
        { id: 1, time: "14:02:11", msg: "PPO Agent: Weights successfully synchronized." },
        { id: 2, time: "14:05:44", msg: "Physics: J2 Perturbation drift corrected." },
        { id: 3, time: "14:10:02", msg: "Alert: Conjunction detected in Orbit Plane 2." },
      ],
    },
  },
  {
    id: 'SAT-002',
    name: 'ACM-AETHER-ORYX',
    telemetry: {
      fuel: 52.15,
      velocity: 7.58,
      altitude: 575.3,
      logs: [
        { id: 1, time: "14:01:22", msg: "System initialized: All subsystems nominal." },
        { id: 2, time: "14:06:05", msg: "Solar panel deployment confirmed." },
      ],
    },
  },
  {
    id: 'SAT-003',
    name: 'ACM-AETHER-NOVA',
    telemetry: {
      fuel: 45.30,
      velocity: 7.71,
      altitude: 510.8,
      logs: [
        { id: 1, time: "14:03:44", msg: "Attitude control active: Star tracker locked." },
        { id: 2, time: "14:07:18", msg: "Thruster test firing sequence: SUCCESS." },
      ],
    },
  },
  {
    id: 'SAT-004',
    name: 'ACM-AETHER-ZEPHYR',
    telemetry: {
      fuel: 51.75,
      velocity: 7.59,
      altitude: 528.4,
      logs: [
        { id: 1, time: "14:04:33", msg: "Orbital insertion complete." },
        { id: 2, time: "14:08:12", msg: "Communication systems online." },
      ],
    },
  },
  {
    id: 'SAT-005',
    name: 'ACM-AETHER-TITAN',
    telemetry: {
      fuel: 47.20,
      velocity: 7.65,
      altitude: 556.7,
      logs: [
        { id: 1, time: "14:02:55", msg: "Payload deployment successful." },
        { id: 2, time: "14:09:01", msg: "Thermal control systems nominal." },
      ],
    },
  },
];

export const SatelliteSelector: React.FC<SatelliteSelectorProps> = ({
  isOpen,
  onClose,
  onSelectSatellite,
  currentSatellites,
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  // Filter out satellites that are already active
  const availableSatellites = AVAILABLE_SATELLITES.filter(
    sat => !currentSatellites.some(current => current.id === sat.id)
  ).filter(sat =>
    sat.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    sat.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSelect = (satellite: SatelliteData) => {
    onSelectSatellite(satellite);
    onClose();
    setSearchTerm('');
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        className="bg-[#0a0a12] border border-[rgba(93,92,222,0.2)] rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-hidden"
        style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(93,92,222,0.1)" }}
      >
        {/* Header */}
        <div className="p-6 border-b border-[rgba(255,255,255,0.05)]">
          <h2 className="text-lg font-bold text-white mb-2">SELECT SATELLITE</h2>
          <p className="text-sm text-gray-400">Choose a satellite to monitor</p>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-[rgba(255,255,255,0.05)]">
          <input
            type="text"
            placeholder="Search satellites..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[rgba(93,92,222,0.5)]"
          />
        </div>

        {/* Satellite List */}
        <div className="max-h-96 overflow-y-auto">
          {availableSatellites.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              {currentSatellites.length === AVAILABLE_SATELLITES.length
                ? "All satellites are already active"
                : "No satellites found matching your search"}
            </div>
          ) : (
            availableSatellites.map((satellite) => (
              <button
                key={satellite.id}
                onClick={() => handleSelect(satellite)}
                className="w-full p-4 text-left hover:bg-[rgba(93,92,222,0.1)] border-b border-[rgba(255,255,255,0.02)] last:border-b-0 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-green-500 shadow-lg shadow-green-500/30"></div>
                  <div className="flex-1">
                    <div className="font-bold text-white text-sm uppercase tracking-wider">
                      {satellite.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      ID: {satellite.id} • Fuel: {satellite.telemetry.fuel.toFixed(1)}kg
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">ALT</div>
                    <div className="text-sm font-mono text-[rgba(93,92,222,0.8)]">
                      {satellite.telemetry.altitude.toFixed(1)}km
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[rgba(255,255,255,0.05)] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
};
