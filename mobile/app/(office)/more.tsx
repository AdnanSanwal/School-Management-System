import { Screen, Card, Muted } from '../../components/ui';
import { MoreMenu } from '../../components/MoreMenu';

export default function OfficeMore() {
  return (
    <Screen>
      <MoreMenu />
      <Card><Muted>Admissions, fee collection and reports are on the web panel.</Muted></Card>
    </Screen>
  );
}
