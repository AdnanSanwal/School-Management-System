import { useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Button, Card, Empty, ErrorBox, Loading, Muted, Screen } from '../../components/ui';
import { useMySections } from '../../components/sections';
import { colors, STATUS_COLORS } from '../../lib/theme';

const OPTIONS = [['PRESENT', 'P'], ['ABSENT', 'A'], ['LATE', 'L'], ['LEAVE', 'Lv']] as const;

function notify(title: string, msg = '') {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n${msg}`);
  else Alert.alert(title, msg);
}

// Spec §8 Mark Attendance: select class → Present/Absent/Late → submit (one tap for all present).
export default function MarkAttendance() {
  const params = useLocalSearchParams<{ section?: string }>();
  const sections = useMySections();
  const [sectionId, setSectionId] = useState<string | null>(params.section ?? null);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const qc = useQueryClient();

  useEffect(() => { if (params.section) setSectionId(params.section); }, [params.section]);
  useEffect(() => { if (!sectionId && sections.data?.length) setSectionId(sections.data[0].id); }, [sections.data, sectionId]);

  const roster = useQuery({ queryKey: ['roster', sectionId], queryFn: () => API.roster(sectionId!), enabled: !!sectionId });
  useEffect(() => {
    if (roster.data) setMarks(Object.fromEntries(roster.data.students.filter((s: any) => s.status).map((s: any) => [s.id, s.status])));
  }, [roster.data]);

  const students: any[] = roster.data?.students ?? [];
  const counts = useMemo(() => Object.values(marks).reduce<Record<string, number>>((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {}), [marks]);
  const unmarked = students.length - Object.keys(marks).length;

  const save = useMutation({
    mutationFn: () => API.markAttendance(sectionId!, students.filter((s) => marks[s.id]).map((s) => ({ studentId: s.id, status: marks[s.id] }))),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['roster'] });
      notify('Attendance saved', `${r.saved} students${r.parentsNotified ? `\n${r.parentsNotified} parent(s) notified of absence` : ''}`);
    },
    onError: (e) => notify('Could not save', apiError(e)),
  });

  if (sections.isLoading) return <Loading />;
  if (!sections.data?.length) return <Empty title="No classes assigned yet" />;

  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={roster.isRefetching} onRefresh={() => roster.refetch()}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {sections.data.map((s) => (
            <Pressable key={s.id} onPress={() => setSectionId(s.id)} accessibilityRole="tab" accessibilityState={{ selected: s.id === sectionId }}
              style={[st.pill, s.id === sectionId && st.pillOn]}>
              <Text style={[st.pillText, s.id === sectionId && { color: '#fff' }]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {roster.data?.holiday && <Card style={{ backgroundColor: colors.infoSoft }}><Text style={{ color: colors.info }}>{roster.data.holiday} — today is a holiday.</Text></Card>}
        {roster.error && <ErrorBox message={apiError(roster.error)} />}
        {roster.isLoading ? <Loading /> : (
          <>
            <View style={st.summary}>
              <Muted>P {counts.PRESENT ?? 0} · A {counts.ABSENT ?? 0} · L {counts.LATE ?? 0} · Lv {counts.LEAVE ?? 0}{unmarked ? ` · ${unmarked} left` : ''}</Muted>
              <Pressable onPress={() => setMarks(Object.fromEntries(students.map((s) => [s.id, 'PRESENT'])))} accessibilityRole="button">
                <Text style={st.allPresent}>All present</Text>
              </Pressable>
            </View>
            {students.map((s, i) => (
              <Card key={s.id} style={st.studentRow}>
                <View style={{ flex: 1 }}>
                  <Text style={st.name}>{s.rollNo ?? i + 1}. {s.name}</Text>
                </View>
                <View style={st.options} accessibilityRole="radiogroup" accessibilityLabel={`Attendance for ${s.name}`}>
                  {OPTIONS.map(([key, short]) => {
                    const on = marks[s.id] === key;
                    return (
                      <Pressable key={key} onPress={() => setMarks({ ...marks, [s.id]: key })} accessibilityRole="radio" accessibilityState={{ checked: on }}
                        accessibilityLabel={STATUS_COLORS[key].label}
                        style={[st.opt, on && { backgroundColor: STATUS_COLORS[key].fg, borderColor: STATUS_COLORS[key].fg }]}>
                        <Text style={[st.optText, on && { color: '#fff' }]}>{short}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Card>
            ))}
          </>
        )}
      </Screen>
      {students.length > 0 && (
        <View style={st.footer}>
          <Button title={save.isPending ? 'Saving…' : roster.data?.marked ? 'Update attendance' : 'Submit attendance'}
            onPress={() => save.mutate()} disabled={!Object.keys(marks).length} loading={save.isPending} />
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  pill: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '700', color: colors.text },
  summary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allPresent: { color: colors.primary, fontWeight: '700', padding: 4 },
  studentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  options: { flexDirection: 'row', gap: 6 },
  opt: { minWidth: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  optText: { fontWeight: '800', color: colors.muted },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border },
});
