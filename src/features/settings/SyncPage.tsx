import { useEffect, useState } from 'react';
import { Cloud, CloudOff, RefreshCw, LogOut, Mail, AlertTriangle } from 'lucide-react';
import { useUI } from '@/app/ui';
import { Field, PageHeader, SectionTitle } from '@/components/ui';
import { useConflicts, useSettings } from '@/db/hooks';
import { updateSettings } from '@/db/repo';
import { db } from '@/db/db';
import { useI18n } from '@/i18n';
import { refreshStatus, resolveConfig, resolveConflictWith, sendMagicLink, signOut, syncNow, useSyncStatus } from '@/sync/sync';
import { SyncChip } from './SettingsPage';

export function SyncPage() {
  const { t, fmt } = useI18n();
  const { toast } = useUI();
  const settings = useSettings();
  const status = useSyncStatus();
  const conflicts = useConflicts();
  const cfg = resolveConfig(settings);
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUrl(settings?.sync.url ?? '');
    setKey(settings?.sync.anonKey ?? '');
  }, [settings?.sync.url, settings?.sync.anonKey]);

  useEffect(() => {
    void refreshStatus();
  }, []);

  const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url.trim()) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url.trim());
  const keyLooksSecret = /service_role/i.test(key) || (() => {
    try {
      return JSON.parse(atob(key.split('.')[1] ?? '')).role === 'service_role';
    } catch {
      return false;
    }
  })();

  const saveCfg = async () => {
    if (!validUrl || !key.trim() || keyLooksSecret) return;
    await updateSettings((s) => ({ sync: { ...s.sync, enabled: true, url: url.trim().replace(/\/$/, ''), anonKey: key.trim(), lastPulledAt: undefined } }));
    await refreshStatus();
  };
  const removeCfg = async () => {
    await signOut().catch(() => undefined);
    await updateSettings((s) => ({ sync: { enabled: false, lastSyncedAt: s.sync.lastSyncedAt } }));
    await refreshStatus();
  };

  const signedIn = status.state === 'idle' || status.state === 'syncing' || status.state === 'error';

  return (
    <div className="pb-28">
      <PageHeader title={t('sync.title')} back />
      <div className="px-4">
        <div className="card p-4 flex items-center gap-3">
          {cfg ? <Cloud size={26} className="text-sky" /> : <CloudOff size={26} className="text-muted" />}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted">{t('sync.status')}</p>
            <p className="font-semibold">{!navigator.onLine ? t('sync.offline') : cfg ? (status.email ? t('sync.signedInAs', { email: status.email }) : t('sync.signedOut')) : t('sync.notConfigured')}</p>
            <p className="text-xs text-muted mt-0.5">
              {settings?.sync.lastSyncedAt ? t('sync.last', { t: fmt(new Date(settings.sync.lastSyncedAt), 'd MMM HH:mm') }) : t('sync.never')}
              {status.pending && cfg ? ` · ${t('sync.pending', { n: status.pending })}` : ''}
            </p>
          </div>
          <SyncChip />
        </div>
        {status.state === 'error' && status.error && (
          <p className="text-sm text-danger mt-2 flex gap-2" role="alert">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {status.error}
          </p>
        )}

        {!cfg && <p className="text-sm text-muted mt-4">{t('sync.notConfiguredHint')}</p>}

        {cfg?.fromEnv ? (
          <p className="text-xs text-muted mt-4">{t('sync.envConfigured')}</p>
        ) : (
          <>
            <SectionTitle>Supabase</SectionTitle>
            <Field label={t('sync.url')} htmlFor="s-url" error={url && !validUrl ? 'https://<project>.supabase.co' : undefined}>
              <input id="s-url" className="input" inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label={t('sync.key')} htmlFor="s-key" hint={t('sync.keyHint')} error={keyLooksSecret ? t('sync.keyHint') : undefined}>
              <input id="s-key" className="input font-mono text-xs" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button className="btn-sky flex-1" disabled={!validUrl || !key.trim() || keyLooksSecret} onClick={saveCfg}>
                {t('sync.saveConfig')}
              </button>
              {settings?.sync.url && (
                <button className="btn-ghost" onClick={removeCfg}>
                  {t('sync.removeConfig')}
                </button>
              )}
            </div>
            <p className="text-xs text-muted mt-3">{t('sync.setupDocs')}</p>
          </>
        )}

        {cfg && (
          <>
            <SectionTitle>{t('sync.title')}</SectionTitle>
            {!signedIn ? (
              <div>
                <Field label={t('sync.email')} htmlFor="s-email">
                  <input id="s-email" type="email" className="input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </Field>
                <button
                  className="btn-primary w-full"
                  disabled={busy || !/^\S+@\S+\.\S+$/.test(email) || !navigator.onLine}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await sendMagicLink(email.trim());
                      toast(t('sync.linkSent'));
                    } catch (e) {
                      toast(`${t('sync.error')}: ${(e as Error).message}`, { tone: 'warn' });
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Mail size={20} /> {t('sync.sendLink')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button className="btn-primary flex-1" disabled={status.state === 'syncing'} onClick={() => syncNow()}>
                  <RefreshCw size={20} className={status.state === 'syncing' ? 'animate-spin' : ''} /> {t('sync.now')}
                </button>
                <button className="btn-ghost" onClick={() => signOut()}>
                  <LogOut size={20} /> {t('sync.signOut')}
                </button>
              </div>
            )}
          </>
        )}

        {conflicts && conflicts.length > 0 && (
          <>
            <SectionTitle>{t('sync.conflicts')}</SectionTitle>
            <p className="text-sm text-muted mb-3">{t('sync.conflictsHint')}</p>
            <div className="flex flex-col gap-2">
              {conflicts.map((c) => {
                const lost = (c.keptVersion === 'remote' ? c.local : c.remote) as { date?: string; updatedAt?: string; type?: string; activity?: string; title?: string };
                return (
                  <div key={c.id} className="card p-3">
                    <p className="text-sm font-semibold">
                      {c.table} · {lost.date ?? ''} {lost.activity ?? ''} {lost.type ?? lost.title ?? ''}
                    </p>
                    <p className="text-xs text-muted">{lost.updatedAt ? fmt(new Date(lost.updatedAt), 'd MMM HH:mm') : ''}</p>
                    <div className="flex gap-2 mt-2">
                      <button className="chip min-h-[36px] text-xs" onClick={() => resolveConflictWith(c.id)}>
                        {t('sync.restoreVersion')}
                      </button>
                      <button className="chip min-h-[36px] text-xs" onClick={() => db.conflicts.delete(c.id)}>
                        {t('sync.dismiss')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
