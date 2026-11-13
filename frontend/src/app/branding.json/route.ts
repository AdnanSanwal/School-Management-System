import { getBranding } from '@/lib/branding';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(getBranding(), { headers: { 'Cache-Control': 'no-cache' } });
}
