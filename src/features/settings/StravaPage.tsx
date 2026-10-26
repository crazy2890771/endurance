import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Link2Off, RefreshCw } from 'lucide-react';
import { useUI } from '@/app/ui';
import { PageHeader, Spinner } from '@/components/ui';
import { ActivityBadge } from '@/components/icons';
import { workoutName } from '@/components/cards';
import { useSettingsOrDefault } from '@/db/hooks';
import { db } from '@/db/db';
import { deleteWorkout, importStravaResults, reopenWorkout, updateSettings } from '@/db/repo';
import { addDaysISO, fromISODate, todayISO } from '@/lib/dates';
import { formatDistance, formatDuration } from '@/lib/format';
import { isStandalone } from '@/lib/care';
import {
  DEFAULT_TYPE,
  disconnectStrava,
  fetchStravaActivities,
  matchActivities,
  StravaError,
  stravaResult,
  stravaStatus,
  type StravaMatch,
} from '@/lib/strava';
import { useI18n, type TKey } from '@/i18n';

const STRAVA_ORANGE = 'bg-[#FC5200] text-white';
const ERRORS = ['denied', 'state', 'scope', 'exchange', 'reauth', 'rate_limited', 'not_configured', 'network'];
const errKey = (code?: string | null) => `strava.err.${ERRORS.includes(code ?? '') ? code : 'network'}` as TKey;

/** Connect Strava, pull recent activities, and review how they map onto the plan before saving. */
export function StravaPage() {
  const { t, fmt } = useI18n();
  const { toast, confirm } = useUI();
  const nav = useNavigate();
  const settings = useSettingsOrDefault();
  const strava = settings.strava;
  const [configured, setConfigured] = useState<boolean | null>(__ARTIFACT__ ? false : null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<(StravaMatch & { include: boolean })[] | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  useEffect(() => {
    if (!__ARTIFACT__) void stravaStatus().then(setConfigured);
    // Back from Strava sign-in: the Worker hands over the sealed token in the URL fragment.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (hash.has('connect') || hash.has('error')) {
      history.replaceState(null, '', window.location.pathname);
      const token = hash.get('connect');
      if (token) {
        void updateSettings({ strava: { token, athlete: hash.get('name') || undefined, connectedAt: new Date().toISOString() } });
        setJustConnected(true);
        toast(t('strava.connected'));
      } else setError(t(errKey(hash.get('error'))));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sync = async () => {
    if (!strava) return;
    setBusy(true);
    setError(undefined);
    setRows(null);
    try {
      // From the last sync (with a 2-day overlap), at most 30 days back.
      const from = strava.lastSyncAt ? Math.min(Date.parse(strava.lastSyncAt) - 2 * 86400e3, Date.now()) : Date.now() - 30 * 86400e3;
      const res = await fetchStravaActivities(strava.token, Math.floor(Math.max(from, Date.now() - 60 * 86400e3) / 1000));
      if (res.token) await updateSettings((s) => ({ strava: s.strava && { ...s.strava, token: res.token! } }));
      const fromDate = addDaysISO(todayISO(), -61);
      const workouts = await db.workouts.where('date').between(fromDate, addDaysISO(todayISO(), 1), true, true).toArray();
      const matches = matchActivities(res.activities, workouts);
      setRows(matches.filter((m) => m.kind && !m.imported).map((m) => ({ ...m, include: true })));
      await updateSettings((s) => ({ strava: s.strava && { ...s.strava, lastSyncAt: new Date().toISOString() } }));
    } catch (e) {
      setError(t(errKey(e instanceof StravaError ? e.code : 'network')));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const chosen = (rows ?? []).filter((r) => r.include);
    const res = await importStravaResults(
      chosen.map((r) => ({
        workoutId: r.workout?.id,
        date: r.activity.startLocal.slice(0, 10),
        startTime: r.activity.startLocal.slice(11, 16),
        activity: r.kind!,
        type: DEFAULT_TYPE[r.kind!],
        result: stravaResult(r.activity),
      })),
    );
    setRows(null);
    toast(t('strava.saved', { n: res.completed.length + res.created.length }), {
      action: { label: t('common.undo'), run: () => void Promise.all([...res.completed.map(reopenWorkout), ...res.created.map(deleteWorkout)]) },
    });
  };

  const disconnect = async () => {
    if (!strava || !(await confirm(t('strava.disconnectConfirm'), { confirmLabel: t('strava.disconnect'), danger: true }))) return;
    await disconnectStrava(strava.token);
    await updateSettings({ strava: undefined });
    setRows(null);
  };

  const upd = (i: number, include: boolean) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, include } : r)));
  const selected = rows?.filter((r) => r.include).length ?? 0;

  return (
    <div className="pb-32">
      <PageHeader title="Strava" back />
      <div className="px-4 flex flex-col gap-4">
        {error && (
          <div className="card border-danger/40 p-4 text-danger flex gap-2" role="alert">
            <AlertTriangle size={20} className="shrink-0" /> {error}
          </div>
        )}

        {configured === null ? (
          <Spinner />
        ) : !configured ? (
          <div className="card p-4 text-sm">
            <p className="font-semibold mb-2">{t(__ARTIFACT__ ? 'strava.artifact' : 'strava.setupTitle')}</p>
            {!__ARTIFACT__ && (
              <ol className="list-decimal pl-5 flex flex-col gap-1.5 text-muted">
                <li>{t('strava.setup1')}</li>
                <li>{t('strava.setup2', { domain: window.location.host })}</li>
                <li>{t('strava.setup3')}</li>
              </ol>
            )}
          </div>
        ) : !strava ? (
          <div className="card p-5 flex flex-col items-center text-center gap-3">
            <p className="text-sm text-muted">{t('strava.intro')}</p>
            <a href="/api/strava/connect" className={`inline-flex items-center justify-center rounded-xl px-5 min-h-[48px] font-bold ${STRAVA_ORANGE}`}>
              {t('strava.connect')}
            </a>
            <details className="w-full text-left mt-1">
              <summary className="text-xs text-muted cursor-pointer">{t('strava.pasteTitle')}</summary>
              <form
                className="flex gap-2 mt-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = new FormData(e.currentTarget).get('code')?.toString().trim();
                  if (code) void updateSettings({ strava: { token: code, connectedAt: new Date().toISOString() } }).then(() => toast(t('strava.connected')));
                }}
              >
                <input name="code" className="input flex-1 min-h-[40px] text-xs font-mono" placeholder={t('strava.pastePh')} autoComplete="off" />
                <button className="btn-ghost min-h-[40px] text-sm">{t('common.save')}</button>
              </form>
            </details>
          </div>
        ) : (
          <>
            <div className="card p-4 flex items-center gap-3">
              <CheckCircle2 size={24} className="text-mint shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{t('strava.connectedAs', { name: strava.athlete || 'Strava' })}</p>
                <p className="text-xs text-muted">
                  {strava.lastSyncAt ? t('strava.lastSync', { date: fmt(new Date(strava.lastSyncAt), 'd MMM HH:mm') }) : t('strava.neverSynced')}
                </p>
              </div>
              <button className="icon-btn" aria-label={t('strava.disconnect')} onClick={disconnect}>
                <Link2Off size={20} />
              </button>
            </div>
            {justConnected && !isStandalone() && (
              <div className="card p-3 -mt-2 text-xs text-muted flex items-center gap-2">
                <span className="flex-1">{t('strava.homeScreenNote')}</span>
                <button
                  className="chip min-h-[36px] text-xs shrink-0"
                  onClick={() => void navigator.clipboard?.writeText(strava.token).then(() => toast(t('strava.codeCopied')))}
                >
                  {t('strava.copyCode')}
                </button>
              </div>
            )}
            <button className="btn-primary w-full" onClick={sync} disabled={busy}>
              <RefreshCw size={20} className={busy ? 'animate-spin' : ''} /> {t('strava.sync')}
            </button>
          </>
        )}

        {rows && rows.length === 0 && <p className="card p-4 text-sm text-muted">{t('strava.nothingNew')}</p>}
        {rows && rows.length > 0 && (
          <div className="animate-rise">
            <h2 className="text-lg font-bold">{t('strava.review')}</h2>
            <p className="text-sm text-muted mb-3">{t('strava.reviewHint')}</p>
            <div className="flex flex-col gap-2">
              {rows.map((r, i) => {
                const res = stravaResult(r.activity);
                return (
                  <label key={r.activity.id} className={`card p-3 flex items-start gap-3 cursor-pointer ${r.include ? '' : 'opacity-60'}`}>
                    <input type="checkbox" className="w-6 h-6 mt-1 accent-[rgb(var(--mint))]" checked={r.include} onChange={(e) => upd(i, e.target.checked)} />
                    <ActivityBadge activity={r.kind!} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold truncate">{r.activity.name}</span>
                      <span className="block text-xs text-muted tabular-nums">
                        {fmt(fromISODate(r.activity.startLocal.slice(0, 10)), 'EEE d MMM')} {r.activity.startLocal.slice(11, 16)} · {formatDuration(res.durationMin ?? 0)}
                        {res.distanceKm ? ` · ${formatDistance(res.distanceKm, r.kind!, settings.units)}` : ''}
                        {res.avgHr ? ` · ${res.avgHr} bpm` : ''}
                      </span>
                      <span className={`block text-xs mt-1 font-semibold ${r.workout ? 'text-mint' : 'text-sky'}`}>
                        {r.workout ? t('strava.completes', { name: workoutName(t, r.workout) }) : t('strava.addsNew')}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <p className="text-[11px] text-muted text-center">{t('strava.powered')}</p>
      </div>

      {rows && rows.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] px-4 pb-3 pt-2 bg-gradient-to-t from-bg via-bg to-transparent z-30">
          <button
            className="btn-primary w-full max-w-lg mx-auto flex"
            disabled={!selected}
            onClick={async () => {
              await save();
              nav('/history');
            }}
          >
            {t('strava.save', { n: selected })}
          </button>
        </div>
      )}
    </div>
  );
}
