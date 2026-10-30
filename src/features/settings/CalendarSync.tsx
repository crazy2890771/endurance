import { useEffect } from 'react';
import { workoutName } from '@/components/cards';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import { updateSettings } from '@/db/repo';
import { addDaysISO, todayISO } from '@/lib/dates';
import { calendarEvents, uploadCalendar } from '@/lib/calendar';
import { useI18n } from '@/i18n';

/** While the iPhone Calendar link is on, keeps it in step with the roster and plan. Renders nothing. */
export function CalendarSync() {
  const settings = useSettingsOrDefault();
  const { t } = useI18n();
  const today = todayISO();
  const from = addDaysISO(today, -30);
  const to = addDaysISO(today, 120);
  const workouts = useWorkouts(from, to);
  const duties = useDuties(from, to);
  const types = useDutyTypes();
  const token = settings.calendar?.token;

  useEffect(() => {
    if (!token || !workouts || !duties || !types) return;
    const events = calendarEvents(workouts, duties.filter((d) => (d.endDate ?? d.date) >= from), types, {
      name: (w) => workoutName(t, w),
      zone: (z) => t('common.zone', { z }),
    });
    // Debounced: a burst of edits (or a roster import) uploads once.
    const timer = setTimeout(() => {
      void uploadCalendar(token, t('cal.name'), events)
        .then(() => updateSettings((s) => ({ calendar: s.calendar && { ...s.calendar, lastSyncAt: new Date().toISOString() } })))
        .catch(() => undefined);
    }, 2000);
    return () => clearTimeout(timer);
  }, [token, workouts, duties, types, from, t]);

  return null;
}
