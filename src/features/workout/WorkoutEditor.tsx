import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, BookmarkPlus, Building2, CheckCircle2, Plus, Sun, Trash2, Waves, Mountain } from 'lucide-react';
import { useUI } from '@/app/ui';
import { ChipGroup, Field, Stepper } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { ACTIVITY_ICON, ACTIVITY_TEXT } from '@/components/icons';
import { workoutName } from '@/components/cards';
import { db } from '@/db/db';
import { useDuties, useDutyTypes, useSettingsOrDefault, useTemplates } from '@/db/hooks';
import { saveTemplate, saveWorkout, type WorkoutDraft } from '@/db/repo';
import {
  ACTIVITIES,
  DEFAULT_ZONE_BY_TYPE,
  LOCATIONS_BY_ACTIVITY,
  TYPES_BY_ACTIVITY,
  supportsIntervals,
} from '@/domain/catalog';
import type { Activity, HRZone, IntervalSet, Location, Workout, WorkoutTemplate, WorkoutType } from '@/domain/types';
import { formatMin, isValidHHmm, isValidISODate, parseHHmm, todayISO } from '@/lib/dates';
import { clashingBlocks, dutiesOnDate, dutyBlocksOn, freeWindows } from '@/domain/rules';
import { DutyBadge } from '@/components/cards';
import { distanceUnitLabel, inputToKm, kmToInput } from '@/lib/format';
import { useI18n } from '@/i18n';

interface FormState {
  activity: Activity;
  type: WorkoutType;
  location?: Location;
  date: string;
  startTime: string;
  durationMin: number;
  distance: string;
  hrZone?: HRZone;
  target: string;
  notes: string;
  intervals: IntervalSet[];
}

const LOC_ICON: Record<Location, React.ReactNode> = {
  outdoor: <Sun size={18} />,
  indoor: <Building2 size={18} />,
  pool: <Waves size={18} />,
  openwater: <Mountain size={18} />,
};

function initial(date?: string): FormState {
  return { activity: 'run', type: 'easy', location: 'outdoor', date: date ?? todayISO(), startTime: '', durationMin: 45, distance: '', hrZone: 2, target: '', notes: '', intervals: [] };
}

function fromSource(src: Workout | WorkoutTemplate, units: 'metric' | 'imperial', date?: string): FormState {
  return {
    activity: src.activity,
    type: src.type,
    location: src.location,
    date: 'date' in src ? src.date : (date ?? todayISO()),
    startTime: 'startTime' in src ? (src.startTime ?? '') : '',
    durationMin: src.durationMin,
    distance: src.distanceKm ? String(kmToInput(src.distanceKm, src.activity, units)) : '',
    hrZone: src.hrZone,
    target: src.target ?? '',
    notes: src.notes ?? '',
    intervals: src.intervals ? structuredClone(src.intervals) : [],
  };
}

export function WorkoutEditor() {
  const { sheet, close, toast, open } = useUI();
  const isOpen = sheet.kind === 'workoutEditor';
  const params = isOpen ? sheet : undefined;
  const settings = useSettingsOrDefault();
  const templates = useTemplates();
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [f, setF] = useState<FormState>(initial());
  const [existing, setExisting] = useState<Workout>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tplName, setTplName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!params) return;
    setErrors({});
    setTplName(null);
    if (params.id) {
      void db.workouts.get(params.id).then((w) => {
        if (!w) return;
        setExisting(w);
        setF(fromSource(w, settings.units));
        setStep(3);
      });
    } else if (params.template) {
      setExisting(undefined);
      setF(fromSource(params.template, settings.units, params.date));
      setStep(3);
    } else {
      setExisting(undefined);
      setF(initial(params.date));
      setStep(1);
    }
  }, [isOpen, params?.id, params?.date, params?.template]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const pickActivity = (a: Activity) => {
    const type = TYPES_BY_ACTIVITY[a].includes(f.type) ? f.type : TYPES_BY_ACTIVITY[a][0];
    setF((s) => ({
      ...s,
      activity: a,
      type,
      location: LOCATIONS_BY_ACTIVITY[a][0],
      hrZone: a === 'strength' || a === 'rest' ? undefined : (DEFAULT_ZONE_BY_TYPE[type] ?? s.hrZone),
      durationMin: a === 'swim' ? 40 : a === 'strength' ? 40 : a === 'cycle' ? 60 : 45,
      distance: '',
    }));
    setStep(a === 'rest' ? 3 : 2);
  };

  const pickType = (type: WorkoutType) =>
    setF((s) => ({
      ...s,
      type,
      hrZone: s.activity === 'strength' ? undefined : (DEFAULT_ZONE_BY_TYPE[type] ?? s.hrZone),
      intervals: supportsIntervals(type) ? (s.intervals.length ? s.intervals : type === 'interval' ? [{ reps: 6, distanceM: s.activity === 'swim' ? 100 : 800, recoverySec: 90 }] : []) : [],
    }));

  const unit = distanceUnitLabel(f.activity, settings.units);
  const hasDistance = f.activity !== 'strength' && f.activity !== 'rest';

  function validate(): WorkoutDraft | null {
    const e: Record<string, string> = {};
    if (!isValidISODate(f.date)) e.date = t('wizard.err.date');
    if (f.startTime && !isValidHHmm(f.startTime)) e.startTime = t('wizard.err.time');
    if (f.activity !== 'rest' && (!Number.isFinite(f.durationMin) || f.durationMin < 1 || f.durationMin > 1440)) e.duration = t('wizard.err.duration');
    let distanceKm: number | undefined;
    if (hasDistance && f.distance.trim()) {
      const n = Number(f.distance.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0) e.distance = t('wizard.err.distance');
      else distanceKm = Math.round(inputToKm(n, f.activity, settings.units) * 1000) / 1000;
    }
    const intervals = supportsIntervals(f.type) ? f.intervals.filter((s) => s.reps || s.distanceM || s.durationSec) : [];
    if (intervals.some((s) => !s.reps || s.reps < 1)) e.intervals = t('wizard.err.reps');
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      id: existing?.id,
      activity: f.activity,
      type: f.activity === 'rest' ? 'rest' : f.type,
      location: LOCATIONS_BY_ACTIVITY[f.activity].length ? f.location : undefined,
      date: f.date,
      startTime: f.startTime || undefined,
      durationMin: f.activity === 'rest' ? 0 : f.durationMin,
      distanceKm,
      hrZone: f.activity === 'strength' || f.activity === 'rest' ? undefined : f.hrZone,
      target: f.target.trim() || undefined,
      notes: f.notes.trim() || undefined,
      intervals: intervals.length ? intervals : undefined,
      status: existing?.status,
      result: existing?.result,
    };
  }

  async function onSave() {
    const d = validate();
    if (!d) return;
    setSaving(true);
    try {
      const w = await saveWorkout(d);
      toast(t('wizard.saved'));
      if (existing) open({ kind: 'workoutDetail', id: w.id });
      else close();
    } catch (err) {
      toast(`${t('common.error')}: ${(err as Error).message}`, { tone: 'warn' });
    } finally {
      setSaving(false);
    }
  }

  async function onSaveTemplate() {
    const d = validate();
    if (!d || !tplName?.trim()) return;
    const { date: _d, startTime: _s, status: _st, result: _r, id: _id, ...rest } = d;
    await saveTemplate({ ...rest, name: tplName.trim() });
    setTplName(null);
    toast(t('wizard.templateSaved'));
  }

  const title = existing ? t('wizard.edit') : t('wizard.add');
  const back =
    step > 1 ? (
      <button className="icon-btn" aria-label={t('common.back')} onClick={() => setStep(f.activity === 'rest' && step === 3 ? 1 : step - 1)}>
        <ArrowLeft size={22} />
      </button>
    ) : null;

  const stepLabel = useMemo(() => [t('wizard.step1'), t('wizard.step2'), t('wizard.step3')][step - 1], [step, t]);

  return (
    <Sheet open={isOpen} onClose={close} title={title} leading={back} tall footer={step === 3 ? (
      <div className="flex flex-col gap-2">
        {tplName !== null ? (
          <div className="flex gap-2">
            <input className="input flex-1" autoFocus placeholder={t('wizard.templateName')} aria-label={t('wizard.templateName')} value={tplName} onChange={(e) => setTplName(e.target.value)} />
            <button className="btn-sky" disabled={!tplName.trim()} onClick={onSaveTemplate}>
              {t('common.save')}
            </button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1" onClick={close}>
            {t('common.cancel')}
          </button>
          {f.activity !== 'rest' && tplName === null && (
            <button className="btn-ghost" aria-label={t('wizard.saveTemplate')} title={t('wizard.saveTemplate')} onClick={() => setTplName(workoutName(t, f))}>
              <BookmarkPlus size={20} />
            </button>
          )}
          <button className="btn-primary flex-[2]" onClick={onSave} disabled={saving}>
            {t('common.save')}
          </button>
        </div>
      </div>
    ) : undefined}>
      <div className="flex items-center gap-2 mb-4" aria-label={t('wizard.stepOf', { n: step })}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 flex-1 rounded-full transition ${n <= step ? 'bg-mint' : 'bg-line'}`} />
        ))}
      </div>
      <p className="text-xs uppercase tracking-wider text-muted mb-1">{t('wizard.stepOf', { n: step })}</p>
      <h3 className="text-xl font-bold mb-4">{stepLabel}</h3>

      {step === 1 && (
        <div className="animate-rise">
          <div className="grid grid-cols-2 gap-3">
            {ACTIVITIES.map((a) => {
              const Icon = ACTIVITY_ICON[a];
              const on = f.activity === a && !!existing;
              return (
                <button key={a} onClick={() => pickActivity(a)} className={`card flex flex-col items-center justify-center gap-2 py-5 active:scale-[.98] transition ${on ? 'border-mint' : ''} ${a === 'rest' ? 'col-span-2 flex-row py-4' : ''}`}>
                  <Icon size={30} className={ACTIVITY_TEXT[a]} />
                  <span className="font-semibold">{t(`activity.${a}`)}</span>
                </button>
              );
            })}
          </div>
          {templates && templates.length > 0 && (
            <div className="mt-6">
              <p className="label">{t('wizard.fromTemplate')}</p>
              <div className="flex flex-col gap-2">
                {templates.map((tpl) => {
                  const Icon = ACTIVITY_ICON[tpl.activity];
                  return (
                    <button key={tpl.id} className="flex items-center gap-3 rounded-2xl bg-card2 px-3 py-3 text-left" onClick={() => open({ kind: 'workoutEditor', date: f.date, template: tpl })}>
                      <Icon size={20} className={ACTIVITY_TEXT[tpl.activity]} />
                      <span className="flex-1 font-medium truncate">{tpl.name}</span>
                      <span className="text-xs text-muted">{tpl.durationMin} {t('common.min')}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="animate-rise">
          <p className="label">{t(`activity.${f.activity}`)}</p>
          <ChipGroup cols={f.activity === 'strength' ? 2 : 3} value={f.type} onChange={pickType} ariaLabel={t('wizard.step2')} options={TYPES_BY_ACTIVITY[f.activity].map((ty) => ({ value: ty, label: t(`type.${ty}`) }))} />
          {LOCATIONS_BY_ACTIVITY[f.activity].length > 0 && (
            <div className="mt-6">
              <p className="label">{t('wizard.location')}</p>
              <ChipGroup cols={2} value={f.location} onChange={(v) => set('location', v)} ariaLabel={t('wizard.location')} options={LOCATIONS_BY_ACTIVITY[f.activity].map((l) => ({ value: l, label: t(`loc.${l}`), icon: LOC_ICON[l] }))} />
            </div>
          )}
          <button className="btn-primary w-full mt-8" onClick={() => setStep(3)}>
            {t('common.next')}
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="animate-rise">
          {f.activity !== 'rest' && (
            <button className="flex items-center gap-2 mb-4 text-sm text-muted" onClick={() => setStep(1)}>
              {(() => {
                const Icon = ACTIVITY_ICON[f.activity];
                return <Icon size={18} className={ACTIVITY_TEXT[f.activity]} />;
              })()}
              <span className="font-semibold text-ink">{workoutName(t, f)}</span>
              {f.location && <span>· {t(`loc.${f.location}`)}</span>}
              <span className="text-sky ml-1">{t('common.edit')}</span>
            </button>
          )}
          {f.activity === 'rest' && <p className="text-sm text-muted mb-4">{t('wizard.restHint')}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('wizard.date')} error={errors.date} htmlFor="w-date">
              <input id="w-date" type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} />
            </Field>
            {f.activity !== 'rest' && (
              <Field label={<>{t('wizard.startTime')} <span className="text-muted font-normal">({t('common.optional')})</span></>} error={errors.startTime} htmlFor="w-time">
                <input id="w-time" type="time" className="input" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} />
              </Field>
            )}
          </div>
          {f.activity !== 'rest' && (
            <>
              <Field label={t('wizard.duration')} error={errors.duration}>
                <Stepper label={t('wizard.duration')} value={f.durationMin} onChange={(v) => set('durationMin', v)} step={5} min={5} suffix={t('common.min')} />
              </Field>
              <DutyFit date={f.date} startTime={f.startTime} durationMin={f.durationMin} onPick={(time) => set('startTime', time)} />
              {hasDistance && (
                <Field label={<>{t('wizard.distance')} <span className="text-muted font-normal">({t('common.optional')})</span></>} error={errors.distance} htmlFor="w-dist">
                  <div className="relative">
                    <input id="w-dist" inputMode="decimal" className="input pr-12" placeholder="0" value={f.distance} onChange={(e) => set('distance', e.target.value)} />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted">{unit}</span>
                  </div>
                </Field>
              )}
              {f.activity !== 'strength' && (
                <Field label={t('wizard.hrZone')}>
                  <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={t('wizard.hrZone')}>
                    {([undefined, 1, 2, 3, 4, 5] as (HRZone | undefined)[]).map((z) => (
                      <button key={z ?? 0} role="radio" aria-checked={f.hrZone === z} onClick={() => set('hrZone', z)} className={`chip px-0 ${f.hrZone === z ? 'chip-on' : ''}`}>
                        {z ? `Z${z}` : '—'}
                      </button>
                    ))}
                  </div>
                  {f.hrZone && settings.hrZones[f.hrZone] && (
                    <p className="text-xs text-muted mt-1.5">
                      {settings.hrZones[f.hrZone].min}–{settings.hrZones[f.hrZone].max} bpm
                    </p>
                  )}
                </Field>
              )}
              <Field label={<>{t('wizard.target')} <span className="text-muted font-normal">({t('common.optional')})</span></>} htmlFor="w-target">
                <input id="w-target" className="input" placeholder={t('wizard.targetPh')} value={f.target} onChange={(e) => set('target', e.target.value)} />
              </Field>
              {supportsIntervals(f.type) && <IntervalsEditor value={f.intervals} onChange={(v) => set('intervals', v)} error={errors.intervals} />}
            </>
          )}
          <Field label={<>{t('common.notes')} <span className="text-muted font-normal">({t('common.optional')})</span></>} htmlFor="w-notes">
            <textarea id="w-notes" rows={3} className="input py-3" placeholder={t('wizard.notesPh')} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

function IntervalsEditor({ value, onChange, error }: { value: IntervalSet[]; onChange: (v: IntervalSet[]) => void; error?: string }) {
  const { t } = useI18n();
  const upd = (i: number, patch: Partial<IntervalSet>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const num = (v: string) => {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    return isNaN(n) ? undefined : n;
  };
  return (
    <Field label={t('wizard.intervals')} error={error}>
      <div className="flex flex-col gap-2">
        {value.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_1.3fr_1.3fr_auto] gap-2 items-end">
            <label className="text-[11px] text-muted">
              {t('wizard.reps')}
              <input inputMode="numeric" className="input mt-1 px-2 text-center" value={s.reps ?? ''} onChange={(e) => upd(i, { reps: num(e.target.value) ?? 0 })} />
            </label>
            <label className="text-[11px] text-muted">
              {t('wizard.workDist')}
              <input inputMode="numeric" className="input mt-1 px-2 text-center" value={s.distanceM ?? ''} onChange={(e) => upd(i, { distanceM: num(e.target.value) })} />
            </label>
            <label className="text-[11px] text-muted">
              {t('wizard.recovery')}
              <input inputMode="numeric" className="input mt-1 px-2 text-center" value={s.recoverySec ?? ''} onChange={(e) => upd(i, { recoverySec: num(e.target.value) })} />
            </label>
            <button className="icon-btn text-danger" aria-label={t('common.delete')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <button className="btn-ghost min-h-[44px] text-sm" onClick={() => onChange([...value, { reps: 4, distanceM: 400, recoverySec: 60 }])}>
          <Plus size={18} /> {t('wizard.addSet')}
        </button>
      </div>
    </Field>
  );
}

/** On a duty day: shows the duty, whether the chosen time clashes with it, and the free windows to pick from. */
function DutyFit({ date, startTime, durationMin, onPick }: { date: string; startTime: string; durationMin: number; onPick: (time: string) => void }) {
  const { t } = useI18n();
  const settings = useSettingsOrDefault();
  const day = isValidISODate(date) ? date : todayISO();
  const duties = useDuties(day, day);
  const types = useDutyTypes();
  if (!isValidISODate(date) || !duties || !types) return null;
  const typeById = new Map(types.map((x) => [x.id, x]));
  const relevant = dutiesOnDate(duties, date).filter((d) => {
    const a = typeById.get(d.dutyTypeId)?.allowsTraining;
    return a && a !== 'yes';
  });
  if (!relevant.length) return null;

  const buffer = settings.rules.dutyOverlap.bufferMin;
  const blocks = dutyBlocksOn(date, duties, types, buffer);
  const untimed = relevant.some((d) => !d.startTime || !d.endTime);
  const start = isValidHHmm(startTime) ? parseHHmm(startTime) : null;
  const clash = start !== null ? clashingBlocks(blocks, start, durationMin)[0] : undefined;
  const windows = freeWindows(blocks, Math.max(durationMin, 15));

  return (
    <div className={`card p-3 mb-4 ${clash ? 'border-danger/50' : ''}`}>
      <p className="text-xs text-muted mb-2">{t('wizard.dutyToday')}</p>
      <div className="flex flex-col gap-1.5 mb-2">
        {relevant.map((d) => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <DutyBadge duty={d} type={typeById.get(d.dutyTypeId)} size="sm" />
            <span className="tabular-nums whitespace-nowrap">{d.startTime && d.endTime ? `${d.startTime}–${d.endTime}` : '—'}</span>
            {d.title && <span className="text-muted truncate min-w-0">{d.title}</span>}
          </div>
        ))}
      </div>
      {clash ? (
        <p className="text-sm text-danger flex items-start gap-1.5" role="alert">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          {t('wizard.clash', { duty: typeById.get(clash.duty.dutyTypeId)?.code ?? '', start: clash.duty.startTime ?? '', end: clash.duty.endTime ?? '', buffer })}
        </p>
      ) : start !== null && !untimed ? (
        <p className="text-sm text-mint flex items-center gap-1.5">
          <CheckCircle2 size={16} /> {t('wizard.noClash')}
        </p>
      ) : (
        <p className="text-sm text-muted">{untimed ? t('wizard.dutyNoTimes') : t('wizard.pickTime')}</p>
      )}
      {!untimed && (
        <div className="mt-3">
          <p className="text-xs text-muted mb-1.5">{windows.length ? t('wizard.freeWindows') : t('wizard.noWindow')}</p>
          <div className="flex flex-wrap gap-2">
            {windows.map((w) => (
              <button key={w.start} type="button" className="chip min-h-[36px] text-xs tabular-nums bg-mint/10 text-mint" onClick={() => onPick(formatMin(w.start))}>
                {formatMin(w.start)}–{formatMin(w.end)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
