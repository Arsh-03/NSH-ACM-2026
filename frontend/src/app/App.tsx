import { useEffect, useRef, useState } from 'react';
import EnhancedDashboard from './components/EnhancedDashboard';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const updateScale = () => {
      const scaleX = window.innerWidth / 1920;
      const scaleY = window.innerHeight / 1080;
      setScale(Math.min(scaleX, scaleY));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      background: '#03020e',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'flex-start',
    }}>
      <div
        ref={containerRef}
        style={{
          width: '1920px',
          height: '1080px',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          flexShrink: 0,
        }}
      >
        <EnhancedDashboard />
      </div>
    </div>
  );
}