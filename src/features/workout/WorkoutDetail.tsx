import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Copy,
  Heart,
  MapPin,
  MoveRight,
  Pencil,
  RotateCcw,
  SkipForward,
  Target,
  Trash2,
} from 'lucide-react';
import { useUI } from '@/app/ui';
import { Sheet } from '@/components/Sheet';
import { ActivityBadge } from '@/components/icons';
import { DutyLine, workoutName } from '@/components/cards';
import { useDuties, useDutyTypes, useSettingsOrDefault, useWorkout } from '@/db/hooks';
import {
  deleteWorkout,
  duplicateWorkout,
  moveWorkout,
  reopenWorkout,
  reorderWorkout,
  restoreWorkout,
  skipWorkout,
} from '@/db/repo';
import { dutiesOnDate } from '@/domain/rules';
import { addDaysISO, fromISODate, isValidISODate, todayISO } from '@/lib/dates';
import { formatDistance, formatDuration } from '@/lib/format';
import { useI18n } from '@/i18n';
import { usePlanWarnings } from '@/features/plancheck/usePlanWarnings';
import { WarningCard } from '@/features/plancheck/WarningCard';

export function WorkoutDetail() {
  const { sheet, close, open, toast, confirm, setMoving } = useUI();
  const isOpen = sheet.kind === 'workoutDetail';
  const id = isOpen ? sheet.id : undefined;
  const w = useWorkout(id);
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const nav = useNavigate();
  const dutyTypes = useDutyTypes();
  const day = w?.date ?? todayISO();
  const duties = useDuties(day, day);
  const warnings = usePlanWarnings(day, day, settings);
  const [dateAction, setDateAction] = useState<null | 'move' | 'duplicate'>(null);
  const [target, setTarget] = useState('');

  useEffect(() => {
    setDateAction(null);
  }, [id]);

  if (!isOpen) return null;
  if (!w) return <Sheet open onClose={close} title="">{null}</Sheet>;

  const typeById = new Map(dutyTypes?.map((d) => [d.id, d]));
  const dayDuties = dutiesOnDate(duties ?? [], w.date);
  const mine = (warnings?.all ?? []).filter((x) => x.workoutIds.includes(w.id));
  const zone = w.hrZone ? settings.hrZones[w.hrZone] : undefined;

  const run = async (fn: () => Promise<unknown>, msg: string, undo?: () => Promise<unknown>) => {
    try {
      await fn();
      toast(msg, undo ? { action: { label: t('common.undo'), run: () => void undo() } } : undefined);
    } catch (e) {
      toast(`${t('common.error')}: ${(e as Error).message}`, { tone: 'warn' });
    }
  };

  const onDelete = async () => {
    if (!(await confirm(t('detail.confirmDelete'), { danger: true, confirmLabel: t('common.delete') }))) return;
    close();
    await run(() => deleteWorkout(w.id), t('detail.deleted'), () => restoreWorkout(w.id));
  };

  const onDateAction = async () => {
    if (!isValidISODate(target)) return;
    if (dateAction === 'move') {
      const from = w.date;
      await run(() => moveWorkout(w.id, target), t('detail.moved'), () => moveWorkout(w.id, from));
    } else {
      const copy = await duplicateWorkout(w.id, target);
      toast(t('detail.duplicated'), { action: { label: t('common.undo'), run: () => void deleteWorkout(copy.id) } });
    }
    setDateAction(null);
  };

  const startDateAction = (a: 'move' | 'duplicate') => {
    setTarget(a === 'move' ? w.date : addDaysISO(w.date, 7));
    setDateAction(a);
  };

  return (
    <Sheet
      open
      onClose={close}
      title={fmt(fromISODate(w.date), 'EEE, d MMM yyyy')}
      footer={
        w.status === 'planned' ? (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => run(() => skipWorkout(w.id), t('detail.skipped'), () => reopenWorkout(w.id))}>
              <SkipForward size={18} /> {t('detail.skip')}
            </button>
            {w.activity !== 'rest' && (
              <button className="btn-primary flex-1" onClick={() => open({ kind: 'complete', id: w.id })}>
                <CheckCircle2 size={20} /> {t('detail.markComplete')}
              </button>
            )}
          </div>
        ) : (
          <button className="btn-ghost w-full" onClick={() => run(() => reopenWorkout(w.id), t('detail.reopen'))}>
            <RotateCcw size={18} /> {t('detail.reopen')}
          </button>
        )
      }
    >
      <div className="animate-rise">
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-xs font-bold uppercase rounded-lg px-2 py-1 ${w.status === 'completed' ? 'bg-mint/15 text-mint' : w.status === 'skipped' ? 'bg-muted/15 text-muted' : 'bg-sky/15 text-sky'}`}>
            {t(`status.${w.status}`)}
          </span>
        </div>
        <div className="flex items-center gap-4 mb-4">
          <ActivityBadge activity={w.activity} size="lg" />
          <div className="min-w-0">
            <p className="text-2xl font-bold leading-tight">{workoutName(t, w)}</p>
            <p className="text-muted mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {w.startTime && <span>{w.startTime}</span>}
              {w.durationMin > 0 && <span>{formatDuration(w.durationMin)}</span>}
              {w.distanceKm && <span>{formatDistance(w.distanceKm, w.activity, settings.units)}</span>}
              {w.hrZone && <span>{t('common.zone', { z: w.hrZone })}</span>}
            </p>
            {w.location && (
              <p className="text-muted text-sm flex items-center gap-1 mt-1">
                <MapPin size={14} /> {t(`loc.${w.location}`)}
              </p>
            )}
          </div>
        </div>

        {dayDuties.length > 0 && (
          <div className="card p-3 mb-4 flex flex-col gap-2">
            {dayDuties.map((d) => (
              <DutyLine key={d.id} duty={d} type={typeById.get(d.dutyTypeId)} />
            ))}
          </div>
        )}

        {mine.length > 0 && (
          <div className="mb-4">
            <p className="label flex items-center gap-2">
              <AlertTriangle size={16} className="text-warn" /> {t('detail.warnings')}
            </p>
            <div className="flex flex-col gap-2">
              {mine.map((x) => (
                <WarningCard key={x.key} w={x} overridden={!(warnings?.active ?? []).some((a) => a.key === x.key)} />
              ))}
            </div>
          </div>
        )}

        {(zone || w.target || w.intervals?.length) && (
          <>
            <p className="label">{t('detail.target')}</p>
            <div className="card divide-y divide-line/50 mb-4">
              {zone && (
                <div className="flex items-center gap-3 p-3">
                  <Heart size={22} className="text-danger" />
                  <div>
                    <p className="text-sm text-muted">{t('detail.hr')}</p>
                    <p className="font-semibold">
                      {t('common.zone', { z: w.hrZone! })} <span className="text-muted font-normal ml-2">{zone.min}–{zone.max} bpm</span>
                    </p>
                  </div>
                </div>
              )}
              {w.target && (
                <div className="flex items-center gap-3 p-3">
                  <Target size={22} className="text-sky" />
                  <div>
                    <p className="text-sm text-muted">{t('detail.pace')}</p>
                    <p className="font-semibold">{w.target}</p>
                  </div>
                </div>
              )}
              {w.intervals?.map((s, i) => (
                <div key={i} className="flex items-center gap-3 p-3">
                  <span className="w-[22px] text-center font-bold text-mint">{i + 1}</span>
                  <p className="font-semibold">
                    {s.reps} × {s.distanceM ? `${s.distanceM} m` : s.durationSec ? `${s.durationSec}s` : ''}
                    {s.recoverySec ? <span className="text-muted font-normal"> · {s.recoverySec}s rec</span> : null}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}

        {w.notes && (
          <>
            <p className="label">{t('common.notes')}</p>
            <div className="card p-3 mb-4 whitespace-pre-wrap text-sm">{w.notes}</div>
          </>
        )}

        {w.status === 'completed' && w.result && (
          <>
            <p className="label">{t('detail.result')}</p>
            <div className="card p-3 mb-4 grid grid-cols-3 gap-3 text-center">
              {w.result.durationMin !== undefined && <Stat label={t('history.time')} value={formatDuration(w.result.durationMin)} />}
              {w.result.distanceKm !== undefined && <Stat label={t('history.distance')} value={formatDistance(w.result.distanceKm, w.activity, settings.units)} />}
              {w.result.avgHr !== undefined && <Stat label="HR" value={`${w.result.avgHr}`} />}
              {w.result.avgPace && <Stat label={t('complete.avgPace')} value={w.result.avgPace} />}
              {w.result.rpe !== undefined && <Stat label="RPE" value={`${w.result.rpe}/10`} />}
              {w.result.notes && <p className="col-span-3 text-left text-sm whitespace-pre-wrap">{w.result.notes}</p>}
            </div>
          </>
        )}

        {dateAction && (
          <div className="card p-3 mb-4 animate-rise">
            <label className="label" htmlFor="d-target">
              {dateAction === 'move' ? t('detail.moveTo') : t('detail.duplicateTo')}
            </label>
            <div className="flex gap-2">
              <button className="btn-ghost px-3" aria-label="-1" onClick={() => setTarget((d) => addDaysISO(d, -1))}>
                −1
              </button>
              <input id="d-target" type="date" className="input flex-1" value={target} onChange={(e) => setTarget(e.target.value)} />
              <button className="btn-ghost px-3" aria-label="+1" onClick={() => setTarget((d) => addDaysISO(d, 1))}>
                +1
              </button>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn-ghost flex-1" onClick={() => setDateAction(null)}>
                {t('common.cancel')}
              </button>
              {dateAction === 'move' && (
                <button
                  className="btn-ghost flex-1"
                  aria-label={t('planner.title')}
                  onClick={() => {
                    setMoving({ id: w.id, name: workoutName(t, w) });
                    close();
                    nav(`/planner?date=${w.date}`);
                  }}
                >
                  <CalendarDays size={18} />
                </button>
              )}
              <button className="btn-sky flex-[2]" disabled={!isValidISODate(target) || (dateAction === 'move' && target === w.date)} onClick={onDateAction}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 mb-2">
          <Action icon={<Pencil size={20} />} label={t('common.edit')} onClick={() => open({ kind: 'workoutEditor', id: w.id })} />
          <Action icon={<MoveRight size={20} />} label={t('detail.move')} onClick={() => startDateAction('move')} />
          <Action icon={<Copy size={20} />} label={t('detail.duplicate')} onClick={() => startDateAction('duplicate')} />
          <Action icon={<Trash2 size={20} />} label={t('common.delete')} onClick={onDelete} danger />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Action row icon={<ArrowUp size={18} />} label={t('detail.up')} onClick={() => reorderWorkout(w.id, -1)} />
          <Action row icon={<ArrowDown size={18} />} label={t('detail.down')} onClick={() => reorderWorkout(w.id, 1)} />
        </div>
      </div>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted truncate">{label}</p>
      <p className="font-bold">{value}</p>
    </div>
  );
}

function Action({ icon, label, onClick, danger, row }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; row?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl bg-card2 flex ${row ? 'flex-row min-h-[44px] gap-2 text-sm' : 'flex-col min-h-[64px] gap-1 text-xs'} items-center justify-center font-medium active:scale-95 transition ${danger ? 'text-danger' : ''}`}
    >
      {icon}
      {label}
    </button>
  );
}
