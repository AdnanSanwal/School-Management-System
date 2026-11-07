import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { ErrorBox, Loading, Screen } from '../../components/ui';
import { ChildSwitcher, useChildren } from '../../components/ChildSwitcher';
import { DiaryList } from '../../components/DiaryList';
import { colors } from '../../lib/theme';

// Spec §10 Daily Diary + Homework (date-wise posts by teachers, attachments viewable).
export default function FamilyDiary() {
  const { childId } = useChildren();
  const [homeworkOnly, setHomeworkOnly] = useState(false);
  const q = useQuery({
    queryKey: ['diary', childId, homeworkOnly],
    queryFn: () => API.diary({ studentId: childId, limit: 50, ...(homeworkOnly ? { homework: 'true' } : {}) }),
    enabled: !!childId,
  });

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
      {q.data && <DiaryList entries={q.data.data} />}
    </Screen>
  );
}
