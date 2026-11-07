import { useQuery } from '@tanstack/react-query';
import { API } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export type Section = { id: string; label: string; strength: number; isClassTeacher: boolean };

/** Sections this teacher teaches, with their class-teacher section first. */
export function useMySections() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: ['classes'],
    queryFn: API.classes,
    select: (classes: any[]): Section[] => classes
      .flatMap((c) => c.sections.map((s: any) => ({
        id: s.id, label: `${c.name}-${s.name}`, strength: s.strength,
        isClassTeacher: !!s.classTeacher && s.classTeacher.name === user?.name,
      })))
      .sort((a, b) => Number(b.isClassTeacher) - Number(a.isClassTeacher)),
  });
}
