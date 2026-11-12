'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, HOME_BY_ROLE } from '@/store/authStore';
import { api } from '@/lib/api';

/**
 * Last step of Google / Microsoft sign-in. The backend sends a one-time code in the URL
 * fragment (never tokens); it is exchanged once for the session. Tokens arriving in a link
 * are ignored, so nobody can be signed into someone else's account by a crafted URL.
 */
export default function OAuthCallback() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const code = new URLSearchParams(window.location.hash.slice(1)).get('code');
    if (window.location.hash || window.location.search) window.history.replaceState(null, '', window.location.pathname);
    if (!code) {
      router.replace('/login?error=oauth_failed');
      return;
    }
    (async () => {
      try {
        const { data } = await api.post('/auth/oauth/exchange', { code });
        const { accessToken, refreshToken } = data.data;
        const me = await api.get('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
        const user = me.data.data;
        setAuth(user, accessToken, refreshToken);
        router.replace(HOME_BY_ROLE[user.role] || '/');
      } catch {
        router.replace('/login?error=oauth_failed');
      }
    })();
  }, [router, setAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-500 text-sm">Completing sign in…</p>
      </div>
    </div>
  );
}
