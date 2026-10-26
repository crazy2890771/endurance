import { useEffect, useState } from 'react';
import {
  CalendarClock,
  Cloud,
  CloudOff,
  Database,
  Download,
  Heart,
  Info,
  LayoutTemplate,
  ListChecks,
  Plane,
  SlidersHorizontal,
} from 'lucide-react';
import { ListLink, PageHeader } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/i18n';
import { useSyncStatus } from '@/sync/sync';
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION } from '@/lib/version';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
  });
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export function SyncChip() {
  const { t } = useI18n();
  const s = useSyncStatus();
  const map = {
    'not-configured': ['bg-card2 text-muted', t('sync.notConfigured')],
    offline: ['bg-warn/15 text-warn', 'Offline'],
    'signed-out': ['bg-warn/15 text-warn', t('sync.signedOut')],
    idle: ['bg-mint/15 text-mint', t('sync.ready')],
    syncing: ['bg-sky/15 text-sky', t('sync.syncing')],
    error: ['bg-danger/15 text-danger', t('sync.error')],
  } as const;
  const [cls, label] = map[s.state];
  return <span className={`text-[11px] font-semibold rounded-lg px-2 py-1 whitespace-nowrap max-w-[140px] truncate ${cls}`}>{label}</span>;
}

export function SettingsPage() {
  const { t, fmt } = useI18n();
  const sync = useSyncStatus();
  const [canInstall, setCanInstall] = useState(!!deferredPrompt);
  useEffect(() => {
    const on = () => setCanInstall(true);
    window.addEventListener('beforeinstallprompt', on);
    return () => window.removeEventListener('beforeinstallprompt', on);
  }, []);
  const standalone = isStandalone();

  return (
    <div className="pb-28">
      <PageHeader title={t('settings.title')} />
      <div className="px-4 flex flex-col gap-4">
        <nav className="card divide-y divide-line/50 overflow-hidden">
          <ListLink to="/settings/duties" icon={<Plane size={20} />} title={t('settings.duty')} sub={t('settings.duty.sub')} />
          <ListLink to="/settings/duty-types" icon={<CalendarClock size={20} />} title={t('settings.dutyTypes')} sub={t('settings.dutyTypes.sub')} />
          <ListLink to="/settings/rules" icon={<ListChecks size={20} />} title={t('settings.rules')} sub={t('settings.rules.sub')} />
          <ListLink to="/settings/zones" icon={<Heart size={20} />} title={t('settings.zones')} sub={t('settings.zones.sub')} />
          <ListLink to="/settings/templates" icon={<LayoutTemplate size={20} />} title={t('settings.templates')} sub={t('settings.templates.sub')} />
        </nav>
        <nav className="card divide-y divide-line/50 overflow-hidden">
          <ListLink to="/settings/general" icon={<SlidersHorizontal size={20} />} title={t('settings.general')} sub={t('settings.general.sub')} />
          <ListLink to="/settings/data" icon={<Database size={20} />} title={t('settings.data')} sub={t('settings.data.sub')} />
          <ListLink
            to="/settings/sync"
            icon={sync.state === 'not-configured' || sync.state === 'offline' ? <CloudOff size={20} /> : <Cloud size={20} />}
            title={t('settings.sync')}
            sub={sync.pending && sync.state !== 'not-configured' ? t('sync.pending', { n: sync.pending }) : undefined}
            right={<SyncChip />}
          />
        </nav>

        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-card2 flex items-center justify-center shrink-0">
            <Download size={20} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">{t('settings.install')}</p>
            <p className="text-xs text-muted">{standalone ? t('settings.installed') : canInstall ? t('settings.install.sub') : t('settings.install.ios')}</p>
          </div>
          {canInstall && !standalone && (
            <button
              className="btn-sky min-h-[40px] text-sm"
              onClick={async () => {
                await deferredPrompt?.prompt();
                deferredPrompt = null;
                setCanInstall(false);
              }}
            >
              {t('common.add')}
            </button>
          )}
        </div>

        <div className="card p-4 flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-card2 flex items-center justify-center shrink-0">
            <Info size={20} />
          </span>
          <div className="flex-1">
            <p className="font-semibold">{t('settings.about')}</p>
            <p className="text-xs text-muted tabular-nums">{t('settings.version', { v: APP_VERSION })}</p>
            <p className="text-[11px] text-muted tabular-nums">{t('settings.build', { commit: APP_COMMIT, date: fmt(new Date(APP_BUILT_AT), 'd MMM yyyy HH:mm') })}</p>
          </div>
          <Logo className="w-10 h-8 text-muted" />
        </div>
      </div>
    </div>
  );
}
