import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const icon = (name: keyof typeof Ionicons.glyphMap) => function TabIcon({ color, size }: { color: unknown; size: number }) { return <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />; };

// Spec §5: the owner checks the school from their phone without coming in.
// Day-to-day office work (admissions, fee entry) stays on the web panel.
export default function OfficeTabs() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, tabBarInactiveTintColor: colors.faint, headerTitleStyle: { fontWeight: '700' } }}>
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('stats-chart-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('ellipsis-horizontal') }} />
    </Tabs>
  );
}
