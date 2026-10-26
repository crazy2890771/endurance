import { describe, expect, it } from 'vitest';
import { BUILTIN_DUTY_TYPES, DEFAULT_RULES } from '@/domain/catalog';
import { clashingBlocks, dayAvailability, dutiesShownOn, dutyBlocksOn, dutyEndDate, dutiesOnDate, evaluatePlan, freeWindows, restAfterOvernight, type RuleId } from '@/domain/rules';
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
    expect(ids(run([w('2026-10-23', { startTime: '05:00' })], only('dutyOverlap'), [d]))).toEqual(['dutyOverlap']);
    // After it ends, the next day needs the overnight rest (8 h by default): 06:40 + 8 h = 14:40.
    const rest = run([w('2026-10-23', { startTime: '09:00' })], only('dutyOverlap'), [d]);
    expect(ids(rest)).toEqual(['dutyRest']);
    expect(rest[0].params).toMatchObject({ until: '14:40', hours: 8 });
    expect(run([w('2026-10-23', { startTime: '14:40' })], only('dutyOverlap'), [d])).toHaveLength(0);
  });

  it('shows the day after a duty that spills past midnight as off, trainable after duty end + 8 h', () => {
    // Report 15:20, debrief 01:12 the next day.
    const d = duty('2026-10-21', 'dt-flight', { startTime: '15:20', endTime: '01:12' });
    expect(dutiesShownOn([d], '2026-10-21')).toHaveLength(1);
    expect(dutiesShownOn([d], '2026-10-22')).toHaveLength(0);
    expect(restAfterOvernight('2026-10-22', [d], types)).toMatchObject({ until: 9 * 60 + 12, endedAt: 72 });
    expect(restAfterOvernight('2026-10-23', [d], types)).toBeNull();
    expect(freeWindows(dutyBlocksOn('2026-10-22', [d], types, 60), 45)[0]).toEqual({ start: 9 * 60 + 12, end: 23 * 60 });
    expect(ids(run([w('2026-10-22', { startTime: '08:00' })], only('dutyOverlap'), [d]))).toEqual(['dutyRest']);
    expect(run([w('2026-10-22', { startTime: '09:30' })], only('dutyOverlap'), [d])).toHaveLength(0);
    // Without a start time it's only a reminder of when rest ends.
    const info = run([w('2026-10-22')], only('dutyOverlap'), [d]);
    expect(info.map((x) => [x.ruleId, x.severity])).toEqual([['dutyRest', 'info']]);
    // The rest period is configurable.
    const six = { ...only('dutyOverlap'), dutyOverlap: { enabled: true, bufferMin: 60, overnightRestMin: 360 } };
    expect(run([w('2026-10-22', { startTime: '08:00' })], six, [d])).toHaveLength(0);
  });

  it('keeps the normal buffer, not the rest, before a duty and after one ending the same day', () => {
    const d = duty('2026-10-22', 'dt-flight', { startTime: '05:30', endTime: '14:45' });
    expect(run([w('2026-10-22', { startTime: '15:45' })], only('dutyOverlap'), [d])).toHaveLength(0);
    expect(restAfterOvernight('2026-10-22', [d], types)).toBeNull();
  });

  it('never warns on duty types marked Training OK, such as standby', () => {
    const sby = duty('2026-10-26', 'dt-standby', { startTime: '08:00', endTime: '16:00', title: 'DM2' });
    expect(run([w('2026-10-26', { startTime: '10:00' })], only('dutyOverlap'), [sby])).toHaveLength(0);
    expect(run([w('2026-10-26')], only('dutyOverlap'), [sby])).toHaveLength(0);
  });

  it('flags a Limited duty without times with an info notice', () => {
    const res = run([w('2026-10-25')], only('dutyOverlap'), [duty('2026-10-25', 'dt-flight')]);
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
    const res = run([w('2026-10-20', { type: 'long' }), w('2026-10-25', { type: 'long' })], only('keySessionsPerWeek'));
    expect(ids(res)).toEqual(['longRunPerWeek']);
  });

  it('allows one interval, one tempo and one long run in the same week', () => {
    const ws = [w('2026-10-19', { type: 'interval' }), w('2026-10-21', { type: 'tempo' }), w('2026-10-24', { type: 'long' })];
    expect(run(ws, only('keySessionsPerWeek'))).toHaveLength(0);
  });

  it('warns on a second interval or tempo in a week, whatever the activity', () => {
    const res = run([w('2026-10-20', { type: 'interval' }), w('2026-10-23', { activity: 'cycle', type: 'interval' }), w('2026-10-21', { type: 'tempo' }), w('2026-10-24', { type: 'tempo' })], only('keySessionsPerWeek'));
    expect(ids(res).sort()).toEqual(['intervalPerWeek', 'tempoPerWeek']);
    expect(res.find((x) => x.ruleId === 'intervalPerWeek')?.params.count).toBe(2);
  });

  it('uses Sunday–Saturday weeks when the week starts on Sunday', () => {
    // Sat 24 Oct and Sun 25 Oct fall in different Sunday-first weeks.
    const ws = [w('2026-10-24', { type: 'interval' }), w('2026-10-25', { type: 'interval' })];
    const sundayWeeks = evaluatePlan({ workouts: ws, duties: [], dutyTypes: types, rules: only('keySessionsPerWeek'), from: '2026-10-18', to: '2026-10-31', weekStartsOn: 0 });
    expect(sundayWeeks).toHaveLength(0);
    // Monday-first, both are in the week of 19–25 Oct.
    expect(run(ws, only('keySessionsPerWeek'))).toHaveLength(1);
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

describe('flight-day free windows', () => {
  const flight = duty('2026-10-12', 'dt-flight', { startTime: '14:25', endTime: '22:49' });

  it('blocks the duty plus buffer and leaves the morning free', () => {
    const blocks = dutyBlocksOn('2026-10-12', [flight], types, 60);
    expect(blocks.map((b) => [b.start, b.end])).toEqual([[13 * 60 + 25, 23 * 60 + 49]]);
    expect(freeWindows(blocks, 45)).toEqual([{ start: 300, end: 13 * 60 + 25 }]);
    expect(clashingBlocks(blocks, 12 * 60 + 30, 45)).toHaveLength(0); // 12:30–13:15 fits
    expect(clashingBlocks(blocks, 12 * 60 + 45, 45)).toHaveLength(1); // runs into the buffer
  });

  it('clips an overnight duty to the morning of the next day', () => {
    const night = duty('2026-10-13', 'dt-flight', { startTime: '20:15', endTime: '00:31' });
    const blocks = dutyBlocksOn('2026-10-14', [night], types, 60);
    expect(blocks.map((b) => [b.start, b.end])).toEqual([[0, 31 + 8 * 60]]); // 8 h rest after 00:31
    expect(freeWindows(blocks, 60)[0]).toEqual({ start: 8 * 60 + 31, end: 23 * 60 });
  });

  it('ignores Training OK duties and blocks a whole No-training day without times', () => {
    expect(dutyBlocksOn('2026-10-26', [duty('2026-10-26', 'dt-standby', { startTime: '08:00', endTime: '16:00' })], types, 60)).toEqual([]);
    const sim = { ...types[0], id: 'dt-sim', code: 'SIM', allowsTraining: 'no' as const };
    const blocks = dutyBlocksOn('2026-10-27', [duty('2026-10-27', 'dt-sim')], [...types, sim], 60);
    expect(freeWindows(blocks, 30)).toEqual([]);
  });
});

describe('day availability', () => {
  const rule = { bufferMin: 60, overnightRestMin: 480 };
  it('grades days as free, partial, busy or unknown', () => {
    expect(dayAvailability('2026-10-20', [], types, rule).level).toBe('unknown');
    expect(dayAvailability('2026-10-20', [duty('2026-10-20', 'dt-off')], types, rule).level).toBe('free');
    expect(dayAvailability('2026-10-20', [duty('2026-10-20', 'dt-standby', { startTime: '08:00', endTime: '16:00' })], types, rule).level).toBe('free');
    const flight = dayAvailability('2026-10-21', [duty('2026-10-21', 'dt-flight', { startTime: '15:20', endTime: '01:12' })], types, rule);
    expect(flight).toEqual({ level: 'partial', windows: [{ start: 300, end: 14 * 60 + 20 }] });
    expect(dayAvailability('2026-10-21', [duty('2026-10-21', 'dt-flight', { startTime: '04:00', endTime: '22:30' })], types, rule).level).toBe('busy');
    expect(dayAvailability('2026-10-21', [duty('2026-10-21', 'dt-flight')], types, rule)).toEqual({ level: 'partial', windows: [] });
  });
  it('counts the rest after an overnight duty on the next day', () => {
    const night = duty('2026-10-21', 'dt-flight', { startTime: '15:20', endTime: '01:12' });
    const next = dayAvailability('2026-10-22', [night, duty('2026-10-22', 'dt-off')], types, rule);
    expect(next).toEqual({ level: 'partial', windows: [{ start: 9 * 60 + 12, end: 23 * 60 }] });
  });
});

describe('hard sessions near duty', () => {
  const early = duty('2026-10-22', 'dt-flight', { startTime: '05:30', endTime: '14:45' });
  it('warns when a hard session ends less than 10 h before an early report', () => {
    const res = run([w('2026-10-21', { type: 'interval', startTime: '19:00', durationMin: 60 })], only('hardNearDuty'), [early]);
    expect(ids(res)).toEqual(['hardBeforeDuty']);
    expect(res[0].params).toMatchObject({ report: '05:30', hours: 9.5, min: 10 });
  });
  it('is fine with enough gap, easy sessions, late reports and Training OK duties', () => {
    expect(run([w('2026-10-21', { type: 'interval', startTime: '18:00', durationMin: 60 })], only('hardNearDuty'), [early])).toHaveLength(0);
    expect(run([w('2026-10-21', { type: 'easy', startTime: '21:00' })], only('hardNearDuty'), [early])).toHaveLength(0);
    const late = duty('2026-10-22', 'dt-flight', { startTime: '15:20', endTime: '23:00' });
    expect(run([w('2026-10-22', { type: 'tempo', startTime: '07:00' })], only('hardNearDuty'), [late])).toHaveLength(0);
    const sby = duty('2026-10-22', 'dt-standby', { startTime: '05:00', endTime: '13:00' });
    expect(run([w('2026-10-21', { type: 'interval', startTime: '20:00' })], only('hardNearDuty'), [sby])).toHaveLength(0);
  });
  it('warns on a hard session the day after an overnight duty', () => {
    const night = duty('2026-10-21', 'dt-flight', { startTime: '15:20', endTime: '01:12' });
    expect(ids(run([w('2026-10-22', { type: 'long', startTime: '16:00', durationMin: 100 })], only('hardNearDuty'), [night]))).toEqual(['hardAfterOvernight']);
    expect(run([w('2026-10-22', { type: 'easy', startTime: '16:00' })], only('hardNearDuty'), [night])).toHaveLength(0);
  });
});
