import { router } from 'expo-router';
import { Screen } from '../../components/ui';
import { Item, MoreMenu } from '../../components/MoreMenu';

export default function TeacherMore() {
  return (
    <Screen>
      <MoreMenu extra={<>
        <Item icon="time-outline" label="My timetable" onPress={() => router.push('/timetable')} />
        <Item icon="create-outline" label="Marks entry" onPress={() => router.push('/marks')} />
        <Item icon="airplane-outline" label="Leave" onPress={() => router.push('/leave')} />
      </>} />
    </Screen>
  );
}
