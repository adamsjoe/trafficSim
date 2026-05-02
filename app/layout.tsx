import type { Metadata } from 'next';
import { IBM_Plex_Mono, Barlow_Condensed } from 'next/font/google';
import './globals.css';
import 'leaflet/dist/leaflet.css';

const ibmPlexMono = IBM_Plex_Mono({
  weight: ['300', '400', '500'],
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

const barlowCondensed = Barlow_Condensed({
  weight: ['300', '400', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'TrafficSim',
  description: 'Real-world road network traffic simulation powered by OpenStreetMap',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${ibmPlexMono.variable} ${barlowCondensed.variable}`}>
      <body style={{ fontFamily: 'var(--font-mono, monospace)' }}>
        {children}
      </body>
    </html>
  );
}
