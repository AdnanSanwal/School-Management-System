import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Badge, Button, Card, ErrorBox, H, Loading, Muted, Row, Screen } from '../../components/ui';
import { ChildSwitcher, useChildren } from '../../components/ChildSwitcher';
import { colors } from '../../lib/theme';
import { day, money, period } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';

const INVOICE_BADGE: Record<string, { fg: string; bg: string; label: string }> = {
  PAID: { fg: colors.good, bg: colors.goodSoft, label: 'Paid' },
  PARTIAL: { fg: colors.warn, bg: colors.warnSoft, label: 'Part paid' },
  UNPAID: { fg: colors.bad, bg: colors.badSoft, label: 'Unpaid' },
};

// Spec §10 Fee Details: history, pending amount, due date, receipts.
export default function FeesScreen() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const isParent = useAuthStore((s) => s.user?.role === 'PARENT');
  const { childId } = useChildren();
  const q = useQuery({ queryKey: ['ledger', childId], queryFn: () => API.feeLedger(childId!), enabled: !!childId });
  const L = q.data;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {L && (
        <>
          <Card>
            <Muted>Pending</Muted>
            <Text style={{ fontSize: 30, fontWeight: '800', color: Number(L.pending) > 0 ? colors.bad : colors.good }}>{money(L.pending, currency)}</Text>
            {L.nextDueDate && <Muted>Next due {day(L.nextDueDate, { day: 'numeric', month: 'long' })}</Muted>}
            {L.paidTill && <Muted>Paid till {period(L.paidTill)}</Muted>}
            {Number(L.pending) > 0 && isParent && <View style={{ marginTop: 12 }}><Button title="Pay online" onPress={() => router.push('/pay')} /></View>}
          </Card>

          <H>Monthly fees</H>
          {L.invoices.map((i: any) => {
            const b = INVOICE_BADGE[i.status] ?? INVOICE_BADGE.UNPAID;
            const due = Number(i.netAmount) + Number(i.fineAmount) - Number(i.paidAmount);
            return (
              <Card key={i.id}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <H>{period(i.period)}</H>
                  <Badge {...b} />
                </View>
                {i.items.map((it: any) => (
                  <Row key={it.id} label={it.feeHead.name} value={Number(it.discount) ? `${money(it.amount, currency)} − ${money(it.discount, currency)}` : money(it.amount, currency)} />
                ))}
                {i.status !== 'PAID' && <Row label={`Due ${day(i.dueDate)}`} value={<Text style={{ fontWeight: '700', color: colors.bad }}>{money(due, currency)}</Text>} />}
              </Card>
            );
          })}

          <H>Payments</H>
          {L.payments.length === 0 && <Muted>No payments yet.</Muted>}
          {L.payments.map((p: any) => (
            <Card key={p.id} onPress={() => router.push(`/receipt/${p.id}`)}>
              <Row label={`${day(p.paidAt)} · ${p.receiptNo}`} value={money(p.amount, currency)} />
              <Muted>{p.allocations.map((a: any) => period(a.invoice.period)).join(', ')} · tap for receipt</Muted>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
