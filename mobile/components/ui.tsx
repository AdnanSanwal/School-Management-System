import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, ViewStyle, TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

export function Screen({ children, refreshing, onRefresh, padded = true }: {
  children: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean;
}) {
  return (
    <SafeAreaView style={s.screen} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={[padded && s.padded, { gap: 12 }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { opacity: 0.85 }]} accessibilityRole="button">
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function H({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.h, style]}>{children}</Text>;
}

export function Muted({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Badge({ label, fg, bg }: { label: string; fg: string; bg: string }) {
  return <View style={[s.badge, { backgroundColor: bg }]}><Text style={[s.badgeText, { color: fg }]}>{label}</Text></View>;
}

export function Button({ title, onPress, disabled, variant = 'primary', loading }: {
  title: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger'; loading?: boolean;
}) {
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.badSoft : colors.primarySoft;
  const fg = variant === 'primary' ? '#fff' : variant === 'danger' ? colors.bad : colors.primary;
  return (
    <Pressable
      onPress={onPress} disabled={disabled || loading} accessibilityRole="button" accessibilityState={{ disabled: disabled || loading }}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Loading() {
  return <View style={s.center}><ActivityIndicator color={colors.primary} /></View>;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={s.empty}>
      <Text style={s.emptyTitle}>{title}</Text>
      {hint && <Muted style={{ textAlign: 'center' }}>{hint}</Muted>}
    </View>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ backgroundColor: colors.badSoft, borderColor: '#fecaca' }}>
      <Text style={{ color: colors.bad }}>{message}</Text>
      {onRetry && <Text onPress={onRetry} style={{ color: colors.primary, marginTop: 8, fontWeight: '600' }}>Try again</Text>}
    </Card>
  );
}

export function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Muted>{label}</Muted>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={s.rowValue}>{value}</Text> : value}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: 16, paddingBottom: 32 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#f1f5f9' },
  h: { fontSize: 16, fontWeight: '700', color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  btn: { paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  btnText: { fontSize: 15, fontWeight: '700' },
  center: { padding: 40, alignItems: 'center' },
  empty: { alignItems: 'center', padding: 32, gap: 4 },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, gap: 12 },
  rowValue: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1, textAlign: 'right' },
});
