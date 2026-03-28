import EnhancedDashboard from './components/EnhancedDashboard';

export default function App() {
  return (
    <div style={{
      width: '100%',
      height: '100vh',
      minHeight: '100vh',
      overflow: 'hidden',
      background: '#03020e',
    }}>
      <EnhancedDashboard />
    </div>
  );
}