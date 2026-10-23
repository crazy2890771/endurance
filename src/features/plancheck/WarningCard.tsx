import { AlertTriangle, Info, RotateCcw, ShieldCheck } from 'lucide-react';
import type { RuleWarning } from '@/domain/rules';
import { clearOverride, overrideWarning } from '@/db/repo';
import { fromISODate } from '@/lib/dates';
import { useI18n } from '@/i18n';
import { warningTitle, warningWhy } from './usePlanWarnings';

export function WarningCard({ w, overridden, onAdjust }: { w: RuleWarning; overridden?: boolean; onAdjust?: () => void }) {
  const { t, fmt } = useI18n();
  const Icon = w.severity === 'info' ? Info : AlertTriangle;
  const tone = overridden ? 'text-muted' : w.severity === 'info' ? 'text-sky' : 'text-warn';
  const dates = [...new Set(w.dates)].sort();
  const dateLabel =
    w.ruleId === 'weeklyRest' || w.ruleId === 'runVolume'
      ? `${fmt(fromISODate(dates[0]), 'd MMM')} →`
      : dates.map((d) => fmt(fromISODate(d), 'EEE d')).join(', ');
  return (
    <div className={`card p-3 ${overridden ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${tone}`}>
          <Icon size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-snug">{warningTitle(t, w)}</p>
          <p className="text-xs text-muted mt-0.5">{dateLabel}</p>
          <p className="text-sm text-muted mt-1.5">{warningWhy(t, w)}</p>
          <div className="flex gap-2 mt-3">
            {overridden ? (
              <button className="chip min-h-[36px] text-xs gap-1" onClick={() => clearOverride(w.key)}>
                <RotateCcw size={14} /> {t('warn.undoOverride')}
              </button>
            ) : (
              <>
                {onAdjust && (
                  <button className="chip min-h-[36px] text-xs" onClick={onAdjust}>
                    {t('warn.adjust')}
                  </button>
                )}
                <button className="chip min-h-[36px] text-xs gap-1" onClick={() => overrideWarning(w.key)}>
                  <ShieldCheck size={14} /> {t('warn.override')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
