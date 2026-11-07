import { router } from 'expo-router';
import { Screen, Card, Muted } from '../../components/ui';
import { Item, MoreMenu } from '../../components/MoreMenu';
import { useAuthStore } from '../../store/authStore';

export default function OfficeMore() {
  return (
    <Screen>
      <MoreMenu extra={<OfficeItems />} />
      <Card><Muted>Admissions, fee collection and reports are on the web panel.</Muted></Card>
    </Screen>
  );
}

function OfficeItems() {
  const role = useAuthStore((st) => st.user?.role);
  return (
    <>
      {role !== 'OWNER' && <Item icon="checkmark-done-circle-outline" label="Approvals" onPress={() => router.push('/approvals')} />}
      {role !== 'OWNER' && <Item icon="airplane-outline" label="My leave" onPress={() => router.push('/leave')} />}
    </>
  );
}
