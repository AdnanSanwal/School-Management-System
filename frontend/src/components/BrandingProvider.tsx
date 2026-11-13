
'use client';
import { createContext, useContext } from 'react';

type Branding = { name: string; logo: string; icon: string; description: string };
const BrandingContext = createContext<Branding>({ name: 'School ERP', logo: '/default-logo.svg', icon: '/default-logo.svg', description: 'Your school management portal' });
export function BrandingProvider({ branding, children }: { branding: Branding; children: React.ReactNode }) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
export const useBranding = () => useContext(BrandingContext);
