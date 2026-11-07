import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Empty, Muted } from './ui';
import { colors } from '../lib/theme';

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const todayName = () => new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date()).toUpperCase();

/** One day at a time — fits a phone better than a week grid. */
export function WeekTimetable({ slots, show }: { slots: any[]; show: 'teacher' | 'section' }) {
  const days = DAYS.filter((d) => d !== 'SATURDAY' || slots.some((s) => s.dayOfWeek === 'SATURDAY'));
  const [day, setDay] = useState(days.includes(todayName()) ? todayName() : days[0]);
  if (!slots.length) return <Empty title="No timetable yet" hint="The school office hasn't set it up." />;
  const list = slots.filter((s) => s.dayOfWeek === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} accessibilityRole="tablist">
        {days.map((d) => (
          <Pressable key={d} onPress={() => setDay(d)} accessibilityRole="tab" accessibilityState={{ selected: d === day }}
            style={[s.day, d === day && s.dayOn]}>
            <Text style={[s.dayText, d === day && { color: '#fff' }]}>{d.slice(0, 3)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {list.length === 0 && <Muted>No classes this day.</Muted>}
      {list.map((p) => (
        <Card key={p.id} style={s.row}>
          <View style={s.time}>
            <Text style={s.timeText}>{p.startTime}</Text>
            <Muted style={{ fontSize: 11 }}>{p.endTime}</Muted>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.subject}>{p.subject.name}</Text>
            <Muted>{show === 'teacher' ? p.teacher.name : p.section.name}{p.room ? ` · Room ${p.room}` : ''}</Muted>
          </View>
          <Muted>P{p.period}</Muted>
        </Card>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  day: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  dayOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { fontWeight: '700', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  time: { width: 52, alignItems: 'center' },
  timeText: { fontWeight: '800', color: colors.text },
  subject: { fontSize: 15, fontWeight: '700', color: colors.text },
});
