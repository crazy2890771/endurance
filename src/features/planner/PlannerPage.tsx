import { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardCheck, Moon, Plane, Plus, X } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Segmented } from '@/components/ui';
import { DutyBadge, WorkoutCard } from '@/components/cards';
import { ACTIVITY_BAR } from '@/components/icons';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import { moveWorkout } from '@/db/repo';
import { dutiesShownOn, dutyEndDate, effectiveDistanceKm, restAfterOvernight } from '@/domain/rules';
import type { Duty, DutyType, ISODate, Workout } from '@/domain/types';
import { addDaysISO, formatMin, fromISODate, isValidISODate, monthBounds, monthGrid, todayISO, weekDays } from '@/lib/dates';
import { formatDuration, formatKm } from '@/lib/format';
import { useI18n } from '@/i18n';
import { usePlanWarnings } from '@/features/plancheck/usePlanWarnings';

type View = 'week' | 'month';

/** Time label for a duty as seen on one calendar day (handles overnight / multi-day duties). */
function dutyTimeLabel(d: Duty, date: ISODate) {
  const ends = dutyEndDate(d);
  if (d.date === date) return `${d.startTime}–${d.endTime}${ends > date ? ' +1' : ''}`;
  if (ends === date) return `…–${d.endTime}`;
  return '…';
}

export function PlannerPage() {
  const [sp, setSp] = useSearchParams();
  const today = todayISO();
  const anchor = isValidISODate(sp.get('date') ?? '') ? sp.get('date')! : today;
  const view: View = sp.get('view') === 'month' ? 'month' : 'week';
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const { open, moving, setMoving, toast } = useUI();
  const [selected, setSelected] = useState<ISODate>(anchor);

  const days = useMemo(() => (view === 'week' ? weekDays(anchor, settings.weekStartsOn) : monthGrid(anchor, settings.weekStartsOn)), [anchor, view, settings.weekStartsOn]);
  const from = days[0];
  const to = days[days.length - 1];
  const workouts = useWorkouts(from, to);
  const duties = useDuties(from, to);
  const dutyTypes = useDutyTypes();
  const weekRange = view === 'week' ? [from, to] : monthBounds(anchor);
  const warnings = usePlanWarnings(weekRange[0], weekRange[1], settings);

  const typeById = useMemo(() => new Map((dutyTypes ?? []).map((x) => [x.id, x])), [dutyTypes]);
  const byDate = useMemo(() => {
    const m = new Map<ISODate, Workout[]>();
    for (const w of workouts ?? []) m.set(w.date, [...(m.get(w.date) ?? []), w]);
    return m;
  }, [workouts]);
  // The day after an overnight duty shows as off, with the time training is fine again.
  const restUntil = (d: ISODate) => {
    const r = restAfterOvernight(d, duties ?? [], dutyTypes ?? [], settings.rules.dutyOverlap.overnightRestMin);
    return r ? formatMin(r.until) : undefined;
  };
  const warnedIds = useMemo(() => new Set((warnings?.active ?? []).filter((w) => w.severity === 'warning').flatMap((w) => w.workoutIds)), [warnings]);

  const go = (date: ISODate, v: View = view) => {
    setSp({ date, view: v }, { replace: true });
    setSelected(date);
  };
  const shift = (dir: -1 | 1) => {
    if (view === 'week') go(addDaysISO(anchor, dir * 7));
    else {
      const d = fromISODate(anchor);
      const next = new Date(d.getFullYear(), d.getMonth() + dir, 1);
      go(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`);
    }
  };

  // Swipe between weeks / months.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
  };

  const onDayTap = async (date: ISODate) => {
    if (moving) {
      await moveWorkout(moving.id, date);
      toast(t('detail.moved'));
      setMoving(null);
      return;
    }
    setSelected(date);
  };

  const issueCount = warnings?.active.length ?? 0;
  const anchorDate = fromISODate(anchor);
  const monthLabel = fmt(anchorDate, 'LLLL yyyy');

  return (
    <div className="pb-28" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur pt-safe px-4">
        <div className="flex items-center gap-2 min-h-[56px]">
          <h1 className="flex-1 text-2xl font-bold capitalize truncate">{monthLabel}</h1>
          {anchor !== today && (
            <button className="chip min-h-[36px] bg-sky/15 text-sky font-semibold" onClick={() => go(today)}>
              {t('common.today')}
            </button>
          )}
          <Link to={`/plan-check?date=${weekRange[0]}&to=${weekRange[1]}`} className="icon-btn relative" aria-label={t('planner.planCheck')}>
            <ClipboardCheck size={22} />
            {issueCount > 0 && <span className="absolute top-1 right-1 min-w-[18px] h-[18px] rounded-full bg-warn text-[11px] font-bold text-[#241300] flex items-center justify-center px-1">{issueCount}</span>}
          </Link>
        </div>
        <div className="flex items-center gap-2 pb-3">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label={view === 'week' ? t('planner.prevWeek') : t('planner.prevMonth')}>
            <ChevronLeft size={22} />
          </button>
          <div className="flex-1">
            <Segmented size="sm" value={view} onChange={(v) => go(anchor, v)} options={[{ value: 'week', label: t('planner.week') }, { value: 'month', label: t('planner.month') }]} ariaLabel="view" />
          </div>
          <button className="icon-btn" onClick={() => shift(1)} aria-label={view === 'week' ? t('planner.nextWeek') : t('planner.nextMonth')}>
            <ChevronRight size={22} />
          </button>
        </div>
        {view === 'week' && <WeekStrip days={days} today={today} selected={selected} byDate={byDate} onPick={onDayTap} />}
      </header>

      {moving && (
        <div className="mx-4 mb-3 card border-sky/60 p-3 flex items-center gap-3 animate-rise">
          <CalendarDays size={20} className="text-sky" />
          <p className="flex-1 text-sm font-medium">{t('planner.moving', { name: moving.name })}</p>
          <button className="icon-btn" aria-label={t('planner.cancelMove')} onClick={() => setMoving(null)}>
            <X size={20} />
          </button>
        </div>
      )}

      <div key={`${view}-${from}`} className="px-4 animate-rise">
        {view === 'week' ? (
          <>
            <div className="flex flex-col gap-2">
              {days.map((d) => (
                <DayRow
                  key={d}
                  date={d}
                  today={today}
                  workouts={byDate.get(d) ?? []}
                  duties={dutiesShownOn(duties ?? [], d)}
                  restUntil={restUntil(d)}
                  typeById={typeById}
                  warned={warnedIds}
                  moving={!!moving}
                  onTap={() => onDayTap(d)}
                />
              ))}
            </div>
            <WeekTotals workouts={workouts ?? []} />
          </>
        ) : (
          <MonthView
            days={days}
            anchor={anchor}
            today={today}
            selected={selected}
            byDate={byDate}
            duties={duties ?? []}
            restUntil={restUntil}
            typeById={typeById}
            warned={warnedIds}
            onPick={onDayTap}
          />
        )}
      </div>

      <button
        className="fixed right-[max(1.25rem,calc(50vw-21rem+1.25rem))] bottom-[calc(92px+env(safe-area-inset-bottom))] z-30 w-14 h-14 rounded-full bg-mint text-[#062015] shadow-[0_10px_30px_-6px_rgb(var(--mint)/.7)] flex items-center justify-center active:scale-95 transition"
        aria-label={t('planner.addWorkout')}
        onClick={() => open({ kind: 'workoutEditor', date: view === 'month' ? selected : selected >= from && selected <= to ? selected : from })}
      >
        <Plus size={28} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function WeekStrip({ days, today, selected, byDate, onPick }: { days: ISODate[]; today: ISODate; selected: ISODate; byDate: Map<ISODate, Workout[]>; onPick: (d: ISODate) => void }) {
  const { fmt } = useI18n();
  return (
    <div className="grid grid-cols-7 gap-1 pb-3">
      {days.map((d) => {
        const dt = fromISODate(d);
        const isToday = d === today;
        const isSel = d === selected;
        const ws = byDate.get(d) ?? [];
        return (
          <button
            key={d}
            onClick={() => {
              onPick(d);
              document.getElementById(`day-${d}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            className={`flex flex-col items-center rounded-2xl py-2 transition ${isToday ? 'bg-sky text-[#03111c]' : isSel ? 'bg-card2' : ''}`}
            aria-label={fmt(dt, 'EEEE d MMMM')}
            aria-current={isToday ? 'date' : undefined}
          >
            <span className={`text-[11px] font-medium ${isToday ? '' : 'text-muted'}`}>{fmt(dt, 'EEEEEE')}</span>
            <span className="text-lg font-bold leading-tight">{fmt(dt, 'd')}</span>
            <span className="flex gap-0.5 h-1.5 mt-1">
              {ws.slice(0, 3).map((w) => (
                <span key={w.id} className={`w-1.5 h-1.5 rounded-full ${isToday ? 'bg-[#03111c]' : ACTIVITY_BAR[w.activity]} ${w.status === 'skipped' ? 'opacity-30' : ''}`} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayRow({
  date,
  today,
  workouts,
  duties,
  restUntil,
  typeById,
  warned,
  moving,
  onTap,
}: {
  date: ISODate;
  today: ISODate;
  workouts: Workout[];
  duties: Duty[];
  restUntil?: string;
  typeById: Map<string, DutyType>;
  warned: Set<string>;
  moving: boolean;
  onTap: () => void;
}) {
  const { t, fmt } = useI18n();
  const { open } = useUI();
  const settings = useSettingsOrDefault();
  const dt = fromISODate(date);
  const isToday = date === today;
  const isPast = date < today;
  return (
    <section
      id={`day-${date}`}
      aria-label={fmt(dt, 'EEEE d MMMM')}
      onClick={moving ? onTap : undefined}
      className={`card p-3 flex gap-3 scroll-mt-48 ${isToday ? 'border-sky/70 ring-1 ring-sky/30' : ''} ${moving ? 'cursor-pointer border-dashed border-sky/60 active:bg-card2' : ''} ${isPast && !isToday ? 'opacity-80' : ''}`}
    >
      <div className="w-11 shrink-0 text-center pt-0.5">
        <p className={`text-xs font-medium ${isToday ? 'text-sky' : 'text-muted'}`}>{fmt(dt, 'EEE')}</p>
        <p className={`text-2xl font-bold leading-none mt-0.5 ${isToday ? 'text-sky' : ''}`}>{fmt(dt, 'd')}</p>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 flex-wrap min-h-[28px]">
          {duties.map((d) => (
            <button key={d.id} disabled={moving} onClick={() => open({ kind: 'dutyEditor', id: d.id })} className="flex items-center gap-1.5" aria-label={`${t('duty.edit')} ${typeById.get(d.dutyTypeId)?.code ?? ''}`}>
              <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} />
              {d.startTime && d.endTime && <span className="text-[11px] text-muted">{dutyTimeLabel(d, date)}</span>}
            </button>
          ))}
          {restUntil && <span className="chip min-h-[28px] px-2 text-[11px] bg-sky/10 text-sky">{t('planner.trainAfter', { time: restUntil })}</span>}
          {duties.length === 0 && !restUntil && !moving && (
            <button className="inline-flex items-center gap-1 text-[11px] text-muted rounded-lg border border-dashed border-line px-2 h-7" onClick={() => open({ kind: 'dutyEditor', date })}>
              <Plane size={12} /> {t('planner.addDuty')}
            </button>
          )}
          {!moving && (
            <button className="ml-auto icon-btn w-9 h-9 bg-card2" aria-label={`${t('planner.addWorkout')} ${fmt(dt, 'd MMM')}`} onClick={() => open({ kind: 'workoutEditor', date })}>
              <Plus size={18} />
            </button>
          )}
        </div>
        {workouts.length === 0 ? (
          <p className="text-sm text-muted flex items-center gap-2 py-1">
            <Moon size={14} /> {duties.length ? t('planner.noWorkout') : t('planner.restDay')}
          </p>
        ) : (
          workouts.map((w) => (
            <WorkoutCard key={w.id} w={w} units={settings.units} compact warning={warned.has(w.id)} onClick={moving ? undefined : () => open({ kind: 'workoutDetail', id: w.id })} />
          ))
        )}
      </div>
    </section>
  );
}

function WeekTotals({ workouts }: { workouts: Workout[] }) {
  const { t } = useI18n();
  const settings = useSettingsOrDefault();
  const counted = workouts.filter((w) => w.status !== 'skipped' && w.activity !== 'rest');
  const runKm = counted.filter((w) => w.activity === 'run').reduce((s, w) => s + effectiveDistanceKm(w), 0);
  const mins = counted.reduce((s, w) => s + (w.status === 'completed' ? (w.result?.durationMin ?? w.durationMin) : w.durationMin), 0);
  return (
    <div className="card p-4 mt-4 grid grid-cols-3 text-center">
      <div>
        <p className="text-xs text-muted">{t('planner.weekTotal')}</p>
        <p className="font-bold">{counted.length}</p>
      </div>
      <div>
        <p className="text-xs text-muted">{t('activity.run')}</p>
        <p className="font-bold">{formatKm(runKm, settings.units)}</p>
      </div>
      <div>
        <p className="text-xs text-muted">{t('history.time')}</p>
        <p className="font-bold">{formatDuration(mins)}</p>
      </div>
    </div>
  );
}

function MonthView({
  days,
  anchor,
  today,
  selected,
  byDate,
  duties,
  restUntil,
  typeById,
  warned,
  onPick,
}: {
  days: ISODate[];
  anchor: ISODate;
  today: ISODate;
  selected: ISODate;
  byDate: Map<ISODate, Workout[]>;
  duties: Duty[];
  restUntil: (d: ISODate) => string | undefined;
  typeById: Map<string, DutyType>;
  warned: Set<string>;
  onPick: (d: ISODate) => void;
}) {
  const { fmt, t } = useI18n();
  const settings = useSettingsOrDefault();
  const month = anchor.slice(0, 7);
  const sel = days.includes(selected) ? selected : anchor;
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted mb-1">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{fmt(fromISODate(d), 'EEEEEE')}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const ws = byDate.get(d) ?? [];
          const ds = dutiesShownOn(duties, d);
          const inMonth = d.startsWith(month);
          const isToday = d === today;
          return (
            <button
              key={d}
              onClick={() => onPick(d)}
              aria-label={fmt(fromISODate(d), 'EEEE d MMMM')}
              aria-pressed={d === sel}
              className={`aspect-[4/5] sm:aspect-auto sm:h-24 rounded-xl p-1 flex flex-col items-center gap-0.5 border transition ${d === sel ? 'border-sky bg-card2' : 'border-transparent bg-card'} ${inMonth ? '' : 'opacity-40'}`}
            >
              <span className={`text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full ${isToday ? 'bg-sky text-[#03111c]' : ''}`}>{fmt(fromISODate(d), 'd')}</span>
              {ds[0] && <DutyBadge duty={ds[0]} type={typeById.get(ds[0].dutyTypeId)} size="sm" />}
              <span className="flex flex-wrap justify-center gap-0.5 mt-auto mb-0.5">
                {ws.slice(0, 4).map((w) => (
                  <span key={w.id} className={`w-2 h-2 rounded-full ${ACTIVITY_BAR[w.activity]} ${w.status === 'skipped' ? 'opacity-30' : ''} ${warned.has(w.id) ? 'ring-2 ring-warn' : ''}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <DayDetail date={sel} workouts={byDate.get(sel) ?? []} duties={dutiesShownOn(duties, sel)} restUntil={restUntil(sel)} typeById={typeById} warned={warned} units={settings.units} t={t} />
    </>
  );
}

function DayDetail({ date, workouts, duties, restUntil, typeById, warned, units, t }: { date: ISODate; workouts: Workout[]; duties: Duty[]; restUntil?: string; typeById: Map<string, DutyType>; warned: Set<string>; units: 'metric' | 'imperial'; t: ReturnType<typeof useI18n>['t'] }) {
  const { fmt } = useI18n();
  const { open } = useUI();
  return (
    <div className="mt-4 animate-rise" key={date}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold text-lg">{fmt(fromISODate(date), 'EEEE d MMMM')}</h2>
        <div className="flex gap-2">
          <button className="chip min-h-[36px] text-xs gap-1" onClick={() => open({ kind: 'dutyEditor', date })}>
            <Plane size={14} /> {t('planner.addDuty')}
          </button>
          <button className="chip min-h-[36px] text-xs gap-1 bg-mint/15 text-mint" onClick={() => open({ kind: 'workoutEditor', date })}>
            <Plus size={14} /> {t('common.add')}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {duties.map((d) => (
          <button key={d.id} className="card p-3 flex items-center gap-2 text-left" onClick={() => open({ kind: 'dutyEditor', id: d.id })}>
            <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} />
            <span className="text-sm text-muted truncate">
              {d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : typeById.get(d.dutyTypeId)?.label}
              {d.title ? ` · ${d.title}` : ''}
            </span>
          </button>
        ))}
        {restUntil && <p className="card px-3 py-2.5 text-sm text-sky">{t('planner.trainAfter', { time: restUntil })}</p>}
        {workouts.map((w) => (
          <WorkoutCard key={w.id} w={w} units={units} warning={warned.has(w.id)} onClick={() => open({ kind: 'workoutDetail', id: w.id })} />
        ))}
        {workouts.length === 0 && duties.length === 0 && <p className="text-sm text-muted py-2">{t('planner.emptyDay')}</p>}
      </div>
    </div>
  );
}
