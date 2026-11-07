import { Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Badge, Card, ErrorBox, H, Loading, Muted, Screen } from '../../components/ui';
import { colors } from '../../lib/theme';

// Teacher: which students' families marked a homework as done.
export default function HomeworkCompletion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['homework', id], queryFn: () => API.homeworkCompletion(id!), enabled: !!id });
  const d: any = q.data;
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} /> : d && (
        <Card>
          <H>{d.done} of {d.total} done</H>
          <Muted>Marked by parents or students in the app.</Muted>
          {d.students.map((s: any) => (
            <View key={s.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <Text style={{ color: colors.text, flex: 1 }}>{s.rollNo ? `${s.rollNo}. ` : ''}{s.name}</Text>
              {s.done ? <Badge label="Done" fg={colors.good} bg={colors.goodSoft} /> : <Badge label="Not yet" fg={colors.muted} bg="#f1f5f9" />}
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}
