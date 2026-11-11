import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../lib/api';
import { Card, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { money, period, todayIso } from '../lib/format';
import { useAuthStore } from '../store/authStore';

const shift = (p: string, by: number) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};

// Finance at a glance for the owner (and whoever else may see finance): money in the
// accounts now, and what came in and went out in a month.
export default function FinanceScreen() {
  const cur = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const thisMonth = todayIso().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const q = useQuery({ queryKey: ['finance', 'summary', month], queryFn: () => API.financeSummary(month) });
  const payroll = useQuery({ queryKey: ['payroll', 'runs'], queryFn: API.payrollRuns });
  const d = q.data;
  const waiting = (payroll.data ?? []).filter((r: any) => r.status === 'SUBMITTED');
  const net = Number(d?.net ?? 0);

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => { q.refetch(); payroll.refetch(); }}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <Card>
            <Muted>Money in all accounts now</Muted>
            <Text style={s.big}>{money(d.totalBalance, cur)}</Text>
            <View style={{ height: 6 }} />
            {d.accounts.map((a: any) => <Row key={a.id} label={a.name} value={<Text style={{ fontWeight: '600', color: Number(a.balance) < 0 ? colors.bad : colors.text }}>{money(a.balance, cur)}</Text>} />)}
          </Card>

          {(d.pendingExpenses.count > 0 || waiting.length > 0) && (
            <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warn }}>
              <H>Waiting for approval</H>
              {d.pendingExpenses.count > 0 && <Muted>{d.pendingExpenses.count} expense{d.pendingExpenses.count > 1 ? 's' : ''} worth {money(d.pendingExpenses.amount, cur)}</Muted>}
              {waiting.map((r: any) => <Muted key={r.id}>Payroll for {r.label}: {r.staff} staff, net {money(r.net, cur)}</Muted>)}
              <Muted style={{ marginTop: 4 }}>Open the web panel to review and approve.</Muted>
            </Card>
          )}

          <View style={s.monthBar}>
            <Pressable onPress={() => setMonth(shift(month, -1))} style={s.arrow} accessibilityRole="button" accessibilityLabel="Previous month"><Ionicons name="chevron-back" size={20} color={colors.primary} /></Pressable>
            <Text style={s.month}>{period(month)}</Text>
            <Pressable onPress={() => month < thisMonth && setMonth(shift(month, 1))} style={[s.arrow, month >= thisMonth && { opacity: 0.3 }]} accessibilityRole="button" accessibilityLabel="Next month"><Ionicons name="chevron-forward" size={20} color={colors.primary} /></Pressable>
          </View>

          <Card>
            <Row label="Income" value={<Text style={{ fontWeight: '700', color: colors.good }}>{money(d.income.total, cur)}</Text>} />
            <Row label="Expenses" value={<Text style={{ fontWeight: '700', color: colors.bad }}>{money(d.expenses.total, cur)}</Text>} />
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }}>
              <Row label={net < 0 ? 'Shortfall' : 'Surplus'} value={<Text style={{ fontWeight: '800', fontSize: 18, color: net < 0 ? colors.bad : colors.good }}>{money(Math.abs(net), cur)}</Text>} />
            </View>
          </Card>

          <Card>
            <H>Where it came from</H>
            <Row label="Student fees" value={money(d.income.fees, cur)} />
            {d.income.otherByCategory.map((r: any) => <Row key={r.category} label={r.category} value={money(r.amount, cur)} />)}
            {Number(d.income.total) === 0 && <Muted>No income recorded this month.</Muted>}
          </Card>
          <Card>
            <H>Where it went</H>
            {d.expenses.byCategory.map((r: any) => <Row key={r.category} label={r.category} value={money(r.amount, cur)} />)}
            {d.expenses.byCategory.length === 0 && <Muted>No expenses recorded this month.</Muted>}
          </Card>
          <Muted style={{ textAlign: 'center' }}>Statements, the journal and month closing are on the web panel.</Muted>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 2 },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  month: { fontSize: 16, fontWeight: '700', color: colors.text },
  arrow: { padding: 10, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
});
