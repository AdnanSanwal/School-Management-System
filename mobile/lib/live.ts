import { useEffect } from 'react';
import { AppState } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API, BASE_URL } from './api';
import { useAuthStore } from '../store/authStore';

/**
 * The live connection to the server while the app is open. It only says "something new
 * for you"; the app then reloads its notifications from the API. When the app is closed
 * or in the background the connection is dropped to save battery, and push notifications
 * take over; on return it reconnects and catches up. (A type the person muted still
 * updates the bell here; it simply is not pushed.)
 */

function serverUrl() {
  // "https://school.example.com/api/v1" → "https://school.example.com"
  return BASE_URL.replace(/\/api\/v\d+\/?$/, '');
}

export function useLiveNotifications(queryClient: QueryClient) {
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
      autoConnect: AppState.currentState === 'active',
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
      if (closed || AppState.currentState !== 'active') return;
      clearTimeout(retry);
      const wait = Math.min(60_000, 2000 * 2 ** Math.min(failures++, 5)) + Math.random() * 1000;
      retry = setTimeout(async () => {
        await API.unreadCount().catch(() => {});
        if (!closed && useAuthStore.getState().accessToken && AppState.currentState === 'active') socket.connect();
      }, wait);
    };

    socket.on('connect', () => { failures = 0; refresh(); }); // catch up on anything missed while away
    socket.on('connect_error', () => { if (!socket.active) comeBack(); });
    socket.on('disconnect', (reason) => { if (reason === 'io server disconnect') comeBack(); });
    socket.on('notification', refresh);
    socket.on('notifications:read', refresh);

    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') { failures = 0; if (!socket.connected) socket.connect(); } else { clearTimeout(retry); socket.disconnect(); }
    });

    return () => {
      closed = true;
      clearTimeout(retry);
      appState.remove();
      socket.removeAllListeners();
      socket.close();
    };
  }, [userId, schoolId, queryClient]);
}
