import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { seal, trimActivity, unseal, type Env } from '../worker/index';
import { matchActivities, stravaResult, type StravaActivity } from '@/lib/strava';
import { clearAllData, importStravaResults, saveWorkout } from '@/db/repo';
import { db } from '@/db/db';
import type { Workout } from '@/domain/types';

const env: Env = {
  ASSETS: { fetch: async () => new Response('app shell') },
  STRAVA_CLIENT_ID: '123',
  STRAVA_CLIENT_SECRET: 'shh',
};
const call = (path: string, init?: RequestInit, e: Env = env) => worker.fetch(new Request(`https://endurance.example.workers.dev${path}`, init), e);

const act = (p: Partial<StravaActivity> = {}): StravaActivity => ({
  id: 1,
  name: 'Morning Run',
  sportType: 'Run',
  startLocal: '2026-10-26T06:10:00',
  movingSec: 2700,
  elapsedSec: 2800,
  distanceM: 8000,
  avgHr: 141.6,
  ...p,
});

describe('Strava worker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves the app for normal paths and reports whether Strava is set up', async () => {
    expect(await (await call('/planner')).text()).toBe('app shell');
    expect(await (await call('/api/strava/status')).json()).toEqual({ configured: true });
    expect(await (await call('/api/strava/status', undefined, { ASSETS: env.ASSETS })).json()).toEqual({ configured: false });
    expect((await call('/api/strava/connect', undefined, { ASSETS: env.ASSETS })).status).toBe(503);
  });

  it('seals tokens so only the server secret opens them', async () => {
    const t = { a: 'acc', r: 'ref', e: 99, id: 7, n: 'Kim' };
    const s = await seal(t, 'shh');
    expect(s).not.toContain('acc');
    expect(await unseal(s, 'shh')).toEqual(t);
    expect(await unseal(s, 'other')).toBeNull();
    expect(await unseal('garbage', 'shh')).toBeNull();
  });

  it('sends the user to Strava with a state cookie, and checks it on the way back', async () => {
    const res = await call('/api/strava/connect');
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://www.strava.com/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe('123');
    expect(to.searchParams.get('redirect_uri')).toBe('https://endurance.example.workers.dev/api/strava/callback');
    expect(to.searchParams.get('scope')).toBe('read,activity:read_all');
    const state = to.searchParams.get('state')!;
    expect(res.headers.get('set-cookie')).toContain(`gt_strava_state=${state}`);

    const bad = await call(`/api/strava/callback?code=x&state=nope&scope=read,activity:read_all`, { headers: { cookie: `gt_strava_state=${state}` } });
    expect(bad.headers.get('location')).toBe('/settings/strava#error=state');
    const denied = await call(`/api/strava/callback?error=access_denied&state=${state}`, { headers: { cookie: `gt_strava_state=${state}` } });
    expect(denied.headers.get('location')).toBe('/settings/strava#error=denied');
    const noScope = await call(`/api/strava/callback?code=x&state=${state}&scope=read`, { headers: { cookie: `gt_strava_state=${state}` } });
    expect(noScope.headers.get('location')).toBe('/settings/strava#error=scope');
  });

  it('exchanges the code and hands the app a sealed token', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ access_token: 'acc', refresh_token: 'ref', expires_at: 2e9, athlete: { id: 7, firstname: 'Kim', lastname: 'P' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await call('/api/strava/callback?code=abc&state=s1&scope=read,activity:read_all', { headers: { cookie: 'gt_strava_state=s1' } });
    const loc = res.headers.get('location')!;
    expect(loc.startsWith('/settings/strava#connect=')).toBe(true);
    const hash = new URLSearchParams(loc.split('#')[1]);
    expect(hash.get('name')).toBe('Kim P');
    expect(await unseal(hash.get('connect')!, 'shh')).toEqual({ a: 'acc', r: 'ref', e: 2e9, id: 7, n: 'Kim P' });
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get('client_secret')).toBe('shh');
    expect(body.get('grant_type')).toBe('authorization_code');
  });

  it('refreshes an expired token, returns trimmed activities and the new sealed token', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'acc2', refresh_token: 'ref2', expires_at: 2e9 });
      return Response.json([
        { id: 5, name: 'Easy', sport_type: 'Run', start_date_local: '2026-10-26T06:10:00Z', moving_time: 2700, elapsed_time: 2800, distance: 8000, average_heartrate: 140 },
      ]);
    });
    const token = await seal({ a: 'old', r: 'ref', e: 1, id: 7, n: 'Kim' }, 'shh');
    const res = await call('/api/strava/activities?after=1000', { headers: { authorization: `Bearer ${token}` } });
    const body = (await res.json()) as { activities: StravaActivity[]; token: string };
    expect(urls[0]).toBe('https://www.strava.com/oauth/token');
    expect(urls[1]).toContain('/api/v3/athlete/activities?after=1000');
    expect(body.activities).toEqual([trimActivity({ id: 5, name: 'Easy', sport_type: 'Run', start_date_local: '2026-10-26T06:10:00Z', moving_time: 2700, elapsed_time: 2800, distance: 8000, average_heartrate: 140 })]);
    expect(body.activities[0].startLocal).toBe('2026-10-26T06:10:00');
    expect((await unseal(body.token, 'shh'))!.a).toBe('acc2');
  });

  it('rejects a missing or forged token', async () => {
    expect((await call('/api/strava/activities')).status).toBe(401);
    const forged = await seal({ a: 'x', r: 'y', e: 2e9, id: 1, n: '' }, 'other-secret');
    expect((await call('/api/strava/activities', { headers: { authorization: `Bearer ${forged}` } })).status).toBe(401);
  });
});

describe('matching Strava activities to the plan', () => {
  const w = (p: Partial<Workout>): Workout => ({ id: Math.random().toString(36), date: '2026-10-26', activity: 'run', type: 'easy', durationMin: 45, status: 'planned', order: 0, createdAt: '', updatedAt: '', ...p });

  it('pairs by day and activity, nearest start time first, each workout once', () => {
    const early = w({ id: 'early', startTime: '06:00' });
    const late = w({ id: 'late', startTime: '18:00', type: 'interval' });
    const ride = w({ id: 'ride', activity: 'cycle', type: 'endurance' });
    const m = matchActivities(
      [act({ id: 1, startLocal: '2026-10-26T17:45:00' }), act({ id: 2 }), act({ id: 3 }), act({ id: 4, sportType: 'Ride' }), act({ id: 5, sportType: 'Walk' })],
      [early, late, ride],
    );
    const byId = Object.fromEntries(m.map((x) => [x.activity.id, x]));
    expect(byId[2].workout?.id).toBe('early');
    expect(byId[1].workout?.id).toBe('late');
    expect(byId[3].workout).toBeUndefined(); // both runs already taken: becomes a new workout
    expect(byId[4].workout?.id).toBe('ride');
    expect(byId[5].kind).toBeUndefined(); // walks aren't tracked
  });

  it('skips activities already imported and workouts already completed', () => {
    const done = w({ id: 'done', status: 'completed', result: { completedAt: '', stravaId: 9 } });
    const m = matchActivities([act({ id: 9 }), act({ id: 10 })], [done]);
    expect(m[0].imported).toBe(true);
    expect(m[1].workout).toBeUndefined();
  });

  it('converts results the way they would be typed', () => {
    expect(stravaResult(act())).toMatchObject({ durationMin: 45, distanceKm: 8, avgHr: 142, avgPace: '5:38', stravaId: 1, notes: 'Morning Run' });
    expect(stravaResult(act({ sportType: 'Ride', movingSec: 3600, distanceM: 28400 })).avgPace).toBe('28.4');
    expect(stravaResult(act({ sportType: 'Swim', movingSec: 1500, distanceM: 1500 })).avgPace).toBe('1:40');
    expect(stravaResult(act({ sportType: 'WeightTraining', distanceM: 0 }))).toMatchObject({ distanceKm: undefined, avgPace: undefined });
  });
});

describe('saving Strava results', () => {
  beforeEach(async () => {
    await clearAllData();
  });

  it('completes the matched workout (keeping its RPE) and adds unmatched ones', async () => {
    const planned = await saveWorkout({ date: '2026-10-26', activity: 'run', type: 'easy', durationMin: 45, hrZone: 2 });
    await db.workouts.update(planned.id, { result: { rpe: 4, completedAt: '' } });
    const res = await importStravaResults([
      { workoutId: planned.id, date: '2026-10-26', activity: 'run', type: 'easy', result: stravaResult(act()) },
      { date: '2026-10-25', startTime: '07:00', activity: 'cycle', type: 'endurance', result: stravaResult(act({ id: 2, sportType: 'Ride' })) },
    ]);
    expect(res.completed).toEqual([planned.id]);
    const a = await db.workouts.get(planned.id);
    expect(a).toMatchObject({ status: 'completed', durationMin: 45, result: { stravaId: 1, rpe: 4, distanceKm: 8 } });
    const b = await db.workouts.get(res.created[0]);
    expect(b).toMatchObject({ date: '2026-10-25', startTime: '07:00', activity: 'cycle', status: 'completed', result: { stravaId: 2 } });
  });
});
