import { describe, expect, it } from 'vitest';
import { BUILTIN_DUTY_TYPES, DEFAULT_RULES } from '@/domain/catalog';
import { dutyEndDate, dutiesOnDate, evaluatePlan, type RuleId } from '@/domain/rules';
import type { Duty, DutyType, RuleConfig, Workout } from '@/domain/types';

const ts = '2026-01-01T00:00:00.000Z';
const types: DutyType[] = BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: ts, updatedAt: ts }));
let n = 0;

function w(date: string, p: Partial<Workout> = {}): Workout {
  return {
    id: `w${++n}`,
    date,
    activity: 'run',
    type: 'easy',
    durationMin: 45,
    hrZone: 2,
    status: 'planned',
    order: 0,
    createdAt: ts,
    updatedAt: ts,
    ...p,
  };
}

function duty(date: string, dutyTypeId: string, p: Partial<Duty> = {}): Duty {
  return { id: `d${++n}`, date, dutyTypeId, source: 'manual', createdAt: ts, updatedAt: ts, ...p };
}

/** All rules disabled except the ones under test. */
function only(...ids: (keyof RuleConfig)[]): RuleConfig {
  const r = structuredClone(DEFAULT_RULES);
  for (const k of Object.keys(r) as (keyof RuleConfig)[]) r[k].enabled = ids.includes(k);
  return r;
}

// Week of Mon 2026-10-19 .. Sun 2026-10-25
const FROM = '2026-10-19';
const TO = '2026-10-25';

function run(workouts: Workout[], rules: RuleConfig, duties: Duty[] = []) {
  return evaluatePlan({ workouts, duties, dutyTypes: types, rules, from: FROM, to: TO, weekStartsOn: 1 });
}
const ids = (ws: ReturnType<typeof run>) => ws.map((x) => x.ruleId as RuleId);

describe('consecutive hard days', () => {
  it('warns on interval followed by a long run the next day', () => {
    const res = run([w('2026-10-22', { type: 'interval', hrZone: 4 }), w('2026-10-23', { type: 'long', distanceKm: 18 })], only('consecutiveHard'));
    expect(ids(res)).toEqual(['consecutiveHard']);
    expect(res[0].dates).toEqual(['2026-10-22', '2026-10-23']);
    expect(res[0].params.days).toBe(2);
  });

  it('does not warn when an easy day separates hard days', () => {
    const res = run([w('2026-10-20', { type: 'interval' }), w('2026-10-21'), w('2026-10-22', { type: 'tempo' })], only('consecutiveHard'));
    expect(res).toHaveLength(0);
  });

  it('respects a higher configured threshold', () => {
    const rules = only('consecutiveHard');
    rules.consecutiveHard.maxDays = 2;
    expect(run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { type: 'tempo' })], rules)).toHaveLength(0);
    expect(run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { type: 'tempo' }), w('2026-10-22', { type: 'long' })], rules)).toHaveLength(1);
  });

  it('counts lower-body strength as hard but not mobility', () => {
    expect(run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { activity: 'strength', type: 'lower', hrZone: undefined })], only('consecutiveHard'))).toHaveLength(1);
    expect(run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { activity: 'strength', type: 'mobility', hrZone: undefined })], only('consecutiveHard'))).toHaveLength(0);
  });

  it('ignores skipped and deleted workouts', () => {
    const res = run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { type: 'tempo', status: 'skipped' }), w('2026-10-21', { type: 'long', deleted: true })], only('consecutiveHard'));
    expect(res).toHaveLength(0);
  });
});

describe('recovery after high intensity', () => {
  it('warns when two intense sessions are less than 48 h apart', () => {
    const res = run([w('2026-10-20', { type: 'interval', startTime: '07:00', durationMin: 60 }), w('2026-10-21', { type: 'tempo', startTime: '18:00' })], only('hardRecovery'));
    expect(ids(res)).toEqual(['hardRecovery']);
    expect(res[0].params.hours).toBe(34);
  });

  it('passes with enough recovery', () => {
    const res = run([w('2026-10-20', { type: 'interval', startTime: '07:00' }), w('2026-10-23', { type: 'tempo', startTime: '07:00' })], only('hardRecovery'));
    expect(res).toHaveLength(0);
  });

  it('treats HR zone 4+ as high intensity even for an easy-type session', () => {
    const res = run([w('2026-10-20', { activity: 'cycle', type: 'endurance', hrZone: 4 }), w('2026-10-21', { type: 'interval' })], only('hardRecovery'));
    expect(res).toHaveLength(1);
  });

  it('is not duplicated when consecutive-hard already covers the same pair', () => {
    const res = run([w('2026-10-20', { type: 'interval' }), w('2026-10-21', { type: 'tempo' })], only('hardRecovery', 'consecutiveHard'));
    expect(ids(res)).toEqual(['consecutiveHard']);
  });
});

describe('consecutive running days', () => {
  it('warns when running more than 3 days in a row', () => {
    const ws = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].map((d) => w(d));
    const res = run(ws, only('consecutiveRun'));
    expect(ids(res)).toEqual(['consecutiveRun']);
    expect(res[0].params.days).toBe(4);
  });

  it('allows exactly 3 days and ignores other activities', () => {
    const ws = [w('2026-10-19'), w('2026-10-20'), w('2026-10-21'), w('2026-10-22', { activity: 'cycle', type: 'easy' })];
    expect(run(ws, only('consecutiveRun'))).toHaveLength(0);
  });

  it('detects a streak that started in the previous week', () => {
    const ws = ['2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'].map((d) => w(d));
    expect(run(ws, only('consecutiveRun'))).toHaveLength(1);
  });
});

describe('weekly rest', () => {
  it('warns when every day of the week has training', () => {
    const ws = ['19', '20', '21', '22', '23', '24', '25'].map((d, i) => w(`2026-10-${d}`, { activity: i % 2 ? 'swim' : 'cycle', type: 'easy' }));
    const res = run(ws, only('weeklyRest'));
    expect(ids(res)).toEqual(['weeklyRest']);
    expect(res[0].params.rest).toBe(0);
  });

  it('counts explicit rest entries and skipped sessions as rest', () => {
    const ws = ['19', '20', '21', '22', '23', '24'].map((d) => w(`2026-10-${d}`, { activity: 'cycle', type: 'easy' }));
    ws.push(w('2026-10-25', { activity: 'rest', type: 'rest', durationMin: 0 }));
    expect(run(ws, only('weeklyRest'))).toHaveLength(0);
    ws.push(w('2026-10-25', { activity: 'swim', type: 'easy', status: 'skipped' }));
    expect(run(ws, only('weeklyRest'))).toHaveLength(0);
  });

  it('does not warn for an empty week', () => {
    expect(run([], only('weeklyRest'))).toHaveLength(0);
  });
});

describe('duty conflicts', () => {
  it('warns when a workout overlaps a flight duty including the buffer', () => {
    const d = duty('2026-10-22', 'dt-flight', { startTime: '05:30', endTime: '14:45' });
    const res = run([w('2026-10-22', { startTime: '15:00', durationMin: 45 })], only('dutyOverlap'), [d]);
    expect(ids(res)).toEqual(['dutyOverlap']);
    expect(res[0].dutyIds).toEqual([d.id]);
  });

  it('passes when the workout is clear of duty + buffer', () => {
    const d = duty('2026-10-22', 'dt-flight', { startTime: '05:30', endTime: '14:45' });
    expect(run([w('2026-10-22', { startTime: '16:00' })], only('dutyOverlap'), [d])).toHaveLength(0);
  });

  it('handles overnight duties that end the next morning', () => {
    const d = duty('2026-10-22', 'dt-flight', { startTime: '22:10', endTime: '06:40' });
    expect(dutyEndDate(d)).toBe('2026-10-23');
    expect(dutiesOnDate([d], '2026-10-23')).toHaveLength(1);
    const res = run([w('2026-10-23', { startTime: '07:00' })], only('dutyOverlap'), [d]);
    expect(ids(res)).toEqual(['dutyOverlap']);
    expect(run([w('2026-10-23', { startTime: '09:00' })], only('dutyOverlap'), [d])).toHaveLength(0);
  });

  it('does not assume standby is free: limited duty without times gives an info notice', () => {
    const res = run([w('2026-10-25')], only('dutyOverlap'), [duty('2026-10-25', 'dt-standby')]);
    expect(ids(res)).toEqual(['dutyLimited']);
    expect(res[0].severity).toBe('info');
  });

  it('warns on duty types the user marked as no-training', () => {
    const noTrain: DutyType = { ...types[0], id: 'dt-sim', code: 'SIM', allowsTraining: 'no' };
    const res = evaluatePlan({ workouts: [w('2026-10-21')], duties: [duty('2026-10-21', 'dt-sim')], dutyTypes: [...types, noTrain], rules: only('dutyOverlap'), from: FROM, to: TO });
    expect(ids(res)).toEqual(['dutyNoTraining']);
  });

  it('is silent on OFF / AL days', () => {
    expect(run([w('2026-10-21')], only('dutyOverlap'), [duty('2026-10-21', 'dt-off'), duty('2026-10-21', 'dt-al')])).toHaveLength(0);
  });

  it('skips completed workouts', () => {
    const d = duty('2026-10-22', 'dt-flight', { startTime: '05:30', endTime: '14:45' });
    expect(run([w('2026-10-22', { startTime: '06:00', status: 'completed' })], only('dutyOverlap'), [d])).toHaveLength(0);
  });
});

describe('running volume increase', () => {
  const prevWeek = [w('2026-10-13', { distanceKm: 10, status: 'completed', result: { distanceKm: 10, completedAt: ts } }), w('2026-10-16', { distanceKm: 10, status: 'completed', result: { distanceKm: 10, completedAt: ts } })];

  it('warns when weekly running grows by more than 10%', () => {
    const res = run([...prevWeek, w('2026-10-20', { distanceKm: 12 }), w('2026-10-23', { distanceKm: 12 })], only('runVolume'));
    expect(ids(res)).toEqual(['runVolume']);
    expect(res[0].params).toMatchObject({ prev: 20, cur: 24, pct: 20, max: 10 });
  });

  it('passes within the threshold', () => {
    expect(run([...prevWeek, w('2026-10-20', { distanceKm: 11 }), w('2026-10-23', { distanceKm: 11 })], only('runVolume'))).toHaveLength(0);
  });

  it('uses actual distance for completed workouts', () => {
    const prev = [w('2026-10-14', { distanceKm: 30, status: 'completed', result: { distanceKm: 20, completedAt: ts } })];
    expect(run([...prev, w('2026-10-21', { distanceKm: 25 })], only('runVolume'))).toHaveLength(1);
  });

  it('ignores a low base week', () => {
    expect(run([w('2026-10-14', { distanceKm: 5 }), w('2026-10-21', { distanceKm: 15 })], only('runVolume'))).toHaveLength(0);
  });
});

describe('long runs per week', () => {
  it('warns on two long runs in one week', () => {
    const res = run([w('2026-10-20', { type: 'long' }), w('2026-10-25', { type: 'long' })], only('longRunPerWeek'));
    expect(ids(res)).toEqual(['longRunPerWeek']);
  });
});

describe('warning keys and determinism', () => {
  it('produces identical output for identical input and never mutates workouts', () => {
    const ws = [w('2026-10-22', { type: 'interval' }), w('2026-10-23', { type: 'long' })];
    const snapshot = JSON.stringify(ws);
    const a = run(ws, DEFAULT_RULES);
    const b = run(ws, DEFAULT_RULES);
    expect(a).toEqual(b);
    expect(JSON.stringify(ws)).toBe(snapshot);
    expect(new Set(a.map((x) => x.key)).size).toBe(a.length);
  });

  it('only returns warnings inside the requested range', () => {
    const res = run([w('2026-10-27', { type: 'interval' }), w('2026-10-28', { type: 'long' })], only('consecutiveHard'));
    expect(res).toHaveLength(0);
  });
});
