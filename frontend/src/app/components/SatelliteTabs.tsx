import { X, Plus } from 'lucide-react';
import { motion } from 'motion/react';

interface Satellite {
  id: string;
  name: string;
}

interface SatelliteTabsProps {
  satellites: Satellite[];
  activeSatelliteId: string;
  onSelectSatellite: (id: string) => void;
  onCloseSatellite: (id: string) => void;
  onAddSatellite: () => void;
}

export function SatelliteTabs({ 
  satellites, 
  activeSatelliteId, 
  onSelectSatellite, 
  onCloseSatellite,
  onAddSatellite 
}: SatelliteTabsProps) {
  return (
    <div className="flex items-center gap-[8px] overflow-x-auto scrollbar-thin scrollbar-thumb-[#1f3c5e] scrollbar-track-transparent pb-[4px]">
      {satellites.map((satellite) => {
        const isActive = satellite.id === activeSatelliteId;
        return (
          <motion.div
            key={satellite.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            className="relative flex items-center gap-[8px] px-[14px] py-[5px] rounded-full cursor-pointer transition-all duration-200 group"
onClick={() => onSelectSatellite(satellite.id)}
style={{
  background: isActive ? '#0e1a2e' : '#0a0f1a',
  padding:'5px',
  boxShadow: isActive
    ? 'inset 2px 2px 5px rgba(0,0,0,0.5), inset -2px -2px 5px rgba(255,255,255,0.04), 0 0 10px rgba(58,127,255,0.3)'
    : '3px 3px 7px rgba(0,0,0,0.5), -2px -2px 5px rgba(255,255,255,0.03)',
}}
          >
            <p className={`
              text-[13px] font-['SF_Compact_Rounded:Regular',sans-serif] whitespace-nowrap
              ${isActive ? 'text-white font-semibold' : 'text-[#8892a4]'}
            `}>
              {satellite.name}
            </p>
            
            {satellites.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseSatellite(satellite.id);
                }}
                className={`
                  p-[2px] rounded-full transition-all
                  ${isActive 
                    ? 'hover:bg-[#3a7fff] hover:text-white text-[#8892a4]' 
                    : 'hover:bg-[#2a5a9f] hover:text-white opacity-0 group-hover:opacity-100 text-[#555]'
                  }
                `}
              >
                <X className="w-[11px] h-[11px]" />
              </button>
            )}
          </motion.div>
        );
      })}
      
      <button
        onClick={onAddSatellite}
        className="flex items-center gap-[6px] px-[12px] py-[5px] rounded-full transition-all duration-200 text-[#8892a4] hover:text-[#3a7fff]"
style={{
  background: '#0a0f1a',
  padding:'5px',
  boxShadow: '3px 3px 7px rgba(0,0,0,0.5), -2px -2px 5px rgba(255,255,255,0.03)',
}}
      >
        <Plus className="w-[14px] h-[14px]" />
        <span className="text-[12px] font-['SF_Compact_Rounded:Regular',sans-serif] whitespace-nowrap">
          Add Satellite
        </span>
      </button>
    </div>
  );
}