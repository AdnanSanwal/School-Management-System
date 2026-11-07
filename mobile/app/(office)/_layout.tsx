import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/theme';

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: string; size: number }) => <Ionicons name={name} color={color} size={size} />;

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
