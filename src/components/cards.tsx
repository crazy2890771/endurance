import { AlertTriangle, CheckCircle2, Clock, SkipForward } from 'lucide-react';
import type { Duty, DutyType, Units, Workout } from '@/domain/types';
import { formatDistance, formatDuration } from '@/lib/format';
import { useI18n } from '@/i18n';
import { ActivityBadge } from './icons';

export function workoutName(t: ReturnType<typeof useI18n>['t'], w: Pick<Workout, 'activity' | 'type'>) {
  if (w.activity === 'rest') return t('type.rest');
  if (w.activity === 'strength') return `${t('activity.strength')} · ${t(`type.${w.type}`)}`;
  if (w.activity === 'run' && w.type === 'long') return t('type.long');
  return t('fmt.workoutName', { type: t(`type.${w.type}`), activity: t(w.activity === 'run' ? 'activity.runShort' : `activity.${w.activity}`) });
}

export function workoutMeta(t: ReturnType<typeof useI18n>['t'], w: Workout, units: Units): string[] {
  const parts: string[] = [];
  if (w.activity === 'rest') return parts;
  if (w.durationMin) parts.push(formatDuration(w.durationMin));
  if (w.distanceKm) parts.push(formatDistance(w.distanceKm, w.activity, units));
  if (w.intervals?.length) {
    const s = w.intervals[0];
    parts.push(`${s.reps} × ${s.distanceM ? `${s.distanceM} m` : s.durationSec ? `${s.durationSec}s` : ''}`.trim());
  }
  if (w.hrZone) parts.push(t('common.zone', { z: w.hrZone }));
  return parts;
}

export function WorkoutCard({
  w,
  units,
  onClick,
  warning,
  compact,
}: {
  w: Workout;
  units: Units;
  onClick?: () => void;
  warning?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const done = w.status === 'completed';
  const skipped = w.status === 'skipped';
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 rounded-2xl bg-card2/70 border border-line/40 px-3 ${compact ? 'py-2' : 'py-3'} active:scale-[.99] transition ${skipped ? 'opacity-50' : ''}`}
    >
      <ActivityBadge activity={w.activity} size={compact ? 'sm' : 'md'} />
      <span className="flex-1 min-w-0">
        <span className={`block font-semibold truncate ${skipped ? 'line-through' : ''}`}>{workoutName(t, w)}</span>
        <span className="block text-xs text-muted truncate">
          {w.startTime && (
            <span className="inline-flex items-center gap-1 mr-1.5">
              <Clock size={11} />
              {w.startTime}
            </span>
          )}
          {workoutMeta(t, w, units).join(' · ')}
        </span>
      </span>
      {warning && <AlertTriangle size={18} className="text-warn shrink-0" aria-label="warning" />}
      {done && <CheckCircle2 size={20} className="text-mint shrink-0" aria-label={t('status.completed')} />}
      {skipped && <SkipForward size={18} className="text-muted shrink-0" aria-label={t('status.skipped')} />}
    </button>
  );
}

export function DutyBadge({ duty, type, size = 'md' }: { duty?: Duty; type?: DutyType; size?: 'sm' | 'md' }) {
  if (!duty || !type) return null;
  const color = type.color;
  return (
    <span
      className={`duty-ink inline-flex items-center justify-center rounded-lg font-bold tracking-tight whitespace-nowrap ${size === 'sm' ? 'text-[10px] px-1.5 h-5 min-w-[34px]' : 'text-xs px-2.5 h-7 min-w-[44px]'}`}
      style={{ backgroundColor: `${color}26`, '--duty': color } as React.CSSProperties}
      title={type.label}
    >
      {type.code}
    </span>
  );
}

export function DutyLine({ duty, type }: { duty: Duty; type?: DutyType }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 min-w-0">
      <DutyBadge duty={duty} type={type} />
      <span className="text-sm text-muted truncate">
        {duty.startTime && duty.endTime ? `${duty.startTime}–${duty.endTime}` : type?.label}
        {duty.title ? ` · ${duty.title}` : ''}
      </span>
      {type && type.allowsTraining !== 'yes' && (
        <span className={`ml-auto text-[10px] font-semibold uppercase rounded-md px-1.5 py-0.5 shrink-0 ${type.allowsTraining === 'no' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'}`}>
          {t(`allow.${type.allowsTraining}`)}
        </span>
      )}
    </div>
  );
}
