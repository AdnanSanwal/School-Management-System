import { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { API, apiError } from '../lib/api';
import { Button, Card, Muted, Screen } from '../components/ui';
import { useMySections } from '../components/sections';
import { colors } from '../lib/theme';
import { day, todayIso } from '../lib/format';

const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

function Pills<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel={label} accessibilityRole="radiogroup">
      {items.map((i) => (
        <Pressable key={i.id} onPress={() => onChange(i.id)} accessibilityRole="radio" accessibilityState={{ checked: value === i.id }}
          style={[s.pill, value === i.id && s.pillOn]}>
          <Text style={[s.pillText, value === i.id && { color: '#fff' }]}>{i.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

// Spec §8 Daily Diary: select class → write text + attach photo/PDF → post. Parents see it instantly.
export default function PostDiary() {
  const qc = useQueryClient();
  const sections = useMySections();
  const subjects = useQuery({ queryKey: ['subjects'], queryFn: API.subjects });
  const today = todayIso();
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [homework, setHomework] = useState(true);
  const [due, setDue] = useState(addDays(today, 1));
  const [files, setFiles] = useState<DocumentPicker.DocumentPickerAsset[]>([]);

  useEffect(() => { if (!sectionId && sections.data?.length) setSectionId(sections.data[0].id); }, [sections.data, sectionId]);

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], multiple: true, copyToCacheDirectory: true });
    if (!r.canceled) setFiles([...files, ...r.assets].slice(0, 3));
  };

  const post = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('sectionId', sectionId!);
      if (subjectId) form.append('subjectId', subjectId);
      if (title.trim()) form.append('title', title.trim());
      form.append('content', content.trim());
      form.append('isHomework', String(homework));
      if (homework && due) form.append('dueDate', due);
      for (const f of files) {
        // Web gives a real File; native needs { uri, name, type }.
        if (Platform.OS === 'web' && f.file) form.append('files', f.file, f.name);
        else form.append('files', { uri: f.uri, name: f.name, type: f.mimeType ?? 'application/octet-stream' } as any);
      }
      return API.postDiary(form);
    },
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['diary'] });
      const msg = `Sent to ${r.familiesNotified} famil${r.familiesNotified === 1 ? 'y' : 'ies'}.`;
      if (Platform.OS === 'web') globalThis.alert?.(`Posted. ${msg}`); else Alert.alert('Posted', msg);
      router.back();
    },
    onError: (e) => (Platform.OS === 'web' ? globalThis.alert?.(apiError(e)) : Alert.alert('Could not post', apiError(e))),
  });

  return (
    <Screen>
      <Card style={{ gap: 10 }}>
        <Muted>Class</Muted>
        <Pills label="Class" value={sectionId} onChange={setSectionId} items={(sections.data ?? []).map((s) => ({ id: s.id, label: s.label }))} />
        <Muted>Subject</Muted>
        <Pills label="Subject" value={subjectId} onChange={setSubjectId} items={[{ id: '', label: 'General' }, ...(subjects.data ?? []).map((s: any) => ({ id: s.id, label: s.name }))]} />
      </Card>
      <Card style={{ gap: 10 }}>
        <TextInput style={s.input} placeholder="Title (optional)" value={title} onChangeText={setTitle} maxLength={120} accessibilityLabel="Title" placeholderTextColor={colors.faint} />
        <TextInput style={[s.input, { minHeight: 120, textAlignVertical: 'top' }]} placeholder="e.g. Maths: Chapter 5 exercise 5.2, questions 1–10"
          value={content} onChangeText={setContent} multiline maxLength={5000} accessibilityLabel="Diary text" placeholderTextColor={colors.faint} />
        <View style={s.switchRow}>
          <Text style={{ fontWeight: '600', color: colors.text }}>Homework</Text>
          <Switch value={homework} onValueChange={setHomework} trackColor={{ true: colors.primary }} accessibilityLabel="Homework" />
        </View>
        {homework && (
          <>
            <Muted>Due</Muted>
            <Pills label="Due date" value={due} onChange={setDue} items={[1, 2, 3, 7].map((n) => ({ id: addDays(today, n), label: day(addDays(today, n), { weekday: 'short', day: 'numeric' }) }))} />
          </>
        )}
      </Card>
      <Card style={{ gap: 8 }}>
        {files.map((f, i) => (
          <View key={i} style={s.file}>
            <Ionicons name={f.mimeType === 'application/pdf' ? 'document-text-outline' : 'image-outline'} size={18} color={colors.primary} />
            <Text style={{ flex: 1 }} numberOfLines={1}>{f.name}</Text>
            <Pressable onPress={() => setFiles(files.filter((_, j) => j !== i))} accessibilityLabel={`Remove ${f.name}`} hitSlop={10}>
              <Ionicons name="close-circle" size={20} color={colors.faint} />
            </Pressable>
          </View>
        ))}
        {files.length < 3 && <Button title="Attach photo or PDF" variant="secondary" onPress={pick} />}
        <Muted>Up to 3 files, 5 MB each.</Muted>
      </Card>
      <Button title="Post to parents" onPress={() => post.mutate()} loading={post.isPending} disabled={!sectionId || !content.trim()} />
    </Screen>
  );
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border },
  pillOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontWeight: '600', color: colors.text },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, fontSize: 15, color: colors.text },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  file: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.primarySoft },
});
