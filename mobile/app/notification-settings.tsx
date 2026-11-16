import { Switch, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Card, ErrorBox, Loading, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';

/** Each person chooses which routine kinds of notification alert them. */
export default function NotificationSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notification-preferences'], queryFn: API.notificationPreferences });
  const save = useMutation({
    mutationFn: (muted: string[]) => API.saveNotificationPreferences(muted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });
  const types = q.data?.types ?? [];
  const toggle = (type: string) => {
    const muted = new Set(types.filter((t) => t.muted).map((t) => t.type));
    if (muted.has(type)) muted.delete(type); else muted.add(type);
    save.mutate([...muted]);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {save.error && <ErrorBox message={apiError(save.error)} />}
      {!!types.length && (
        <>
          <Muted>
            Switch off the kinds you don’t want an alert for. They still appear in your notification list. Urgent alerts and messages from the school office always come through.
          </Muted>
          <Card style={{ padding: 0 }}>
            {types.map((t, i) => (
              <View key={t.type} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{t.label}</Text>
                  {!t.canMute && <Muted>{t.urgent ? 'Urgent: always on' : 'Always on'}</Muted>}
                </View>
                <Switch
                  value={!t.muted}
                  disabled={!t.canMute || save.isPending}
                  onValueChange={() => toggle(t.type)}
                  trackColor={{ true: colors.primary }}
                  accessibilityLabel={`Alert me about: ${t.label}`}
                />
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
