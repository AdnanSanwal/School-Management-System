import { Linking, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../components/ui';
import { ChildSwitcher, useChildren } from '../components/ChildSwitcher';
import { useAuthStore } from '../store/authStore';
import { colors } from '../lib/theme';
import { day, money } from '../lib/format';

// Parent/student: the child's van/bus route, stop, timings and driver.
export default function TransportScreen() {
  const { childId } = useChildren();
  const currency = useAuthStore((s) => s.user?.school?.currency) ?? 'PKR';
  const q = useQuery({ queryKey: ['transport', childId], queryFn: () => API.transport(childId!), enabled: !!childId });
  const t: any = q.data;

  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} onRetry={() => q.refetch()} /> : !t ? (
        <Empty title="Not using school transport" hint="Contact the school office to add a route." />
      ) : (
        <>
          <Card>
            <H>{t.route.name}</H>
            {t.stop && <Row label="Stop" value={t.stop.name} />}
            {t.stop?.pickupTime && <Row label="Pick-up" value={t.stop.pickupTime} />}
            {t.stop?.dropTime && <Row label="Drop" value={t.stop.dropTime} />}
            {t.route.vehicleNo && <Row label="Vehicle" value={t.route.vehicleNo} />}
            {t.route.driverName && <Row label="Driver" value={t.route.driverName} />}
            <Row label="Monthly fee" value={money(t.route.monthlyFee, currency)} />
            <Row label="Since" value={day(t.since, { day: 'numeric', month: 'short', year: 'numeric' })} />
            {t.route.driverPhone && (
              <Text onPress={() => Linking.openURL(`tel:${t.route.driverPhone}`)} accessibilityRole="link"
                style={{ color: colors.primary, fontWeight: '700', marginTop: 8 }}>
                Call driver ({t.route.driverPhone})
              </Text>
            )}
          </Card>
          {t.route.stops.length > 0 && (
            <Card>
              <H>Route stops</H>
              {t.route.stops.map((s: any, i: number) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                  <Text style={{ color: s.name === t.stop?.name ? colors.primary : colors.text, fontWeight: s.name === t.stop?.name ? '700' : '400', flex: 1 }}>
                    {i + 1}. {s.name}
                  </Text>
                  <Muted>{s.pickupTime ?? '—'}{s.dropTime ? ` / ${s.dropTime}` : ''}</Muted>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
