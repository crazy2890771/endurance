/**
 * Deterministic training-plan validation.
 *
 * The engine only *reports* — it never changes, moves or deletes workouts.
 * Every warning carries a stable `key` so the user can acknowledge (override) it.
 */
import { addDaysISO, dateRange, toEpochMin, weekStart } from '@/lib/dates';
import { DEFAULT_RULES, isHardSession, isHighIntensity } from './catalog';
import type { Duty, DutyType, ISODate, RuleConfig, Workout } from './types';

export type RuleId =
  | 'consecutiveHard'
  | 'hardRecovery'
  | 'consecutiveRun'
  | 'weeklyRest'
  | 'dutyOverlap'
  | 'dutyNoTraining'
  | 'dutyLimited'
  | 'dutyRest'
  | 'runVolume'
  | 'longRunPerWeek'
  | 'intervalPerWeek'
  | 'tempoPerWeek';

export interface RuleWarning {
  key: string;
  ruleId: RuleId;
  severity: 'warning' | 'info';
  dates: ISODate[];
  workoutIds: string[];
  dutyIds?: string[];
  params: Record<string, string | number>;
}

export interface EvaluateInput {
  workouts: Workout[];
  duties: Duty[];
  dutyTypes: DutyType[];
  rules: RuleConfig;
  /** Inclusive range whose warnings should be returned. */
  from: ISODate;
  to: ISODate;
  weekStartsOn?: 0 | 1;
}

/** Epoch minutes → local "HH:mm". */
const fmtClock = (epochMin: number) => {
  const d = new Date(epochMin * 60000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Default time assumed for comparisons when a workout has no start time. */
const DEFAULT_START = '12:00';

const makeKey = (ruleId: RuleId, dates: ISODate[], ids: string[]) =>
  `${ruleId}|${[...dates].sort().join(',')}|${[...ids].sort().join(',')}`;

function warn(
  ruleId: RuleId,
  severity: RuleWarning['severity'],
  dates: ISODate[],
  workoutIds: string[],
  params: RuleWarning['params'] = {},
  dutyIds?: string[],
): RuleWarning {
  return { key: makeKey(ruleId, dates, [...workoutIds, ...(dutyIds ?? [])]), ruleId, severity, dates, workoutIds, dutyIds, params };
}

/** Workouts that count toward load: not deleted, not skipped, not explicit rest entries. */
export const countsAsTraining = (w: Workout) => !w.deleted && w.status !== 'skipped' && w.activity !== 'rest';

/** Distance actually run (completed) or planned (otherwise). */
export const effectiveDistanceKm = (w: Workout) =>
  w.status === 'completed' ? (w.result?.distanceKm ?? w.distanceKm ?? 0) : (w.distanceKm ?? 0);

/** Group consecutive dates into runs. Input must be sorted and unique. */
function consecutiveRuns(dates: ISODate[]): ISODate[][] {
  const runs: ISODate[][] = [];
  for (const d of dates) {
    const last = runs[runs.length - 1];
    if (last && addDaysISO(last[last.length - 1], 1) === d) last.push(d);
    else runs.push([d]);
  }
  return runs;
}

const overlapsRange = (dates: ISODate[], from: ISODate, to: ISODate) => dates.some((d) => d >= from && d <= to);

/** Effective end of a duty: explicit endDate, or the next day when the end time is before the start (overnight). */
export function dutyEndDate(d: Duty): ISODate {
  if (d.endDate) return d.endDate;
  if (d.startTime && d.endTime && d.endTime <= d.startTime) return addDaysISO(d.date, 1);
  return d.date;
}

/** Duty window in epoch minutes, or null when times are not known. */
export function dutyWindow(d: Duty): [number, number] | null {
  if (!d.startTime || !d.endTime) return null;
  return [toEpochMin(d.date, d.startTime), toEpochMin(dutyEndDate(d), d.endTime)];
}

export function dutiesOnDate(duties: Duty[], date: ISODate): Duty[] {
  return duties.filter((d) => !d.deleted && d.date <= date && dutyEndDate(d) >= date);
}

/** A timed duty that runs past midnight belongs to its start day; the next day isn't shown as that duty. */
const spillsInto = (d: Duty, date: ISODate) => d.date < date && !!d.startTime && !!d.endTime;

/** Duties to show on a calendar day: those starting that day, plus untimed multi-day ones such as leave. */
export const dutiesShownOn = (duties: Duty[], date: ISODate) => dutiesOnDate(duties, date).filter((d) => !spillsInto(d, date));

export const DEFAULT_OVERNIGHT_REST_MIN = 8 * 60;

/** Time kept clear after a duty: the rest period if it ended past midnight, else the normal buffer. */
export const afterDutyMin = (d: Duty, bufferMin: number, overnightRestMin = DEFAULT_OVERNIGHT_REST_MIN) =>
  dutyEndDate(d) > d.date ? overnightRestMin : bufferMin;

/**
 * On the day after an overnight duty that restricts training: the minute of `date` from which
 * training is fine again (duty end + overnight rest), with the duty. Null when nothing applies.
 */
export function restAfterOvernight(date: ISODate, duties: Duty[], dutyTypes: DutyType[], overnightRestMin = DEFAULT_OVERNIGHT_REST_MIN) {
  const day0 = toEpochMin(date, '00:00');
  let best: { until: number; endedAt: number; duty: Duty } | null = null;
  for (const d of dutiesOnDate(duties, date)) {
    if (!spillsInto(d, date)) continue;
    const type = dutyTypes.find((t) => t.id === d.dutyTypeId);
    if (!type || type.allowsTraining === 'yes') continue;
    const win = dutyWindow(d);
    if (!win) continue;
    const endedAt = win[1] - day0;
    const until = endedAt + overnightRestMin;
    if (until > 0 && (!best || until > best.until)) best = { until: Math.min(until, 1440), endedAt: Math.max(endedAt, 0), duty: d };
  }
  return best;
}

/** A busy stretch of one day, in minutes from 00:00 (buffer included, clipped to the day). */
export interface DutyBlock {
  start: number;
  end: number;
  duty: Duty;
}

/**
 * Busy blocks on `date` from duties that restrict training. "Training OK" types never block;
 * a "No training" duty without times blocks the whole day; a "Limited" one without times can't be placed.
 */
export function dutyBlocksOn(date: ISODate, duties: Duty[], dutyTypes: DutyType[], bufferMin: number, overnightRestMin = DEFAULT_OVERNIGHT_REST_MIN): DutyBlock[] {
  const day0 = toEpochMin(date, '00:00');
  return dutiesOnDate(duties, date).flatMap((d) => {
    const type = dutyTypes.find((t) => t.id === d.dutyTypeId);
    if (!type || type.allowsTraining === 'yes') return [];
    const win = dutyWindow(d);
    if (!win) return type.allowsTraining === 'no' ? [{ start: 0, end: 1440, duty: d }] : [];
    const start = Math.max(0, win[0] - bufferMin - day0);
    const end = Math.min(1440, win[1] + afterDutyMin(d, bufferMin, overnightRestMin) - day0);
    return end > start ? [{ start, end, duty: d }] : [];
  });
}

/** Blocks that a workout starting at `startMin` for `durationMin` would run into. */
export const clashingBlocks = (blocks: DutyBlock[], startMin: number, durationMin: number) =>
  blocks.filter((b) => startMin < b.end && startMin + durationMin > b.start);

/** Gaps of at least `minLen` minutes between busy blocks, within sensible training hours (default 05:00–23:00). */
export function freeWindows(blocks: DutyBlock[], minLen: number, from = 5 * 60, to = 23 * 60): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let cursor = from;
  for (const b of [...blocks].sort((a, c) => a.start - c.start)) {
    if (b.start - cursor >= minLen) out.push({ start: cursor, end: Math.min(b.start, to) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (to - cursor >= minLen) out.push({ start: cursor, end: to });
  return out.filter((w) => w.end - w.start >= minLen);
}

export function evaluatePlan(input: EvaluateInput): RuleWarning[] {
  const { from, to } = input;
  // Fill in rules added after the user's settings were saved.
  const rules: RuleConfig = { ...DEFAULT_RULES, ...input.rules };
  const wso = input.weekStartsOn ?? 1;
  // Look back far enough to see streaks and the previous week's volume.
  const lookFrom = addDaysISO(weekStart(from, wso), -14);
  const lookTo = addDaysISO(to, 7);
  const workouts = input.workouts
    .filter(countsAsTraining)
    .filter((w) => w.date >= lookFrom && w.date <= lookTo)
    .sort((a, b) => (a.date + (a.startTime ?? DEFAULT_START)).localeCompare(b.date + (b.startTime ?? DEFAULT_START)));
  const typeById = new Map(input.dutyTypes.map((t) => [t.id, t]));
  const out: RuleWarning[] = [];

  const byDate = new Map<ISODate, Workout[]>();
  for (const w of workouts) byDate.set(w.date, [...(byDate.get(w.date) ?? []), w]);
  const idsOn = (dates: ISODate[], pred: (w: Workout) => boolean) =>
    dates.flatMap((d) => (byDate.get(d) ?? []).filter(pred).map((w) => w.id));

  // 1. Consecutive hard days
  const coveredPairs = new Set<string>();
  if (rules.consecutiveHard.enabled) {
    const hardDates = [...byDate.keys()].filter((d) => byDate.get(d)!.some(isHardSession)).sort();
    for (const run of consecutiveRuns(hardDates)) {
      if (run.length > rules.consecutiveHard.maxDays && overlapsRange(run, from, to)) {
        out.push(warn('consecutiveHard', 'warning', run, idsOn(run, isHardSession), { days: run.length, max: rules.consecutiveHard.maxDays }));
        for (let i = 1; i < run.length; i++) coveredPairs.add(`${run[i - 1]}|${run[i]}`);
      }
    }
  }

  // 2. Recovery between high-intensity sessions
  if (rules.hardRecovery.enabled) {
    const hi = workouts.filter(isHighIntensity);
    for (let i = 1; i < hi.length; i++) {
      const a = hi[i - 1];
      const b = hi[i];
      if (b.date < from || b.date > to) continue;
      const aEnd = toEpochMin(a.date, a.startTime ?? DEFAULT_START) + a.durationMin;
      const bStart = toEpochMin(b.date, b.startTime ?? DEFAULT_START);
      const gapH = Math.max(0, (bStart - aEnd) / 60);
      if (gapH >= rules.hardRecovery.minHours) continue;
      if (coveredPairs.has(`${a.date}|${b.date}`)) continue;
      out.push(warn('hardRecovery', 'warning', [a.date, b.date], [a.id, b.id], { hours: Math.round(gapH), min: rules.hardRecovery.minHours }));
    }
  }

  // 3. Consecutive running days
  if (rules.consecutiveRun.enabled) {
    const isRun = (w: Workout) => w.activity === 'run';
    const runDates = [...byDate.keys()].filter((d) => byDate.get(d)!.some(isRun)).sort();
    for (const run of consecutiveRuns(runDates)) {
      if (run.length > rules.consecutiveRun.maxDays && overlapsRange(run, from, to)) {
        out.push(warn('consecutiveRun', 'warning', run, idsOn(run, isRun), { days: run.length, max: rules.consecutiveRun.maxDays }));
      }
    }
  }

  // Weekly rules operate on every week that intersects the requested range.
  const weeks: ISODate[] = [];
  for (let ws = weekStart(from, wso); ws <= to; ws = addDaysISO(ws, 7)) weeks.push(ws);

  // 4. Weekly rest
  if (rules.weeklyRest.enabled) {
    for (const ws of weeks) {
      const days = dateRange(ws, addDaysISO(ws, 6));
      const trainingDays = days.filter((d) => (byDate.get(d) ?? []).length > 0);
      if (trainingDays.length === 0) continue;
      const restDays = 7 - trainingDays.length;
      if (restDays < rules.weeklyRest.minDays) {
        out.push(warn('weeklyRest', 'warning', [ws], [], { rest: restDays, min: rules.weeklyRest.minDays }));
      }
    }
  }

  // 5. Duty conflicts
  if (rules.dutyOverlap.enabled) {
    const buffer = rules.dutyOverlap.bufferMin;
    for (const w of workouts) {
      if (w.date < from || w.date > to || w.status === 'completed') continue;
      for (const d of dutiesOnDate(input.duties, w.date)) {
        const type = typeById.get(d.dutyTypeId);
        // "Training OK" duty types (e.g. standby, where call-outs are rare) never raise conflicts.
        if (type?.allowsTraining === 'yes') continue;
        const label = type?.code ?? '?';
        const win = dutyWindow(d);
        if (win && w.startTime) {
          const ws = toEpochMin(w.date, w.startTime);
          const we = ws + w.durationMin;
          const after = afterDutyMin(d, buffer, rules.dutyOverlap.overnightRestMin);
          if (ws < win[1] + after && we > win[0] - buffer) {
            const inRest = ws >= win[1] && dutyEndDate(d) > d.date;
            out.push(
              inRest
                ? warn('dutyRest', 'warning', [w.date], [w.id], { duty: label, end: d.endTime!, hours: Math.round(after / 6) / 10, until: fmtClock(win[1] + after) }, [d.id])
                : warn('dutyOverlap', 'warning', [w.date], [w.id], { duty: label, start: d.startTime!, end: d.endTime!, buffer }, [d.id]),
            );
          }
          continue;
        }
        if (win && spillsInto(d, w.date)) {
          // The day after an overnight duty is a day off once the rest period is over.
          const after = afterDutyMin(d, buffer, rules.dutyOverlap.overnightRestMin);
          if (win[1] + after > toEpochMin(w.date, '00:00')) {
            out.push(warn('dutyRest', 'info', [w.date], [w.id], { duty: label, end: d.endTime!, hours: Math.round(after / 6) / 10, until: fmtClock(win[1] + after) }, [d.id]));
          }
          continue;
        }
        if (type?.allowsTraining === 'no') {
          out.push(warn('dutyNoTraining', 'warning', [w.date], [w.id], { duty: label }, [d.id]));
        } else if (type?.allowsTraining === 'limited') {
          out.push(warn('dutyLimited', 'info', [w.date], [w.id], { duty: label, times: d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : '—' }, [d.id]));
        }
      }
    }
  }

  // 6. Weekly running-volume increase
  if (rules.runVolume.enabled) {
    const runKm = (ws: ISODate) =>
      workouts
        .filter((w) => w.activity === 'run' && w.date >= ws && w.date <= addDaysISO(ws, 6))
        .reduce((s, w) => s + effectiveDistanceKm(w), 0);
    for (const ws of weeks) {
      const prev = runKm(addDaysISO(ws, -7));
      const cur = runKm(ws);
      if (prev < rules.runVolume.minBaseKm) continue;
      const pct = ((cur - prev) / prev) * 100;
      if (pct > rules.runVolume.maxIncreasePct) {
        out.push(warn('runVolume', 'warning', [ws], [], {
          prev: Math.round(prev * 10) / 10,
          cur: Math.round(cur * 10) / 10,
          pct: Math.round(pct),
          max: rules.runVolume.maxIncreasePct,
        }));
      }
    }
  }

  // 7. Key sessions per week: long runs, intervals and tempo sessions, each limited on its own.
  if (rules.keySessionsPerWeek.enabled) {
    const max = rules.keySessionsPerWeek.max;
    const kinds: [RuleId, (w: Workout) => boolean][] = [
      ['longRunPerWeek', (w) => w.activity === 'run' && w.type === 'long'],
      ['intervalPerWeek', (w) => w.type === 'interval'],
      ['tempoPerWeek', (w) => w.type === 'tempo'],
    ];
    for (const ws of weeks) {
      const inWeek = workouts.filter((w) => w.date >= ws && w.date <= addDaysISO(ws, 6));
      for (const [id, is] of kinds) {
        const hits = inWeek.filter(is);
        if (hits.length > max) out.push(warn(id, 'warning', hits.map((w) => w.date), hits.map((w) => w.id), { count: hits.length, max }));
      }
    }
  }

  return out;
}
