import type { Duty, DutyType, ISODate, Workout } from '@/domain/types';
import { dutiesShownOn } from '@/domain/rules';
import { formatDuration } from '@/lib/format';

/** Default reminder time, local. */
export const DEFAULT_NOTIFY_TIME = '05:00';

export interface Digest {
  title: string;
  body: string;
}

type T = (key: 'notify.title' | 'notify.titleDuty', params?: Record<string, string | number>) => string;

/**
 * Notification text for one day: the planned workouts in order, with the day's duty in the title.
 * Null when nothing is planned, so no notification is sent that day.
 */
export function buildDigest(date: ISODate, workouts: Workout[], duties: Duty[], dutyTypes: DutyType[], t: T, name: (w: Workout) => string): Digest | null {
  const planned = workouts
    .filter((w) => w.date === date && !w.deleted && w.status === 'planned' && w.activity !== 'rest')
    .sort((a, b) => (a.startTime ?? '99').localeCompare(b.startTime ?? '99') || a.order - b.order);
  if (!planned.length) return null;
  const duty = dutiesShownOn(duties, date)
    .map((d) => {
      const code = dutyTypes.find((x) => x.id === d.dutyTypeId)?.code ?? '';
      return d.startTime && d.endTime ? `${code} ${d.startTime}–${d.endTime}` : code;
    })
    .join(', ');
  return {
    title: duty ? t('notify.titleDuty', { n: planned.length, duty }) : t('notify.title', { n: planned.length }),
    body: planned.map((w) => [w.startTime, name(w), formatDuration(w.durationMin)].filter(Boolean).join(' · ')).join('\n'),
  };
}

type FreeT = (key: 'notify.freeTitle' | 'notify.freeAllDay' | 'notify.freeWindows', params?: Record<string, string | number>) => string;

/** Notification for a rostered day with free time but nothing planned (optional). */
export function buildFreeDigest(free: { level: string; windows: { start: number; end: number }[] }, t: FreeT): Digest | null {
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  if (free.level === 'free') return { title: t('notify.freeTitle'), body: t('notify.freeAllDay') };
  if (free.level === 'partial' && free.windows.length)
    return { title: t('notify.freeTitle'), body: t('notify.freeWindows', { windows: free.windows.map((w) => `${hhmm(w.start)}–${hhmm(w.end)}`).join(' · ') }) };
  return null;
}

// ---------- on-device store the service worker reads (public/push-sw.js) ----------

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gt-notify', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('days');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Replaces the stored notification texts with `digests` (date → text). */
export async function storeDigests(digests: Record<ISODate, Digest>) {
  const db = await openStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('days', 'readwrite');
    const store = tx.objectStore('days');
    store.clear();
    for (const [date, d] of Object.entries(digests)) store.put(d, date);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ---------- push subscription ----------

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  });

/** Asks for permission (must run from a tap), subscribes this phone and registers the reminder. */
export async function enablePush(time: string, days: ISODate[]) {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = (await (await fetch('/api/push/key')).json()) as { publicKey: string };
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(publicKey) });
  }
  await syncPush(time, days, sub);
}

/** Tells the server the reminder time and which dates have a plan (no workout details). */
export async function syncPush(time: string, days: ISODate[], sub?: PushSubscription | null) {
  const s = sub ?? (await currentSubscription());
  if (!s) return false;
  await post('/api/push/subscribe', { subscription: s.toJSON(), time, tz: Intl.DateTimeFormat().resolvedOptions().timeZone, days });
  return true;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await currentSubscription();
  if (!sub) throw new Error('not_subscribed');
  return post('/api/push/test', { endpoint: sub.endpoint });
}
