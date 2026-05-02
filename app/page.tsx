import dynamic from 'next/dynamic';

// Leaflet cannot run server-side — disable SSR for the whole map component
const TrafficMap = dynamic(() => import('@/components/TrafficMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07090d',
        color: '#3d5068',
        fontFamily: 'monospace',
        fontSize: '12px',
        letterSpacing: '0.1em',
      }}
    >
      INITIALISING MAP…
    </div>
  ),
});

export default function Home() {
  return <TrafficMap />;
}
