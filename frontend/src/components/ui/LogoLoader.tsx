/* eslint-disable @next/next/no-img-element -- tiny local/remote logo, no optimisation needed */

/** Spinning ring around a faded logo. Used by the global loader and route loading screens. */
export function LogoLoader({ logoUrl, label = 'Loading…', size = 96 }: { logoUrl?: string | null; label?: string; size?: number }) {
  return (
    <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
      <div className="logo-loader" style={{ width: size, height: size }}>
        <span className="logo-loader-ring" />
        <img src={logoUrl || '/favicon.svg'} alt="" className="logo-loader-logo" style={{ width: size * 0.48, height: size * 0.48 }} />
      </div>
      {label && <p className="text-sm font-medium text-slate-600">{label}</p>}
    </div>
  );
}
