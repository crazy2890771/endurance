import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, Clock, MapPin, Plane, Plus, ShieldCheck } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Logo } from '@/components/Logo';
import { SectionTitle } from '@/components/ui';
import { DutyBadge, WorkoutCard, dutyLabel, workoutName } from '@/components/cards';
import { ActivityBadge } from '@/components/icons';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import { dayAvailability, dutiesShownOn, effectiveDistanceKm, restAfterOvernight } from '@/domain/rules';
import { addDaysISO, formatMin, fromISODate, todayISO, weekDays } from '@/lib/dates';
import { formatDistance, formatDuration, formatKm } from '@/lib/format';
import { useI18n } from '@/i18n';
import { versionLabel } from '@/lib/version';
import { usePlanWarnings } from '@/features/plancheck/usePlanWarnings';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { CareCards } from './CareCards';

export function HomePage() {
  const today = todayISO();
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const { open } = useUI();
  const week = weekDays(today, settings.weekStartsOn);
  const workouts = useWorkouts(week[0], addDaysISO(today, 7) > week[6] ? addDaysISO(today, 7) : week[6]);
  const duties = useDuties(week[0], addDaysISO(today, 7) > week[6] ? addDaysISO(today, 7) : week[6]);
  const dutyTypes = useDutyTypes();
  const warnings = usePlanWarnings(week[0], week[6], settings);
  const typeById = new Map((dutyTypes ?? []).map((d) => [d.id, d]));

  const todays = (workouts ?? []).filter((w) => w.date === today);
  const main = todays.find((w) => w.status === 'planned') ?? todays[0];
  const todayDuties = dutiesShownOn(duties ?? [], today);
  const rest = restAfterOvernight(today, duties ?? [], dutyTypes ?? [], settings.rules.dutyOverlap.overnightRestMin);
  const weekW = (workouts ?? []).filter((w) => w.date >= week[0] && w.date <= week[6] && w.activity !== 'rest');
  const done = weekW.filter((w) => w.status === 'completed');
  const total = weekW.filter((w) => w.status !== 'skipped').length;
  const sumKm = (a: string) => weekW.filter((w) => w.activity === a && w.status !== 'skipped').reduce((s, w) => s + effectiveDistanceKm(w), 0);
  const doneKm = (a: string) => done.filter((w) => w.activity === a).reduce((s, w) => s + effectiveDistanceKm(w), 0);
  const upcoming = (workouts ?? []).filter((w) => w.date > today && w.date <= addDaysISO(today, 7) && w.status === 'planned').slice(0, 5);
  const issues = warnings?.active.length ?? 0;
  const goals = settings.goals;
  // Remind to upload next month's roster when the stored one ends within a week.
  const rosterEnd = useLiveQuery(async () => {
    const last = await db.duties.orderBy('date').reverse().filter((d) => !d.deleted).first();
    return last ? (last.endDate ?? last.date) : null;
  }, []);
  const rosterEnding = !!rosterEnd && rosterEnd < addDaysISO(today, 7);
  // Free training time this week (05:00–23:00 outside duty), against what's planned and done.
  const freeMin = week.reduce((s, d) => {
    const a = dayAvailability(d, duties ?? [], dutyTypes ?? [], settings.rules.dutyOverlap);
    return s + (a.level === 'free' ? 18 * 60 : a.windows.reduce((m, w) => m + w.end - w.start, 0));
  }, 0);
  const rostered = week.some((d) => dayAvailability(d, duties ?? [], dutyTypes ?? [], settings.rules.dutyOverlap).level !== 'unknown');
  const plannedMin = weekW.filter((w) => w.status !== 'skipped').reduce((s, w) => s + w.durationMin, 0);
  const doneMin = done.reduce((s, w) => s + (w.result?.durationMin ?? w.durationMin), 0);

  return (
    <div className="px-4 pb-28">
      <header className="pt-safe flex items-center gap-3 min-h-[64px]">
        <Logo className="w-9 h-9 text-ink" />
        <span className="flex-1 font-extrabold tracking-wide text-sm">{t('app.name')}</span>
        <Link to="/plan-check" className="icon-btn relative" aria-label={t('planner.planCheck')}>
          <ClipboardCheck size={22} />
          {issues > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-warn" />}
        </Link>
      </header>

      <p className="text-muted text-sm mt-1">{fmt(fromISODate(today), 'EEEE d MMMM yyyy')}</p>

      {rosterEnding && (
        <Link to="/settings/import" className="card mt-3 px-4 py-3 flex items-center gap-3 border-warn/40 bg-warn/5">
          <CalendarClock size={20} className="text-warn shrink-0" />
          <span className="text-sm flex-1">
            {rosterEnd! < today ? t('home.rosterEnded') : t('home.rosterEnds', { date: fmt(fromISODate(rosterEnd!), 'd MMM') })}
          </span>
          <span className="text-sm text-sky font-semibold shrink-0">{t('home.rosterUpload')}</span>
        </Link>
      )}

      {/* Duty */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-muted mr-1">{t('home.todayDuty')}</span>
        {rest && <span className="chip min-h-[28px] px-2 text-xs bg-sky/10 text-sky">{t('planner.trainAfter', { time: formatMin(rest.until) })}</span>}
        {todayDuties.length ? (
          todayDuties.map((d) => (
            <button key={d.id} className="flex items-center gap-2" onClick={() => open({ kind: 'dutyEditor', id: d.id })}>
              <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} />
              <span className="text-sm text-muted">
                {d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : dutyLabel(typeById.get(d.dutyTypeId))}
                {d.title ? ` · ${d.title}` : ''}
              </span>
            </button>
          ))
        ) : rest ? null : (
          <button className="inline-flex items-center gap-1 text-xs text-muted rounded-lg border border-dashed border-line px-2 h-7" onClick={() => open({ kind: 'dutyEditor', date: today })}>
            <Plane size={12} /> {t('home.noDuty')}
          </button>
        )}
      </div>

      {/* Today's workout */}
      <section className="card p-4 mt-4 animate-rise" aria-label={t('home.todayWorkout')}>
        {main ? (
          <>
            <button className="w-full text-left flex items-center gap-4" onClick={() => open({ kind: 'workoutDetail', id: main.id })}>
              <ActivityBadge activity={main.activity} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="text-2xl font-bold leading-tight">{workoutName(t, main)}</p>
                <p className="text-muted mt-1 flex flex-wrap gap-x-3 text-sm">
                  {main.startTime && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={13} />
                      {main.startTime}
                    </span>
                  )}
                  {main.durationMin > 0 && <span>{formatDuration(main.durationMin)}</span>}
                  {main.distanceKm && <span>{formatDistance(main.distanceKm, main.activity, settings.units)}</span>}
                  {main.hrZone && <span>{t('common.zone', { z: main.hrZone })}</span>}
                </p>
                {main.location && (
                  <p className="text-muted text-sm flex items-center gap-1 mt-0.5">
                    <MapPin size={13} /> {t(`loc.${main.location}`)}
                  </p>
                )}
              </div>
            </button>
            {main.status === 'planned' && main.activity !== 'rest' && (
              <button className="btn-primary w-full mt-4" onClick={() => open({ kind: 'complete', id: main.id })}>
                <CheckCircle2 size={20} /> {t('home.complete')}
              </button>
            )}
            {main.status === 'completed' && (
              <p className="mt-4 flex items-center justify-center gap-2 text-mint font-semibold min-h-[48px] rounded-2xl bg-mint/10">
                <CheckCircle2 size={20} /> {t('status.completed')}
              </p>
            )}
            {todays.length > 1 && (
              <div className="mt-3 flex flex-col gap-2">
                {todays
                  .filter((w) => w.id !== main.id)
                  .map((w) => (
                    <WorkoutCard key={w.id} w={w} units={settings.units} compact onClick={() => open({ kind: 'workoutDetail', id: w.id })} />
                  ))}
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-4">
            <p className="font-semibold">{t('home.noWorkout')}</p>
            <p className="text-sm text-muted mt-1">{t('home.noWorkoutHint')}</p>
            <button className="btn-ghost mt-4" onClick={() => open({ kind: 'workoutEditor', date: today })}>
              <Plus size={18} /> {t('planner.addWorkout')}
            </button>
          </div>
        )}
      </section>

      {/* Plan check */}
      <Link to="/plan-check" className={`mt-3 card px-4 py-3 flex items-center gap-3 ${issues ? 'border-warn/40' : ''}`}>
        {issues ? <AlertTriangle size={20} className="text-warn" /> : <ShieldCheck size={20} className="text-mint" />}
        <span className="text-sm font-medium flex-1">{issues ? t('home.warnings', { n: issues }) : t('home.planOk')}</span>
      </Link>

      {/* Week summary */}
      <SectionTitle right={<span className="text-sm text-muted">{t('home.completedOf', { done: done.length, total })}</span>}>{t('home.thisWeek')}</SectionTitle>
      <div className="h-2 rounded-full bg-card2 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done.length}>
        <div className="h-full bg-mint rounded-full transition-all" style={{ width: `${total ? (done.length / total) * 100 : 0}%` }} />
      </div>
      <div className="card p-4 mt-3 flex flex-col gap-3">
        {goals?.runKm ? <GoalRow label={t('home.goalRun')} done={doneKm('run')} goal={goals.runKm} text={`${formatKm(doneKm('run'), settings.units)} / ${formatKm(goals.runKm, settings.units)}`} /> : null}
        {goals?.hours ? <GoalRow label={t('home.goalHours')} done={doneMin} goal={goals.hours * 60} text={`${formatDuration(doneMin)} / ${formatDuration(goals.hours * 60)}`} /> : null}
        {rostered && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{t('home.freeTime')}</span>
            <span className="font-bold text-mint tabular-nums">{formatDuration(freeMin)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{t('home.trainingTime')}</span>
          <span className="font-bold tabular-nums">
            {formatDuration(doneMin)} <span className="text-muted font-normal">/ {formatDuration(plannedMin)}</span>
          </span>
        </div>
        {sumKm('run') > 0 && !goals?.runKm && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{t('home.running')}</span>
            <span className="font-bold tabular-nums">
              {formatKm(doneKm('run'), settings.units)} <span className="text-muted font-normal">/ {formatKm(sumKm('run'), settings.units)}</span>
            </span>
          </div>
        )}
      </div>

      {/* Upcoming */}
      <SectionTitle right={<Link to="/planner" className="text-sm text-sky font-semibold">{t('nav.planner')}</Link>}>{t('home.upcoming')}</SectionTitle>
      {upcoming.length ? (
        <div className="flex flex-col gap-2">
          {upcoming.map((w) => {
            const d = dutiesShownOn(duties ?? [], w.date)[0];
            return (
              <div key={w.id} className="flex items-center gap-3">
                <div className="w-12 text-center shrink-0">
                  <p className="text-[11px] text-muted">{fmt(fromISODate(w.date), 'EEE')}</p>
                  <p className="font-bold">{fmt(fromISODate(w.date), 'd')}</p>
                  {d && <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} size="sm" />}
                </div>
                <div className="flex-1 min-w-0">
                  <WorkoutCard w={w} units={settings.units} compact onClick={() => open({ kind: 'workoutDetail', id: w.id })} />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted card p-4">{t('home.noUpcoming')}</p>
      )}

      <CareCards settings={settings} />

      <button className="btn-sky w-full mt-6" onClick={() => open({ kind: 'workoutEditor', date: today })}>
        <Plus size={20} /> {t('home.quickAdd')}
      </button>

      <Link to="/settings" className="block text-center text-[11px] text-muted tabular-nums mt-6 py-2">
        {versionLabel()}
      </Link>
    </div>
  );
}

function GoalRow({ label, done, goal, text }: { label: string; done: number; goal: number; text: string }) {
  const pct = Math.min(100, goal ? (done / goal) * 100 : 0);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted">{label}</span>
        <span className={`font-bold tabular-nums ${pct >= 100 ? 'text-mint' : ''}`}>{text}</span>
      </div>
      <div className="h-1.5 mt-1.5 rounded-full bg-card2 overflow-hidden" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.round(done)}>
        <div className="h-full bg-mint rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
