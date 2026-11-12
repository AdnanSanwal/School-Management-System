import { Alert, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Button, Card, Empty, ErrorBox, H, Loading, Muted, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { ago, day, money } from '../lib/format';
import { useAuthStore } from '../store/authStore';

type Kind = 'leave' | 'concession' | 'claim';
const say = (title: string, msg = '') => (Platform.OS === 'web' ? globalThis.alert?.(`${title}\n${msg}`) : Alert.alert(title, msg));

// Spec §6 Principal → Approvals (and accountant: online payments to verify), from the phone.
export default function ApprovalsScreen() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['approvals'], queryFn: API.approvals });
  const decide = useMutation({
    mutationFn: ({ kind, id, approve }: { kind: Kind; id: string; approve: boolean }): Promise<unknown> =>
      kind === 'leave' ? API.decideLeave(id, approve) : kind === 'concession' ? API.decideConcession(id, approve) : API.decideClaim(id, approve),
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['approvals'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); say(v.approve ? 'Approved' : 'Rejected'); },
    onError: (e) => say('Could not save', apiError(e)),
  });
  const Actions = ({ kind, id }: { kind: Kind; id: string }) => (
    <View style={s.actions}>
      <View style={{ flex: 1 }}><Button title={kind === 'claim' ? 'Verify' : 'Approve'} onPress={() => decide.mutate({ kind, id, approve: true })} disabled={decide.isPending} /></View>
      <View style={{ flex: 1 }}><Button title="Reject" variant="danger" onPress={() => decide.mutate({ kind, id, approve: false })} disabled={decide.isPending} /></View>
    </View>
  );
  const d = q.data;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {d && d.total === 0 && <Empty title="All caught up" hint="Nothing is waiting for your decision." />}
      {d?.leaves?.map((l: any) => (
        <Card key={l.id} style={{ gap: 4 }}>
          <Muted>Leave request</Muted>
          <H>{l.staff.name}</H>
          <Text style={{ color: colors.text }}>{l.type.toLowerCase()} · {day(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${day(l.toDate)}` : ''}</Text>
          <Muted>{l.reason}</Muted>
          <Actions kind="leave" id={l.id} />
        </Card>
      ))}
      {d?.concessions?.map((c: any) => (
        <Card key={c.id} style={{ gap: 4 }}>
          <Muted>Fee concession</Muted>
          <H>{c.student.name}</H>
          <Text style={{ color: colors.text }}>{c.type === 'PERCENT' ? `${Number(c.value)}%` : money(c.value, currency)} off {c.feeHead?.name ?? 'all fees'}</Text>
          <Muted>{c.reason}</Muted>
          <Actions kind="concession" id={c.id} />
        </Card>
      ))}
      {d?.paymentClaims?.map((c: any) => (
        <Card key={c.id} style={{ gap: 4 }}>
          <Muted>Online payment to verify · {ago(c.createdAt)}</Muted>
          <H>{c.student.name}</H>
          <Text style={{ color: colors.text }}>{money(c.amount, currency)} · {c.method.replace('_', ' ').toLowerCase()} · ref {c.reference}</Text>
          {c.proof && <Text onPress={() => Linking.openURL(c.proof)} style={{ color: colors.primary, fontWeight: '600' }}>View screenshot</Text>}
          <Muted>Check the school account statement before verifying.</Muted>
          <Actions kind="claim" id={c.id} />
        </Card>
      ))}
    </Screen>
  );
}

const s = StyleSheet.create({ actions: { flexDirection: 'row', gap: 8, marginTop: 8 } });
