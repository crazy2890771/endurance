import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import {
  clearAllData,
  completeWorkout,
  deleteDutyType,
  deleteWorkout,
  duplicateWorkout,
  ensureInitialized,
  importDuties,
  moveWorkout,
  reorderWorkout,
  saveDuty,
  saveWorkout,
  skipWorkout,
  type WorkoutDraft,
} from '@/db/repo';
import { createBackup, isBackup, restoreBackup } from '@/db/backup';
import { loadDemoData } from '@/db/demo';

const draft = (p: Partial<WorkoutDraft> = {}): WorkoutDraft => ({ date: '2026-10-21', activity: 'run', type: 'easy', durationMin: 45, hrZone: 2, ...p });

beforeEach(async () => {
  await clearAllData();
});

describe('workout CRUD', () => {
  it('creates, edits and soft-deletes a workout', async () => {
    const w = await saveWorkout(draft());
    expect(w).toMatchObject({ status: 'planned', order: 0, dirty: 1 });
    const edited = await saveWorkout({ ...draft({ durationMin: 60 }), id: w.id });
    expect(edited.durationMin).toBe(60);
    expect(edited.createdAt).toBe(w.createdAt);
    await deleteWorkout(w.id);
    expect((await db.workouts.get(w.id))?.deleted).toBe(true);
  });

  it('supports multiple workouts per day with stable ordering and reordering', async () => {
    const a = await saveWorkout(draft());
    const b = await saveWorkout(draft({ activity: 'strength', type: 'upper', hrZone: undefined }));
    expect(b.order).toBe(1);
    await reorderWorkout(b.id, -1);
    expect((await db.workouts.get(b.id))?.order).toBe(0);
    expect((await db.workouts.get(a.id))?.order).toBe(1);
  });

  it('moves and duplicates without touching the original', async () => {
    const w = await saveWorkout(draft());
    await completeWorkout(w.id, { durationMin: 44, rpe: 4 });
    const copy = await duplicateWorkout(w.id, '2026-10-28');
    expect(copy).toMatchObject({ date: '2026-10-28', status: 'planned' });
    expect(copy.result).toBeUndefined();
    expect(copy.id).not.toBe(w.id);
    await moveWorkout(w.id, '2026-10-22');
    expect((await db.workouts.get(w.id))).toMatchObject({ date: '2026-10-22', status: 'completed' });
  });

  it('records results and skips', async () => {
    const w = await saveWorkout(draft());
    await completeWorkout(w.id, { durationMin: 47, distanceKm: 7.6, avgHr: 141, rpe: 4 });
    const done = await db.workouts.get(w.id);
    expect(done?.status).toBe('completed');
    expect(done?.result).toMatchObject({ durationMin: 47, avgHr: 141 });
    const s = await saveWorkout(draft());
    await skipWorkout(s.id);
    expect((await db.workouts.get(s.id))?.status).toBe('skipped');
  });
});

describe('duties', () => {
  it('prevents duplicate imports', async () => {
    await saveDuty({ date: '2026-10-21', dutyTypeId: 'dt-off', source: 'manual' });
    const res = await importDuties([
      { date: '2026-10-21', dutyTypeId: 'dt-off', source: 'csv' },
      { date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', source: 'csv' },
      { date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', source: 'csv' },
    ]);
    expect(res).toMatchObject({ added: 1, skipped: 2 });
    const again = await importDuties([{ date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', source: 'ics' }]);
    expect(again.added).toBe(0);
  });

  it('dedupes ICS events by UID even when times change', async () => {
    await importDuties([{ date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', source: 'ics', sourceKey: 'ics:1' }]);
    const r = await importDuties([{ date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '06:00', endTime: '15:00', source: 'ics', sourceKey: 'ics:1' }]);
    expect(r.added).toBe(0);
  });

  it('replaces duties on imported dates when asked, keeping other days', async () => {
    await saveDuty({ date: '2026-10-21', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', source: 'aims', sourceKey: 'aims:2026-10-21' });
    await saveDuty({ date: '2026-10-22', dutyTypeId: 'dt-off', source: 'manual' });
    const r = await importDuties([{ date: '2026-10-21', dutyTypeId: 'dt-flight', startTime: '06:10', endTime: '15:00', source: 'aims', sourceKey: 'aims:2026-10-21' }], { replace: true });
    expect(r).toEqual({ added: 1, skipped: 0, replaced: 1 });
    const live = (await db.duties.toArray()).filter((d) => !d.deleted);
    expect(live.map((d) => `${d.date} ${d.startTime ?? ''}`).sort()).toEqual(['2026-10-21 06:10', '2026-10-22 ']);
  });

  it('does not delete built-in or in-use duty types', async () => {
    await expect(deleteDutyType('dt-off')).rejects.toThrow();
  });
});

describe('initialisation, demo and backup', () => {
  it('migrates older installs: standby becomes Training OK and imported DM duties move to Standby', async () => {
    const sb = (await db.dutyTypes.get('dt-standby'))!;
    await db.dutyTypes.put({ ...sb, allowsTraining: 'limited', updatedAt: sb.createdAt });
    await db.duties.put({ id: 'old-dm', date: '2026-10-26', dutyTypeId: 'dt-dm', title: 'DM2', startTime: '08:00', endTime: '16:00', source: 'aims', createdAt: 'x', updatedAt: 'x' });
    await db.duties.put({ id: 'manual-dm', date: '2026-10-27', dutyTypeId: 'dt-dm', title: 'Meeting', source: 'manual', createdAt: 'x', updatedAt: 'x' });
    const s = (await db.settings.get('app'))!;
    await db.settings.put({ ...s, migrations: [] });
    await ensureInitialized();
    expect((await db.dutyTypes.get('dt-standby'))?.allowsTraining).toBe('yes');
    expect((await db.duties.get('old-dm'))?.dutyTypeId).toBe('dt-standby');
    expect((await db.duties.get('manual-dm'))?.dutyTypeId).toBe('dt-dm');
    expect((await db.settings.get('app'))?.migrations).toContain('standby-training-ok');
  });

  it('keeps a standby setting the user chose themselves', async () => {
    const sb = (await db.dutyTypes.get('dt-standby'))!;
    await db.dutyTypes.put({ ...sb, allowsTraining: 'limited', updatedAt: '2099-01-01T00:00:00.000Z' });
    const s = (await db.settings.get('app'))!;
    await db.settings.put({ ...s, migrations: [] });
    await ensureInitialized();
    expect((await db.dutyTypes.get('dt-standby'))?.allowsTraining).toBe('limited');
  });

  it('seeds settings and built-in duty types once', async () => {
    await ensureInitialized();
    await ensureInitialized();
    expect(await db.dutyTypes.count()).toBe(7);
    expect((await db.settings.get('app'))?.rules.consecutiveRun.maxDays).toBe(3);
  });

  it('round-trips a backup', async () => {
    await loadDemoData();
    const backup = await createBackup();
    expect(isBackup(backup)).toBe(true);
    expect(backup.workouts.length).toBeGreaterThan(20);
    await clearAllData();
    const n = await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(n).toBeGreaterThanOrEqual(backup.workouts.length + backup.duties.length);
    expect(await db.workouts.count()).toBe(backup.workouts.length);
  });

  it('rejects foreign JSON', () => {
    expect(isBackup({ foo: 1 })).toBe(false);
  });
});
