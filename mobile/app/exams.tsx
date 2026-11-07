import { useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { ChildSwitcher, useChildren } from '../components/ChildSwitcher';
import { colors } from '../lib/theme';
import { day } from '../lib/format';

// Spec §10: Exam Schedule (dates + syllabus) and Progress Report (marks, grade, report card PDF).
export default function ExamsScreen() {
  const { childId } = useChildren();
  const q = useQuery({ queryKey: ['family-exams', childId], queryFn: () => API.familyExams(childId!), enabled: !!childId });
  const [open, setOpen] = useState<string | null>(null);

  const download = async (examId: string) => {
    try {
      const { url } = await API.reportCardLink(examId, childId!);
      await Linking.openURL(url);
    } catch (e) {
      const msg = apiError(e);
      if (Platform.OS === 'web') globalThis.alert?.(msg); else Alert.alert('Could not open report card', msg);
    }
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <Empty title="No exams yet" hint="The date sheet appears here once the school schedules an exam." />}
      {q.data?.map((e) => {
        const r = e.result;
        const expanded = open === e.id || (!r && q.data!.length === 1);
        return (
          <Card key={e.id} onPress={() => setOpen(open === e.id ? null : e.id)}>
            <View style={s.top}>
              <H>{e.name}</H>
              {r ? <Badge label="Result out" fg={colors.good} bg={colors.goodSoft} /> : <Badge label="Upcoming" fg={colors.info} bg={colors.infoSoft} />}
            </View>
            {e.startDate && <Muted>{day(e.startDate)}{e.endDate ? ` – ${day(e.endDate)}` : ''}</Muted>}

            {r && (
              <View style={s.summary}>
                <View style={s.stat}><Text style={s.big}>{r.percent ?? '—'}%</Text><Muted>Percentage</Muted></View>
                <View style={s.stat}><Text style={s.big}>{r.grade ?? '—'}</Text><Muted>Grade</Muted></View>
                <View style={s.stat}><Text style={s.big}>{r.position ?? '—'}</Text><Muted>Position</Muted></View>
              </View>
            )}
            {r && r.passed === false && <Text style={{ color: colors.bad, fontWeight: '600' }}>Did not pass every subject</Text>}

            {expanded && (
              <View style={{ marginTop: 10, gap: 2 }}>
                {r
                  ? r.subjects.map((x: any) => (
                    <Row key={x.subject} label={x.subject} value={
                      <Text style={{ fontWeight: '700', color: x.passed === false ? colors.bad : colors.text }}>
                        {x.isAbsent ? 'Absent' : `${x.obtained ?? '—'}/${x.totalMarks}`}{x.grade ? `  ${x.grade}` : ''}
                      </Text>} />
                  ))
                  : e.papers.map((p: any) => (
                    <View key={p.id} style={s.paper}>
                      <Row label={p.subject} value={p.date ? day(p.date, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Date TBA'} />
                      {p.syllabus && <Muted>Syllabus: {p.syllabus}</Muted>}
                    </View>
                  ))}
                {r && <View style={{ marginTop: 10 }}><Button title="Download report card (PDF)" variant="secondary" onPress={() => download(e.id)} /></View>}
              </View>
            )}
            {!expanded && <Pressable onPress={() => setOpen(e.id)}><Text style={s.more}>{r ? 'Subject-wise marks' : 'Date sheet & syllabus'} ›</Text></Pressable>}
          </Card>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  summary: { flexDirection: 'row', marginVertical: 10 },
  stat: { flex: 1, alignItems: 'center' },
  big: { fontSize: 22, fontWeight: '800', color: colors.text },
  paper: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  more: { color: colors.primary, fontWeight: '600', marginTop: 8 },
});
