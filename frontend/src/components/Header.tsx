import React from 'react';

interface HeaderProps {
  connectionStatus: string;
  isAiLoading: boolean;
  onGetAIStrategy: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  connectionStatus,
  isAiLoading,
  onGetAIStrategy,
}) => {
  return (
    <div
      style={{
        height: 52,
        paddingLeft: 64,
        background: "linear-gradient(90deg, rgba(15,15,23,0.8), rgba(30,30,50,0.6))",
        borderBottom: "1px solid rgba(93,92,222,0.1)",
        backdropFilter: "blur(10px)",
      }}
      className="flex items-center justify-between px-6 shrink-0"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-2 w-2 rounded-full"
          style={{
            background: connectionStatus === "connected" ? "#4ade80" : "#ef4444",
            boxShadow: connectionStatus === "connected" ? "0 0 8px rgba(74,222,128,0.6)" : "0 0 8px rgba(239,68,68,0.6)",
          }}
        />
        <span style={{ color: "#94a3b8", fontSize: 12, fontWeight: 500 }}>
          {connectionStatus === "connected" ? "MISSION CONTROL ONLINE" : "OFFLINE"}
        </span>
      </div>

      <h1
        style={{
          color: "#f8fafc",
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: "0.05em",
        }}
      >
        PROJECT AETHER
      </h1>

      <button
        onClick={onGetAIStrategy}
        disabled={isAiLoading}
        style={{
          background: isAiLoading
            ? "rgba(93,92,222,0.3)"
            : "linear-gradient(135deg,#5D5CDE,#7c6ce8)",
          color: isAiLoading ? "#94a3b8" : "#f8fafc",
          border: "none",
          padding: "8px 16px",
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 500,
          cursor: isAiLoading ? "not-allowed" : "pointer",
          transition: "all 0.3s",
          boxShadow: isAiLoading ? "none" : "0 0 15px rgba(93,92,222,0.3)",
        }}
      >
        {isAiLoading ? "THINKING..." : "GET AI STRATEGY"}
      </button>
    </div>
  );
};
