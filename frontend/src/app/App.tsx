import EnhancedDashboard from './components/EnhancedDashboard';

export default function App() {
  return (
    <div style={{
      width: '100vw',
      // height: '100vh',
      // overflow: 'hidden',
      minHeight: '100vh',
      background: '#03020e',
    }}>
      <EnhancedDashboard />
    </div>
  );
}