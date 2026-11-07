import { Alert, Platform, Text } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Button, ErrorBox, Loading, Screen } from '../../components/ui';
import { DiaryList } from '../../components/DiaryList';
import { colors } from '../../lib/theme';

export default function TeacherDiary() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['diary', 'mine-all'], queryFn: () => API.diary({ mine: 'true', limit: 50 }) });
  const del = useMutation({
    mutationFn: (id: string) => API.deleteDiary(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diary'] }),
    onError: (e) => Alert.alert('Could not delete', apiError(e)),
  });
  const confirmDelete = (id: string) => {
    if (Platform.OS === 'web') { if (globalThis.confirm?.('Delete this diary entry?')) del.mutate(id); return; }
    Alert.alert('Delete this entry?', 'Parents will no longer see it.', [{ text: 'Cancel' }, { text: 'Delete', style: 'destructive', onPress: () => del.mutate(id) }]);
  };

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Button title="+ Post diary / homework" onPress={() => router.push('/post-diary')} />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {q.data && (
        <DiaryList entries={q.data.data} showSection footer={(e) => (
          <Text onPress={() => confirmDelete(e.id)} style={{ color: colors.bad, fontWeight: '600', marginTop: 8 }} accessibilityRole="button">Delete</Text>
        )} />
      )}
    </Screen>
  );
}
