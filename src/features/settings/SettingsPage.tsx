import { useEffect, useState } from 'react';
import { Activity, Bell, CalendarCheck, CalendarClock, Heart, Info, ListChecks, Plane, SlidersHorizontal } from 'lucide-react';
import { useSettingsOrDefault } from '@/db/hooks';
import { stravaStatus } from '@/lib/strava';
import { ListLink, PageHeader } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useI18n } from '@/i18n';
import { useSyncStatus } from '@/sync/sync';
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION, versionLabel } from '@/lib/version';

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
  const { strava, notify, calendar } = useSettingsOrDefault();
  // Strava shows once it's set up on the server (or already connected).
  const [stravaReady, setStravaReady] = useState(false);
  useEffect(() => {
    if (!__ARTIFACT__) void stravaStatus().then(setStravaReady);
  }, []);
  return (
    <div className="pb-28">
      <PageHeader
        title={t('settings.title')}
        right={<span className="mr-3 rounded-lg bg-card2 px-2 py-1 text-[11px] font-semibold text-muted tabular-nums">{versionLabel()}</span>}
      />
      <div className="px-4 flex flex-col gap-4">
        <nav className="card divide-y divide-line/50 overflow-hidden">
          <ListLink to="/settings/duties" icon={<Plane size={20} />} title={t('settings.duty')} sub={t('settings.duty.sub')} />
          <ListLink to="/settings/duty-types" icon={<CalendarClock size={20} />} title={t('settings.dutyTypes')} sub={t('settings.dutyTypes.sub')} />
          <ListLink to="/settings/rules" icon={<ListChecks size={20} />} title={t('settings.rules')} sub={t('settings.rules.sub')} />
          <ListLink to="/settings/zones" icon={<Heart size={20} />} title={t('settings.zones')} sub={t('settings.zones.sub')} />
          <ListLink
            to="/settings/calendar"
            icon={<CalendarCheck size={20} />}
            title={t('cal.title')}
            sub={calendar ? t('cal.onSub') : t('cal.offSub')}
          />
          <ListLink
            to="/settings/notifications"
            icon={<Bell size={20} />}
            title={t('notify.pageTitle')}
            sub={notify?.enabled ? t('notify.onSub', { time: notify.time }) : t('notify.offSub')}
          />
          {(strava || stravaReady) && (
            <ListLink
              to="/settings/strava"
              icon={<Activity size={20} />}
              title="Strava"
              sub={strava ? t('strava.connectedAs', { name: strava.athlete || 'Strava' }) : t('strava.sub')}
            />
          )}
          <ListLink to="/settings/general" icon={<SlidersHorizontal size={20} />} title={t('settings.general')} sub={t('settings.general.sub')} />
        </nav>

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
