import 'server-only';

function publicPath(value: string | undefined): string | null {
  const path = value?.trim() || '';
  return /^\/(?!\/)[a-zA-Z0-9_./-]+$/.test(path) && !path.includes('..') ? path : null;
}

/** Deployment branding; only public, same-origin image paths are exposed. */
export function getBranding() {
  const logo = publicPath(process.env.PORTAL_LOGO_PATH);
  return {
    name: process.env.PORTAL_NAME?.trim().slice(0, 150) || 'School ERP',
    logo: logo || '/default-logo.svg',
    icon: publicPath(process.env.PORTAL_ICON_PATH) || logo || '/default-logo.svg',
    description: process.env.PORTAL_DESCRIPTION?.trim().slice(0, 300) || 'Your school management portal',
  };
}
