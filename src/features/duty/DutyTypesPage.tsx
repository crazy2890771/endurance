import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Field, PageHeader } from '@/components/ui';
import { Sheet } from '@/components/Sheet';
import { useDutyTypes } from '@/db/hooks';
import { deleteDutyType, saveDutyType } from '@/db/repo';
import type { DutyType, TrainingAllowance } from '@/domain/types';
import { useI18n } from '@/i18n';

const ALLOW: TrainingAllowance[] = ['yes', 'limited', 'no'];
const ALLOW_CLS: Record<TrainingAllowance, string> = { yes: 'bg-mint text-[#062015]', limited: 'bg-warn text-[#241300]', no: 'bg-danger text-white' };

export function DutyTypesPage() {
  const { t } = useI18n();
  const types = useDutyTypes();
  const [editing, setEditing] = useState<Partial<DutyType> | null>(null);

  return (
    <div className="pb-28">
      <PageHeader title={t('dutyType.title')} back right={<button className="icon-btn" aria-label={t('dutyType.add')} onClick={() => setEditing({ color: '#52BFFF', allowsTraining: 'limited' })}><Plus size={22} /></button>} />
      <div className="px-4">
        <p className="text-sm text-muted mb-4">{t('dutyType.hint')}</p>
        <div className="flex flex-col gap-2">
          {types?.map((ty) => (
            <div key={ty.id} className="card p-3">
              <button className="w-full flex items-center gap-3 text-left" onClick={() => setEditing(ty)}>
                <span className="duty-ink inline-flex items-center justify-center rounded-lg text-xs font-bold px-2 h-8 min-w-[56px]" style={{ backgroundColor: `${ty.color}26`, '--duty': ty.color } as React.CSSProperties}>
                  {ty.code}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold truncate">{ty.label}</span>
                  {ty.builtin && <span className="text-[11px] text-muted">{t('dutyType.builtin')}</span>}
                </span>
              </button>
              <div className="grid grid-cols-3 gap-1 mt-3 p-1 rounded-xl bg-card2" role="radiogroup" aria-label={`${ty.code} ${t('dutyType.training')}`}>
                {ALLOW.map((a) => (
                  <button key={a} role="radio" aria-checked={ty.allowsTraining === a} onClick={() => saveDutyType({ ...ty, allowsTraining: a })} className={`min-h-[38px] rounded-lg text-xs font-semibold transition ${ty.allowsTraining === a ? ALLOW_CLS[a] : 'text-muted'}`}>
                    {t(`allow.${a}`)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TypeSheet value={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function TypeSheet({ value, onClose }: { value: Partial<DutyType> | null; onClose: () => void }) {
  const { t } = useI18n();
  const { toast, confirm } = useUI();
  const [draft, setDraft] = useState<Partial<DutyType>>({});
  const [kw, setKw] = useState('');
  const [key, setKey] = useState<unknown>(null);
  if (value !== key) {
    setKey(value);
    setDraft(value ?? {});
    setKw((value?.keywords ?? []).join(', '));
  }
  const [err, setErr] = useState<string>();
  if (!value) return null;

  const save = async () => {
    if (!draft.code?.trim() || !draft.label?.trim()) return setErr(t('common.error'));
    await saveDutyType({
      ...(draft as DutyType),
      code: draft.code.trim().slice(0, 8),
      label: draft.label.trim(),
      color: draft.color ?? '#52BFFF',
      allowsTraining: draft.allowsTraining ?? 'limited',
      keywords: kw.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean),
    });
    toast(t('duty.saved'));
    onClose();
  };
  const remove = async () => {
    if (!draft.id || !(await confirm(`${t('common.delete')} ${draft.code}?`, { danger: true, confirmLabel: t('common.delete') }))) return;
    try {
      await deleteDutyType(draft.id);
      onClose();
    } catch (e) {
      const m = (e as Error).message;
      toast(m.startsWith('IN_USE:') ? t('dutyType.inUse', { n: m.slice(7) }) : m, { tone: 'warn' });
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={draft.id ? draft.code : t('dutyType.add')}
      footer={
        <div className="flex gap-2">
          {draft.id && !draft.builtin && (
            <button className="btn-danger" onClick={remove} aria-label={t('common.delete')}>
              <Trash2 size={20} />
            </button>
          )}
          <button className="btn-ghost flex-1" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary flex-[2]" onClick={save}>
            {t('common.save')}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-[1fr_2fr] gap-3">
        <Field label={t('dutyType.code')} htmlFor="dt-code" error={err && !draft.code?.trim() ? err : undefined}>
          <input id="dt-code" className="input uppercase" maxLength={8} disabled={draft.builtin} value={draft.code ?? ''} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label={t('dutyType.label')} htmlFor="dt-label" error={err && !draft.label?.trim() ? err : undefined}>
          <input id="dt-label" className="input" value={draft.label ?? ''} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </Field>
      </div>
      <Field label={t('dutyType.color')} htmlFor="dt-color">
        <input id="dt-color" type="color" className="h-12 w-full rounded-xl bg-card2 border border-line/60 p-1" value={draft.color ?? '#52BFFF'} onChange={(e) => setDraft({ ...draft, color: e.target.value.toUpperCase() })} />
      </Field>
      <Field label={t('dutyType.training')}>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-card2" role="radiogroup">
          {ALLOW.map((a) => (
            <button key={a} role="radio" aria-checked={draft.allowsTraining === a} onClick={() => setDraft({ ...draft, allowsTraining: a })} className={`min-h-[40px] rounded-lg text-sm font-semibold ${draft.allowsTraining === a ? ALLOW_CLS[a] : 'text-muted'}`}>
              {t(`allow.${a}`)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('dutyType.keywords')} htmlFor="dt-kw">
        <input
          id="dt-kw"
          className="input"
          value={kw}
          onChange={(e) => setKw(e.target.value)}
        />
      </Field>
    </Sheet>
  );
}
