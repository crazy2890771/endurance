import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Sheet } from '@/components/Sheet';
import { Field, Toggle } from '@/components/ui';
import { db } from '@/db/db';
import { useDutyTypes } from '@/db/hooks';
import { deleteDuty, saveDuty } from '@/db/repo';
import type { Duty } from '@/domain/types';
import { addDaysISO, isValidHHmm, isValidISODate, todayISO } from '@/lib/dates';
import { useI18n } from '@/i18n';

export function DutyEditor() {
  const { sheet, close, toast, confirm } = useUI();
  const isOpen = sheet.kind === 'dutyEditor';
  const params = isOpen ? sheet : undefined;
  const types = useDutyTypes();
  const { t } = useI18n();
  const [existing, setExisting] = useState<Duty>();
  const [dutyTypeId, setType] = useState('');
  const [date, setDate] = useState(todayISO());
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [endDate, setEndDate] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!params) return;
    setErrors({});
    const reset = (d?: Duty) => {
      setExisting(d);
      setType(d?.dutyTypeId ?? '');
      setDate(d?.date ?? params.date ?? todayISO());
      setStart(d?.startTime ?? '');
      setEnd(d?.endTime ?? '');
      setEndDate(d?.endDate ?? '');
      setTitle(d?.title ?? '');
      setNotes(d?.notes ?? '');
    };
    if (params.id) void db.duties.get(params.id).then(reset);
    else reset();
  }, [isOpen, params?.id, params?.date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dutyTypeId && types?.length) setType(types[0].id);
  }, [types, dutyTypeId]);

  if (!isOpen) return null;
  const overnight = !!start && !!end && end <= start;
  const multiDay = !!endDate && endDate > date;

  const save = async () => {
    const e: Record<string, string> = {};
    if (!isValidISODate(date)) e.date = t('wizard.err.date');
    if (start && !isValidHHmm(start)) e.start = t('wizard.err.time');
    if (end && !isValidHHmm(end)) e.end = t('wizard.err.time');
    if (endDate && (!isValidISODate(endDate) || endDate < date)) e.endDate = t('duty.err.end');
    if (endDate && endDate === date && start && end && end <= start) e.end = t('duty.err.end');
    setErrors(e);
    if (Object.keys(e).length || !dutyTypeId) return;
    await saveDuty({
      id: existing?.id,
      date,
      dutyTypeId,
      startTime: start || undefined,
      endTime: end || undefined,
      endDate: endDate && endDate > date ? endDate : undefined,
      title: title.trim() || undefined,
      notes: notes.trim() || undefined,
      source: existing?.source ?? 'manual',
      sourceKey: existing?.sourceKey,
    });
    toast(t('duty.saved'));
    close();
  };

  const remove = async () => {
    if (!existing) return;
    if (!(await confirm(`${t('common.delete')}?`, { danger: true, confirmLabel: t('common.delete') }))) return;
    await deleteDuty(existing.id);
    toast(t('duty.deleted'));
    close();
  };

  return (
    <Sheet
      open
      onClose={close}
      title={existing ? t('duty.edit') : t('duty.add')}
      footer={
        <div className="flex gap-2">
          {existing && (
            <button className="btn-danger" onClick={remove} aria-label={t('common.delete')}>
              <Trash2 size={20} />
            </button>
          )}
          <button className="btn-ghost flex-1" onClick={close}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary flex-[2]" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      }
    >
      <Field label={t('duty.type')}>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={t('duty.type')}>
          {types?.map((ty) => (
            <button
              key={ty.id}
              role="radio"
              aria-checked={dutyTypeId === ty.id}
              onClick={() => setType(ty.id)}
              className={`chip px-1 text-xs font-bold ${dutyTypeId === ty.id ? '' : 'duty-ink'}`}
              style={dutyTypeId === ty.id ? { backgroundColor: ty.color, color: '#0b0f12' } : ({ '--duty': ty.color } as React.CSSProperties)}
            >
              {ty.code}
            </button>
          ))}
        </div>
        {types && dutyTypeId && (
          <p className="text-xs text-muted mt-2">
            {types.find((x) => x.id === dutyTypeId)?.label} · {t(`allow.${types.find((x) => x.id === dutyTypeId)?.allowsTraining ?? 'yes'}`)}
          </p>
        )}
      </Field>
      <Field label={t('common.date')} error={errors.date} htmlFor="du-date">
        <input id="du-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('duty.start')} error={errors.start} htmlFor="du-start">
          <input id="du-start" type="time" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label={t('duty.end')} error={errors.end} htmlFor="du-end" hint={overnight && !multiDay ? t('duty.overnight') : undefined}>
          <input id="du-end" type="time" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-semibold">{t('duty.endDate')}</span>
        <Toggle label={t('duty.endDate')} checked={multiDay || !!endDate} onChange={(v) => setEndDate(v ? addDaysISO(date, 1) : '')} />
      </div>
      {(multiDay || !!endDate) && (
        <Field label={t('duty.endDate')} error={errors.endDate} htmlFor="du-enddate">
          <input id="du-enddate" type="date" className="input" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      )}
      <Field label={<>{t('duty.titleField')} <span className="text-muted font-normal">({t('common.optional')})</span></>} htmlFor="du-title">
        <input id="du-title" className="input" placeholder={t('duty.titlePh')} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={<>{t('common.notes')} <span className="text-muted font-normal">({t('common.optional')})</span></>} htmlFor="du-notes">
        <textarea id="du-notes" rows={2} className="input py-3" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Sheet>
  );
}
