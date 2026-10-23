import { useLiveQuery } from 'dexie-react-hooks';
import { BUILTIN_DUTY_TYPES, defaultSettings } from '@/domain/catalog';
import type { AppSettings, ISODate } from '@/domain/types';
import { addDaysISO } from '@/lib/dates';
import { db } from './db';

const byOrder = <T extends { date: string; order: number; startTime?: string }>(a: T, b: T) =>
  a.date.localeCompare(b.date) || (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.order - b.order;

export function useSettings(): AppSettings | undefined {
  return useLiveQuery(() => db.settings.get('app'));
}

/** Settings with defaults while loading — safe for rendering. */
export function useSettingsOrDefault(): AppSettings {
  return useSettings() ?? FALLBACK;
}
const FALLBACK = defaultSettings();

export function useWorkouts(from: ISODate, to: ISODate) {
  return useLiveQuery(
    async () => (await db.workouts.where('date').between(from, to, true, true).toArray()).filter((w) => !w.deleted).sort(byOrder),
    [from, to],
  );
}

export function useAllWorkouts() {
  return useLiveQuery(async () => (await db.workouts.toArray()).filter((w) => !w.deleted).sort(byOrder));
}

export function useWorkout(id: string | undefined) {
  return useLiveQuery(async () => (id ? db.workouts.get(id) : undefined), [id]);
}

/** Duties overlapping the range (looks back a few days to catch multi-day / overnight duties). */
export function useDuties(from: ISODate, to: ISODate) {
  return useLiveQuery(
    async () =>
      (await db.duties.where('date').between(addDaysISO(from, -7), to, true, true).toArray())
        .filter((d) => !d.deleted && (d.endDate ?? d.date) >= addDaysISO(from, -1))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? '')),
    [from, to],
  );
}

export function useAllDuties() {
  return useLiveQuery(async () => (await db.duties.toArray()).filter((d) => !d.deleted).sort((a, b) => a.date.localeCompare(b.date)));
}

const BUILTIN_ORDER = BUILTIN_DUTY_TYPES.map((t) => t.id);
const typeRank = (id: string) => {
  const i = BUILTIN_ORDER.indexOf(id);
  return i < 0 ? BUILTIN_ORDER.length : i;
};

export function useDutyTypes() {
  return useLiveQuery(async () =>
    (await db.dutyTypes.toArray()).filter((t) => !t.deleted).sort((a, b) => typeRank(a.id) - typeRank(b.id) || a.code.localeCompare(b.code)),
  );
}

export function useTemplates() {
  return useLiveQuery(async () => (await db.templates.toArray()).filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name)));
}

export function useOverrides() {
  return useLiveQuery(async () => new Set((await db.overrides.toArray()).map((o) => o.key)));
}

export function useConflicts() {
  return useLiveQuery(() => db.conflicts.orderBy('createdAt').reverse().toArray());
}
