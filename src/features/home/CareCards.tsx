import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { HardDriveDownload, Share, X } from 'lucide-react';
import { useUI } from '@/app/ui';
import { db } from '@/db/db';
import { updateSettings } from '@/db/repo';
import { createBackup } from '@/db/backup';
import type { AppSettings } from '@/domain/types';
import { backupDue, clearInstallPrompt, installPrompt, isStandalone, snoozeUntil } from '@/lib/care';
import { downloadFile } from '@/lib/format';
import { todayISO } from '@/lib/dates';
import { useI18n } from '@/i18n';

/** Saves the backup file: the share sheet where it can take files (iPhone → Save to Files), else a download. */
async function saveBackupFile(): Promise<boolean> {
  const name = `ground-time-backup-${todayISO()}.json`;
  const json = JSON.stringify(await createBackup(), null, 2);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return false;
    }
  }
  downloadFile(name, json, 'application/json');
  return true;
}

/** Home cards that keep the on-device data safe: a monthly backup reminder and an add-to-Home-Screen hint. */
export function CareCards({ settings }: { settings: AppSettings }) {
  const { t, fmt } = useI18n();
  const { toast } = useUI();
  const hasData = useLiveQuery(async () => (await db.workouts.filter((w) => !w.deleted).count()) > 0, [], false);
  const [canInstall, setCanInstall] = useState(!!installPrompt);
  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);

  const showBackup = backupDue(settings.backup, hasData);
  const showInstall = !__ARTIFACT__ && !settings.installHintDismissed && !isStandalone();
  if (!showBackup && !showInstall) return null;

  const backup = async () => {
    try {
      if (!(await saveBackupFile())) return;
      await updateSettings((s) => ({ backup: { ...s.backup, lastAt: new Date().toISOString(), snoozeUntil: undefined } }));
      toast(t('care.backup.done'));
    } catch (e) {
      toast(`${t('common.error')}: ${(e as Error).message}`, { tone: 'warn' });
    }
  };
  const last = settings.backup?.lastAt;

  return (
    <div className="flex flex-col gap-2 mt-3">
      {showBackup && (
        <section className="card p-4 border-sky/40" aria-label={t('care.backup.title')}>
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-sky/15 text-sky flex items-center justify-center shrink-0">
              <HardDriveDownload size={20} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold">{t('care.backup.title')}</p>
              <p className="text-xs text-muted mt-0.5">{t('care.backup.body')}</p>
              <p className="text-xs text-muted mt-1">{last ? t('care.backup.last', { date: fmt(new Date(last), 'd MMM yyyy') }) : t('care.backup.never')}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="btn-sky flex-1 min-h-[44px] text-sm" onClick={backup}>
              {t('care.backup.now')}
            </button>
            <button className="btn-ghost min-h-[44px] text-sm" onClick={() => void updateSettings((s) => ({ backup: { ...s.backup, snoozeUntil: snoozeUntil() } }))}>
              {t('care.later')}
            </button>
          </div>
        </section>
      )}
      {showInstall && (
        <section className="card p-4 flex items-start gap-3" aria-label={t('care.install.title')}>
          <span className="w-10 h-10 rounded-xl bg-mint/15 text-mint flex items-center justify-center shrink-0">
            <Share size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('care.install.title')}</p>
            <p className="text-xs text-muted mt-0.5">{canInstall ? t('care.install.android') : t('care.install.ios')}</p>
            {canInstall && (
              <button
                className="btn-primary min-h-[40px] text-sm mt-2"
                onClick={async () => {
                  await installPrompt?.prompt();
                  clearInstallPrompt();
                  setCanInstall(false);
                }}
              >
                {t('care.install.button')}
              </button>
            )}
          </div>
          <button className="icon-btn w-9 h-9 -mr-1 -mt-1" aria-label={t('common.close')} onClick={() => void updateSettings({ installHintDismissed: true })}>
            <X size={18} />
          </button>
        </section>
      )}
    </div>
  );
}
