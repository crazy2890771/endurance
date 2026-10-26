import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Settings2, AlertTriangle } from 'lucide-react';
import { PageHeader, SectionTitle } from '@/components/ui';
import { useSettingsOrDefault } from '@/db/hooks';
import type { RuleConfig } from '@/domain/types';
import { addDaysISO, fromISODate, isValidISODate, todayISO, weekStart } from '@/lib/dates';
import { useI18n, type TKey } from '@/i18n';
import { usePlanWarnings } from './usePlanWarnings';
import { WarningCard } from './WarningCard';

const RULE_TO_IDS: Record<keyof RuleConfig, string[]> = {
  consecutiveHard: ['consecutiveHard'],
  hardRecovery: ['hardRecovery'],
  consecutiveRun: ['consecutiveRun'],
  weeklyRest: ['weeklyRest'],
  dutyOverlap: ['dutyOverlap', 'dutyNoTraining', 'dutyLimited', 'dutyRest'],
  runVolume: ['runVolume'],
  keySessionsPerWeek: ['longRunPerWeek', 'intervalPerWeek', 'tempoPerWeek'],
  hardNearDuty: ['hardBeforeDuty', 'hardAfterOvernight'],
};

export function PlanCheckPage() {
  const [sp, setSp] = useSearchParams();
  const settings = useSettingsOrDefault();
  const { t, fmt } = useI18n();
  const nav = useNavigate();
  const start = weekStart(isValidISODate(sp.get('date') ?? '') ? sp.get('date')! : todayISO(), settings.weekStartsOn);
  const toParam = sp.get('to');
  const end = toParam && isValidISODate(toParam) && toParam > start ? toParam : addDaysISO(start, 6);
  const res = usePlanWarnings(start, end, settings);
  const shift = (dir: number) => setSp({ date: addDaysISO(start, dir * 7) }, { replace: true });

  const active = res?.active ?? [];
  const firedRules = new Set(active.map((w) => w.ruleId as string));
  const passing = (Object.keys(RULE_TO_IDS) as (keyof RuleConfig)[]).filter((k) => settings.rules[k].enabled && !RULE_TO_IDS[k].some((id) => firedRules.has(id)));

  return (
    <div className="pb-28">
      <PageHeader title={t('check.title')} back right={<Link to="/settings/rules" className="icon-btn" aria-label={t('check.configure')}><Settings2 size={22} /></Link>} />
      <div className="px-4">
        <div className="flex items-center justify-between mb-4">
          <button className="icon-btn" onClick={() => shift(-1)} aria-label={t('planner.prevWeek')}>
            <ChevronLeft size={22} />
          </button>
          <p className="font-semibold">
            {fmt(fromISODate(start), 'd MMM')} – {fmt(fromISODate(end), 'd MMM yyyy')}
          </p>
          <button className="icon-btn" onClick={() => shift(1)} aria-label={t('planner.nextWeek')}>
            <ChevronRight size={22} />
          </button>
        </div>

        {res === undefined ? null : active.length === 0 ? (
          <div className="card p-5 flex items-center gap-4 border-mint/30 bg-mint/5 animate-rise">
            <CheckCircle2 size={40} className="text-mint shrink-0" />
            <div>
              <p className="text-lg font-bold text-mint">{t('check.good')}</p>
              <p className="text-sm text-muted">{t('check.goodHint')}</p>
            </div>
          </div>
        ) : (
          <div className="card p-5 flex items-center gap-4 border-warn/30 bg-warn/5 animate-rise">
            <AlertTriangle size={36} className="text-warn shrink-0" />
            <div>
              <p className="text-lg font-bold text-warn">{t('check.issues', { n: active.length })}</p>
              <p className="text-sm text-muted">{t('check.issuesHint')}</p>
            </div>
          </div>
        )}

        {active.length > 0 && (
          <div className="flex flex-col gap-2 mt-4">
            {active.map((w) => (
              <WarningCard key={w.key} w={w} onAdjust={() => nav(`/planner?date=${w.dates[0]}`)} />
            ))}
          </div>
        )}

        {passing.length > 0 && (
          <>
            <SectionTitle>{t('check.passed')}</SectionTitle>
            <div className="flex flex-col gap-2">
              {passing.map((k) => (
                <div key={k} className="card px-4 py-3 flex items-center gap-3">
                  <CheckCircle2 size={22} className="text-mint shrink-0" />
                  <span className="text-sm">{t(`rules.${k}` as TKey)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {(res?.overridden.length ?? 0) > 0 && (
          <>
            <SectionTitle>{t('check.overridden', { n: res!.overridden.length })}</SectionTitle>
            <div className="flex flex-col gap-2">
              {res!.overridden.map((w) => (
                <WarningCard key={w.key} w={w} overridden />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
