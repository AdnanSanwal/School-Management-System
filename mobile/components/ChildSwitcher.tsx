import { useEffect } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { API } from '../lib/api';
import { useChildStore } from '../store/childStore';
import { colors } from '../lib/theme';
import { sectionName } from '../lib/format';

/** Children of the signed-in parent; selecting one drives every family screen. */
export function useChildren() {
  const { childId, setChild } = useChildStore();
  const q = useQuery({ queryKey: ['children'], queryFn: API.children });
  useEffect(() => {
    if (q.data?.length && !q.data.some((c) => c.id === childId)) setChild(q.data[0].id);
  }, [q.data, childId, setChild]);
  const child = q.data?.find((c) => c.id === childId) ?? null;
  return { ...q, child, childId: child?.id ?? null };
}

export function ChildSwitcher() {
  const { data = [], childId } = useChildren();
  const setChild = useChildStore((s) => s.setChild);
  if (data.length <= 1) {
    const c = data[0];
    return c ? <ChildChip child={c} active /> : null;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
      {data.map((c) => (
        <Pressable key={c.id} onPress={() => setChild(c.id)} accessibilityRole="tab" accessibilityState={{ selected: c.id === childId }}>
          <ChildChip child={c} active={c.id === childId} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function ChildChip({ child, active }: { child: any; active: boolean }) {
  return (
    <View style={[s.chip, active && s.active]}>
      {child.photo
        ? <Image source={{ uri: child.photo }} style={s.avatar} accessibilityIgnoresInvertColors />
        : <View style={[s.avatar, s.initial]}><Text style={s.initialText}>{child.name[0]}</Text></View>}
      <View>
        <Text style={s.name}>{child.name}</Text>
        <Text style={s.cls}>Class {sectionName(child.section).replace(/^Class /, '')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, paddingRight: 14, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  active: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  avatar: { width: 36, height: 36, borderRadius: 10 },
  initial: { backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  initialText: { color: '#fff', fontWeight: '800' },
  name: { fontWeight: '700', color: colors.text },
  cls: { fontSize: 12, color: colors.muted },
});
