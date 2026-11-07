import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { registerForPushNotifications } from '../lib/pushNotifications';
import { areaFor, useAuthStore, useHydrated } from '../store/authStore';
import { useChildStore } from '../store/childStore';
import { colors } from '../lib/theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }),
  });
}

/** Where a tapped notification should open. */
function openFromNotification(data: Record<string, any> | undefined) {
  if (!data) return;
  const area = areaFor(useAuthStore.getState().user?.role);
  if (data.studentId) useChildStore.getState().setChild(String(data.studentId));
  switch (data.type) {
    case 'ATTENDANCE_ABSENT': return area === 'family' && router.push('/(family)/attendance');
    case 'FEE_DUE':
    case 'FEE_PAID': return area === 'family' && router.push('/(family)/fees');
    case 'DIARY_POSTED': return area === 'family' ? router.push('/(family)/diary') : router.push('/(teacher)/diary');
    case 'NOTICE_PUBLISHED': return router.push('/notices');
    default: return router.push('/notifications');
  }
}

export default function RootLayout() {
  const user = useAuthStore((s) => s.user);
  const hydrated = useHydrated();
  const segments = useSegments();

  // Auth gate: signed-out users go to login; signed-in users go to their app.
  useEffect(() => {
    if (!hydrated) return;
    const inAuth = segments[0] === '(auth)';
    const area = areaFor(user?.role);
    if (!user || !area) {
      if (!inAuth) router.replace('/(auth)/login');
    } else if (inAuth || !segments[0] || segments[0] === 'index') {
      router.replace(`/(${area})`);
    }
  }, [user, hydrated, segments]);

  useEffect(() => {
    if (user) registerForPushNotifications();
  }, [user?.id]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((r) => openFromNotification(r.notification.request.content.data));
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text, fontWeight: '700' } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
          <Stack.Screen name="(family)" options={{ headerShown: false }} />
          <Stack.Screen name="(teacher)" options={{ headerShown: false }} />
          <Stack.Screen name="(office)" options={{ headerShown: false }} />
          <Stack.Screen name="notices" options={{ title: 'Notices' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="post-diary" options={{ title: 'Post diary', presentation: 'modal' }} />
          <Stack.Screen name="receipt/[id]" options={{ title: 'Receipt' }} />
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
