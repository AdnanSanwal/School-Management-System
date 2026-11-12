import { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../lib/api';
import { Badge, Button, Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { ChildSwitcher, useChildren } from '../components/ChildSwitcher';
import { colors } from '../lib/theme';
import { ago, day, money, period } from '../lib/format';
import { useAuthStore } from '../store/authStore';

const say = (title: string, msg = '') => (Platform.OS === 'web' ? globalThis.alert?.(`${title}\n${msg}`) : Alert.alert(title, msg));
const METHOD_LABEL: Record<string, string> = { JAZZCASH: 'JazzCash', EASYPAISA: 'Easypaisa', BANK_TRANSFER: 'Bank transfer' };
const CLAIM_BADGE: Record<string, { fg: string; bg: string; label: string }> = {
  PENDING: { fg: colors.warn, bg: colors.warnSoft, label: 'Being verified' },
  APPROVED: { fg: colors.good, bg: colors.goodSoft, label: 'Verified' },
  REJECTED: { fg: colors.bad, bg: colors.badSoft, label: 'Not verified' },
};

// Spec §10 Fee Details → "Pay Online": gateway checkout, or pay to a school account and submit proof.
export default function PayScreen() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const { childId } = useChildren();
  const qc = useQueryClient();
  const ledger = useQuery({ queryKey: ['ledger', childId], queryFn: () => API.feeLedger(childId!), enabled: !!childId });
  const options = useQuery({ queryKey: ['payment-options'], queryFn: API.paymentOptions });
  const claims = useQuery({ queryKey: ['claims', childId], queryFn: () => API.claims(childId!), enabled: !!childId });

  const open: any[] = (ledger.data?.invoices ?? []).filter((i: any) => i.status === 'UNPAID' || i.status === 'PARTIAL').sort((a: any, b: any) => a.period.localeCompare(b.period));
  const due = (i: any) => Number(i.netAmount) + Number(i.fineAmount) - Number(i.paidAmount);
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => { setSelected(open.map((i) => i.id)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ledger.data]);
  const total = open.filter((i) => selected.includes(i.id)).reduce((s, i) => s + due(i), 0);

  // ─── Gateway ───
  const [intentId, setIntentId] = useState<string | null>(null);
  const intent = useQuery({ queryKey: ['intent', intentId], queryFn: () => API.intent(intentId!), enabled: !!intentId, refetchInterval: (q) => (q.state.data?.status === 'CREATED' ? 3000 : false) });
  useEffect(() => {
    if (intent.data?.status === 'SUCCEEDED') {
      qc.invalidateQueries({ queryKey: ['ledger'] }); qc.invalidateQueries({ queryKey: ['home'] });
      say('Payment received', 'Your receipt is in the Fees tab.');
      setIntentId(null);
    } else if (intent.data?.status === 'FAILED') {
      say('Payment not completed', intent.data.error ?? '');
      setIntentId(null);
    }
  }, [intent.data?.status, qc, intent.data?.error]);
  const checkout = useMutation({
    mutationFn: () => API.createIntent(childId!, selected),
    onSuccess: (r: any) => { setIntentId(r.intentId); Linking.openURL(r.checkoutUrl); },
    onError: (e) => say('Could not start payment', apiError(e)),
  });

  // ─── Proof ───
  const accounts: any[] = options.data?.accounts ?? [];
  const [method, setMethod] = useState<string>('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [proof, setProof] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  useEffect(() => { if (!method && accounts.length) setMethod(accounts[0].method); }, [accounts, method]);
  useEffect(() => setAmount(total ? String(total) : ''), [total]);

  const pickProof = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], copyToCacheDirectory: true });
    if (!r.canceled) setProof(r.assets[0]);
  };
  const submit = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('studentId', childId!);
      form.append('invoiceIds', selected.join(','));
      form.append('amount', amount);
      form.append('method', method);
      form.append('reference', reference.trim());
      if (proof) {
        if (Platform.OS === 'web' && proof.file) form.append('file', proof.file, proof.name);
        else form.append('file', { uri: proof.uri, name: proof.name, type: proof.mimeType ?? 'image/jpeg' } as any);
      }
      return API.submitClaim(form);
    },
    onSuccess: () => {
      setReference(''); setProof(null);
      qc.invalidateQueries({ queryKey: ['claims'] });
      say('Sent for verification', 'The school office will confirm and send your receipt.');
    },
    onError: (e) => say('Could not submit', apiError(e)),
  });

  if (ledger.isLoading || options.isLoading) return <Loading />;
  return (
    <Screen refreshing={ledger.isRefetching} onRefresh={() => { ledger.refetch(); claims.refetch(); }}>
      <ChildSwitcher />
      {ledger.error && <ErrorBox message={apiError(ledger.error)} />}
      {open.length === 0 ? <Empty title="Nothing to pay" hint="All fees are paid." /> : (
        <>
          <Card>
            <H>Months to pay</H>
            {open.map((i) => {
              const on = selected.includes(i.id);
              return (
                <Pressable key={i.id} onPress={() => setSelected(on ? selected.filter((x) => x !== i.id) : [...selected, i.id])} style={s.month}
                  accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                  <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? colors.primary : colors.faint} />
                  <Text style={{ flex: 1, color: colors.text }}>{period(i.period)} <Muted>· due {day(i.dueDate)}</Muted></Text>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{money(due(i), currency)}</Text>
                </Pressable>
              );
            })}
            <Row label="Total" value={<Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{money(total, currency)}</Text>} />
          </Card>

          {options.data?.gateway && (
            <Card style={{ gap: 8 }}>
              <H>Pay now</H>
              <Muted>Card or mobile wallet through {options.data.gateway.label}. Your receipt comes automatically.</Muted>
              <Button title={intentId ? 'Waiting for payment…' : `Pay ${money(total, currency)}`} onPress={() => checkout.mutate()}
                loading={checkout.isPending} disabled={!selected.length || !!intentId} />
              {intentId && <Text onPress={() => setIntentId(null)} style={{ color: colors.muted, textAlign: 'center' }}>Cancel waiting</Text>}
            </Card>
          )}

          {accounts.length > 0 && (
            <Card style={{ gap: 8 }}>
              <H>Already paid by JazzCash, Easypaisa or bank?</H>
              <Muted>Send the money to one of these school accounts, then enter the transaction ID below.</Muted>
              {accounts.map((a) => (
                <Pressable key={a.id} onPress={() => setMethod(a.method)} style={[s.account, method === a.method && s.accountOn]} accessibilityRole="radio" accessibilityState={{ checked: method === a.method }}>
                  <Text style={{ fontWeight: '700', color: colors.text }}>{METHOD_LABEL[a.method]}</Text>
                  <Text selectable style={{ color: colors.text, fontSize: 16, letterSpacing: 0.5 }}>{a.accountNo}</Text>
                  <Muted>{a.title}{a.bankName ? ` · ${a.bankName}` : ''}{a.iban ? ` · ${a.iban}` : ''}</Muted>
                </Pressable>
              ))}
              <TextInput style={s.input} placeholder="Transaction ID (TID)" value={reference} onChangeText={setReference} autoCapitalize="characters" accessibilityLabel="Transaction ID" placeholderTextColor={colors.faint} />
              <TextInput style={s.input} placeholder="Amount paid" keyboardType="decimal-pad" value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} accessibilityLabel="Amount paid" placeholderTextColor={colors.faint} />
              <Button title={proof ? `Screenshot: ${proof.name}` : 'Attach payment screenshot'} variant="secondary" onPress={pickProof} />
              <Button title="Submit for verification" onPress={() => submit.mutate()} loading={submit.isPending}
                disabled={!selected.length || reference.trim().length < 4 || !Number(amount) || !method} />
            </Card>
          )}
          {!options.data?.gateway && !accounts.length && <Card><Muted>Online payment isn’t set up by the school yet. Please pay at the school office.</Muted></Card>}
        </>
      )}

      {(claims.data?.length ?? 0) > 0 && (
        <>
          <H>Your submissions</H>
          {claims.data!.map((c) => (
            <Card key={c.id}>
              <View style={s.rowBetween}>
                <Text style={{ fontWeight: '700', color: colors.text }}>{money(c.amount, currency)} · {METHOD_LABEL[c.method] ?? c.method}</Text>
                <Badge {...CLAIM_BADGE[c.status]} />
              </View>
              <Muted>Ref {c.reference} · {c.periods.map((p: string) => period(p)).join(', ')} · {ago(c.createdAt)}</Muted>
              {c.decisionNote && <Muted>School: {c.decisionNote}</Muted>}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  month: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  account: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 2 },
  accountOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, color: colors.text },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
