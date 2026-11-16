import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { API } from '../lib/api';
import { colors } from '../lib/theme';

/** How many notifications the signed-in user has not opened yet. Kept fresh by lib/live.ts. */
export function useUnreadNotifications() {
  // The one-minute refresh is only the safety net for when the live connection is down.
  return useQuery({ queryKey: ['notifications', 'unread'], queryFn: API.unreadCount, refetchInterval: 60_000 }).data ?? 0;
}

/** The bell in the top bar: shows the unread count and opens the notification list. */
export function NotificationBell() {
  const unread = useUnreadNotifications();
  return (
    <Pressable
      onPress={() => router.push('/notifications')}
      hitSlop={10}
      style={s.button}
      accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    >
      <Ionicons name="notifications-outline" size={24} color={colors.text} />
      {unread > 0 && (
        <View style={s.badge}><Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text></View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  button: { marginRight: 16, padding: 2 },
  badge: { position: 'absolute', top: -4, right: -8, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
