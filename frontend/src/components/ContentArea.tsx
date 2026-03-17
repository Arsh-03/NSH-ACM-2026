import React from 'react';
import { TabBar } from './TabBar';
import { SatellitePanel } from './SatellitePanel';
import type { TelemetryData } from './SatellitePanel';

interface SatelliteData {
  id: string;
  name: string;
  telemetry: TelemetryData;
}

interface ContentAreaProps {
  satellites: SatelliteData[];
  activeTabId: string;
  aiInsight: string;
  onTabChange: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onExecuteManeuver: (satelliteId: string, maneuverType: string) => void;
}

export const ContentArea: React.FC<ContentAreaProps> = ({
  satellites,
  activeTabId,
  aiInsight,
  onTabChange,
  onAddTab,
  onCloseTab,
  onExecuteManeuver,
}) => {
  const activeSatellite = satellites.find(sat => sat.id === activeTabId);

  // Convert satellites to tab format for TabBar
  const tabs = satellites.map(sat => ({
    id: sat.id,
    label: sat.name.split('-').pop() || sat.name,
  }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ marginLeft: 56 }}>
      {/* Tab Bar with proper sizing */}
      <div style={{ height: 64, minHeight: 64, flexShrink: 0 }} className="border-b border-[rgba(255,255,255,0.05)]">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          onTabClose={onCloseTab}
          onAddTab={onAddTab}
        />
      </div>

      {/* AI Insight Display */}
      {aiInsight && (
        <div className="px-6 pt-4 pb-2 flex-shrink-0" style={{ background: "rgba(8,8,15,0.5)" }}>
          <div className="p-4 rounded-lg text-xs font-mono" style={{ background: "rgba(67,56,202,0.1)", border: "1px solid rgba(93,92,222,0.25)", color: "#c7d2fe" }}>
            <div className="flex items-center gap-2 mb-2 font-bold uppercase tracking-widest text-[10px]" style={{ color: "#818cf8" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
                <path d="M5 3v4"/>
                <path d="M3 5h4"/>
                <path d="M21 17v4"/>
                <path d="M19 19h4"/>
              </svg>
              <span>Claude Strategic Advisory</span>
            </div>
            {aiInsight}
          </div>
        </div>
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-auto" style={{ background: "#08080f" }}>
        {activeSatellite ? (
          <SatellitePanel
            satelliteId={activeSatellite.id}
            satelliteName={activeSatellite.name}
            telemetry={activeSatellite.telemetry}
            onManeuver={(satelliteId, _dv) => onExecuteManeuver(satelliteId, 'thrust')}
            isActive={true}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div style={{ color: "#475569", margin: "0 auto 16px" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m4.5 15.5 2 2"/><path d="m8.5 11.5 2 2"/><path d="m13 15 2 2"/><path d="M2 22 7.6 16.4"/><path d="m16.4 7.6 5.6-5.6"/>
                </svg>
              </div>
              <p style={{ color: "#64748b" }} className="text-sm font-bold uppercase tracking-wider">No satellites loaded</p>
              <p style={{ color: "#475569" }} className="text-xs mt-2">Click the + button to add a satellite</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
