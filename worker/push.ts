/**
 * Daily plan notifications (Web Push).
 *
 * One Durable Object per phone (keyed by its push endpoint) keeps the push subscription, the
 * reminder time and time zone, and which dates have planned workouts. Its alarm fires at that local
 * time; on a date with a plan it sends an empty push, and the phone's service worker builds the
 * notification from the plan stored on the device. The plan itself never leaves the phone.
 *
 * VAPID keys are generated once and kept in a dedicated instance ("vapid"), so no secrets are needed.
 */

export interface DOStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(time: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface DOState {
  storage: DOStorage;
}
export interface DONamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch: (url: string, init?: RequestInit) => Promise<Response> };
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys?: { p256dh?: string; auth?: string };
}

interface Reminder {
  subscription: PushSubscriptionJSON;
  time: string; // HH:mm local
  tz: string; // IANA zone, e.g. Asia/Bangkok
  days: string[]; // YYYY-MM-DD with planned workouts
  origin: string; // app origin, used as the VAPID subject
}

interface VapidKeys {
  publicKey: string; // base64url raw P-256 point, for the browser
  privateJwk: JsonWebKey;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const textB64url = (s: string) => b64url(new TextEncoder().encode(s));

// ---------- time zones ----------

/** Local wall-clock parts of `epochMs` in `tz`. */
function parts(tz: string, epochMs: number) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(new Date(epochMs)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** YYYY-MM-DD in `tz` at `epochMs`. */
export function localDate(tz: string, epochMs: number) {
  const p = parts(tz, epochMs);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Epoch ms of local `y-m-d hh:mm` in `tz` (DST-safe to within the usual ambiguity). */
function zonedToEpoch(tz: string, y: number, m: number, d: number, hh: number, mm: number) {
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let t = wanted;
  for (let i = 0; i < 2; i++) {
    const p = parts(tz, t);
    t += wanted - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  }
  return t;
}

/** The next time after `now` that it is `hhmm` in `tz`. */
export function nextAt(hhmm: string, tz: string, now: number) {
  const [hh, mm] = hhmm.split(':').map(Number);
  const today = parts(tz, now);
  for (let off = 0; off < 3; off++) {
    const t = zonedToEpoch(tz, today.y, today.m, today.d + off, hh, mm);
    if (t > now + 30_000) return t;
  }
  return now + 86_400_000;
}

// ---------- VAPID ----------

export async function makeVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { publicKey: b64url(raw), privateJwk: (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey };
}

/** `Authorization` header value for a push to `endpoint` (RFC 8292). */
export async function vapidAuth(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()) {
  const header = textB64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = textB64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${keys.publicKey}`;
}

/** Sends an empty push. Returns the push service's status (404/410 = subscription is gone). */
export async function sendPush(sub: PushSubscriptionJSON, keys: VapidKeys, subject: string) {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { authorization: await vapidAuth(sub.endpoint, keys, subject), ttl: '3600', urgency: 'high', 'content-length': '0' },
  });
  return res.status;
}

// ---------- Durable Object ----------

const ok = (data: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

export class PushReminder {
  constructor(
    private state: DOState,
    private env: { REMINDERS: DONamespace },
  ) {}

  private async vapid(): Promise<VapidKeys> {
    const res = await this.env.REMINDERS.get(this.env.REMINDERS.idFromName('vapid')).fetch('https://do/vapid');
    return (await res.json()) as VapidKeys;
  }

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);
    const s = this.state.storage;

    // The "vapid" instance: create the key pair once, then always return the same one.
    if (pathname === '/vapid') {
      let keys = await s.get<VapidKeys>('vapid');
      if (!keys) {
        keys = await makeVapidKeys();
        await s.put('vapid', keys);
      }
      return ok(keys);
    }

    if (pathname === '/subscribe') {
      const r = (await req.json()) as Reminder;
      await s.put('reminder', r);
      await s.setAlarm(nextAt(r.time, r.tz, Date.now()));
      return ok({ next: nextAt(r.time, r.tz, Date.now()) });
    }

    if (pathname === '/unsubscribe') {
      await s.deleteAlarm();
      await s.deleteAll();
      return ok();
    }

    if (pathname === '/test') {
      const r = await s.get<Reminder>('reminder');
      if (!r) return ok({ error: 'not_subscribed' }, 404);
      return ok({ status: await sendPush(r.subscription, await this.vapid(), r.origin) });
    }

    return ok({ error: 'not_found' }, 404);
  }

  async alarm(): Promise<void> {
    const s = this.state.storage;
    const r = await s.get<Reminder>('reminder');
    if (!r) return;
    if (r.days.includes(localDate(r.tz, Date.now()))) {
      const status = await sendPush(r.subscription, await this.vapid(), r.origin);
      if (status === 404 || status === 410) {
        await s.deleteAll(); // the phone unsubscribed or the app was removed
        return;
      }
    }
    await s.setAlarm(nextAt(r.time, r.tz, Date.now()));
  }
}

// ---------- routes ----------

const validTime = (t: unknown) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const validTz = (tz: unknown) => {
  try {
    return typeof tz === 'string' && !!new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    return false;
  }
};
const validEndpoint = (e: unknown) => typeof e === 'string' && /^https:\/\//.test(e) && e.length < 1000;

export async function handlePush(req: Request, env: { REMINDERS?: DONamespace }): Promise<Response> {
  const url = new URL(req.url);
  if (!env.REMINDERS) return ok({ error: 'not_configured' }, 503);
  const ns = env.REMINDERS;
  const stub = (name: string) => ns.get(ns.idFromName(name));

  if (url.pathname === '/api/push/key') {
    const keys = (await (await stub('vapid').fetch('https://do/vapid')).json()) as VapidKeys;
    return ok({ publicKey: keys.publicKey });
  }
  if (req.method !== 'POST') return ok({ error: 'not_found' }, 404);
  const body = (await req.json().catch(() => ({}))) as Partial<Reminder> & { endpoint?: string };
  const endpoint = body.subscription?.endpoint ?? body.endpoint;
  if (!validEndpoint(endpoint)) return ok({ error: 'bad_request' }, 400);
  const device = stub(`device:${endpoint}`);

  if (url.pathname === '/api/push/subscribe') {
    if (!validTime(body.time) || !validTz(body.tz)) return ok({ error: 'bad_request' }, 400);
    const days = (Array.isArray(body.days) ? body.days : []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 62);
    const reminder: Reminder = { subscription: { endpoint: endpoint!, keys: body.subscription?.keys }, time: body.time!, tz: body.tz!, days, origin: url.origin };
    return device.fetch('https://do/subscribe', { method: 'POST', body: JSON.stringify(reminder) });
  }
  if (url.pathname === '/api/push/unsubscribe') return device.fetch('https://do/unsubscribe', { method: 'POST' });
  if (url.pathname === '/api/push/test') return device.fetch('https://do/test', { method: 'POST' });
  return ok({ error: 'not_found' }, 404);
}
