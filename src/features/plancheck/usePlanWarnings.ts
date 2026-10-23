import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { evaluatePlan, type RuleWarning } from '@/domain/rules';
import type { AppSettings, ISODate } from '@/domain/types';
import { addDaysISO } from '@/lib/dates';
import type { TFn } from '@/i18n';

export interface PlanWarnings {
  active: RuleWarning[];
  overridden: RuleWarning[];
  all: RuleWarning[];
}

/** Evaluate the training rules for a date range, split into active vs overridden warnings. */
export function usePlanWarnings(from: ISODate, to: ISODate, settings: AppSettings | undefined): PlanWarnings | undefined {
  return useLiveQuery(async () => {
    if (!settings) return undefined;
    const [workouts, duties, dutyTypes, overrides] = await Promise.all([
      db.workouts.where('date').between(addDaysISO(from, -35), addDaysISO(to, 7), true, true).toArray(),
      db.duties.where('date').between(addDaysISO(from, -7), addDaysISO(to, 1), true, true).toArray(),
      db.dutyTypes.toArray(),
      db.overrides.toArray(),
    ]);
    const all = evaluatePlan({ workouts, duties, dutyTypes, rules: settings.rules, from, to, weekStartsOn: settings.weekStartsOn });
    const keys = new Set(overrides.map((o) => o.key));
    return { all, active: all.filter((w) => !keys.has(w.key)), overridden: all.filter((w) => keys.has(w.key)) };
  }, [from, to, settings?.rules, settings?.weekStartsOn]);
}

export const warningTitle = (t: TFn, w: RuleWarning) => t(`warn.${w.ruleId}` as Parameters<TFn>[0], w.params);
export const warningWhy = (t: TFn, w: RuleWarning) => t(`warn.${w.ruleId}.why` as Parameters<TFn>[0], w.params);
