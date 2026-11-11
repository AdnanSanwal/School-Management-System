import { Share, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../../lib/api';
import { Button, Card, ErrorBox, H, Loading, Muted, Row, Screen } from '../../components/ui';
import { colors } from '../../lib/theme';
import { day, money } from '../../lib/format';

const days = (v: unknown) => { const n = Number(v); const w = Math.floor(n); return n % 1 ? `${w || ''}½` : String(w); };
type Part = { name: string; amount: number };

export default function PayslipScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ['payroll', 'payslip', id], queryFn: () => API.payslip(id!) });
  const p = q.data;
  const cur = p?.school.currency ?? 'PKR';
  const earnings: [string, unknown][] = p ? [['Basic salary', p.basic], ...p.allowances.map((a: Part) => [a.name, a.amount] as [string, unknown]), ...(Number(p.bonus) ? [['Bonus / extra pay', p.bonus] as [string, unknown]] : [])] : [];
  const deductions: [string, unknown][] = p ? [
    ...p.fixedDeductions.map((a: Part) => [a.name, a.amount] as [string, unknown]),
    ...(Number(p.absenceDeduction) ? [[`Absence (${days(p.deductDays)} day${Number(p.deductDays) === 1 ? '' : 's'})`, p.absenceDeduction] as [string, unknown]] : []),
    ...(Number(p.loanDeduction) ? [['Advance / loan recovery', p.loanDeduction] as [string, unknown]] : []),
    ...(Number(p.otherDeduction) ? [['Other deduction', p.otherDeduction] as [string, unknown]] : []),
  ] : [];

  const share = () => Share.share({
    message: `${p.school.name}\nPayslip — ${p.label}\n${p.name} (${p.employeeNo})\n` +
      earnings.map(([l, v]) => `${l}: ${money(v as string, cur)}`).join('\n') +
      (deductions.length ? `\n${deductions.map(([l, v]) => `${l}: − ${money(v as string, cur)}`).join('\n')}` : '') +
      `\nNet pay: ${money(p.net, cur)}`,
  });

  return (
    <Screen>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {p && (
        <>
          <Card>
            <H style={{ textAlign: 'center' }}>{p.school.name}</H>
            <Muted style={{ textAlign: 'center' }}>Payslip — {p.label}</Muted>
            <View style={{ height: 12 }} />
            <Row label="Name" value={p.name} />
            <Row label="Employee no." value={p.employeeNo} />
            {p.designation && <Row label="Designation" value={p.designation} />}
            <Row label="Days paid" value={`${days(p.paidDays)} of ${p.daysInMonth}`} />
            {p.paymentDate && <Row label="Paid on" value={day(p.paymentDate, { day: 'numeric', month: 'long', year: 'numeric' })} />}
            <Row label="Paid to" value={p.bankAccountNo ? `${p.bankName ?? 'Bank'} · ${p.bankAccountNo}` : 'Cash'} />
          </Card>
          <Card>
            <H>Earnings</H>
            {earnings.map(([l, v]) => <Row key={l} label={l} value={money(v as string, cur)} />)}
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }}>
              <Row label="Total earnings" value={<Text style={{ fontWeight: '700' }}>{money(Number(p.gross) + Number(p.bonus), cur)}</Text>} />
            </View>
          </Card>
          {deductions.length > 0 && (
            <Card>
              <H>Deductions</H>
              {deductions.map(([l, v]) => <Row key={l} label={l} value={<Text style={{ color: colors.bad }}>− {money(v as string, cur)}</Text>} />)}
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 6 }}>
                <Row label="Total deductions" value={<Text style={{ fontWeight: '700', color: colors.bad }}>− {money(p.totalDeductions, cur)}</Text>} />
              </View>
            </Card>
          )}
          <Card>
            <Row label="Net pay" value={<Text style={{ fontWeight: '800', fontSize: 20, color: colors.good }}>{money(p.net, cur)}</Text>} />
            {p.remarks && <Muted>Note: {p.remarks}</Muted>}
          </Card>
          <Button title="Share payslip" variant="secondary" onPress={share} />
        </>
      )}
    </Screen>
  );
}
