import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from 'react-hot-toast';

export const metadata: Metadata = {
  title: 'Fact Knowledge Layer',
  description: 'Extract, link, and compare facts across documents',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#12121a',
              color: '#e8e8f0',
              border: '1px solid #1e1e2e',
              borderRadius: '10px',
              fontSize: '13px',
            },
            success: {
              iconTheme: { primary: '#22c55e', secondary: '#12121a' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#12121a' },
            },
          }}
        />
      </body>
    </html>
  );
}
