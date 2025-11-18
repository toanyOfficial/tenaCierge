import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TenaCierge Ops',
  description: '내부 운영 대시보드'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>
        <main className="app-shell">
          {children}
        </main>
      </body>
    </html>
  );
}
