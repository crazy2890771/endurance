import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePush, localDate, makeVapidKeys, nextAt, PushReminder, vapidAuth, type DONamespace, type DOState } from '../worker/push';
import { buildDigest } from '@/lib/notify';
import { BUILTIN_DUTY_TYPES } from '@/domain/catalog';
import type { Duty, DutyType, Workout } from '@/domain/types';

const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** In-memory Durable Objects: one PushReminder per name, with storage and a recorded alarm. */
function fakeNamespace() {
  const objs = new Map<string, { obj: PushReminder; state: DOState & { alarm?: number; data: Map<string, unknown> } }>();
  const ns: DONamespace = {
    idFromName: (name) => name,
    get: (id) => {
      const name = id as string;
      if (!objs.has(name)) {
        const data = new Map<string, unknown>();
        const state = {
          data,
          alarm: undefined as number | undefined,
          storage: {
            get: async <T,>(k: string) => data.get(k) as T | undefined,
            put: async (k: string, v: unknown) => void data.set(k, structuredClone(v)),
            deleteAll: async () => data.clear(),
            setAlarm: async (t: number) => void (state.alarm = t),
            deleteAlarm: async () => void (state.alarm = undefined),
          },
        };
        objs.set(name, { obj: new PushReminder(state, { REMINDERS: ns }), state });
      }
      const { obj } = objs.get(name)!;
      return { fetch: (url: string, init?: RequestInit) => obj.fetch(new Request(url, init)) };
    },
  };
  return { ns, objs };
}

const api = (ns: DONamespace, path: string, body?: unknown) =>
  handlePush(new Request(`https://endurance.example.workers.dev${path}`, body ? { method: 'POST', body: JSON.stringify(body) } : undefined), { REMINDERS: ns });

describe('reminder time', () => {
  it('finds the next 05:00 in the phone’s time zone', () => {
    // 17:00 in Bangkok → 05:00 tomorrow = 22:00 UTC today
    expect(new Date(nextAt('05:00', 'Asia/Bangkok', Date.parse('2026-10-29T10:00:00Z'))).toISOString()).toBe('2026-10-29T22:00:00.000Z');
    // 04:00 in Bangkok → 05:00 the same morning
    expect(new Date(nextAt('05:00', 'Asia/Bangkok', Date.parse('2026-10-29T21:00:00Z'))).toISOString()).toBe('2026-10-29T22:00:00.000Z');
    // On a layover in Seoul it follows local time
    expect(new Date(nextAt('05:00', 'Asia/Seoul', Date.parse('2026-10-29T10:00:00Z'))).toISOString()).toBe('2026-10-29T20:00:00.000Z');
    // Across a DST change (London leaves summer time on 25 Oct 2026)
    expect(new Date(nextAt('05:00', 'Europe/London', Date.parse('2026-10-24T12:00:00Z'))).toISOString()).toBe('2026-10-25T05:00:00.000Z');
    expect(localDate('Asia/Bangkok', Date.parse('2026-10-29T22:00:00Z'))).toBe('2026-10-30');
  });
});

describe('VAPID', () => {
  it('signs a JWT the public key verifies, for the push service’s origin', async () => {
    const keys = await makeVapidKeys();
    const auth = await vapidAuth('https://web.push.apple.com/abc', keys, 'https://endurance.example.workers.dev', Date.parse('2026-10-29T00:00:00Z'));
    const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    const [h, c, s] = jwt.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromB64url(c)))).toMatchObject({ aud: 'https://web.push.apple.com', sub: 'https://endurance.example.workers.dev' });
    const pub = await crypto.subtle.importKey('raw', fromB64url(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64url(s), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });
});

describe('push reminders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const sub = { endpoint: 'https://web.push.apple.com/device1', keys: { p256dh: 'x', auth: 'y' } };

  it('keeps one VAPID key and validates input', async () => {
    const { ns } = fakeNamespace();
    const a = (await (await api(ns, '/api/push/key')).json()) as { publicKey: string };
    const b = (await (await api(ns, '/api/push/key')).json()) as { publicKey: string };
    expect(a.publicKey).toBe(b.publicKey);
    expect(fromB64url(a.publicKey)).toHaveLength(65);
    expect((await api(ns, '/api/push/subscribe', { subscription: sub, time: '25:00', tz: 'Asia/Bangkok' })).status).toBe(400);
    expect((await api(ns, '/api/push/subscribe', { subscription: sub, time: '05:00', tz: 'Mars/Base' })).status).toBe(400);
    expect((await api(ns, '/api/push/subscribe', { subscription: { endpoint: 'http://x' }, time: '05:00', tz: 'Asia/Bangkok' })).status).toBe(400);
    expect((await handlePush(new Request('https://x/api/push/key'), {})).status).toBe(503);
  });

  it('sets an alarm for 05:00 and pushes only on days with a plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
    const { ns, objs } = fakeNamespace();
    const pushes: { url: string; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      pushes.push({ url, headers: new Headers(init.headers) });
      return new Response(null, { status: 201 });
    });
    const res = await api(ns, '/api/push/subscribe', { subscription: sub, time: '05:00', tz: 'Asia/Bangkok', days: ['2026-10-30'] });
    expect(res.status).toBe(200);
    const dev = objs.get(`device:${sub.endpoint}`)!;
    expect(new Date(dev.state.alarm!).toISOString()).toBe('2026-10-29T22:00:00.000Z');

    vi.setSystemTime(new Date(dev.state.alarm!)); // 05:00 on the 30th: planned
    await dev.obj.alarm();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].url).toBe(sub.endpoint);
    expect(pushes[0].headers.get('authorization')).toMatch(/^vapid t=.+, k=.+/);
    expect(pushes[0].headers.get('ttl')).toBe('3600');
    expect(new Date(dev.state.alarm!).toISOString()).toBe('2026-10-30T22:00:00.000Z');

    vi.setSystemTime(new Date(dev.state.alarm!)); // 05:00 on the 31st: nothing planned
    await dev.obj.alarm();
    expect(pushes).toHaveLength(1);
    expect(new Date(dev.state.alarm!).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });

  it('forgets a phone whose subscription is gone, and supports test and unsubscribe', async () => {
    const { ns, objs } = fakeNamespace();
    let status = 201;
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    await api(ns, '/api/push/subscribe', { subscription: sub, time: '05:00', tz: 'Asia/Bangkok', days: [localDate('Asia/Bangkok', Date.now())] });
    expect(await (await api(ns, '/api/push/test', { endpoint: sub.endpoint })).json()).toEqual({ status: 201 });
    const dev = objs.get(`device:${sub.endpoint}`)!;
    status = 410;
    await dev.obj.alarm();
    expect(dev.state.data.size).toBe(0);
    await api(ns, '/api/push/subscribe', { subscription: sub, time: '05:00', tz: 'Asia/Bangkok', days: [] });
    await api(ns, '/api/push/unsubscribe', { endpoint: sub.endpoint });
    expect(dev.state.alarm).toBeUndefined();
    expect(dev.state.data.size).toBe(0);
  });
});

describe('notification text', () => {
  const types: DutyType[] = BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: '', updatedAt: '' }));
  const w = (p: Partial<Workout>): Workout => ({ id: Math.random().toString(36), date: '2026-10-30', activity: 'run', type: 'easy', durationMin: 45, status: 'planned', order: 0, createdAt: '', updatedAt: '', ...p });
  const t = (k: string, p: Record<string, string | number> = {}) => `${k}:${Object.values(p).join('|')}`;
  const name = (x: Workout) => `${x.activity}-${x.type}`;

  it('lists planned workouts by time with the day’s duty', () => {
    const duty: Duty = { id: 'd', date: '2026-10-30', dutyTypeId: 'dt-flight', startTime: '15:20', endTime: '01:12', source: 'aims', createdAt: '', updatedAt: '' };
    const g = buildDigest('2026-10-30', [w({ startTime: '18:00', type: 'interval' }), w({ startTime: '06:00' }), w({ status: 'completed' }), w({ activity: 'rest', type: 'rest' }), w({ date: '2026-10-31' })], [duty], types, t, name);
    expect(g!.title).toBe('notify.titleDuty:2|Flight 15:20–01:12');
    expect(g!.body.split('\n')).toEqual(['06:00 · run-easy · 45 min', '18:00 · run-interval · 45 min']);
  });

  it('returns nothing on days without a plan, and ignores the tail of last night’s duty', () => {
    expect(buildDigest('2026-10-30', [w({ status: 'skipped' })], [], types, t, name)).toBeNull();
    const night: Duty = { id: 'n', date: '2026-10-29', dutyTypeId: 'dt-flight', startTime: '20:00', endTime: '01:00', source: 'aims', createdAt: '', updatedAt: '' };
    expect(buildDigest('2026-10-30', [w({})], [night], types, t, name)!.title).toBe('notify.title:1');
  });
});
