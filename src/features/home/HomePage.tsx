import { Link } from 'react-router-dom';
import { AlertTriangle, Bell, CheckCircle2, Clock, MapPin, Plane, Plus, ShieldCheck } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Logo } from '@/components/Logo';
import { SectionTitle } from '@/components/ui';
import { DutyBadge, WorkoutCard, workoutName } from '@/components/cards';
import { ACTIVITY_BG, ACTIVITY_ICON, ACTIVITY_TEXT, ActivityBadge } from '@/components/icons';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import { TRAINING_ACTIVITIES } from '@/domain/catalog';
import { dutiesOnDate, effectiveDistanceKm } from '@/domain/rules';
import { addDaysISO, fromISODate, todayISO, weekDays } from '@/lib/dates';
import { formatDistance, formatDuration, formatKm } from '@/lib/format';
import { useI18n } from '@/i18n';
import { usePlanWarnings } from '@/features/plancheck/usePlanWarnings';

export function HomePage() {
  const today = todayISO();
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const { open } = useUI();
  const week = weekDays(today, settings.weekStartsOn);
  const workouts = useWorkouts(week[0], addDaysISO(today, 7) > week[6] ? addDaysISO(today, 7) : week[6]);
  const duties = useDuties(today, addDaysISO(today, 7));
  const dutyTypes = useDutyTypes();
  const warnings = usePlanWarnings(week[0], week[6], settings);
  const typeById = new Map((dutyTypes ?? []).map((d) => [d.id, d]));

  const todays = (workouts ?? []).filter((w) => w.date === today);
  const main = todays.find((w) => w.status === 'planned') ?? todays[0];
  const todayDuties = dutiesOnDate(duties ?? [], today);
  const weekW = (workouts ?? []).filter((w) => w.date >= week[0] && w.date <= week[6] && w.activity !== 'rest');
  const done = weekW.filter((w) => w.status === 'completed');
  const total = weekW.filter((w) => w.status !== 'skipped').length;
  const sumKm = (a: string) => weekW.filter((w) => w.activity === a && w.status !== 'skipped').reduce((s, w) => s + effectiveDistanceKm(w), 0);
  const doneKm = (a: string) => done.filter((w) => w.activity === a).reduce((s, w) => s + effectiveDistanceKm(w), 0);
  const upcoming = (workouts ?? []).filter((w) => w.date > today && w.date <= addDaysISO(today, 7) && w.status === 'planned').slice(0, 5);
  const issues = warnings?.active.length ?? 0;

  return (
    <div className="px-4 pb-28">
      <header className="pt-safe flex items-center gap-3 min-h-[64px]">
        <Logo className="w-9 h-9 text-ink" />
        <span className="flex-1 font-extrabold tracking-wide text-sm">{t('app.name')}</span>
        <Link to="/plan-check" className="icon-btn relative" aria-label={t('planner.planCheck')}>
          <Bell size={22} />
          {issues > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-warn" />}
        </Link>
      </header>

      <p className="text-muted text-sm mt-1">{fmt(fromISODate(today), 'EEEE d MMMM yyyy')}</p>

      {/* Duty */}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wider text-muted mr-1">{t('home.todayDuty')}</span>
        {todayDuties.length ? (
          todayDuties.map((d) => (
            <button key={d.id} className="flex items-center gap-2" onClick={() => open({ kind: 'dutyEditor', id: d.id })}>
              <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} />
              <span className="text-sm text-muted">
                {d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : typeById.get(d.dutyTypeId)?.label}
                {d.title ? ` · ${d.title}` : ''}
              </span>
            </button>
          ))
        ) : (
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
      <div className="grid grid-cols-4 gap-2 mt-4">
        {TRAINING_ACTIVITIES.map((a) => {
          const Icon = ACTIVITY_ICON[a];
          const n = done.filter((w) => w.activity === a).length;
          const km = a === 'strength' ? undefined : doneKm(a);
          return (
            <div key={a} className="card py-3 flex flex-col items-center gap-1">
              <span className={`w-11 h-11 rounded-full flex items-center justify-center ${ACTIVITY_BG[a]} ${ACTIVITY_TEXT[a]}`}>
                <Icon size={22} />
              </span>
              <span className="text-[11px] text-muted">{t(`activity.${a}`)}</span>
              <span className="font-bold">{n}</span>
              {km !== undefined && <span className="text-[10px] text-muted">{a === 'swim' ? formatDistance(km, 'swim', settings.units) : formatKm(km, settings.units)}</span>}
            </div>
          );
        })}
      </div>
      <div className="card p-4 mt-2 flex items-center justify-between">
        <span className="text-sm text-muted">{t('home.running')}</span>
        <span className="font-bold">
          {formatKm(doneKm('run'), settings.units)} <span className="text-muted font-normal">/ {formatKm(sumKm('run'), settings.units)}</span>
        </span>
      </div>

      {/* Upcoming */}
      <SectionTitle right={<Link to="/planner" className="text-sm text-sky font-semibold">{t('nav.planner')}</Link>}>{t('home.upcoming')}</SectionTitle>
      {upcoming.length ? (
        <div className="flex flex-col gap-2">
          {upcoming.map((w) => {
            const d = dutiesOnDate(duties ?? [], w.date)[0];
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

      <button className="btn-sky w-full mt-6" onClick={() => open({ kind: 'workoutEditor', date: today })}>
        <Plus size={20} /> {t('home.quickAdd')}
      </button>
    </div>
  );
}
