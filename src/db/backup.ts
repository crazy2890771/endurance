import type { Duty, DutyType, Workout, WorkoutTemplate } from '@/domain/types';
import { csvEscape } from '@/lib/format';
import { db } from './db';
import { nowIso } from './repo';

export const BACKUP_FORMAT = 'kim-endurance-lab-backup';

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  workouts: Workout[];
  duties: Duty[];
  dutyTypes: DutyType[];
  templates: WorkoutTemplate[];
}

export async function createBackup(): Promise<Backup> {
  const [workouts, duties, dutyTypes, templates] = await Promise.all([
    db.workouts.toArray(),
    db.duties.toArray(),
    db.dutyTypes.toArray(),
    db.templates.toArray(),
  ]);
  return { format: BACKUP_FORMAT, version: 1, exportedAt: nowIso(), workouts, duties, dutyTypes, templates };
}

export function isBackup(x: unknown): x is Backup {
  const b = x as Backup;
  return !!b && b.format === BACKUP_FORMAT && Array.isArray(b.workouts) && Array.isArray(b.duties);
}

/** Merge a backup into the local database. For each id, the newer `updatedAt` wins. */
export async function restoreBackup(b: Backup): Promise<number> {
  let n = 0;
  await db.transaction('rw', [db.workouts, db.duties, db.dutyTypes, db.templates], async () => {
    const merge = async <T extends { id: string; updatedAt: string }>(table: import('dexie').Table<T, string>, rows: T[] = []) => {
      for (const r of rows) {
        if (!r?.id || !r.updatedAt) continue;
        const cur = await table.get(r.id);
        if (!cur || cur.updatedAt < r.updatedAt) {
          await table.put({ ...r, dirty: 1 });
          n++;
        }
      }
    };
    await merge(db.workouts, b.workouts);
    await merge(db.duties, b.duties);
    await merge(db.dutyTypes, b.dutyTypes);
    await merge(db.templates, b.templates);
  });
  return n;
}

export async function workoutsCsv(): Promise<string> {
  const rows = (await db.workouts.toArray()).filter((w) => !w.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const header = ['date', 'start', 'activity', 'type', 'location', 'planned_min', 'planned_km', 'hr_zone', 'target', 'status', 'actual_min', 'actual_km', 'avg_hr', 'avg_pace', 'rpe', 'notes', 'result_notes'];
  const lines = rows.map((w) =>
    [w.date, w.startTime, w.activity, w.type, w.location, w.durationMin, w.distanceKm, w.hrZone, w.target, w.status, w.result?.durationMin, w.result?.distanceKm, w.result?.avgHr, w.result?.avgPace, w.result?.rpe, w.notes, w.result?.notes]
      .map(csvEscape)
      .join(','),
  );
  return [header.join(','), ...lines].join('\n');
}

export async function dutiesCsv(): Promise<string> {
  const types = new Map((await db.dutyTypes.toArray()).map((t) => [t.id, t.code]));
  const rows = (await db.duties.toArray()).filter((d) => !d.deleted).sort((a, b) => a.date.localeCompare(b.date));
  const header = ['date', 'duty', 'start', 'end', 'end_date', 'title', 'notes'];
  const lines = rows.map((d) => [d.date, types.get(d.dutyTypeId) ?? '', d.startTime, d.endTime, d.endDate, d.title, d.notes].map(csvEscape).join(','));
  return [header.join(','), ...lines].join('\n');
}
