import { getBranding } from '@/lib/branding';
export const dynamic = 'force-dynamic';
export function GET() {
  const brand = getBranding();
  return Response.json({
    name: brand.name, short_name: brand.name.slice(0, 30), description: brand.description,
    start_url: '/', display: 'standalone', background_color: '#06284c', theme_color: '#06284c',
    icons: [{ src: brand.icon, sizes: 'any', purpose: 'any' }],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' } });
}
