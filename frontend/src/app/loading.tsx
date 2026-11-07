import { LogoLoader } from '@/components/ui/LogoLoader';

// Shown while a page's code loads for the first time.
export default function GlobalLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-indigo-50/40 to-violet-50/40">
      <LogoLoader />
    </div>
  );
}
