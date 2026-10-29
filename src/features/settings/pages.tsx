import { useEffect, useRef, useState } from 'react';
import { LayoutTemplate, Trash2, Upload, FileDown, FileJson, Sparkles, AlertTriangle } from 'lucide-react';
import { useUI } from '@/app/ui';
import { EmptyState, Field, PageHeader, Segmented, Toggle } from '@/components/ui';
import { ActivityBadge } from '@/components/icons';
import { useSettings, useSettingsOrDefault, useTemplates } from '@/db/hooks';
import { clearAllData, deleteTemplate, updateSettings } from '@/db/repo';
import { createBackup, dutiesCsv, isBackup, restoreBackup, workoutsCsv } from '@/db/backup';
import { loadDemoData } from '@/db/demo';
import { db } from '@/db/db';
import { DEFAULT_RULES, defaultHrZones } from '@/domain/catalog';
import { DEFAULT_OVERNIGHT_REST_MIN } from '@/domain/rules';
import type { AppSettings, HRZone, RuleConfig } from '@/domain/types';
import { downloadFile, formatDuration } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { useI18n, type TKey } from '@/i18n';

// ---------------- Units, language, theme ----------------

export function GeneralPage() {
  const { t } = useI18n();
  const s = useSettingsOrDefault();
  return (
    <div className="pb-28">
      <PageHeader title={t('settings.general')} back />
      <div className="px-4">
        <Field label={t('general.language')}>
          <Segmented value={s.language} onChange={(language) => updateSettings({ language })} options={[{ value: 'en', label: 'English' }, { value: 'th', label: 'ไทย' }]} />
        </Field>
        <Field label={t('general.units')}>
          <Segmented value={s.units} onChange={(units) => updateSettings({ units })} options={[{ value: 'metric', label: t('general.metric') }, { value: 'imperial', label: t('general.imperial') }]} />
        </Field>
        <Field label={t('general.theme')}>
          <Segmented value={s.theme} onChange={(theme) => updateSettings({ theme })} options={[{ value: 'dark', label: t('general.dark') }, { value: 'light', label: t('general.light') }, { value: 'system', label: t('general.system') }]} />
        </Field>
        <Field label={t('general.weekStart')}>
          <Segmented value={s.weekStartsOn} onChange={(weekStartsOn) => updateSettings({ weekStartsOn })} options={[{ value: 1 as const, label: t('general.monday') }, { value: 0 as const, label: t('general.sunday') }]} />
        </Field>
        <p className="label mt-2">{t('general.goals')}</p>
        <p className="text-xs text-muted -mt-1 mb-3">{t('general.goalsHint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <GoalInput id="g-run" label={t('general.goalRun')} value={s.goals?.runKm} onSave={(runKm) => updateSettings((c) => ({ goals: { ...c.goals, runKm } }))} />
          <GoalInput id="g-hours" label={t('general.goalHours')} step={0.5} value={s.goals?.hours} onSave={(hours) => updateSettings((c) => ({ goals: { ...c.goals, hours } }))} />
        </div>
      </div>
    </div>
  );
}

/** Number field that keeps what's typed locally and saves it, so typing isn't reset by the async store. */
function GoalInput({ id, label, value, step = 1, onSave }: { id: string; label: string; value?: number; step?: number; onSave: (v: number) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <Field label={label} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0}
        step={step}
        className="input"
        placeholder="0"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onSave(Math.max(0, Number(e.target.value) || 0));
        }}
      />
    </Field>
  );
}

// ---------------- Training rules ----------------

type NumKey<K extends keyof RuleConfig> = Exclude<keyof RuleConfig[K], 'enabled'>;

const RULE_ROWS: { key: keyof RuleConfig; field: string; unit: TKey; min: number; max: number; step: number }[] = [
  { key: 'consecutiveHard', field: 'maxDays', unit: 'rules.unit.days', min: 1, max: 7, step: 1 },
  { key: 'hardRecovery', field: 'minHours', unit: 'rules.unit.hours', min: 12, max: 96, step: 6 },
  { key: 'consecutiveRun', field: 'maxDays', unit: 'rules.unit.days', min: 1, max: 14, step: 1 },
  { key: 'weeklyRest', field: 'minDays', unit: 'rules.unit.days', min: 0, max: 4, step: 1 },
  { key: 'dutyOverlap', field: 'bufferMin', unit: 'rules.unit.min', min: 0, max: 720, step: 30 },
  { key: 'runVolume', field: 'maxIncreasePct', unit: 'rules.unit.pct', min: 5, max: 100, step: 5 },
  { key: 'keySessionsPerWeek', field: 'max', unit: 'rules.unit.count', min: 1, max: 4, step: 1 },
  { key: 'hardNearDuty', field: 'minHours', unit: 'rules.unit.hours', min: 4, max: 16, step: 1 },
  { key: 'runAfterLong', field: 'days', unit: 'rules.unit.days', min: 1, max: 3, step: 1 },
];

export function RulesPage() {
  const { t } = useI18n();
  const s = useSettingsOrDefault();
  const setRule = <K extends keyof RuleConfig>(k: K, patch: Partial<RuleConfig[K]>) =>
    updateSettings((cur) => ({ rules: { ...cur.rules, [k]: { ...cur.rules[k], ...patch } } }));
  return (
    <div className="pb-28">
      <PageHeader title={t('rules.title')} back />
      <div className="px-4">
        <p className="text-sm text-muted mb-4">{t('rules.hint')}</p>
        <div className="flex flex-col gap-2">
          {RULE_ROWS.map((r) => {
            const cfg = s.rules[r.key] as unknown as Record<string, number | boolean>;
            const val = cfg[r.field] as number;
            return (
              <div key={r.key} className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <p className="font-semibold">{t(`rules.${r.key}` as TKey)}</p>
                    <p className="text-xs text-muted mt-0.5">{t(`rules.${r.key}.desc` as TKey)}</p>
                  </div>
                  <Toggle label={t(`rules.${r.key}` as TKey)} checked={!!cfg.enabled} onChange={(enabled) => setRule(r.key, { enabled } as never)} />
                </div>
                {cfg.enabled && (
                  <NumRow
                    value={val}
                    min={r.min}
                    max={r.max}
                    step={r.step}
                    unit={t(r.unit)}
                    label={t(`rules.${r.key}` as TKey)}
                    onChange={(v) => setRule(r.key, { [r.field as NumKey<typeof r.key>]: v } as never)}
                  />
                )}
                {cfg.enabled && r.key === 'dutyOverlap' && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t('rules.dutyOverlap.rest')}</p>
                    <NumRow
                      value={(s.rules.dutyOverlap.overnightRestMin ?? DEFAULT_OVERNIGHT_REST_MIN) / 60}
                      min={0}
                      max={16}
                      step={1}
                      unit={t('rules.unit.hours')}
                      label={t('rules.dutyOverlap.rest')}
                      onChange={(v) => setRule('dutyOverlap', { overnightRestMin: v * 60 })}
                    />
                  </div>
                )}
                {cfg.enabled && r.key === 'runVolume' && (
                  <div className="mt-2">
                    <p className="text-xs text-muted">{t('rules.runVolume.base')}</p>
                    <NumRow value={s.rules.runVolume.minBaseKm} min={0} max={100} step={5} unit="km" label={t('rules.runVolume.base')} onChange={(v) => setRule('runVolume', { minBaseKm: v })} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn-ghost w-full mt-4" onClick={() => updateSettings({ rules: structuredClone(DEFAULT_RULES) })}>
          {t('rules.reset')}
        </button>
      </div>
    </div>
  );
}

function NumRow({ value, min, max, step, unit, label, onChange }: { value: number; min: number; max: number; step: number; unit: string; label: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-3">
      <input type="range" className="flex-1 accent-[rgb(var(--mint))] h-8" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="w-20 text-right font-bold tabular-nums">
        {value} <span className="text-xs text-muted font-normal">{unit}</span>
      </span>
    </div>
  );
}

// ---------------- HR zones ----------------

const ZONE_NAMES: TKey[] = ['zones.z1', 'zones.z2', 'zones.z3', 'zones.z4', 'zones.z5'];
const ZONE_CLS = ['bg-sky/20 text-sky', 'bg-mint/20 text-mint', 'bg-cycle/20 text-cycle', 'bg-warn/20 text-warn', 'bg-danger/20 text-danger'];

export function ZonesPage() {
  const { t } = useI18n();
  const { toast } = useUI();
  const s = useSettings();
  const [maxHr, setMaxHr] = useState('');
  const [zones, setZones] = useState<AppSettings['hrZones']>(defaultHrZones());
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !s) return;
    loaded.current = true;
    setZones(s.hrZones);
    setMaxHr(s.maxHr ? String(s.maxHr) : '');
  }, [s]);
  const [err, setErr] = useState(false);

  const save = async () => {
    const ok = ([1, 2, 3, 4, 5] as HRZone[]).every((z) => zones[z].min >= 40 && zones[z].max <= 230 && zones[z].min <= zones[z].max);
    setErr(!ok);
    if (!ok) return;
    const m = Number(maxHr);
    await updateSettings({ hrZones: zones, maxHr: Number.isFinite(m) && m >= 100 && m <= 230 ? m : undefined });
    toast(t('zones.saved'));
  };

  return (
    <div className="pb-28">
      <PageHeader title={t('zones.title')} back />
      <div className="px-4">
        <p className="text-sm text-muted mb-4">{t('zones.hint')}</p>
        <Field label={t('zones.maxHr')} htmlFor="z-max">
          <div className="flex gap-2">
            <input id="z-max" inputMode="numeric" className="input flex-1" placeholder="bpm" value={maxHr} onChange={(e) => setMaxHr(e.target.value.replace(/\D/g, ''))} />
            <button className="btn-ghost" disabled={!(Number(maxHr) >= 100 && Number(maxHr) <= 230)} onClick={() => setZones(defaultHrZones(Number(maxHr)))}>
              {t('zones.calc')}
            </button>
          </div>
        </Field>
        <div className="flex flex-col gap-2">
          {([1, 2, 3, 4, 5] as HRZone[]).map((z) => (
            <div key={z} className="card p-3 flex items-center gap-3">
              <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${ZONE_CLS[z - 1]}`}>Z{z}</span>
              <span className="flex-1 text-sm font-medium">{t(ZONE_NAMES[z - 1])}</span>
              <input inputMode="numeric" aria-label={`Z${z} min`} className="input w-16 min-h-[40px] text-center px-1" value={zones[z].min} onChange={(e) => setZones({ ...zones, [z]: { ...zones[z], min: Number(e.target.value.replace(/\D/g, '')) } })} />
              <span className="text-muted">–</span>
              <input inputMode="numeric" aria-label={`Z${z} max`} className="input w-16 min-h-[40px] text-center px-1" value={zones[z].max} onChange={(e) => setZones({ ...zones, [z]: { ...zones[z], max: Number(e.target.value.replace(/\D/g, '')) } })} />
            </div>
          ))}
        </div>
        {err && (
          <p className="text-danger text-sm mt-3" role="alert">
            {t('zones.err')}
          </p>
        )}
        <button className="btn-primary w-full mt-4" onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </div>
  );
}

// ---------------- Templates ----------------

export function TemplatesPage() {
  const { t } = useI18n();
  const { open, toast } = useUI();
  const templates = useTemplates();
  return (
    <div className="pb-28">
      <PageHeader title={t('templates.title')} back />
      <div className="px-4 flex flex-col gap-2">
        {templates?.length === 0 && <EmptyState icon={<LayoutTemplate size={26} />} title={t('templates.empty')} hint={t('templates.emptyHint')} />}
        {templates?.map((tpl) => (
          <div key={tpl.id} className="card p-3 flex items-center gap-3">
            <ActivityBadge activity={tpl.activity} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{tpl.name}</p>
              <p className="text-xs text-muted">
                {t(`type.${tpl.type}`)} · {formatDuration(tpl.durationMin)}
                {tpl.hrZone ? ` · ${t('common.zone', { z: tpl.hrZone })}` : ''}
              </p>
            </div>
            <button className="chip min-h-[40px] text-sm bg-mint/15 text-mint" onClick={() => open({ kind: 'workoutEditor', date: todayISO(), template: tpl })}>
              {t('templates.use')}
            </button>
            <button
              className="icon-btn text-danger"
              aria-label={t('common.delete')}
              onClick={async () => {
                await deleteTemplate(tpl.id);
                toast(t('templates.deleted'));
              }}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Backup & data ----------------

export function DataPage() {
  const { t } = useI18n();
  const { toast, confirm } = useUI();
  const file = useRef<HTMLInputElement>(null);
  const [counts, setCounts] = useState({ w: 0, d: 0 });
  const [persisted, setPersisted] = useState<boolean | null>(null);

  const refresh = async () => {
    const [w, d] = await Promise.all([db.workouts.filter((x) => !x.deleted).count(), db.duties.filter((x) => !x.deleted).count()]);
    setCounts({ w, d });
  };
  useEffect(() => {
    void refresh();
    void navigator.storage?.persisted?.().then(setPersisted);
  }, []);

  const stamp = todayISO();
  const exportJson = async () => {
    downloadFile(`ground-time-backup-${stamp}.json`, JSON.stringify(await createBackup(), null, 2), 'application/json');
    await updateSettings((s) => ({ backup: { ...s.backup, lastAt: new Date().toISOString(), snoozeUntil: undefined } }));
  };
  const restore = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!isBackup(data)) return toast(t('data.invalid'), { tone: 'warn' });
      const n = await restoreBackup(data);
      toast(t('data.restored', { n }));
      void refresh();
    } catch {
      toast(t('data.invalid'), { tone: 'warn' });
    }
  };

  return (
    <div className="pb-28">
      <PageHeader title={t('data.title')} back />
      <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => restore(e.target.files?.[0])} />
      <div className="px-4 flex flex-col gap-2">
        <p className="text-sm text-muted">{t('data.storage', { n: counts.w, d: counts.d })}</p>
        {persisted !== null && (
          <div className="flex items-center gap-2 text-xs text-muted mb-2">
            <span>{t('data.persist', { state: persisted ? t('data.persist.granted') : t('data.persist.notGranted') })}</span>
            {!persisted && (
              <button className="text-sky font-semibold" onClick={async () => setPersisted((await navigator.storage?.persist?.()) ?? false)}>
                {t('common.retry')}
              </button>
            )}
          </div>
        )}
        <button className="btn-primary justify-start" onClick={exportJson}>
          <FileJson size={20} /> {t('data.export')}
        </button>
        <button className="btn-ghost justify-start" onClick={async () => downloadFile(`ground-time-workouts-${stamp}.csv`, await workoutsCsv(), 'text/csv')}>
          <FileDown size={20} /> {t('data.exportCsv')}
        </button>
        <button className="btn-ghost justify-start" onClick={async () => downloadFile(`ground-time-duties-${stamp}.csv`, await dutiesCsv(), 'text/csv')}>
          <FileDown size={20} /> {t('data.exportDuties')}
        </button>
        <button className="btn-ghost justify-start mt-4" onClick={() => file.current?.click()}>
          <Upload size={20} /> {t('data.import')}
        </button>
        <p className="text-xs text-muted">{t('data.importHint')}</p>
        <button
          className="btn-ghost justify-start mt-4"
          onClick={async () => {
            await loadDemoData();
            toast(t('data.demoLoaded'));
            void refresh();
          }}
        >
          <Sparkles size={20} /> {t('data.demo')}
        </button>
        <button
          className="btn-danger justify-start mt-6"
          onClick={async () => {
            if (!(await confirm(t('data.clearConfirm'), { danger: true, confirmLabel: t('common.delete') }))) return;
            await clearAllData();
            toast(t('data.cleared'));
            void refresh();
          }}
        >
          <AlertTriangle size={20} /> {t('data.clear')}
        </button>
      </div>
    </div>
  );
}

