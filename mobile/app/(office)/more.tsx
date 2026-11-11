import { router } from 'expo-router';
import { Screen, Card, Muted } from '../../components/ui';
import { Item, MoreMenu } from '../../components/MoreMenu';
import { allowed, useAuthStore } from '../../store/authStore';

export default function OfficeMore() {
  return (
    <Screen>
      <MoreMenu extra={<OfficeItems />} />
      <Card><Muted>Admissions, fee collection and reports are on the web panel.</Muted></Card>
    </Screen>
  );
}

function OfficeItems() {
  const user = useAuthStore((st) => st.user);
  const role = user?.role;
  return (
    <>
      {allowed(user, 'finance.view', ['OWNER', 'PRINCIPAL', 'ACCOUNTANT']) && <Item icon="stats-chart-outline" label="Finance" onPress={() => router.push('/finance')} />}
      {role !== 'OWNER' && <Item icon="checkmark-done-circle-outline" label="Approvals" onPress={() => router.push('/approvals')} />}
      {role !== 'OWNER' && <Item icon="airplane-outline" label="My leave" onPress={() => router.push('/leave')} />}
      {role !== 'OWNER' && <Item icon="cash-outline" label="My payslips" onPress={() => router.push('/payslips')} />}
    </>
  );
}
