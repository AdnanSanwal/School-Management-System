import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../lib/api';
import { Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { day, money } from '../lib/format';
import { useAuthStore } from '../store/authStore';

// A staff member's own payslips (paid months) and what they still owe in advances or loans.
export default function PayslipsScreen() {
  const cur = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const q = useQuery({ queryKey: ['payroll', 'my'], queryFn: API.myPayslips });
  const d = q.data;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} />}
      {d && !d.staff && <Empty title="No staff record is linked to your login" hint="Ask the school office to link it." />}
      {d?.staff && (
        <>
          {d.loans.length > 0 && (
            <Card>
              <H>Advances and loans you owe</H>
              {d.loans.map((l: any) => (
                <View key={l.id} style={{ marginTop: 8 }}>
                  <Row label={`${l.kind === 'ADVANCE' ? 'Salary advance' : 'Loan'} of ${money(l.amount, cur)}`} value={<Text style={{ fontWeight: '700', color: colors.warn }}>{money(l.outstanding, cur)} left</Text>} />
                  <Muted>Given {day(l.issuedOn, { day: 'numeric', month: 'short', year: 'numeric' })} · {money(l.installment, cur)} from each salary</Muted>
                </View>
              ))}
            </Card>
          )}
          {d.payslips.length === 0 && <Empty title="No payslips yet" hint="A payslip appears here once that month’s salary has been paid." />}
          {d.payslips.map((p: any) => (
            <Card key={p.id} onPress={() => router.push(`/payslip/${p.id}`)}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{p.label}</Text>
                  <Muted>{p.paymentDate ? `Paid ${day(p.paymentDate, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Paid'}{Number(p.totalDeductions) ? ` · deductions ${money(p.totalDeductions, cur)}` : ''}</Muted>
                </View>
                <Text style={{ fontWeight: '800', fontSize: 16, color: colors.good }}>{money(p.net, cur)}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.faint} />
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}
