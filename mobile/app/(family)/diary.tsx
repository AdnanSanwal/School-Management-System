import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { ErrorBox, Loading, Screen } from '../../components/ui';
import { ChildSwitcher, useChildren } from '../../components/ChildSwitcher';
import { DiaryList } from '../../components/DiaryList';
import { colors } from '../../lib/theme';
import { useAuthStore } from '../../store/authStore';

// Spec §10 Daily Diary + Homework (date-wise posts by teachers, attachments viewable).
export default function FamilyDiary() {
  const { childId } = useChildren();
  const role=useAuthStore(s=>s.user?.role);
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => API.markHomework(id, childId!, done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
    onError: (e) => Alert.alert('Could not update', apiError(e)),
  });
  const [homeworkOnly, setHomeworkOnly] = useState(false);
  const q = useQuery({
    queryKey: ['diary', childId, homeworkOnly],
    queryFn: () => API.diary({ studentId: childId, limit: 50, ...(homeworkOnly ? { homework: 'true' } : {}) }),
    enabled: !!childId,
  });

  useEffect(()=>{if(role==='PARENT'&&childId&&q.data?.data?.length)void API.diaryViews(childId,q.data.data.map((e:any)=>e.id)).catch(()=>{});},[role,childId,q.data]);
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      <View style={{ flexDirection: 'row', gap: 8 }} accessibilityRole="tablist">
        {[['All', false], ['Homework', true]].map(([label, v]) => (
          <Pressable key={String(label)} onPress={() => setHomeworkOnly(v as boolean)} accessibilityRole="tab" accessibilityState={{ selected: homeworkOnly === v }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: homeworkOnly === v ? colors.primary : '#fff', borderWidth: 1, borderColor: homeworkOnly === v ? colors.primary : colors.border }}>
            <Text style={{ color: homeworkOnly === v ? '#fff' : colors.text, fontWeight: '600' }}>{label as string}</Text>
          </Pressable>
        ))}
      </View>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {q.data && (
        <DiaryList entries={q.data.data} footer={(e) => e.isHomework && (
          <Pressable onPress={() => mark.mutate({ id: e.id, done: !e.done })} disabled={mark.isPending} accessibilityRole="checkbox" accessibilityState={{ checked: !!e.done }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, alignSelf: 'flex-start',
              backgroundColor: e.done ? colors.goodSoft : colors.primarySoft }}>
            <Text style={{ fontSize: 16 }}>{e.done ? '✅' : '⬜'}</Text>
            <Text style={{ color: e.done ? colors.good : colors.primary, fontWeight: '700' }}>{e.done ? 'Homework done' : 'Mark homework done'}</Text>
          </Pressable>
        )} />
      )}
    </Screen>
  );
}
