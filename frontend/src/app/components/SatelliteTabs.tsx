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
            className={`
              relative flex items-center gap-[8px] px-[16px] py-[8px] rounded-[6px] cursor-pointer
              transition-all duration-200 group
              ${isActive 
                ? 'bg-[#1a2540] border border-[#3a7fff]' 
                : 'bg-[#0b1124] border border-[#1f3c5e] hover:border-[#2a5a9f]'
              }
            `}
            onClick={() => onSelectSatellite(satellite.id)}
            style={{
              boxShadow: isActive ? '0 0 20px rgba(58, 127, 255, 0.3)' : 'none'
            }}
          >
            <p className={`
              text-[14px] font-['SF_Compact_Rounded:Regular',sans-serif] whitespace-nowrap
              ${isActive ? 'text-[#3a7fff]' : 'text-[#d2d2d2]'}
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
                  p-[2px] rounded-[3px] transition-all
                  ${isActive 
                    ? 'hover:bg-[#3a7fff] hover:text-white' 
                    : 'hover:bg-[#2a5a9f] hover:text-white opacity-0 group-hover:opacity-100'
                  }
                `}
              >
                <X className="w-[12px] h-[12px]" />
              </button>
            )}

            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute bottom-[-1px] left-0 right-0 h-[2px] bg-[#3a7fff]"
                style={{ boxShadow: '0 0 8px rgba(58, 127, 255, 0.6)' }}
              />
            )}
          </motion.div>
        );
      })}
      
      <button
        onClick={onAddSatellite}
        className="
          flex items-center gap-[6px] px-[12px] py-[8px] rounded-[6px]
          bg-[#0b1124] border border-[#1f3c5e] 
          hover:border-[#3a7fff] hover:bg-[#1a2540]
          transition-all duration-200 group
          text-[#d2d2d2] hover:text-[#3a7fff]
        "
      >
        <Plus className="w-[14px] h-[14px]" />
        <span className="text-[12px] font-['SF_Compact_Rounded:Regular',sans-serif] whitespace-nowrap">
          Add Satellite
        </span>
      </button>
    </div>
  );
}
