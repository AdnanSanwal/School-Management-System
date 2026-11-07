import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { useAuthStore } from '../../store/authStore';

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;

// Spec §10: Bottom Tabs: Home | Attendance | Fees | Diary | More
export default function FamilyTabs() {
  const isParent = useAuthStore((s) => s.user?.role === 'PARENT');
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.faint, headerTitleStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('calendar-outline') }} />
      {/* Students don't see fees (spec §11 Student View). */}
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: icon('wallet-outline'), href: isParent ? undefined : null }} />
      <Tabs.Screen name="diary" options={{ title: 'Diary', tabBarIcon: icon('book-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}
