import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../../lib/api';
import { Card, ErrorBox, H, Loading, Muted, Screen } from '../../components/ui';
import { ChildSwitcher, useChildren } from '../../components/ChildSwitcher';
import { colors, STATUS_COLORS } from '../../lib/theme';
import { period, todayIso } from '../../lib/format';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function shift(month: string, by: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

// Spec §10: monthly calendar (green = present, red = absent, yellow = late) and monthly %.
export default function AttendanceCalendar() {
  const { childId } = useChildren();
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const q = useQuery({ queryKey: ['calendar', childId, month], queryFn: () => API.calendar(childId!, month), enabled: !!childId });

  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const byDate = new Map<string, string>((q.data?.days ?? []).map((d: any) => [d.date, d.status]));
  const holidays = new Set<string>();
  for (const h of q.data?.holidays ?? []) {
    for (let d = new Date(`${h.startDate}T00:00:00Z`); d <= new Date(`${h.endDate}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) holidays.add(d.toISOString().slice(0, 10));
  }
  const today = todayIso();
  const summary = q.data?.summary;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      <Card>
        <View style={s.header}>
          <Pressable onPress={() => setMonth(shift(month, -1))} hitSlop={12} accessibilityLabel="Previous month"><Ionicons name="chevron-back" size={22} color={colors.primary} /></Pressable>
          <H>{period(month)}</H>
          <Pressable onPress={() => setMonth(shift(month, 1))} hitSlop={12} disabled={month >= today.slice(0, 7)} accessibilityLabel="Next month">
            <Ionicons name="chevron-forward" size={22} color={month >= today.slice(0, 7) ? colors.border : colors.primary} />
          </Pressable>
        </View>
        {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} /> : (
          <>
            <View style={s.grid}>
              {WEEKDAYS.map((w, i) => <Text key={i} style={s.weekday}>{w}</Text>)}
              {Array.from({ length: lead }).map((_, i) => <View key={`b${i}`} style={s.cell} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const date = `${month}-${String(i + 1).padStart(2, '0')}`;
                const st = byDate.get(date);
                const c = st ? STATUS_COLORS[st] : holidays.has(date) ? { fg: colors.info, bg: colors.infoSoft, label: 'Holiday' } : null;
                return (
                  <View key={date} style={s.cell} accessible accessibilityLabel={`${i + 1}: ${c?.label ?? (date > today ? 'upcoming' : 'no record')}`}>
                    <View style={[s.dayDot, c && { backgroundColor: c.bg }, date === today && s.today]}>
                      <Text style={[s.dayText, c && { color: c.fg, fontWeight: '700' }]}>{i + 1}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
            <View style={s.legend}>
              {['PRESENT', 'ABSENT', 'LATE', 'LEAVE'].map((k) => (
                <View key={k} style={s.legendItem}>
                  <View style={[s.swatch, { backgroundColor: STATUS_COLORS[k].bg, borderColor: STATUS_COLORS[k].fg }]} />
                  <Muted>{STATUS_COLORS[k].label} {summary?.[k] ?? 0}</Muted>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>
      {summary && (
        <Card>
          <Muted>Attendance this month</Muted>
          <Text style={s.big}>{summary.percent !== null ? `${summary.percent}%` : '—'}</Text>
          <Muted>{summary.total} school days recorded</Muted>
        </Card>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', color: colors.faint, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  cell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 3 },
  dayDot: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  today: { borderWidth: 2, borderColor: colors.primary },
  dayText: { color: colors.text, fontSize: 14 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1 },
  big: { fontSize: 32, fontWeight: '800', color: colors.text, marginVertical: 2 },
});
