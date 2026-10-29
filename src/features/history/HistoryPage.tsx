import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Clock, CheckCircle2, ChevronLeft, ChevronRight, FileUp, Gauge, History as HistoryIcon } from 'lucide-react';
import { useUI } from '@/app/ui';
import { EmptyState, PageHeader, Segmented, SectionTitle } from '@/components/ui';
import { WorkoutCard } from '@/components/cards';
import { ACTIVITY_ICON, ACTIVITY_TEXT } from '@/components/icons';
import { useSettingsOrDefault, useWorkouts } from '@/db/hooks';
import { TRAINING_ACTIVITIES } from '@/domain/catalog';
import type { Activity, ISODate, Workout } from '@/domain/types';
import { addDaysISO, dateRange, fromISODate, monthBounds, todayISO, weekDays, weekStart } from '@/lib/dates';
import { formatDistance, formatDuration, formatKm } from '@/lib/format';
import { useI18n } from '@/i18n';

type Period = 'week' | 'month' | 'year';

const COLOR_VAR: Record<Exclude<Activity, 'rest'>, string> = {
  run: 'rgb(var(--run))',
  cycle: 'rgb(var(--cycle))',
  swim: 'rgb(var(--swim))',
  strength: 'rgb(var(--strength))',
};

function bounds(p: Period, anchor: ISODate, wso: 0 | 1): [ISODate, ISODate] {
  if (p === 'week') {
    const d = weekDays(anchor, wso);
    return [d[0], d[6]];
  }
  if (p === 'month') return monthBounds(anchor);
  return [`${anchor.slice(0, 4)}-01-01`, `${anchor.slice(0, 4)}-12-31`];
}

function shiftAnchor(p: Period, anchor: ISODate, dir: number): ISODate {
  if (p === 'week') return addDaysISO(anchor, dir * 7);
  const d = fromISODate(anchor);
  const n = p === 'month' ? new Date(d.getFullYear(), d.getMonth() + dir, 1) : new Date(d.getFullYear() + dir, 0, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
}

const actualKm = (w: Workout) => w.result?.distanceKm ?? w.distanceKm ?? 0;
const actualMin = (w: Workout) => w.result?.durationMin ?? w.durationMin ?? 0;

export function HistoryPage() {
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const { open } = useUI();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [from, to] = bounds(period, anchor, settings.weekStartsOn);
  const all = useWorkouts(from, to);

  const stats = useMemo(() => {
    const ws = (all ?? []).filter((w) => w.activity !== 'rest');
    const completed = ws.filter((w) => w.status === 'completed');
    const skipped = ws.filter((w) => w.status === 'skipped');
    // Consistency only counts sessions whose date has passed (or that are already done).
    const due = ws.filter((w) => w.date < todayISO() || w.status !== 'planned');
    const rpes = completed.map((w) => w.result?.rpe).filter((x): x is number => typeof x === 'number');
    const by = Object.fromEntries(
      TRAINING_ACTIVITIES.map((a) => {
        const list = completed.filter((w) => w.activity === a);
        return [a, { count: list.length, km: list.reduce((s, w) => s + actualKm(w), 0), min: list.reduce((s, w) => s + actualMin(w), 0) }];
      }),
    ) as Record<Exclude<Activity, 'rest'>, { count: number; km: number; min: number }>;
    return {
      completed,
      skipped: skipped.length,
      due: due.length,
      totalKm: completed.reduce((s, w) => s + actualKm(w), 0),
      totalMin: completed.reduce((s, w) => s + actualMin(w), 0),
      avgRpe: rpes.length ? Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 10) / 10 : undefined,
      by,
    };
  }, [all]);

  const buckets = useMemo(() => runBuckets(period, from, to, stats.completed, settings.weekStartsOn, fmt), [period, from, to, stats.completed, settings.weekStartsOn, fmt]);
  const rangeLabel =
    period === 'week' ? `${fmt(fromISODate(from), 'd MMM')} – ${fmt(fromISODate(to), 'd MMM yyyy')}` : period === 'month' ? fmt(fromISODate(from), 'LLLL yyyy') : from.slice(0, 4);
  const consistency = stats.due ? Math.round((stats.completed.length / stats.due) * 100) : 0;

  return (
    <div className="pb-28">
      <PageHeader
        title={t('history.title')}
        right={
          <Link to="/history/import" className="chip min-h-[40px] text-xs gap-1.5 mr-2 bg-mint/15 text-mint">
            <FileUp size={16} /> {t('fit.button')}
          </Link>
        }
      />
      <div className="px-4">
        <Segmented
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setAnchor(todayISO());
          }}
          options={[
            { value: 'week', label: t('common.week') },
            { value: 'month', label: t('common.month') },
            { value: 'year', label: t('common.year') },
          ]}
          ariaLabel="period"
        />
        <div className="flex items-center justify-between my-3">
          <button className="icon-btn" onClick={() => setAnchor(shiftAnchor(period, anchor, -1))} aria-label="previous">
            <ChevronLeft size={22} />
          </button>
          <p className="font-semibold capitalize">{rangeLabel}</p>
          <button className="icon-btn" onClick={() => setAnchor(shiftAnchor(period, anchor, 1))} aria-label="next">
            <ChevronRight size={22} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Tile icon={<BarChart3 size={22} className="text-mint" />} label={t('history.distance')} value={formatKm(stats.totalKm, settings.units)} />
          <Tile icon={<Clock size={22} className="text-sky" />} label={t('history.time')} value={formatDuration(stats.totalMin)} />
          <Tile
            icon={<CheckCircle2 size={22} className="text-mint" />}
            label={t('history.workouts')}
            value={`${stats.completed.length} / ${stats.due}`}
            sub={stats.skipped ? t('history.skipped', { n: stats.skipped }) : undefined}
          />
          <Tile icon={<Gauge size={22} className="text-warn" />} label={t('history.consistency')} value={stats.due ? `${consistency}%` : '—'} sub={stats.avgRpe !== undefined ? `${t('history.avgRpe')} ${stats.avgRpe}` : undefined} />
        </div>

        {stats.completed.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={<HistoryIcon size={26} />} title={t('history.empty')} hint={t('history.emptyHint')} />
          </div>
        ) : (
          <>
            <SectionTitle>{t('history.breakdown')}</SectionTitle>
            <div className="card p-4 flex items-center gap-5">
              <Donut by={stats.by} total={stats.completed.length} label={t('history.workouts')} />
              <ul className="flex-1 flex flex-col gap-2.5">
                {TRAINING_ACTIVITIES.map((a) => {
                  const Icon = ACTIVITY_ICON[a];
                  const b = stats.by[a];
                  return (
                    <li key={a} className="flex items-center gap-2 text-sm">
                      <Icon size={16} className={ACTIVITY_TEXT[a]} />
                      <span className="flex-1 truncate">{t(`activity.${a}`)}</span>
                      <span className="text-muted text-xs">{a !== 'strength' && b.km ? formatDistance(b.km, a, settings.units) : formatDuration(b.min)}</span>
                      <span className="font-bold w-5 text-right">{b.count}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {period !== 'week' || buckets.some((b) => b.km > 0) ? (
              <>
                <SectionTitle right={<span className="text-sm text-muted">{formatKm(stats.by.run.km, settings.units)}</span>}>{t('history.runMileage')}</SectionTitle>
                <RunBars buckets={buckets} units={settings.units} />
              </>
            ) : null}

            <SectionTitle>{t('history.recent')}</SectionTitle>
            <div className="flex flex-col gap-2">
              {[...stats.completed].reverse().slice(0, 30).map((w) => (
                <div key={w.id}>
                  <p className="text-[11px] text-muted mb-1 ml-1">{fmt(fromISODate(w.date), 'EEE d MMM')}</p>
                  <WorkoutCard w={{ ...w, durationMin: actualMin(w), distanceKm: w.result?.distanceKm ?? w.distanceKm }} units={settings.units} onClick={() => open({ kind: 'workoutDetail', id: w.id })} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="card p-3 flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-card2 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted truncate">{label}</p>
        <p className="text-lg font-bold leading-tight truncate">{value}</p>
        {sub && <p className="text-[11px] text-muted truncate">{sub}</p>}
      </div>
    </div>
  );
}

/** Ring chart of session counts per activity. Identity is also carried by the labelled list beside it. */
function Donut({ by, total, label }: { by: Record<Exclude<Activity, 'rest'>, { count: number }>; total: number; label: string }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  const gap = total > 1 ? 2.5 : 0; // surface gap between segments
  let offset = 0;
  const segs = TRAINING_ACTIVITIES.filter((a) => by[a].count > 0).map((a) => {
    const len = (by[a].count / total) * c;
    const seg = { a, len: Math.max(0, len - gap), offset };
    offset += len;
    return seg;
  });
  return (
    <div className="relative w-[120px] h-[120px] shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" role="img" aria-label={`${total} ${label}`}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(var(--card2))" strokeWidth="11" />
        {segs.map((s) => (
          <circle key={s.a} cx="50" cy="50" r={r} fill="none" stroke={COLOR_VAR[s.a as Exclude<Activity, 'rest'>]} strokeWidth="11" strokeDasharray={`${s.len} ${c - s.len}`} strokeDashoffset={-s.offset} />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none">{total}</span>
        <span className="text-[11px] text-muted mt-1">{label}</span>
      </div>
    </div>
  );
}

interface Bucket {
  key: string;
  label: string;
  long: string;
  km: number;
}

function runBuckets(period: Period, from: ISODate, to: ISODate, completed: Workout[], wso: 0 | 1, fmt: (d: Date, p: string) => string): Bucket[] {
  const runs = completed.filter((w) => w.activity === 'run');
  const sum = (a: ISODate, b: ISODate) => runs.filter((w) => w.date >= a && w.date <= b).reduce((s, w) => s + actualKm(w), 0);
  if (period === 'week') return dateRange(from, to).map((d) => ({ key: d, label: fmt(fromISODate(d), 'EEEEE'), long: fmt(fromISODate(d), 'EEE d MMM'), km: sum(d, d) }));
  if (period === 'month') {
    const out: Bucket[] = [];
    for (let ws = weekStart(from, wso); ws <= to; ws = addDaysISO(ws, 7)) {
      out.push({ key: ws, label: fmt(fromISODate(ws), 'd/M'), long: `${fmt(fromISODate(ws), 'd MMM')} – ${fmt(fromISODate(addDaysISO(ws, 6)), 'd MMM')}`, km: sum(ws, addDaysISO(ws, 6)) });
    }
    return out;
  }
  const y = +from.slice(0, 4);
  return Array.from({ length: 12 }, (_, m) => {
    const [a, b] = monthBounds(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    return { key: a, label: fmt(fromISODate(a), 'LLLLL'), long: fmt(fromISODate(a), 'LLLL'), km: sum(a, b) };
  });
}

/** Single-series bar chart: running distance per sub-period. Tap/hover a bar to read its value. */
function RunBars({ buckets, units }: { buckets: Bucket[]; units: 'metric' | 'imperial' }) {
  const [sel, setSel] = useState<string | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.km));
  const peak = buckets.reduce((m, b) => (b.km > m.km ? b : m), buckets[0]);
  const shown = buckets.find((b) => b.key === sel) ?? peak;
  return (
    <div className="card p-4">
      <p className="text-sm text-muted h-5" aria-live="polite">
        {shown && shown.km > 0 ? (
          <>
            {shown.long} · <span className="text-ink font-semibold">{formatKm(shown.km, units)}</span>
          </>
        ) : null}
      </p>
      <div className="flex items-end gap-1 h-28 mt-2 border-b border-line/60" role="list">
        {buckets.map((b) => (
          <button
            key={b.key}
            role="listitem"
            aria-label={`${b.long}: ${formatKm(b.km, units)}`}
            onMouseEnter={() => setSel(b.key)}
            onFocus={() => setSel(b.key)}
            onClick={() => setSel(b.key)}
            className="flex-1 h-full flex items-end justify-center group"
          >
            <span
              className={`w-full max-w-[28px] rounded-t-[4px] transition ${b.key === shown?.key ? 'bg-run' : 'bg-run/55 group-hover:bg-run/80'}`}
              style={{ height: b.km > 0 ? `${Math.max(4, (b.km / max) * 100)}%` : '0%' }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-1 mt-1.5">
        {buckets.map((b) => (
          <span key={b.key} className="flex-1 text-center text-[10px] text-muted truncate">
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}
