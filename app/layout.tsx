import type { Metadata } from 'next';
import './globals.css';
import ChunkLoadRecovery from './components/ChunkLoadRecovery';

export const metadata: Metadata = {
  title: 'TenaCierge Ops',
  description: '내부 운영 대시보드',
  icons: {
    icon: '/icon.png'
  }
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <ChunkLoadRecovery />
        <main className="app-shell">
          {children}
        </main>
      </body>
    </html>
  );
}
