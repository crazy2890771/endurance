import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, Upload } from 'lucide-react';
import { useUI } from '@/app/ui';
import { EmptyState, PageHeader, Spinner } from '@/components/ui';
import { useDutyTypes } from '@/db/hooks';
import { findDuplicateDuties, importDuties, type DutyDraft } from '@/db/repo';
import { isAimsRoster, parseAimsRoster } from '@/domain/aimsPdf';
import { extractPdfItems, type ParsedDuty } from '@/domain/importers';
import { isValidHHmm, isValidISODate } from '@/lib/dates';
import { useI18n } from '@/i18n';

interface Row extends ParsedDuty {
  include: boolean;
  duplicate: boolean;
}

/** Roster import: one AIMS Personal Crew Schedule Report PDF at a time, reviewed before saving. */
export function ImportPage() {
  const { t } = useI18n();
  const { toast } = useUI();
  const nav = useNavigate();
  const types = useDutyTypes();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // An updated roster should replace the old duties on the same dates.
  const [replace, setReplace] = useState(true);

  const pick = () => {
    if (!input.current) return;
    input.current.value = '';
    input.current.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !types) return;
    setBusy(true);
    setError(undefined);
    setRows(null);
    try {
      const items = await extractPdfItems(await file.arrayBuffer());
      if (!isAimsRoster(items)) {
        setError(t('import.notAims'));
        return;
      }
      const parsed = parseAimsRoster(items, types);
      const dups = await findDuplicateDuties(parsed.map((p) => toDraft(p, p.dutyTypeId ?? '')));
      setReplace(true);
      setRows(parsed.map((p, i) => ({ ...p, duplicate: dups[i], include: !!p.dutyTypeId })));
    } catch (e) {
      setError(t('import.failed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const toDraft = (r: ParsedDuty, dutyTypeId: string): DutyDraft => ({
    date: r.date,
    endDate: r.endDate,
    startTime: r.startTime,
    endTime: r.endTime,
    dutyTypeId,
    title: r.title && r.title !== types?.find((x) => x.id === dutyTypeId)?.code ? r.title : undefined,
    notes: r.notes,
    source: 'aims',
    sourceKey: r.sourceKey,
  });

  const upd = (i: number, patch: Partial<Row>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const valid = (r: Row) => isValidISODate(r.date) && !!r.dutyTypeId && (!r.startTime || isValidHHmm(r.startTime)) && (!r.endTime || isValidHHmm(r.endTime));
  const selected = rows?.filter((r) => r.include && valid(r)) ?? [];
  // Ticking “replace” re-includes rows that were only unticked as duplicates.
  useEffect(() => {
    if (replace) setRows((rs) => rs?.map((r) => (r.duplicate && r.dutyTypeId ? { ...r, include: true } : r)) ?? rs);
  }, [replace]);

  const save = async () => {
    const res = await importDuties(selected.map((r) => toDraft(r, r.dutyTypeId!)), { replace });
    toast(res.replaced ? t('import.doneReplaced', res) : t('import.done', res));
    nav('/settings/duties');
  };

  return (
    <div className="pb-32">
      <PageHeader title={t('import.title')} back />
      <div className="px-4">
        <input ref={input} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} aria-hidden="true" tabIndex={-1} />
        <button
          className="card w-full px-4 py-4 flex items-center gap-3 text-left border-mint/50 bg-mint/5 active:scale-[.99] transition"
          onClick={pick}
          disabled={busy}
        >
          <span className="w-12 h-12 rounded-xl bg-mint/15 text-mint flex items-center justify-center shrink-0">
            <Upload size={24} />
          </span>
          <span className="min-w-0">
            <span className="block font-bold">{t('import.aimsPdf')}</span>
            <span className="block text-xs text-muted">{t('import.aimsPdfHint')}</span>
          </span>
        </button>

        {busy && <Spinner label={t('import.parsing')} />}
        {error && (
          <div className="card border-danger/40 p-4 mt-4 text-danger flex gap-2" role="alert">
            <AlertTriangle size={20} /> {error}
          </div>
        )}

        {rows && rows.length === 0 && (
          <div className="mt-4">
            <EmptyState icon={<FileText size={26} />} title={t('import.none')} hint={t('import.noneHint')} />
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="mt-6 animate-rise">
            <h2 className="text-lg font-bold">{t('import.review')}</h2>
            <p className="text-sm text-muted mb-1">{t('import.reviewHint')}</p>
            <p className="text-sm text-muted mb-2">{t('import.aimsNote')}</p>
            <p className="text-xs text-muted mb-3">{t('import.rows', { n: rows.length })}</p>
            <label className="card px-3 py-3 mb-3 flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="w-6 h-6 mt-0.5 accent-[rgb(var(--mint))]" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>
                <span className="block text-sm font-semibold">{t('import.replace')}</span>
                <span className="block text-xs text-muted">{t('import.replaceHint')}</span>
              </span>
            </label>
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => (
                <div key={i} className={`card p-3 ${r.include ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="w-6 h-6 accent-[rgb(var(--mint))]" checked={r.include} aria-label="include" onChange={(e) => upd(i, { include: e.target.checked })} />
                    <input type="date" className="input min-h-[40px] flex-1" value={r.date} aria-label={t('common.date')} onChange={(e) => upd(i, { date: e.target.value })} />
                    <select
                      className={`input min-h-[40px] w-[110px] ${r.dutyTypeId ? '' : 'border-warn'}`}
                      value={r.dutyTypeId ?? ''}
                      aria-label={t('duty.type')}
                      onChange={(e) => upd(i, { dutyTypeId: e.target.value || undefined, include: !!e.target.value && !r.duplicate })}
                    >
                      <option value="">?</option>
                      {types?.map((ty) => (
                        <option key={ty.id} value={ty.id}>
                          {ty.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <input type="time" className="input min-h-[40px] flex-1" value={r.startTime ?? ''} aria-label={t('duty.start')} onChange={(e) => upd(i, { startTime: e.target.value || undefined })} />
                    <span className="text-muted">–</span>
                    <input type="time" className="input min-h-[40px] flex-1" value={r.endTime ?? ''} aria-label={t('duty.end')} onChange={(e) => upd(i, { endTime: e.target.value || undefined })} />
                  </div>
                  <p className="text-xs text-muted mt-2 truncate">
                    {r.raw && <span className="font-mono">“{r.raw.slice(0, 80)}”</span>}
                    {r.duplicate && !replace && <span className="ml-2 text-warn font-semibold">{t('import.duplicate')}</span>}
                    {!r.dutyTypeId && <span className="ml-2 text-warn font-semibold">{t('import.unknownType')}</span>}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {rows && rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] px-4 pb-3 pt-2 bg-gradient-to-t from-bg via-bg to-transparent z-30">
          <button className="btn-primary w-full max-w-lg mx-auto flex" disabled={selected.length === 0} onClick={save}>
            {t('import.save', { n: selected.length })}
          </button>
        </div>
      )}
    </div>
  );
}
