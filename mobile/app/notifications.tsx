import { useEffect } from 'react';
import { Text, View } from 'react-native';
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
  // Opening the list marks everything as read.
  useEffect(() => {
    if (q.data?.some((n) => !n.readAt)) API.readAllNotifications().then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
  }, [q.data, qc]);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
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
