import { useEffect, useState } from 'react';
import { useUI } from '@/app/ui';
import { Sheet } from '@/components/Sheet';
import { Field } from '@/components/ui';
import { workoutName } from '@/components/cards';
import { useSettingsOrDefault, useWorkout } from '@/db/hooks';
import { completeWorkout } from '@/db/repo';
import { distanceUnitLabel, inputToKm, kmToInput } from '@/lib/format';
import { useI18n } from '@/i18n';

export function CompleteSheet() {
  const { sheet, open, close, toast } = useUI();
  const isOpen = sheet.kind === 'complete';
  const w = useWorkout(isOpen ? sheet.id : undefined);
  const settings = useSettingsOrDefault();
  const { t } = useI18n();
  const [duration, setDuration] = useState('');
  const [distance, setDistance] = useState('');
  const [avgHr, setAvgHr] = useState('');
  const [avgPace, setAvgPace] = useState('');
  const [rpe, setRpe] = useState<number | undefined>();
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!w) return;
    // Prefill with the plan (editable) — HR, pace and RPE start empty: we never invent metrics.
    const r = w.result;
    setDuration(String(r?.durationMin ?? w.durationMin ?? ''));
    const km = r?.distanceKm ?? w.distanceKm;
    setDistance(km ? String(kmToInput(km, w.activity, settings.units)) : '');
    setAvgHr(r?.avgHr ? String(r.avgHr) : '');
    setAvgPace(r?.avgPace ?? '');
    setRpe(r?.rpe);
    setNotes(r?.notes ?? '');
    setErrors({});
  }, [w?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen || !w) return null;
  const hasDistance = w.activity !== 'strength' && w.activity !== 'rest';

  const save = async () => {
    const e: Record<string, string> = {};
    const dur = duration.trim() ? Number(duration) : undefined;
    if (dur !== undefined && (!Number.isFinite(dur) || dur < 1 || dur > 1440)) e.duration = t('wizard.err.duration');
    const distN = distance.trim() ? Number(distance.replace(',', '.')) : undefined;
    if (distN !== undefined && (!Number.isFinite(distN) || distN <= 0)) e.distance = t('wizard.err.distance');
    const hr = avgHr.trim() ? Number(avgHr) : undefined;
    if (hr !== undefined && (!Number.isInteger(hr) || hr < 30 || hr > 240)) e.hr = t('complete.err.hr');
    setErrors(e);
    if (Object.keys(e).length) return;
    await completeWorkout(w.id, {
      durationMin: dur,
      distanceKm: distN !== undefined ? Math.round(inputToKm(distN, w.activity, settings.units) * 1000) / 1000 : undefined,
      avgHr: hr,
      avgPace: avgPace.trim() || undefined,
      rpe,
      notes: notes.trim() || undefined,
    });
    toast(t('complete.saved'));
    open({ kind: 'workoutDetail', id: w.id });
  };

  return (
    <Sheet
      open
      onClose={close}
      title={t('complete.title')}
      footer={
        <button className="btn-primary w-full" onClick={save}>
          {t('complete.save')}
        </button>
      }
    >
      <p className="text-muted mb-4 font-medium">{workoutName(t, w)}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('complete.duration')} error={errors.duration} htmlFor="c-dur">
          <input id="c-dur" inputMode="numeric" className="input" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </Field>
        {hasDistance && (
          <Field label={`${t('complete.distance')} (${distanceUnitLabel(w.activity, settings.units)})`} error={errors.distance} htmlFor="c-dist">
            <input id="c-dist" inputMode="decimal" className="input" value={distance} onChange={(e) => setDistance(e.target.value)} />
          </Field>
        )}
        <Field label={<>{t('complete.avgHr')}</>} error={errors.hr} htmlFor="c-hr">
          <input id="c-hr" inputMode="numeric" className="input" placeholder="—" value={avgHr} onChange={(e) => setAvgHr(e.target.value)} />
        </Field>
        {hasDistance && (
          <Field label={t('complete.avgPace')} htmlFor="c-pace">
            <input id="c-pace" className="input" placeholder={w.activity === 'cycle' ? 'km/h' : w.activity === 'swim' ? '/100 m' : '/km'} value={avgPace} onChange={(e) => setAvgPace(e.target.value)} />
          </Field>
        )}
      </div>
      <Field label={t('complete.rpe')}>
        <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="RPE">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={rpe === n}
              onClick={() => setRpe(rpe === n ? undefined : n)}
              className={`min-h-[44px] rounded-lg text-sm font-bold transition ${rpe === n ? (n >= 8 ? 'bg-danger text-white' : n >= 5 ? 'bg-warn text-[#241300]' : 'bg-mint text-[#062015]') : 'bg-card2 text-muted'}`}
            >
              {n}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('complete.notes')} htmlFor="c-notes">
        <textarea id="c-notes" rows={3} className="input py-3" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Sheet>
  );
}
