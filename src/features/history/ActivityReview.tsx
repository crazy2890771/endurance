import { useNavigate } from 'react-router-dom';
import { useUI } from '@/app/ui';
import { ActivityBadge } from '@/components/icons';
import { workoutName } from '@/components/cards';
import { useSettingsOrDefault } from '@/db/hooks';
import { db } from '@/db/db';
import { deleteWorkout, importStravaResults, reopenWorkout } from '@/db/repo';
import { addDaysISO, fromISODate, todayISO } from '@/lib/dates';
import { formatDistance, formatDuration } from '@/lib/format';
import { DEFAULT_TYPE, matchActivities, stravaResult, type StravaActivity, type StravaMatch } from '@/lib/strava';
import { useI18n } from '@/i18n';

export type ReviewRow = StravaMatch & { include: boolean };

/** Matches activities (from Strava or .FIT files) against the plan; drops ones already imported or not tracked. */
export async function reviewRows(activities: StravaActivity[]): Promise<ReviewRow[]> {
  const dates = activities.map((a) => a.startLocal.slice(0, 10)).sort();
  const from = dates[0] ?? todayISO();
  const workouts = await db.workouts.where('date').between(addDaysISO(from, -1), addDaysISO(dates.at(-1) ?? from, 1), true, true).toArray();
  // Imported-before check needs every workout with a source id, not just this date range.
  const imported = await db.workouts.filter((w) => !w.deleted && !!w.result?.stravaId).toArray();
  return matchActivities(activities, [...workouts, ...imported.filter((w) => !workouts.some((x) => x.id === w.id))])
    .filter((m) => m.kind && !m.imported)
    // Very short entries (warm-ups, a stopped watch) start unticked.
    .map((m) => ({ ...m, include: m.activity.movingSec >= 300 }));
}

/** Review list with a sticky save bar: matched activities complete their planned workout, the rest are added. */
export function ActivityReview({ rows, setRows }: { rows: ReviewRow[]; setRows: (r: ReviewRow[] | null) => void }) {
  const { t, fmt } = useI18n();
  const { toast } = useUI();
  const nav = useNavigate();
  const settings = useSettingsOrDefault();
  const selected = rows.filter((r) => r.include).length;

  const save = async () => {
    const res = await importStravaResults(
      rows
        .filter((r) => r.include)
        .map((r) => ({
          workoutId: r.workout?.id,
          date: r.activity.startLocal.slice(0, 10),
          startTime: r.activity.startLocal.slice(11, 16),
          activity: r.kind!,
          type: DEFAULT_TYPE[r.kind!],
          result: stravaResult(r.activity),
        })),
    );
    setRows(null);
    toast(t('strava.saved', { n: res.completed.length + res.created.length }), {
      action: { label: t('common.undo'), run: () => void Promise.all([...res.completed.map(reopenWorkout), ...res.created.map(deleteWorkout)]) },
    });
    nav('/history');
  };

  return (
    <div className="animate-rise">
      <h2 className="text-lg font-bold">{t('strava.review')}</h2>
      <p className="text-sm text-muted mb-3">{t('strava.reviewHint')}</p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          const res = stravaResult(r.activity);
          return (
            <label key={r.activity.id} className={`card p-3 flex items-start gap-3 cursor-pointer ${r.include ? '' : 'opacity-60'}`}>
              <input
                type="checkbox"
                className="w-6 h-6 mt-1 accent-[rgb(var(--mint))]"
                checked={r.include}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
              />
              <ActivityBadge activity={r.kind!} />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold truncate">{r.activity.name}</span>
                <span className="block text-xs text-muted tabular-nums">
                  {fmt(fromISODate(r.activity.startLocal.slice(0, 10)), 'EEE d MMM')} {r.activity.startLocal.slice(11, 16)} · {formatDuration(res.durationMin ?? 0)}
                  {res.distanceKm ? ` · ${formatDistance(res.distanceKm, r.kind!, settings.units)}` : ''}
                  {res.avgHr ? ` · ${res.avgHr} bpm` : ''}
                </span>
                <span className={`block text-xs mt-1 font-semibold ${r.workout ? 'text-mint' : 'text-sky'}`}>
                  {r.workout ? t('strava.completes', { name: workoutName(t, r.workout) }) : t('strava.addsNew')}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] px-4 pb-3 pt-2 bg-gradient-to-t from-bg via-bg to-transparent z-30">
        <button className="btn-primary w-full max-w-lg mx-auto flex" disabled={!selected} onClick={save}>
          {t('strava.save', { n: selected })}
        </button>
      </div>
    </div>
  );
}
