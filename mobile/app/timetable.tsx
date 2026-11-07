import { useQuery } from '@tanstack/react-query';
import { API, apiError } from '../lib/api';
import { ErrorBox, Loading, Screen } from '../components/ui';
import { WeekTimetable } from '../components/WeekTimetable';
import { ChildSwitcher, useChildren } from '../components/ChildSwitcher';
import { useAuthStore } from '../store/authStore';

// Parents/students: the child's class timetable. Teachers: their own week.
export default function TimetableScreen() {
  const role = useAuthStore((s) => s.user?.role);
  return role === 'TEACHER' ? <TeacherWeek /> : <ChildWeek />;
}

function TeacherWeek() {
  const q = useQuery({ queryKey: ['timetable', 'me'], queryFn: API.myTimetable });
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} /> : <WeekTimetable slots={q.data ?? []} show="section" />}
    </Screen>
  );
}

function ChildWeek() {
  const { child } = useChildren();
  const sectionId = child?.section?.id;
  const q = useQuery({ queryKey: ['timetable', sectionId], queryFn: () => API.sectionTimetable(sectionId!), enabled: !!sectionId });
  return (
    <Screen refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <ChildSwitcher />
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox message={apiError(q.error)} /> : <WeekTimetable slots={q.data ?? []} show="teacher" />}
    </Screen>
  );
}
