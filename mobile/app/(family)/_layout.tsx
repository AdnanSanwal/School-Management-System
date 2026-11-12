import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';
import { allowed, useAuthStore } from '../../store/authStore';

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;

// Spec §10: Bottom Tabs: Home | Attendance | Fees | Diary | More
export default function FamilyTabs() {
  const seesFees = useAuthStore((s) => allowed(s.user, 'fee.view', ['PARENT']));
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.faint, headerTitleStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="attendance" options={{ title: 'Attendance', tabBarIcon: icon('calendar-outline') }} />
      {/* Parents see fees; students don't, unless the school switches that on (Roles & permissions). */}
      <Tabs.Screen name="fees" options={{ title: 'Fees', tabBarIcon: icon('wallet-outline'), href: seesFees ? undefined : null }} />
      <Tabs.Screen name="diary" options={{ title: 'Diary', tabBarIcon: icon('book-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}
