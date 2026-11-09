import { useState } from 'react';
import { Text, TextInput, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { Button, Card, H, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';

/**
 * First sign-in with a password the school office chose (CR-05). The server refuses
 * everything else until the person sets their own; the root layout keeps them here.
 */
export default function SetPassword() {
  const qc = useQueryClient();
  const { user, setAuth, clearAuth } = useAuthStore();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (f.next.length < 8) return setError('Use at least 8 characters.');
    if (f.next !== f.confirm) return setError('The two new passwords are different.');
    if (f.next === f.current) return setError('Choose a password different from the one you were given.');
    setBusy(true);
    try {
      const r = await API.changePassword(f.current, f.next);
      qc.clear();
      setAuth(r.user, r.accessToken, r.refreshToken); // root layout now opens the right app
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await API.logout();
    qc.clear();
    clearAuth();
  };

  return (
    <Screen>
      <Card style={{ gap: 10 }}>
        <H>Welcome{user ? `, ${user.name}` : ''}</H>
        <Muted>The password you were given was chosen by the school office. Please set your own to continue.</Muted>
        <TextInput style={s.input} secureTextEntry placeholder="Password you were given" value={f.current} onChangeText={(v) => setF({ ...f, current: v })} accessibilityLabel="Password you were given" autoComplete="password" />
        <TextInput style={s.input} secureTextEntry placeholder="New password (8+ characters)" value={f.next} onChangeText={(v) => setF({ ...f, next: v })} accessibilityLabel="New password" autoComplete="password-new" />
        <TextInput style={s.input} secureTextEntry placeholder="Repeat new password" value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} accessibilityLabel="Repeat new password" autoComplete="password-new" />
        {!!error && <Text style={s.error}>{error}</Text>}
        <Button title="Save and continue" onPress={save} loading={busy} />
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, backgroundColor: '#fff' },
  error: { color: colors.bad, fontWeight: '600' },
});
