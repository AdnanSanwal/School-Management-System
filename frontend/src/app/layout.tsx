import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { getBranding } from '@/lib/branding';
import { BrandingProvider } from '@/components/BrandingProvider';
import { Providers } from '@/components/Providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: false,
});

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const brand = getBranding();
  return {
    title: { default: brand.name, template: `%s · ${brand.name.replace(/%/g, '%%')}` },
    description: brand.description,
    applicationName: brand.name,
    appleWebApp: { title: brand.name },
    icons: { icon: brand.icon, shortcut: brand.icon, apple: brand.icon },
    manifest: '/site.webmanifest',
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#06284c',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">
        <BrandingProvider branding={getBranding()}><Providers>{children}</Providers></BrandingProvider>
      </body>
    </html>
  );
}
