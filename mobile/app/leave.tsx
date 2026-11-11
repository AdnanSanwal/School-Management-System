import { useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { colors } from '../lib/theme';
import { day, todayIso } from '../lib/format';

const say = (title: string, msg = '') => (Platform.OS === 'web' ? globalThis.alert?.(`${title}\n${msg}`) : Alert.alert(title, msg));
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
const LEAVE_LABEL: Record<string, string> = { CASUAL: 'Casual', SICK: 'Sick', ANNUAL: 'Annual', UNPAID: 'Unpaid', OTHER: 'Other' };
const BADGE: Record<string, { fg: string; bg: string; label: string }> = {
  PENDING: { fg: colors.warn, bg: colors.warnSoft, label: 'Pending' },
  APPROVED: { fg: colors.good, bg: colors.goodSoft, label: 'Approved' },
  REJECTED: { fg: colors.bad, bg: colors.badSoft, label: 'Rejected' },
};

function Pills<T extends string | number>({ items, value, onChange }: { items: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="radiogroup">
      {items.map((i) => (
        <Pressable key={String(i.v)} onPress={() => onChange(i.v)} style={[s.pill, value === i.v && s.pillOn]} accessibilityRole="radio" accessibilityState={{ checked: value === i.v }}>
          <Text style={[s.pillText, value === i.v && { color: '#fff' }]}>{i.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// Spec §8 Leave Apply → principal approves → teacher notified.
export default function LeaveScreen() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['leave', 'mine'], queryFn: API.myLeave });
  const today = todayIso();
  const [type, setType] = useState<'CASUAL' | 'SICK' | 'ANNUAL' | 'UNPAID' | 'OTHER'>('CASUAL');
  const [from, setFrom] = useState(today);
  const [days, setDays] = useState(1);
  const [reason, setReason] = useState('');
  const apply = useMutation({
    mutationFn: () => API.applyLeave({ type, fromDate: from, toDate: addDays(from, days - 1), reason }),
    onSuccess: () => { setReason(''); qc.invalidateQueries({ queryKey: ['leave'] }); say('Leave request sent', 'You will be notified when the principal decides.'); },
    onError: (e) => say('Could not send', apiError(e)),
  });
  const cancel = useMutation({ mutationFn: API.cancelLeave, onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }) });

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <Card style={{ gap: 10 }}>
        <H>Apply for leave</H>
        <Pills value={type} onChange={setType} items={[{ v: 'CASUAL', label: 'Casual' }, { v: 'SICK', label: 'Sick' }, { v: 'ANNUAL', label: 'Annual' }, { v: 'UNPAID', label: 'Unpaid' }, { v: 'OTHER', label: 'Other' }]} />
        <Muted>From</Muted>
        <Pills value={from} onChange={setFrom} items={[-1, 0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ v: addDays(today, n), label: n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n === -1 ? 'Yesterday' : day(addDays(today, n), { weekday: 'short', day: 'numeric' }) }))} />
        <Muted>Number of days</Muted>
        <Pills value={days} onChange={setDays} items={[1, 2, 3, 4, 5, 7, 10].map((n) => ({ v: n, label: String(n) }))} />
        <Muted>{day(from, { weekday: 'short', day: 'numeric', month: 'short' })}{days > 1 ? ` – ${day(addDays(from, days - 1), { weekday: 'short', day: 'numeric', month: 'short' })}` : ''}</Muted>
        <TextInput style={s.input} placeholder="Reason" value={reason} onChangeText={setReason} multiline accessibilityLabel="Reason" placeholderTextColor={colors.faint} />
        <Button title="Send to principal" onPress={() => apply.mutate()} loading={apply.isPending} disabled={reason.trim().length < 3} />
      </Card>

      {q.isLoading && <Loading />}
      {q.error && <ErrorBox message={apiError(q.error)} />}
      {q.data && (
        <>
          {q.data.balances?.length ? (
            <Card>
              <H>Leave balance{q.data.year ? ` · ${q.data.year}` : ''}</H>
              {q.data.balances.filter((b: any) => b.isPaid && (b.allowed > 0 || b.used > 0)).map((b: any) => (
                <Row key={b.type} label={`${LEAVE_LABEL[b.type] ?? b.type} · ${b.used} of ${b.allowed} used`}
                  value={<Text style={{ fontWeight: '700', color: b.used > b.allowed ? colors.bad : colors.good }}>{b.used > b.allowed ? `${b.used - b.allowed} over` : `${b.remaining} left`}</Text>} />
              ))}
              {q.data.balances.some((b: any) => b.pending > 0) && <Muted>Waiting for a decision: {q.data.balances.reduce((n: number, b: any) => n + b.pending, 0)} day(s)</Muted>}
              {q.data.balances.some((b: any) => b.unpaid > 0) && <Muted style={{ color: colors.bad }}>Unpaid days this year: {q.data.balances.reduce((n: number, b: any) => n + b.unpaid, 0)} (deducted from salary)</Muted>}
            </Card>
          ) : (
            <Muted>Approved this year: {Object.entries(q.data.usedThisYear).map(([k, v]) => `${k.toLowerCase()} ${v} day(s)`).join(', ') || 'none'}</Muted>
          )}
          {q.data.requests.length === 0 && <Empty title="No leave requests yet" />}
          {q.data.requests.map((l: any) => (
            <Card key={l.id}>
              <View style={s.rowBetween}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{day(l.fromDate)}{l.toDate !== l.fromDate ? ` – ${day(l.toDate)}` : ''} · {l.type.toLowerCase()}</Text>
                <Badge {...BADGE[l.status]} />
              </View>
              <Muted>{l.reason}</Muted>
              {l.decisionNote && <Muted>Principal: {l.decisionNote}</Muted>}
              {l.status === 'PENDING' && <Text onPress={() => cancel.mutate(l.id)} style={{ color: colors.bad, marginTop: 6, fontWeight: '600' }}>Withdraw</Text>}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '600', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, minHeight: 70, textAlignVertical: 'top', color: colors.text },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
