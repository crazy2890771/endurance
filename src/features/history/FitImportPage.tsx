import { useRef, useState } from 'react';
import { AlertTriangle, FileUp } from 'lucide-react';
import { PageHeader, Spinner } from '@/components/ui';
import { readActivityFiles } from '@/lib/fit';
import { useSettingsOrDefault } from '@/db/hooks';
import { useI18n } from '@/i18n';
import { ActivityReview, reviewRows, type ReviewRow } from './ActivityReview';

/** Import results from Garmin .FIT files (or Garmin Connect's "Export Original" .zip), read on the phone. */
export function FitImportPage() {
  const { t } = useI18n();
  const settings = useSettingsOrDefault();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [skipped, setSkipped] = useState(0);

  const onFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(undefined);
    setRows(null);
    try {
      const acts = await readActivityFiles(files, settings.units);
      if (!acts.length) throw new Error(t('fit.noActivity'));
      const r = await reviewRows(acts);
      setSkipped(acts.length - r.length);
      setRows(r);
    } catch (e) {
      setError(t('fit.failed', { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pb-32">
      <PageHeader title={t('fit.title')} back />
      <div className="px-4 flex flex-col gap-4">
        <input
          ref={input}
          type="file"
          multiple
          accept=".fit,.zip,.csv,text/csv,application/zip,application/octet-stream"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => void onFiles([...(e.target.files ?? [])])}
        />
        <button
          className="card w-full px-4 py-4 flex items-center gap-3 text-left border-mint/50 bg-mint/5 active:scale-[.99] transition"
          disabled={busy}
          onClick={() => {
            if (!input.current) return;
            input.current.value = '';
            input.current.click();
          }}
        >
          <span className="w-12 h-12 rounded-xl bg-mint/15 text-mint flex items-center justify-center shrink-0">
            <FileUp size={24} />
          </span>
          <span className="min-w-0">
            <span className="block font-bold">{t('fit.pick')}</span>
            <span className="block text-xs text-muted">{t('fit.pickHint')}</span>
          </span>
        </button>
        <details className="card px-4 py-3 text-sm">
          <summary className="font-semibold cursor-pointer">{t('fit.howTitle')}</summary>
          <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1 text-muted">
            <li>{t('fit.how1')}</li>
            <li>{t('fit.how2')}</li>
            <li>{t('fit.how3')}</li>
          </ol>
          <p className="font-semibold mt-3">{t('fit.csvTitle')}</p>
          <ol className="list-decimal pl-5 mt-1 flex flex-col gap-1 text-muted">
            <li>{t('fit.csv1')}</li>
            <li>{t('fit.csv2')}</li>
          </ol>
        </details>

        {busy && <Spinner />}
        {error && (
          <div className="card border-danger/40 p-4 text-danger flex gap-2" role="alert">
            <AlertTriangle size={20} className="shrink-0" /> {error}
          </div>
        )}
        {rows && rows.length === 0 && <p className="card p-4 text-sm text-muted">{t('fit.nothingNew')}</p>}
        {rows && skipped > 0 && rows.length > 0 && <p className="text-xs text-muted -mb-2">{t('fit.skipped', { n: skipped })}</p>}
        {rows && rows.length > 0 && <ActivityReview rows={rows} setRows={setRows} />}
      </div>
    </div>
  );
}
