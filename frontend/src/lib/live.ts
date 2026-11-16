'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { authAPI } from '@/lib/api';

/**
 * The live connection to the server. It only tells this page "something new for you";
 * the page then reloads its notifications from the API, which stays the source of truth.
 * If the connection is down (blocked network, server restart) the bell still updates by
 * itself every minute, and catches up fully when the connection returns.
 */

/** The server's address: the API's own host, or this site when the API is called by a relative path. */
function serverUrl() {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api/v1';
  try { return new URL(api).origin; } catch { return window.location.origin; }
}

interface LiveNotification { id: string; type: string; title: string; body: string; quiet?: boolean }

export function useLiveNotifications() {
  const queryClient = useQueryClient();
  // Reconnect as a different person, or in a different branch, when either changes.
  const userId = useAuthStore((s) => (s.accessToken && s.user && !s.user.mustChangePassword ? s.user.id : null));
  const schoolId = useAuthStore((s) => s.user?.school?.id ?? null);

  useEffect(() => {
    if (!userId) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const refresh = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

    const socket: Socket = io(serverUrl(), {
      transports: ['websocket'],
      // Read at every attempt, so a refreshed login is picked up by itself.
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });

    // The server refused or ended the connection (usually an expired login). Socket.IO does
    // not retry those by itself: renew the login with an ordinary API call, then try again,
    // waiting longer each time.
    const comeBack = () => {
      if (closed) return;
      clearTimeout(retry);
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5)) + Math.random() * 1000;
      retry = setTimeout(async () => {
        await authAPI.me().catch(() => {});
        if (!closed && useAuthStore.getState().accessToken) socket.connect();
      }, wait);
    };

    socket.on('connect', () => { failures = 0; refresh(); }); // catch up on anything missed while away
    socket.on('connect_error', () => { if (!socket.active) comeBack(); });
    socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') comeBack(); });
    socket.on('notification', (n: LiveNotification) => {
      refresh();
      if (n.quiet) return; // a type this person muted: the bell updates, nothing pops up
      toast(`${n.title}${n.body ? `: ${n.body}` : ''}`.slice(0, 160), { id: n.id, icon: '🔔', duration: 6000 });
    });
    socket.on('notifications:read', refresh);

    return () => {
      closed = true;
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.close();
    };
  }, [userId, schoolId, queryClient]);
}
