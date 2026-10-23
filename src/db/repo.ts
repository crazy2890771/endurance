import { BUILTIN_DUTY_TYPES, defaultSettings } from '@/domain/catalog';
import type {
  AppSettings,
  Duty,
  DutyType,
  ISODate,
  SyncFields,
  Workout,
  WorkoutResult,
  WorkoutTemplate,
} from '@/domain/types';
import { db } from './db';

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

type Listener = () => void;
const listeners = new Set<Listener>();
/** Subscribe to local data changes (used by the sync scheduler). */
export const onLocalChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emitChange = () => listeners.forEach((fn) => fn());

function stamp<T extends Partial<SyncFields>>(rec: T): T & SyncFields {
  const ts = nowIso();
  return { ...rec, id: rec.id ?? newId(), createdAt: rec.createdAt ?? ts, updatedAt: ts, dirty: 1 } as T & SyncFields;
}

// ---------- settings ----------

export async function ensureInitialized(): Promise<AppSettings> {
  return db.transaction('rw', db.settings, db.dutyTypes, async () => {
    let s = await db.settings.get('app');
    if (!s) {
      s = defaultSettings();
      await db.settings.put(s);
    }
    if ((await db.dutyTypes.count()) === 0) {
      const ts = nowIso();
      await db.dutyTypes.bulkPut(BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: ts, updatedAt: ts, dirty: 1 as const })));
    }
    return s;
  });
}

export async function updateSettings(patch: Partial<AppSettings> | ((s: AppSettings) => Partial<AppSettings>)) {
  const cur = (await db.settings.get('app')) ?? defaultSettings();
  const p = typeof patch === 'function' ? patch(cur) : patch;
  await db.settings.put({ ...cur, ...p, id: 'app', updatedAt: nowIso() });
}

// ---------- workouts ----------

export type WorkoutDraft = Omit<Workout, keyof SyncFields | 'order' | 'status'> &
  Partial<Pick<Workout, 'id' | 'order' | 'status' | 'createdAt'>>;

async function nextOrder(date: ISODate) {
  const same = await db.workouts.where('date').equals(date).filter((w) => !w.deleted).toArray();
  return same.reduce((m, w) => Math.max(m, w.order), -1) + 1;
}

export async function saveWorkout(draft: WorkoutDraft): Promise<Workout> {
  const existing = draft.id ? await db.workouts.get(draft.id) : undefined;
  const order = existing && existing.date === draft.date ? existing.order : (draft.order ?? (await nextOrder(draft.date)));
  const rec = stamp<Workout>({
    ...existing,
    ...draft,
    status: draft.status ?? existing?.status ?? 'planned',
    order,
    createdAt: existing?.createdAt,
  } as Workout);
  await db.workouts.put(rec);
  emitChange();
  return rec;
}

async function patchWorkout(id: string, patch: Partial<Workout>) {
  const w = await db.workouts.get(id);
  if (!w) throw new Error('Workout not found');
  const rec = stamp({ ...w, ...patch });
  await db.workouts.put(rec);
  emitChange();
  return rec;
}

export const deleteWorkout = (id: string) => patchWorkout(id, { deleted: true });
export const restoreWorkout = (id: string) => patchWorkout(id, { deleted: false });
export const skipWorkout = (id: string) => patchWorkout(id, { status: 'skipped' });
export const reopenWorkout = (id: string) => patchWorkout(id, { status: 'planned', result: undefined });
export const completeWorkout = (id: string, result: Omit<WorkoutResult, 'completedAt'>) =>
  patchWorkout(id, { status: 'completed', result: { ...result, completedAt: nowIso() } });

export async function moveWorkout(id: string, date: ISODate) {
  return patchWorkout(id, { date, order: await nextOrder(date) });
}

export async function duplicateWorkout(id: string, date?: ISODate) {
  const w = await db.workouts.get(id);
  if (!w) throw new Error('Workout not found');
  const target = date ?? w.date;
  const copy: Workout = stamp({
    ...w,
    id: newId(),
    createdAt: undefined as unknown as string,
    date: target,
    status: 'planned',
    result: undefined,
    order: await nextOrder(target),
  });
  await db.workouts.put(copy);
  emitChange();
  return copy;
}

/** Swap a workout with its neighbour inside the same day. */
export async function reorderWorkout(id: string, dir: -1 | 1) {
  const w = await db.workouts.get(id);
  if (!w) return;
  const day = (await db.workouts.where('date').equals(w.date).filter((x) => !x.deleted).toArray()).sort((a, b) => a.order - b.order);
  const i = day.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= day.length) return;
  [day[i], day[j]] = [day[j], day[i]];
  await db.transaction('rw', db.workouts, async () => {
    for (let k = 0; k < day.length; k++) {
      if (day[k].order !== k) await db.workouts.put(stamp({ ...day[k], order: k }));
    }
  });
  emitChange();
}

// ---------- duties ----------

export type DutyDraft = Omit<Duty, keyof SyncFields> & Partial<Pick<Duty, 'id' | 'createdAt'>>;

export const dutyFingerprint = (d: Pick<Duty, 'date' | 'dutyTypeId' | 'startTime' | 'endTime'>) =>
  [d.date, d.dutyTypeId, d.startTime ?? '', d.endTime ?? ''].join('|');

export async function saveDuty(draft: DutyDraft): Promise<Duty> {
  const existing = draft.id ? await db.duties.get(draft.id) : undefined;
  const rec = stamp<Duty>({ ...existing, ...draft, createdAt: existing?.createdAt } as Duty);
  await db.duties.put(rec);
  emitChange();
  return rec;
}

export async function deleteDuty(id: string) {
  const d = await db.duties.get(id);
  if (!d) return;
  await db.duties.put(stamp({ ...d, deleted: true }));
  emitChange();
}

/** Returns, for each draft, whether an equivalent duty already exists locally. */
export async function findDuplicateDuties(drafts: DutyDraft[]): Promise<boolean[]> {
  const dates = [...new Set(drafts.map((d) => d.date))];
  const existing = (await db.duties.where('date').anyOf(dates).toArray()).filter((d) => !d.deleted);
  const keys = new Set(existing.flatMap((d) => [dutyFingerprint(d), d.sourceKey].filter(Boolean) as string[]));
  return drafts.map((d) => keys.has(dutyFingerprint(d)) || (!!d.sourceKey && keys.has(d.sourceKey)));
}

/**
 * Import reviewed duties. Duplicates (same date/type/times or same source key) are skipped.
 * With `replace`, existing duties starting on the imported dates are removed first, so an
 * updated roster replaces the old entries instead of stacking on top of them.
 */
export async function importDuties(drafts: DutyDraft[], opts: { replace?: boolean } = {}): Promise<{ added: number; skipped: number; replaced: number }> {
  let replaced = 0;
  if (opts.replace && drafts.length) {
    const dates = [...new Set(drafts.map((d) => d.date))];
    const old = (await db.duties.where('date').anyOf(dates).toArray()).filter((d) => !d.deleted);
    await db.duties.bulkPut(old.map((d) => stamp({ ...d, deleted: true })));
    replaced = old.length;
  }
  const dup = await findDuplicateDuties(drafts);
  const seen = new Set<string>();
  const toAdd: Duty[] = [];
  drafts.forEach((d, i) => {
    const fp = dutyFingerprint(d);
    if (dup[i] || seen.has(fp)) return;
    seen.add(fp);
    toAdd.push(stamp<Duty>({ ...d, sourceKey: d.sourceKey ?? fp } as Duty));
  });
  await db.duties.bulkPut(toAdd);
  emitChange();
  return { added: toAdd.length, skipped: drafts.length - toAdd.length, replaced };
}

export async function saveDutyType(t: Omit<DutyType, keyof SyncFields> & Partial<SyncFields>) {
  const existing = t.id ? await db.dutyTypes.get(t.id) : undefined;
  const rec = stamp<DutyType>({ ...existing, ...t, createdAt: existing?.createdAt } as DutyType);
  await db.dutyTypes.put(rec);
  emitChange();
  return rec;
}

export async function deleteDutyType(id: string) {
  const t = await db.dutyTypes.get(id);
  if (!t || t.builtin) throw new Error('Built-in duty types cannot be deleted');
  const inUse = await db.duties.where('dutyTypeId').equals(id).filter((d) => !d.deleted).count();
  if (inUse > 0) throw new Error(`IN_USE:${inUse}`);
  await db.dutyTypes.put(stamp({ ...t, deleted: true }));
  emitChange();
}

// ---------- templates ----------

export async function saveTemplate(t: Omit<WorkoutTemplate, keyof SyncFields> & Partial<SyncFields>) {
  const existing = t.id ? await db.templates.get(t.id) : undefined;
  const rec = stamp<WorkoutTemplate>({ ...existing, ...t, createdAt: existing?.createdAt } as WorkoutTemplate);
  await db.templates.put(rec);
  emitChange();
  return rec;
}

export async function deleteTemplate(id: string) {
  const t = await db.templates.get(id);
  if (!t) return;
  await db.templates.put(stamp({ ...t, deleted: true }));
  emitChange();
}

// ---------- rule overrides ----------

export const overrideWarning = (key: string) => db.overrides.put({ key, createdAt: nowIso() });
export const clearOverride = (key: string) => db.overrides.delete(key);

// ---------- maintenance ----------

export async function clearAllData() {
  await db.transaction('rw', [db.workouts, db.duties, db.dutyTypes, db.templates, db.overrides, db.conflicts], async () => {
    await Promise.all([db.workouts.clear(), db.duties.clear(), db.dutyTypes.clear(), db.templates.clear(), db.overrides.clear(), db.conflicts.clear()]);
  });
  await updateSettings((s) => ({ sync: { ...s.sync, lastPulledAt: undefined, lastSyncedAt: undefined } }));
  await ensureInitialized();
  emitChange();
}
