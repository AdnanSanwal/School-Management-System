import { Linking, Text } from 'react-native';
import { Screen, Card, H, Row } from '../../components/ui';
import { MoreMenu } from '../../components/MoreMenu';
import { useChildren } from '../../components/ChildSwitcher';
import { colors } from '../../lib/theme';
import { sectionName } from '../../lib/format';

// Spec §10 More: teacher info, notices, holidays, profile, password.
export default function FamilyMore() {
  const { child } = useChildren();
  const teacher = child?.section?.classTeacher;
  return (
    <Screen>
      {child && (
        <Card>
          <H>{child.name}</H>
          <Row label="Class" value={sectionName(child.section)} />
          <Row label="Admission no." value={child.admissionNo} />
          {teacher && <Row label="Class teacher" value={teacher.name} />}
          {teacher?.phone && (
            <Text onPress={() => Linking.openURL(`tel:${teacher.phone}`)} accessibilityRole="link"
              style={{ color: colors.primary, fontWeight: '700', marginTop: 6 }}>
              Call class teacher ({teacher.phone})
            </Text>
          )}
        </Card>
      )}
      <MoreMenu />
    </Screen>
  );
}
