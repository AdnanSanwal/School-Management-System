import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Card, Empty, ErrorBox, Loading, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { ago } from '../lib/format';

// Spec §10 Notices & Circulars: school + class notices with read/unread status.
export default function NoticesScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notices', 1], queryFn: () => API.notices(1) });
  const [open, setOpen] = useState<string | null>(null);
  const read = useMutation({
    mutationFn: (id: string) => API.readNotice(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['notices'] }); qc.invalidateQueries({ queryKey: ['home'] }); },
  });

  const toggle = (n: any) => {
    setOpen(open === n.id ? null : n.id);
    if (!n.readAt && n.publishedAt) read.mutate(n.id);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.data.length === 0 && <Empty title="No notices yet" />}
      {q.data?.data.map((n: any) => (
        <Card key={n.id} onPress={() => toggle(n)} style={!n.readAt && n.publishedAt ? s.unread : undefined}>
          <View style={s.top}>
            {!n.readAt && n.publishedAt && <View style={s.dot} accessibilityLabel="Unread" />}
            <Text style={[s.title, !n.readAt && { fontWeight: '800' }]} numberOfLines={open === n.id ? undefined : 2}>{n.title}</Text>
          </View>
          <Muted>{n.author ?? 'School'} · {n.publishedAt ? ago(n.publishedAt) : 'Draft'}{n.sections.length ? ` · ${n.sections.join(', ')}` : ''}</Muted>
          <Text style={s.body} numberOfLines={open === n.id ? undefined : 2}>{n.body}</Text>
          {open === n.id && n.attachment && (
            <Text style={s.link} onPress={() => Linking.openURL(n.attachment)} accessibilityRole="link">Open attachment</Text>
          )}
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  unread: { borderColor: '#c7d2fe', backgroundColor: '#fafaff' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  body: { fontSize: 14, color: colors.text, marginTop: 8, lineHeight: 20 },
  link: { color: colors.primary, fontWeight: '700', marginTop: 10 },
});
