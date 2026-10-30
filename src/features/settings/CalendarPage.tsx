import { useState } from 'react';
import { CalendarCheck, Copy, RefreshCw, Unlink } from 'lucide-react';
import { useUI } from '@/app/ui';
import { PageHeader } from '@/components/ui';
import { useSettingsOrDefault } from '@/db/hooks';
import { updateSettings } from '@/db/repo';
import { calendarLinks, deleteCalendar, newCalendarToken } from '@/lib/calendar';
import { useI18n } from '@/i18n';

/** Private calendar link so the roster and plan show in the iPhone Calendar (and its widgets). */
export function CalendarPage() {
  const { t, fmt } = useI18n();
  const { toast, confirm } = useUI();
  const settings = useSettingsOrDefault();
  const cal = settings.calendar;
  const [busy, setBusy] = useState(false);
  const links = cal ? calendarLinks(cal.token) : null;

  // CalendarSync uploads as soon as a token exists.
  const start = () => updateSettings({ calendar: { token: newCalendarToken() } });

  const renew = async () => {
    if (!cal || !(await confirm(t('cal.renewConfirm'), { confirmLabel: t('cal.renew') }))) return;
    setBusy(true);
    await deleteCalendar(cal.token);
    await start();
    setBusy(false);
    toast(t('cal.renewed'));
  };

  const stop = async () => {
    if (!cal || !(await confirm(t('cal.stopConfirm'), { confirmLabel: t('cal.stop'), danger: true }))) return;
    setBusy(true);
    await deleteCalendar(cal.token);
    await updateSettings({ calendar: undefined });
    setBusy(false);
    toast(t('cal.stopped'));
  };

  return (
    <div className="pb-28">
      <PageHeader title={t('cal.title')} back />
      <div className="px-4 flex flex-col gap-4">
        <p className="text-sm text-muted">{t('cal.intro')}</p>

        {__ARTIFACT__ ? (
          <p className="card p-4 text-sm">{t('cal.artifact')}</p>
        ) : !cal || !links ? (
          <button className="btn-primary w-full" onClick={() => void start()}>
            <CalendarCheck size={20} /> {t('cal.start')}
          </button>
        ) : (
          <>
            <a href={links.webcal} className="btn-primary w-full">
              <CalendarCheck size={20} /> {t('cal.subscribe')}
            </a>
            <p className="text-xs text-muted -mt-2">
              {cal.lastSyncAt ? t('cal.lastSync', { date: fmt(new Date(cal.lastSyncAt), 'd MMM HH:mm') }) : t('cal.syncing')}
            </p>

            <details className="card px-4 py-3 text-sm">
              <summary className="font-semibold cursor-pointer">{t('cal.manualTitle')}</summary>
              <ol className="list-decimal pl-5 mt-2 flex flex-col gap-1 text-muted">
                <li>{t('cal.manual1')}</li>
                <li>{t('cal.manual2')}</li>
                <li>{t('cal.manual3')}</li>
              </ol>
              <button
                className="btn-ghost w-full mt-3 text-sm"
                onClick={() => void navigator.clipboard?.writeText(links.https).then(() => toast(t('cal.copied')))}
              >
                <Copy size={16} /> {t('cal.copy')}
              </button>
            </details>

            <div className="card px-4 py-3 text-xs text-muted">{t('cal.privacy')}</div>

            <div className="flex gap-2">
              <button className="btn-ghost flex-1 text-sm" disabled={busy} onClick={() => void renew()}>
                <RefreshCw size={16} /> {t('cal.renew')}
              </button>
              <button className="btn-ghost flex-1 text-sm text-danger" disabled={busy} onClick={() => void stop()}>
                <Unlink size={16} /> {t('cal.stop')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
