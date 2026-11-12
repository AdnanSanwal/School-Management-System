import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const icon = (name: keyof typeof Ionicons.glyphMap) => function TabIcon({ color, size }: { color: unknown; size: number }) { return <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />; };

// Spec §8: the teacher app should be simple and fast — attendance, diary (marks & timetable come in Phase 3).
export default function TeacherTabs() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.faint, headerTitleStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('checkmark-done-outline') }} />
      <Tabs.Screen name="diary" options={{ title: 'Diary', tabBarIcon: icon('book-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}
