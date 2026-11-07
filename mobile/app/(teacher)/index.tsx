import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMySections } from '../../components/sections';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../../lib/api';
import { Badge, Card, Empty, ErrorBox, H, Loading, Muted, Screen } from '../../components/ui';
import { colors } from '../../lib/theme';
import { day, todayIso } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';


// Spec §8 Teacher Home: who I teach, today's marking status, big quick buttons.
export default function TeacherHome() {
  const user = useAuthStore((s) => s.user);
  const sections = useMySections();
  const rosters = useQueries({
    queries: (sections.data ?? []).map((s) => ({ queryKey: ['roster', s.id], queryFn: () => API.roster(s.id) })),
  });
  const recent = useQuery({ queryKey: ['diary', 'mine'], queryFn: () => API.diary({ mine: 'true', limit: 3 }) });
  const classTeacherOf = sections.data?.find((s) => s.isClassTeacher);

  return (
    <Screen refreshing={sections.isRefetching} onRefresh={() => { sections.refetch(); recent.refetch(); rosters.forEach((r) => r.refetch()); }}>
      <View>
        <Text style={s.hello}>Hello, {user?.name.split(' ')[0]}</Text>
        <Muted>{day(todayIso(), { weekday: 'long', day: 'numeric', month: 'long' })}{classTeacherOf ? ` · Class teacher of ${classTeacherOf.label}` : ''}</Muted>
      </View>

      <View style={s.quick}>
        <Card style={s.quickCard} onPress={() => router.push('/(teacher)/attendance')}>
          <Ionicons name="checkmark-done-outline" size={28} color={colors.primary} />
          <Text style={s.quickText}>Mark attendance</Text>
        </Card>
        <Card style={s.quickCard} onPress={() => router.push('/post-diary')}>
          <Ionicons name="create-outline" size={28} color={colors.primary} />
          <Text style={s.quickText}>Post diary</Text>
        </Card>
      </View>

      <H>Today&apos;s attendance</H>
      {sections.isLoading && <Loading />}
      {sections.error && <ErrorBox message={apiError(sections.error)} />}
      {sections.data?.length === 0 && <Empty title="No classes assigned yet" hint="Ask the office to assign you to a section." />}
      {sections.data?.map((sec, i) => {
        const r = rosters[i]?.data as any;
        return (
          <Card key={sec.id} onPress={() => router.push({ pathname: '/(teacher)/attendance', params: { section: sec.id } })}>
            <View style={s.row}>
              <View>
                <Text style={s.section}>{sec.label}</Text>
                <Muted>{sec.strength} students{sec.isClassTeacher ? ' · your class' : ''}</Muted>
              </View>
              {!r ? <Muted>…</Muted> : r.holiday ? <Badge label="Holiday" fg={colors.info} bg={colors.infoSoft} />
                : r.marked ? <Badge label="Marked" fg={colors.good} bg={colors.goodSoft} />
                : <Badge label="Not marked" fg={colors.warn} bg={colors.warnSoft} />}
            </View>
          </Card>
        );
      })}

      <H>My recent diary posts</H>
      {recent.data?.data.length === 0 && <Muted>Nothing posted yet.</Muted>}
      {recent.data?.data.map((e: any) => (
        <Card key={e.id} onPress={() => router.push('/(teacher)/diary')}>
          <Text style={{ fontWeight: '600', color: colors.text }} numberOfLines={2}>{e.subject?.name ? `${e.subject.name}: ` : ''}{e.title ?? e.content}</Text>
          <Muted>{e.section.class.name}-{e.section.name} · {day(e.date)}</Muted>
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({
  hello: { fontSize: 22, fontWeight: '800', color: colors.text },
  quick: { flexDirection: 'row', gap: 12 },
  quickCard: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 20 },
  quickText: { fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
});
