import { Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Button, Card, ErrorBox, H, Loading, Muted, Row, Screen } from '../../components/ui';
import { colors } from '../../lib/theme';
import { day, money, period, sectionName } from '../../lib/format';

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['receipt', id], queryFn: () => API.receipt(id!) });
  const r = q.data;
  const cur = r?.school.currency ?? 'PKR';

  const share = () => Share.share({
    message: `${r.school.name}\nFee receipt ${r.receiptNo}\n${r.student.name} (${r.student.admissionNo})\n` +
      r.allocations.map((a: any) => `${period(a.invoice.period)}: ${money(a.amount, cur)}`).join('\n') +
      `\nTotal: ${money(r.amount, cur)}\nPaid on ${day(r.paidAt, { day: 'numeric', month: 'long', year: 'numeric' })}`,
  });

  return (
    <Screen>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {r && (
        <>
          <Card>
            <H style={{ textAlign: 'center' }}>{r.school.name}</H>
            <Muted style={{ textAlign: 'center' }}>Fee receipt</Muted>
            <View style={{ height: 12 }} />
            <Row label="Receipt no." value={r.receiptNo} />
            <Row label="Date" value={day(r.paidAt, { day: 'numeric', month: 'long', year: 'numeric' })} />
            <Row label="Student" value={r.student.name} />
            <Row label="Class" value={sectionName(r.student.section)} />
            <Row label="Paid by" value={r.method.replace('_', ' ').toLowerCase()} />
          </Card>
          <Card>
            {r.allocations.map((a: any) => <Row key={a.invoiceId} label={period(a.invoice.period)} value={money(a.amount, cur)} />)}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }}>
              <Row label="Total received" value={<Text style={{ fontWeight: '800', fontSize: 16 }}>{money(r.amount, cur)}</Text>} />
              <Row label="Remaining balance" value={money(r.remainingBalance, cur)} />
            </View>
          </Card>
          <Button title="Share receipt" variant="secondary" onPress={share} />
        </>
      )}
    </Screen>
  );
}
