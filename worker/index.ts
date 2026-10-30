/**
 * Cloudflare Worker: serves the PWA from static assets, a small Strava API under /api/strava, and
 * daily plan notifications under /api/push (see push.ts), and the calendar feed under /api/cal (calendar.ts).
 *
 * The Strava client secret stays here (Cloudflare secret). After OAuth the Strava tokens are
 * encrypted with a key derived from that secret and handed to the app as an opaque string; the app
 * keeps it on the device and sends it back as a Bearer token. Nothing is stored server-side.
 *
 * Secrets / variables: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET.
 */

import { handlePush, PushReminder, type DONamespace } from './push';
import { CalendarFeed, handleCalendar } from './calendar';

export { PushReminder, CalendarFeed };

export interface Env {
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  REMINDERS?: DONamespace;
  CALENDARS?: DONamespace;
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
}

/** What the app gets for each Strava activity (only the fields it uses). */
export interface StravaActivity {
  id: number;
  name: string;
  sportType: string;
  /** Local start, e.g. 2026-10-26T06:12:00 */
  startLocal: string;
  movingSec: number;
  elapsedSec: number;
  distanceM: number;
  avgHr?: number;
  maxHr?: number;
  avgSpeed?: number;
}

interface Tokens {
  a: string; // access token
  r: string; // refresh token
  e: number; // access token expiry (unix seconds)
  id: number; // athlete id
  n: string; // athlete name
}

const STRAVA = 'https://www.strava.com';
const STATE_COOKIE = 'gt_strava_state';
const APP_PAGE = '/settings/strava';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store', ...headers } });

// ---------- token sealing (AES-GCM, key = SHA-256 of the client secret) ----------

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function sealKey(secret: string) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ground-time-strava:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(t: Tokens, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(secret), new TextEncoder().encode(JSON.stringify(t))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

export async function unseal(s: string, secret: string): Promise<Tokens | null> {
  try {
    const bytes = fromB64url(s);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await sealKey(secret), bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(pt)) as Tokens;
  } catch {
    return null;
  }
}

// ---------- Strava calls ----------

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse | null> {
  const res = await fetch(`${STRAVA}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID!, client_secret: env.STRAVA_CLIENT_SECRET!, ...params }),
  });
  return res.ok ? ((await res.json()) as TokenResponse) : null;
}

/** Refreshes the access token when it expires within a minute. Returns the tokens and whether they changed. */
async function fresh(env: Env, t: Tokens): Promise<{ tokens: Tokens; changed: boolean } | null> {
  if (t.e - 60 > Date.now() / 1000) return { tokens: t, changed: false };
  const r = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: t.r });
  if (!r) return null;
  return { tokens: { ...t, a: r.access_token, r: r.refresh_token, e: r.expires_at }, changed: true };
}

interface RawActivity {
  id: number;
  name: string;
  sport_type?: string;
  type?: string;
  start_date_local: string;
  moving_time: number;
  elapsed_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_speed?: number;
}

export const trimActivity = (a: RawActivity): StravaActivity => ({
  id: a.id,
  name: a.name,
  sportType: a.sport_type ?? a.type ?? '',
  // Strava marks local times with a trailing Z although they are local.
  startLocal: a.start_date_local.replace(/Z$/, ''),
  movingSec: a.moving_time,
  elapsedSec: a.elapsed_time,
  distanceM: a.distance,
  avgHr: a.average_heartrate,
  maxHr: a.max_heartrate,
  avgSpeed: a.average_speed,
});

// ---------- routes ----------

const configured = (env: Env) => !!env.STRAVA_CLIENT_ID && !!env.STRAVA_CLIENT_SECRET;

function cookie(req: Request, name: string) {
  const m = (req.headers.get('cookie') ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1];
}

async function bearer(req: Request, env: Env) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return token ? unseal(token, env.STRAVA_CLIENT_SECRET!) : null;
}

export async function handleStrava(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');

  if (path === '/api/strava/status') return json({ configured: configured(env) });
  if (!configured(env)) return json({ error: 'not_configured' }, 503);

  if (path === '/api/strava/connect') {
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const auth = new URL(`${STRAVA}/oauth/authorize`);
    auth.search = new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID!,
      redirect_uri: `${url.origin}/api/strava/callback`,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: 'read,activity:read_all',
      state,
    }).toString();
    return redirect(auth.toString(), { 'set-cookie': `${STATE_COOKIE}=${state}; Path=/api/strava; Max-Age=600; HttpOnly; Secure; SameSite=Lax` });
  }

  if (path === '/api/strava/callback') {
    const clear = { 'set-cookie': `${STATE_COOKIE}=; Path=/api/strava; Max-Age=0; HttpOnly; Secure; SameSite=Lax` };
    const fail = (reason: string) => redirect(`${APP_PAGE}#error=${reason}`, clear);
    if (url.searchParams.get('error')) return fail('denied');
    const state = url.searchParams.get('state');
    if (!state || state !== cookie(req, STATE_COOKIE)) return fail('state');
    if (!/activity:read/.test(url.searchParams.get('scope') ?? '')) return fail('scope');
    const r = await tokenRequest(env, { grant_type: 'authorization_code', code: url.searchParams.get('code') ?? '' });
    if (!r) return fail('exchange');
    const name = [r.athlete?.firstname, r.athlete?.lastname].filter(Boolean).join(' ');
    const sealed = await seal({ a: r.access_token, r: r.refresh_token, e: r.expires_at, id: r.athlete?.id ?? 0, n: name }, env.STRAVA_CLIENT_SECRET!);
    return redirect(`${APP_PAGE}#connect=${sealed}&name=${encodeURIComponent(name)}`, clear);
  }

  if (path === '/api/strava/activities' && req.method === 'GET') {
    const t = await bearer(req, env);
    if (!t) return json({ error: 'reauth' }, 401);
    const f = await fresh(env, t);
    if (!f) return json({ error: 'reauth' }, 401);
    const after = Number(url.searchParams.get('after')) || Math.floor(Date.now() / 1000) - 30 * 86400;
    const activities: StravaActivity[] = [];
    for (let page = 1; page <= 4; page++) {
      const res = await fetch(`${STRAVA}/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, { headers: { authorization: `Bearer ${f.tokens.a}` } });
      if (res.status === 401) return json({ error: 'reauth' }, 401);
      if (res.status === 429) return json({ error: 'rate_limited' }, 429);
      if (!res.ok) return json({ error: 'strava', status: res.status }, 502);
      const batch = (await res.json()) as RawActivity[];
      activities.push(...batch.map(trimActivity));
      if (batch.length < 100) break;
    }
    return json({ activities, token: f.changed ? await seal(f.tokens, env.STRAVA_CLIENT_SECRET!) : undefined });
  }

  if (path === '/api/strava/disconnect' && req.method === 'POST') {
    const t = await bearer(req, env);
    const f = t && (await fresh(env, t));
    if (f) await fetch(`${STRAVA}/oauth/deauthorize`, { method: 'POST', headers: { authorization: `Bearer ${f.tokens.a}` } });
    return json({ ok: true });
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/strava/')) return handleStrava(req, env);
    if (pathname.startsWith('/api/push/')) return handlePush(req, env);
    if (pathname.startsWith('/api/cal/')) return handleCalendar(req, env);
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
