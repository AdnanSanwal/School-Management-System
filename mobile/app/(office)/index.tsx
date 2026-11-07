import { StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Card, ErrorBox, H, Loading, Muted, Row, Screen } from '../../components/ui';
import { colors } from '../../lib/theme';
import { day, money, period } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <Card style={s.tile}>
      <Muted>{label}</Muted>
      <Text style={[s.tileValue, tone === 'good' && { color: colors.good }, tone === 'bad' && { color: colors.bad }]} adjustsFontSizeToFit numberOfLines={1}>{value}</Text>
      {sub && <Muted style={{ fontSize: 12 }}>{sub}</Muted>}
    </Card>
  );
}

// Spec §5 Owner Home Dashboard: 4 cards, monthly collection, quick alerts.
export default function OfficeDashboard() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const q = useQuery({ queryKey: ['dashboard'], queryFn: API.dashboard, refetchInterval: 60_000 });
  const d = q.data;
  const maxMonth = Math.max(1, ...(d?.fees?.monthlyCollection ?? []).map((m: any) => Number(m.amount)));

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Muted>{day(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Muted>
          <View style={s.grid}>
            {d.fees && <Tile label="Collected today" value={money(d.fees.collectedToday, currency)} sub={`Yesterday ${money(d.fees.collectedYesterday, currency)}`} tone="good" />}
            {d.fees && <Tile label="Remaining fee" value={money(d.fees.totalRemaining, currency)} sub={`${d.fees.studentsOverdue30Days} overdue > 30 days`} tone="bad" />}
            {d.staffAttendance && <Tile label="Teachers present" value={d.staffAttendance.marked ? `${d.staffAttendance.teachersPresent}/${d.staffAttendance.teachersTotal}` : '—'} sub={d.staffAttendance.marked ? `${d.staffAttendance.percent}%` : 'Not marked yet'} />}
            {d.studentAttendance && <Tile label="Students present" value={d.studentAttendance.marked ? `${d.studentAttendance.present}/${d.studentAttendance.totalActive}` : '—'} sub={d.studentAttendance.marked ? `${d.studentAttendance.percent}%` : 'Not marked yet'} />}
          </View>

          {d.alerts.length > 0 && (
            <Card style={{ gap: 6 }}>
              <H>Alerts</H>
              {d.alerts.map((a: any, i: number) => (
                <Text key={i} style={{ color: colors.text }}>{a.level === 'warning' ? '⚠️' : 'ℹ️'} {a.message}</Text>
              ))}
            </Card>
          )}

          {d.fees && (
            <Card>
              <H>Monthly fee collection</H>
              <View style={s.bars} accessibilityLabel="Fee collected per month, last six months">
                {d.fees.monthlyCollection.map((m: any) => (
                  <View key={m.month} style={s.barCol} accessible accessibilityLabel={`${period(m.month)}: ${money(m.amount, currency)}`}>
                    <View style={[s.bar, { height: Math.max(2, (Number(m.amount) / maxMonth) * 120) }]} />
                    <Text style={s.barLabel}>{period(m.month).slice(0, 3)}</Text>
                  </View>
                ))}
              </View>
              <Row label="This month" value={money(d.fees.collectedThisMonth, currency)} />
              <Row label="This year" value={money(d.fees.collectedThisYear, currency)} />
            </Card>
          )}

          {d.fees?.pendingByClass?.length > 0 && (
            <Card>
              <H>Pending by class</H>
              {d.fees.pendingByClass.map((c: any) => <Row key={c.classId} label={c.name} value={money(c.pending, currency)} />)}
            </Card>
          )}

          {d.staffAttendance?.teachersOnLeave.length > 0 && (
            <Card><H>On leave today</H><Muted>{d.staffAttendance.teachersOnLeave.join(', ')}</Muted></Card>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { flexBasis: '47%', flexGrow: 1, gap: 2 },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.text },
  bars: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150, marginVertical: 12 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: 22, backgroundColor: colors.primary, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  barLabel: { fontSize: 11, color: colors.muted },
});
