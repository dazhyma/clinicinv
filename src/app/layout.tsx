import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clinic Inventory',
  description: 'Internal inventory and surgery supplies tracking',
  // §15/NFR-18: система полностью закрыта, индексация исключена.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Экран может использоваться на планшете в перчатках — масштабирование не блокируем.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div id="app-root">{children}</div>
      </body>
    </html>
  );
}
