import React from 'react';

interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onAddTab: () => void;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onAddTab,
}) => {
  return (
    <div
      className="flex items-center gap-1 px-6 py-4 overflow-x-auto w-full"
      style={{
        background: "rgba(8,8,15,0.8)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(16px)",
        height: "64px",
        display: "flex",
        alignItems: "center",
      }}
    >
      {/* Tabs */}
      <div className="flex items-center gap-2">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="relative flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-200 group min-w-0"
            style={{
              background:
                activeTabId === tab.id
                  ? "rgba(93,92,222,0.12)"
                  : "transparent",
              border:
                activeTabId === tab.id
                  ? "1px solid rgba(93,92,222,0.25)"
                  : "1px solid transparent",
              color: activeTabId === tab.id ? "#f1f5f9" : "#94a3b8",
              fontWeight: activeTabId === tab.id ? 600 : 500,
              boxShadow: activeTabId === tab.id
                ? "0 2px 8px rgba(93,92,222,0.15), inset 0 1px 0 rgba(255,255,255,0.05)"
                : "none",
            }}
          >
            {/* Active indicator line */}
            {activeTabId === tab.id && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{
                  background: "linear-gradient(90deg, #5D5CDE, #7c6ce8)",
                  boxShadow: "0 0 8px rgba(93,92,222,0.4)",
                }}
              />
            )}

            <span className="text-sm font-medium uppercase tracking-wide whitespace-nowrap">
              {tab.label}
            </span>

            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className="flex items-center justify-center w-5 h-5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all duration-150 ml-1"
              style={{ color: "#64748b" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add tab button */}
      <button
        onClick={onAddTab}
        className="flex items-center justify-center w-9 h-9 rounded-lg hover:bg-white/5 transition-all duration-200 ml-4 border border-dashed"
        style={{
          color: "#64748b",
          borderColor: "rgba(255,255,255,0.15)",
        }}
        title="Add new satellite tab"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
};
