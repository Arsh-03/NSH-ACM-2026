import React from 'react';

const Icons = {
  Globe: () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20"/><path d="M2 12h20"/>
  </svg>),
  Satellite: ({ size = 20 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m4.5 15.5 2 2"/><path d="m8.5 11.5 2 2"/><path d="m13 15 2 2"/><path d="M2 22 7.6 16.4"/><path d="m16.4 7.6 5.6-5.6"/>
    </svg>
  ),
};

export const Sidebar: React.FC = () => {
  return (
    <div style={{ width: 56, background: "#08080f", borderRight: "1px solid rgba(255,255,255,0.05)" }} className="flex flex-col items-center py-5 gap-6 shrink-0 absolute left-0 top-0 bottom-0 z-30">
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
  );
};
