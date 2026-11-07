import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../../lib/api';
import { Badge, Card, Empty, ErrorBox, H, Loading, Muted, Row, Screen } from '../../components/ui';
import { ChildSwitcher, useChildren } from '../../components/ChildSwitcher';
import { colors, STATUS_COLORS } from '../../lib/theme';
import { ago, day, money, period } from '../../lib/format';
import { useAuthStore } from '../../store/authStore';

// Spec §10 Parents Home: today's status, fee status, latest diary, upcoming holiday.
export default function FamilyHome() {
  const currency = useAuthStore((s) => s.user?.school?.currency ?? 'PKR');
  const kids = useChildren();
  const home = useQuery({ queryKey: ['home', kids.childId], queryFn: () => API.home(kids.childId!), enabled: !!kids.childId });
  const h = home.data;

  return (
    <Screen refreshing={home.isRefetching} onRefresh={() => { kids.refetch(); home.refetch(); }}>
      <ChildSwitcher />
      {kids.isSuccess && !kids.data.length && <Empty title="No children linked" hint="Ask the school office to link your account to your child." />}
      {(kids.isLoading || home.isLoading) && <Loading />}
      {home.error && <ErrorBox message={apiError(home.error)} onRetry={() => home.refetch()} />}
      {h && (
        <>
          <Card>
            <Muted>Today · {day(h.date, { weekday: 'long', day: 'numeric', month: 'long' })}</Muted>
            <View style={s.todayRow}>
              {h.today.holiday ? (
                <Badge label={`Holiday · ${h.today.holiday}`} fg={colors.info} bg={colors.infoSoft} />
              ) : h.today.status ? (
                <Badge label={STATUS_COLORS[h.today.status]?.label ?? h.today.status} fg={STATUS_COLORS[h.today.status]?.fg ?? colors.text} bg={STATUS_COLORS[h.today.status]?.bg ?? colors.bg} />
              ) : (
                <Badge label="Not marked yet" fg={colors.muted} bg="#f1f5f9" />
              )}
              {h.attendanceThisMonth.percent !== null && <Muted>This month {h.attendanceThisMonth.percent}%</Muted>}
            </View>
            {h.today.remarks && <Muted style={{ marginTop: 6 }}>{h.today.remarks}</Muted>}
          </Card>

          {h.fees && (
            <Card onPress={() => router.push('/(family)/fees')}>
              <H>Fee status</H>
              {h.fees.paidTill && <Row label="Paid till" value={period(h.fees.paidTill)} />}
              {h.fees.nextDue ? (
                <Row
                  label={h.fees.nextDue.overdue ? 'Overdue' : 'Next due'}
                  value={<Text style={{ fontWeight: '700', color: h.fees.nextDue.overdue ? colors.bad : colors.text }}>
                    {money(h.fees.nextDue.amount, currency)} · {day(h.fees.nextDue.dueDate)}
                  </Text>}
                />
              ) : <Row label="Balance" value={<Text style={{ color: colors.good, fontWeight: '700' }}>All paid</Text>} />}
              {Number(h.fees.pending) > 0 && <Row label="Total pending" value={money(h.fees.pending, currency)} />}
            </Card>
          )}

          <Card onPress={() => router.push('/(family)/diary')}>
            <H>Latest diary</H>
            {h.latestDiary ? (
              <>
                <Text style={s.diaryText} numberOfLines={3}>
                  {h.latestDiary.subject ? <Text style={{ fontWeight: '700' }}>{h.latestDiary.subject.name}: </Text> : null}
                  {h.latestDiary.title ?? h.latestDiary.content}
                </Text>
                <Muted>{h.latestDiary.teacher.name} · {ago(h.latestDiary.createdAt)}{h.latestDiary.dueDate ? ` · due ${day(h.latestDiary.dueDate)}` : ''}</Muted>
              </>
            ) : <Muted>Nothing posted yet.</Muted>}
          </Card>

          <Card>
            <H>Coming up</H>
            {h.upcoming.length === 0 && <Muted>No holidays or events in the next 60 days.</Muted>}
            {h.upcoming.map((e: any) => (
              <Row key={e.id} label={e.title} value={day(e.startDate) + (e.endDate !== e.startDate ? ` – ${day(e.endDate)}` : '')} />
            ))}
          </Card>

          <Card onPress={() => router.push('/notices')}>
            <View style={s.noticeRow}>
              <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
              <H style={{ flex: 1 }}>School notices</H>
              {h.unreadNotices > 0 && <Badge label={`${h.unreadNotices} new`} fg="#fff" bg={colors.primary} />}
            </View>
          </Card>

          {h.student.section?.classTeacher && (
            <Muted style={{ textAlign: 'center' }}>Class teacher: {h.student.section.classTeacher.name}</Muted>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  todayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  diaryText: { fontSize: 14, color: colors.text, marginVertical: 6, lineHeight: 20 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
