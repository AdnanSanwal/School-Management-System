import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../lib/api';
import { unregisterPush } from '../lib/pushNotifications';
import { useAuthStore } from '../store/authStore';
import { Button, Card, H, Muted, Row } from './ui';
import { colors } from '../lib/theme';
import { day } from '../lib/format';

function Item({ icon, label, badge, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.item, pressed && { backgroundColor: '#f8fafc' }]} accessibilityRole="button">
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={s.itemText}>{label}</Text>
      {!!badge && <View style={s.badge}><Text style={s.badgeText}>{badge}</Text></View>}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </Pressable>
  );
}

/** Shared "More" tab: notices, alerts, holidays, password, sign out. */
export function MoreMenu({ extra }: { extra?: React.ReactNode }) {
  const { user, clearAuth } = useAuthStore();
  const qc = useQueryClient();
  const notices = useQuery({ queryKey: ['notices', 1], queryFn: () => API.notices(1) });
  const events = useQuery({ queryKey: ['events'], queryFn: API.events });
  const [pw, setPw] = useState({ open: false, current: '', next: '', saving: false });

  const signOut = async () => {
    await unregisterPush();
    await API.logout();
    qc.clear();
    clearAuth();
  };

  const changePassword = async () => {
    if (pw.next.length < 8) return Alert.alert('Password too short', 'Use at least 8 characters.');
    setPw({ ...pw, saving: true });
    try {
      await API.changePassword(pw.current, pw.next);
      setPw({ open: false, current: '', next: '', saving: false });
      Alert.alert('Password changed');
    } catch (e) {
      setPw({ ...pw, saving: false });
      Alert.alert('Could not change password', apiError(e));
    }
  };

  return (
    <>
      <Card>
        <H>{user?.name}</H>
        <Muted>{user?.email}</Muted>
        <Muted>{user?.school?.name}</Muted>
      </Card>
      <Card style={{ padding: 0 }}>
        <Item icon="megaphone-outline" label="Notices & circulars" badge={notices.data?.unread} onPress={() => router.push('/notices')} />
        <Item icon="notifications-outline" label="Notifications" onPress={() => router.push('/notifications')} />
        {extra}
      </Card>
      <Card>
        <H>Holidays & events</H>
        {(events.data ?? []).slice(0, 8).map((e: any) => (
          <Row key={e.id} label={`${e.type === 'HOLIDAY' ? '🏖️' : '📌'} ${e.title}`} value={day(e.startDate) + (e.endDate !== e.startDate ? ` – ${day(e.endDate)}` : '')} />
        ))}
        {events.data?.length === 0 && <Muted>Nothing scheduled.</Muted>}
      </Card>
      <Card style={{ gap: 8 }}>
        {!pw.open ? (
          <Button title="Change password" variant="secondary" onPress={() => setPw({ ...pw, open: true })} />
        ) : (
          <>
            <TextInput style={s.input} secureTextEntry placeholder="Current password" value={pw.current} onChangeText={(v) => setPw({ ...pw, current: v })} accessibilityLabel="Current password" />
            <TextInput style={s.input} secureTextEntry placeholder="New password (8+ characters)" value={pw.next} onChangeText={(v) => setPw({ ...pw, next: v })} accessibilityLabel="New password" />
            <Button title="Save new password" onPress={changePassword} loading={pw.saving} />
          </>
        )}
        <Button title="Sign out" variant="danger" onPress={() => (Platform.OS === 'web' ? signOut() : Alert.alert('Sign out?', '', [{ text: 'Cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }]))} />
      </Card>
    </>
  );
}

const s = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  itemText: { flex: 1, fontSize: 15, color: colors.text, fontWeight: '500' },
  badge: { backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15 },
});
