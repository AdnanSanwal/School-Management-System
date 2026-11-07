import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Card, Empty, Muted } from './ui';
import { colors } from '../lib/theme';
import { ago, day, sectionName } from '../lib/format';

export function DiaryList({ entries, showSection, footer }: { entries: any[]; showSection?: boolean; footer?: (e: any) => React.ReactNode }) {
  if (!entries.length) return <Empty title="No diary entries yet" />;
  // Group by date so the list reads like a diary.
  const groups = new Map<string, any[]>();
  for (const e of entries) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);
  return (
    <>
      {[...groups].map(([date, list]) => (
        <View key={date} style={{ gap: 8 }}>
          <Text style={s.date}>{day(date, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
          {list.map((e) => (
            <Card key={e.id}>
              <View style={s.top}>
                <Text style={s.subject}>{e.subject?.name ?? 'General'}{showSection ? ` · ${sectionName(e.section)}` : ''}</Text>
                {e.isHomework && <Badge label={e.dueDate ? `Homework · due ${day(e.dueDate)}` : 'Homework'} fg={colors.warn} bg={colors.warnSoft} />}
              </View>
              {e.title && <Text style={s.title}>{e.title}</Text>}
              <Text style={s.content}>{e.content}</Text>
              {e.attachments.map((a: any) => (
                <Pressable key={a.id} onPress={() => a.href && Linking.openURL(a.href)} style={s.attach} accessibilityRole="link">
                  <Ionicons name={a.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={18} color={colors.primary} />
                  <Text style={s.attachText} numberOfLines={1}>{a.fileName}</Text>
                </Pressable>
              ))}
              <Muted style={{ marginTop: 6 }}>{e.teacher.name} · {ago(e.createdAt)}</Muted>
              {footer?.(e)}
            </Card>
          ))}
        </View>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  date: { fontSize: 13, fontWeight: '700', color: colors.muted, marginTop: 4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  subject: { fontSize: 13, fontWeight: '700', color: colors.primary },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 6 },
  content: { fontSize: 15, color: colors.text, marginTop: 4, lineHeight: 21 },
  attach: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, padding: 8, borderRadius: 10, backgroundColor: colors.primarySoft },
  attachText: { color: colors.primary, fontWeight: '600', flex: 1 },
});
