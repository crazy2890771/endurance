import { useState } from 'react';
import { AlertTriangle, BellRing, Send } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Field, PageHeader, Toggle } from '@/components/ui';
import { useSettingsOrDefault } from '@/db/hooks';
import { updateSettings } from '@/db/repo';
import { isStandalone } from '@/lib/care';
import { isValidHHmm } from '@/lib/dates';
import { DEFAULT_NOTIFY_TIME, disablePush, enablePush, pushSupported, testPush } from '@/lib/notify';
import { useI18n } from '@/i18n';

const isIOS = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

/** Daily plan notification: on/off, time, and a test push. The plan text is built on the phone. */
export function NotificationsPage() {
  const { t } = useI18n();
  const { toast } = useUI();
  const settings = useSettingsOrDefault();
  const notify = settings.notify ?? { enabled: false, time: DEFAULT_NOTIFY_TIME };
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(notify.time);

  // iPhone only delivers web notifications to an app added to the Home Screen.
  const blocker = __ARTIFACT__ ? t('notify.artifact') : !pushSupported() || (isIOS() && !isStandalone()) ? t('notify.needsInstall') : undefined;

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      const msg = (e as Error).message;
      toast(msg === 'denied' ? t('notify.denied') : `${t('common.error')}: ${msg}`, { tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (on: boolean) =>
    run(async () => {
      if (on) {
        await enablePush(notify.time, []);
        await updateSettings({ notify: { enabled: true, time: notify.time } });
      } else {
        await disablePush();
        await updateSettings({ notify: { enabled: false, time: notify.time } });
      }
    }, on ? t('notify.on', { time: notify.time }) : t('notify.off'));

  const saveTime = (v: string) => {
    setTime(v);
    // NotifySync sends the new time to the server.
    if (isValidHHmm(v)) void updateSettings({ notify: { ...notify, time: v } });
  };

  return (
    <div className="pb-28">
      <PageHeader title={t('notify.pageTitle')} back />
      <div className="px-4 flex flex-col gap-4">
        <p className="text-sm text-muted">{t('notify.intro')}</p>

        {blocker ? (
          <div className="card border-warn/40 p-4 text-sm flex gap-2">
            <AlertTriangle size={20} className="text-warn shrink-0" /> {blocker}
          </div>
        ) : (
          <>
            <div className="card p-4 flex items-center gap-3">
              <BellRing size={22} className={notify.enabled ? 'text-mint' : 'text-muted'} />
              <span className="flex-1 font-semibold">{t('notify.daily')}</span>
              <Toggle label={t('notify.daily')} checked={notify.enabled} onChange={(on) => void toggle(on)} />
            </div>
            <Field label={t('notify.time')} htmlFor="n-time">
              <input id="n-time" type="time" className="input" value={time} disabled={busy} onChange={(e) => saveTime(e.target.value)} />
            </Field>
            {notify.enabled && (
              <button className="btn-ghost" disabled={busy} onClick={() => void run(testPush, t('notify.testSent'))}>
                <Send size={18} /> {t('notify.test')}
              </button>
            )}
          </>
        )}
        <p className="text-xs text-muted">{t('notify.privacy')}</p>
      </div>
    </div>
  );
}
