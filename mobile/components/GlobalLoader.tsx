import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFetching, type Query } from '@tanstack/react-query';
import { useActivity } from '../lib/activity';
import { useAuthStore } from '../store/authStore';
import { colors } from '../lib/theme';

const SHOW_AFTER_MS = 350; // quick responses never show the loader
const HIDE_AFTER_MS = 150;

/**
 * Spinner with the school logo in the middle of the screen while a screen's data loads
 * for the first time or a save runs (longer than a moment). Refreshing data that is already
 * on screen (pull-to-refresh, polling) never shows it. Saving blocks touches; loading doesn't.
 */
export function GlobalLoader() {
  const { writes } = useActivity();
  const loading = useIsFetching({ predicate: (q: Query) => q.state.data === undefined && q.getObserversCount() > 0 && !q.meta?.quiet });
  const logoUrl = useAuthStore((s) => s.user?.school?.logoUrl);
  const busy = loading + writes > 0;
  const [visible, setVisible] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => setVisible(busy), busy ? SHOW_AFTER_MS : HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [busy]);

  useEffect(() => {
    if (!visible) return;
    spin.setValue(0);
    const a = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    const b = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    a.start(); b.start();
    return () => { a.stop(); b.stop(); };
  }, [visible, spin, pulse]);

  if (!visible) return null;
  const saving = writes > 0;
  return (
    <View
      pointerEvents={saving ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, s.backdrop, saving && s.blocking]}
      accessibilityRole="progressbar"
      accessibilityLabel={saving ? 'Saving' : 'Loading'}
    >
      <View style={s.card}>
        <View style={s.loader}>
          <Animated.View style={[s.ring, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
          <Animated.View style={{ opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.7] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}>
            {logoUrl
              ? <Image source={{ uri: logoUrl }} style={s.logo} resizeMode="contain" />
              : <View style={[s.logo, s.logoFallback]}><Ionicons name="school" size={26} color="#fff" /></View>}
          </Animated.View>
        </View>
        <Text style={s.label}>{saving ? 'Saving…' : 'Loading…'}</Text>
      </View>
    </View>
  );
}

const SIZE = 84;
const s = StyleSheet.create({
  backdrop: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(248,250,252,0.35)', zIndex: 1000, elevation: 1000 },
  blocking: { backgroundColor: 'rgba(248,250,252,0.6)' },
  card: {
    alignItems: 'center', gap: 10, paddingVertical: 20, paddingHorizontal: 28, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#4f46e5', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8,
  },
  loader: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 4,
    borderColor: colors.primarySoft, borderTopColor: colors.primary, borderRightColor: '#8b5cf6',
  },
  logo: { width: SIZE * 0.48, height: SIZE * 0.48, borderRadius: 10 },
  logoFallback: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', color: colors.muted },
});
