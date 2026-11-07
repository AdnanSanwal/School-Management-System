import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API, apiError } from '../../lib/api';
import { areaFor, useAuthStore } from '../../store/authStore';
import { Button } from '../../components/ui';
import { colors } from '../../lib/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const setAuth = useAuthStore((s) => s.setAuth);

  const submit = async () => {
    if (!email.trim() || !password) return setError('Enter your email and password');
    setError('');
    setLoading(true);
    try {
      const r = await API.login(email.trim().toLowerCase(), password);
      if (!areaFor(r.user.role)) return setError('This account has no mobile app. Please use the website.');
      setAuth(r.user, r.accessToken, r.refreshToken); // the root layout routes to the right app
    } catch (e) {
      setError(apiError(e, 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <View style={s.logo}><Text style={{ fontSize: 34 }}>🎓</Text></View>
          <Text style={s.title}>School ERP</Text>
          <Text style={s.sub}>Sign in with the login your school gave you</Text>

          <View style={s.card}>
            <Text style={s.label}>Email</Text>
            <TextInput
              style={s.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email"
              keyboardType="email-address" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder="you@example.com" placeholderTextColor={colors.faint} accessibilityLabel="Email"
            />
            <Text style={s.label}>Password</Text>
            <TextInput
              ref={passwordRef} style={s.input} value={password} onChangeText={setPassword} secureTextEntry
              autoComplete="password" returnKeyType="go" onSubmitEditing={submit}
              placeholder="••••••••" placeholderTextColor={colors.faint} accessibilityLabel="Password"
            />
            {!!error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
            <Button title="Sign in" onPress={submit} loading={loading} />
          </View>
          <Text style={s.hint}>Forgot your password? Ask the school office to reset it.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 8 },
  logo: { alignSelf: 'center', width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', textAlign: 'center', color: colors.text, marginTop: 8 },
  sub: { fontSize: 14, color: colors.muted, textAlign: 'center', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 20, gap: 8, borderWidth: 1, borderColor: '#f1f5f9' },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.text, marginBottom: 4 },
  error: { color: colors.bad, fontSize: 13, marginVertical: 4 },
  hint: { textAlign: 'center', color: colors.faint, fontSize: 12, marginTop: 12 },
});
