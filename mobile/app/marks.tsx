import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, ErrorBox, H, Loading, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';

type Task = { examId: string; exam: string; subjectId: string; subject: string; sectionId: string; section: string; students: number; entered: number };

const say = (title: string, msg = '') => (Platform.OS === 'web' ? globalThis.alert?.(`${title}\n${msg}`) : Alert.alert(title, msg));

// Spec §8 Marks Entry: select exam + class + subject → enter marks → save.
export default function MarksScreen() {
  const tasks = useQuery({ queryKey: ['marks-tasks'], queryFn: API.markTasks });
  const [task, setTask] = useState<Task | null>(null);
  if (task) return <Entry task={task} onBack={() => { setTask(null); tasks.refetch(); }} />;
  return (
    <Screen refreshing={tasks.isRefetching} onRefresh={() => tasks.refetch()}>
      {tasks.isLoading && <Loading />}
      {tasks.error && <ErrorBox message={apiError(tasks.error)} />}
      {tasks.data?.length === 0 && <Empty title="Nothing to enter" hint="Marks open once the principal approves an exam schedule." />}
      {tasks.data?.map((t: Task) => (
        <Card key={`${t.examId}:${t.sectionId}:${t.subjectId}`} onPress={() => setTask(t)}>
          <View style={s.rowBetween}>
            <H>{t.subject} · {t.section}</H>
            <Badge label={`${t.entered}/${t.students}`} fg={t.entered >= t.students ? colors.good : colors.warn} bg={t.entered >= t.students ? colors.goodSoft : colors.warnSoft} />
          </View>
          <Muted>{t.exam}</Muted>
        </Card>
      ))}
    </Screen>
  );
}

function Entry({ task, onBack }: { task: Task; onBack: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['marks', task.examId, task.sectionId, task.subjectId], queryFn: () => API.marks(task.examId, task.sectionId, task.subjectId) });
  const [vals, setVals] = useState<Record<string, { obtained: string; isAbsent: boolean }>>({});
  useEffect(() => {
    if (q.data) setVals(Object.fromEntries(q.data.students.map((st: any) => [st.id, { obtained: st.obtained === null ? '' : String(st.obtained), isAbsent: st.isAbsent }])));
  }, [q.data]);
  const total = q.data?.paper.totalMarks ?? 0;
  const bad = Object.values(vals).some((v) => !v.isAbsent && v.obtained !== '' && !(Number(v.obtained) >= 0 && Number(v.obtained) <= total));

  const save = useMutation({
    mutationFn: () => API.saveMarks(task.examId, {
      sectionId: task.sectionId, subjectId: task.subjectId,
      records: Object.entries(vals).map(([studentId, v]) => ({ studentId, isAbsent: v.isAbsent, obtained: v.isAbsent || v.obtained === '' ? null : Number(v.obtained) })),
    }),
    onSuccess: (r: any) => { qc.invalidateQueries({ queryKey: ['marks-tasks'] }); say('Marks saved', `${r.saved} students`); onBack(); },
    onError: (e) => say('Could not save', apiError(e)),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <Screen><ErrorBox message={apiError(q.error)} /></Screen>;
  const d = q.data;
  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <Pressable onPress={onBack} accessibilityRole="button"><Text style={{ color: colors.primary, fontWeight: '600' }}>‹ All papers</Text></Pressable>
        <Card>
          <H>{d.paper.subject} · {task.section}</H>
          <Muted>{d.exam.name} · out of {total}, pass {d.paper.passingMarks}</Muted>
          {d.locked && <Text style={{ color: colors.warn, marginTop: 6 }}>Results are published — marks are locked.</Text>}
        </Card>
        {d.students.map((st: any, i: number) => {
          const v = vals[st.id] ?? { obtained: '', isAbsent: false };
          const n = Number(v.obtained);
          const invalid = !v.isAbsent && v.obtained !== '' && !(n >= 0 && n <= total);
          return (
            <Card key={st.id} style={s.student}>
              <Text style={s.name} numberOfLines={1}>{st.rollNo ?? i + 1}. {st.name}</Text>
              <TextInput
                style={[s.input, invalid && { borderColor: colors.bad }, !invalid && v.obtained !== '' && n < d.paper.passingMarks && { color: colors.bad }]}
                keyboardType="decimal-pad" editable={!d.locked && !v.isAbsent} value={v.isAbsent ? 'AB' : v.obtained}
                onChangeText={(t) => setVals({ ...vals, [st.id]: { ...v, obtained: t.replace(/[^0-9.]/g, '') } })}
                accessibilityLabel={`Marks for ${st.name}`} placeholder="—" placeholderTextColor={colors.faint} />
              <View style={{ alignItems: 'center' }}>
                <Switch value={v.isAbsent} disabled={d.locked} onValueChange={(b) => setVals({ ...vals, [st.id]: { obtained: '', isAbsent: b } })} accessibilityLabel={`${st.name} absent`} />
                <Muted style={{ fontSize: 10 }}>Absent</Muted>
              </View>
            </Card>
          );
        })}
      </Screen>
      {!d.locked && (
        <View style={s.footer}>
          {bad && <Text style={{ color: colors.bad, marginBottom: 6 }}>Marks must be between 0 and {total}.</Text>}
          <Button title="Save marks" onPress={() => save.mutate()} loading={save.isPending} disabled={bad} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  student: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  name: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  input: { width: 72, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingVertical: 8, textAlign: 'center', fontSize: 16, fontWeight: '700', color: colors.text },
  footer: { padding: 16, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border },
});
