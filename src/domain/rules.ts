/**
 * Deterministic training-plan validation.
 *
 * The engine only *reports* — it never changes, moves or deletes workouts.
 * Every warning carries a stable `key` so the user can acknowledge (override) it.
 */
import { addDaysISO, dateRange, toEpochMin, weekStart } from '@/lib/dates';
import { isHardSession, isHighIntensity } from './catalog';
import type { Duty, DutyType, ISODate, RuleConfig, Workout } from './types';

export type RuleId =
  | 'consecutiveHard'
  | 'hardRecovery'
  | 'consecutiveRun'
  | 'weeklyRest'
  | 'dutyOverlap'
  | 'dutyNoTraining'
  | 'dutyLimited'
  | 'runVolume'
  | 'longRunPerWeek';

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

export function evaluatePlan(input: EvaluateInput): RuleWarning[] {
  const { rules, from, to } = input;
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
        const label = type?.code ?? '?';
        const win = dutyWindow(d);
        if (win && w.startTime) {
          const ws = toEpochMin(w.date, w.startTime);
          const we = ws + w.durationMin;
          if (ws < win[1] + buffer && we > win[0] - buffer) {
            out.push(warn('dutyOverlap', 'warning', [w.date], [w.id], { duty: label, start: d.startTime!, end: d.endTime!, buffer }, [d.id]));
          }
          continue;
        }
        if (type?.allowsTraining === 'no') {
          out.push(warn('dutyNoTraining', 'warning', [w.date], [w.id], { duty: label }, [d.id]));
        } else if (type?.allowsTraining === 'limited') {
          out.push(warn('dutyLimited', 'info', [w.date], [w.id], { duty: label }, [d.id]));
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

  // 7. Long runs per week
  if (rules.longRunPerWeek.enabled) {
    for (const ws of weeks) {
      const longs = workouts.filter((w) => w.activity === 'run' && w.type === 'long' && w.date >= ws && w.date <= addDaysISO(ws, 6));
      if (longs.length > rules.longRunPerWeek.max) {
        out.push(warn('longRunPerWeek', 'warning', longs.map((w) => w.date), longs.map((w) => w.id), { count: longs.length, max: rules.longRunPerWeek.max }));
      }
    }
  }

  return out;
}
