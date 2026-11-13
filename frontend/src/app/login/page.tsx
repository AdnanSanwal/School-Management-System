import LoginForm from './LoginForm';
import { getBranding } from '@/lib/branding';

export const dynamic = 'force-dynamic';
export default function LoginPage() {
  const brand = getBranding();
  return <LoginForm name={brand.name} logo={brand.logo} />;
}
