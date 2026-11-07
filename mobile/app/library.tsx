import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Badge, Card, Empty, ErrorBox, H, Loading, Muted, Screen } from '../components/ui';
import { ChildSwitcher, useChildren } from '../components/ChildSwitcher';
import { useAuthStore } from '../store/authStore';
import { colors } from '../lib/theme';
import { day, money } from '../lib/format';

// Parent/student: books the child has out, due dates and any library fines.
export default function LibraryScreen() {
  const { childId } = useChildren();
  const currency = useAuthStore((s) => s.user?.school?.currency) ?? 'PKR';
  const q = useQuery({ queryKey: ['library', childId], queryFn: () => API.library(childId!), enabled: !!childId });
  const d: any = q.data;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} /> : d && (
        <>
          {d.unpaidFines > 0 && (
            <Card style={{ backgroundColor: colors.badSoft }}>
              <Text style={{ color: colors.bad, fontWeight: '700' }}>Unpaid library fines: {money(d.unpaidFines, currency)}</Text>
              <Muted>Please pay at the library desk.</Muted>
            </Card>
          )}
          <Card>
            <H>Books issued now</H>
            {!d.current.length ? <Muted>No books issued.</Muted> : d.current.map((l: any) => (
              <View key={l.id} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 2 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{l.book.title}</Text>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Muted>Due {day(l.dueDate)}</Muted>
                  {l.overdue
                    ? <Badge label={`${l.daysLate} day(s) late${Number(l.fineSoFar) > 0 ? ` · ${money(l.fineSoFar, currency)}` : ''}`} fg={colors.bad} bg={colors.badSoft} />
                    : <Badge label="On time" fg={colors.good} bg={colors.goodSoft} />}
                </View>
              </View>
            ))}
          </Card>
          {d.history.length > 0 ? (
            <Card>
              <H>Returned</H>
              {d.history.slice(0, 20).map((l: any) => (
                <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 8 }}>
                  <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{l.book.title}</Text>
                  <Muted>{day(l.returnedAt)}{Number(l.fine) > 0 ? ` · fine ${money(l.fine, currency)}${l.finePaid ? ' (paid)' : ''}` : ''}</Muted>
                </View>
              ))}
            </Card>
          ) : !d.current.length && <Empty title="No library history yet" />}
        </>
      )}
    </Screen>
  );
}
