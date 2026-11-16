import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { ago } from '../lib/format';

const ICON: Record<string, string> = {
  ATTENDANCE_ABSENT: '🔴', FEE_DUE: '💰', FEE_PAID: '✅', DIARY_POSTED: '📒', NOTICE_PUBLISHED: '📢',
};

export default function NotificationsScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: API.notifications });
  // Looking at the list marks everything as read. Only while this screen is the one in
  // front: it stays mounted underneath the settings screen, where nothing is being read.
  const [inFront, setInFront] = useState(false);
  useFocusEffect(useCallback(() => { setInFront(true); return () => setInFront(false); }, []));
  useEffect(() => {
    if (inFront && q.data?.some((n) => !n.readAt)) API.readAllNotifications().then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [q.data, qc, inFront]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Pressable onPress={() => router.push('/notification-settings')} accessibilityRole="button" style={{ alignSelf: 'flex-end', paddingVertical: 4 }}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>What should alert me ›</Text>
      </Pressable>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {q.data?.length === 0 && <Empty title="No notifications" hint="Absences, fee updates, diary posts and notices show up here." />}
      {q.data?.map((n) => (
        <Card key={n.id} style={!n.readAt ? { borderColor: '#c7d2fe' } : undefined}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={{ fontSize: 18 }}>{ICON[n.type] ?? '🔔'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text }}>{n.title}</Text>
              <Text style={{ color: colors.text, marginTop: 2 }}>{n.body}</Text>
              <Muted style={{ marginTop: 4 }}>{ago(n.createdAt)}</Muted>
            </View>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
