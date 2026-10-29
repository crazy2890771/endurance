import { useEffect } from 'react';
import { workoutName } from '@/components/cards';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import type { ISODate } from '@/domain/types';
import { addDaysISO, dateRange, todayISO } from '@/lib/dates';
import { buildDigest, buildFreeDigest, storeDigests, syncPush, type Digest } from '@/lib/notify';
import { dayAvailability } from '@/domain/rules';
import { useI18n } from '@/i18n';

const AHEAD_DAYS = 30;

/**
 * While notifications are on, keeps the phone's notification texts and the server's list of
 * planned dates in step with the plan. Renders nothing.
 */
export function NotifySync() {
  const settings = useSettingsOrDefault();
  const { t } = useI18n();
  const today = todayISO();
  const end = addDaysISO(today, AHEAD_DAYS);
  const workouts = useWorkouts(today, end);
  const duties = useDuties(today, end);
  const types = useDutyTypes();
  const on = !!settings.notify?.enabled;
  const time = settings.notify?.time;
  const freeDays = !!settings.notify?.freeDays;

  useEffect(() => {
    if (!on || !time || !workouts || !duties || !types) return;
    const digests: Record<ISODate, Digest> = { fallback: { title: 'Ground Time', body: t('notify.nothingToday') } };
    for (const d of dateRange(today, end)) {
      const g =
        buildDigest(d, workouts, duties, types, t, (w) => workoutName(t, w)) ??
        (freeDays ? buildFreeDigest(dayAvailability(d, duties, types, settings.rules.dutyOverlap), t) : null);
      if (g) digests[d] = g;
    }
    const days = Object.keys(digests).filter((k) => k !== 'fallback');
    // Debounced: a burst of edits sends one update.
    const timer = setTimeout(() => {
      void storeDigests(digests).catch(() => undefined);
      void syncPush(time, days).catch(() => undefined);
    }, 1500);
    return () => clearTimeout(timer);
  }, [on, time, freeDays, workouts, duties, types, today, end, t, settings.rules.dutyOverlap]);

  return null;
}
