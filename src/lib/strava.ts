import type { StravaActivity } from '../../worker/index';
import type { Activity, Workout, WorkoutResult, WorkoutType } from '@/domain/types';

export type { StravaActivity };

/** Strava sport types → app activities. Anything else (walks, hikes, yoga…) is left out. */
const SPORT: Record<string, Activity> = {
  Run: 'run',
  TrailRun: 'run',
  VirtualRun: 'run',
  Ride: 'cycle',
  VirtualRide: 'cycle',
  GravelRide: 'cycle',
  MountainBikeRide: 'cycle',
  EBikeRide: 'cycle',
  Swim: 'swim',
  WeightTraining: 'strength',
  Workout: 'strength',
  Crossfit: 'strength',
};

export const stravaActivity = (a: StravaActivity): Activity | undefined => SPORT[a.sportType];

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** Result fields from a Strava activity; pace is written the way the user would type it. */
export function stravaResult(a: StravaActivity): Omit<WorkoutResult, 'completedAt'> {
  const activity = stravaActivity(a);
  const km = a.distanceM / 1000;
  let avgPace: string | undefined;
  if (km > 0 && a.movingSec > 0) {
    if (activity === 'run') avgPace = mmss(a.movingSec / km);
    else if (activity === 'swim') avgPace = mmss(a.movingSec / (a.distanceM / 100));
    else if (activity === 'cycle') avgPace = (Math.round((km / (a.movingSec / 3600)) * 10) / 10).toString();
  }
  return {
    durationMin: Math.max(1, Math.round(a.movingSec / 60)),
    distanceKm: km > 0 ? Math.round(km * 100) / 100 : undefined,
    avgHr: a.avgHr ? Math.round(a.avgHr) : undefined,
    avgPace,
    notes: a.name,
    stravaId: a.id,
  };
}

/** Default type when an activity has no planned workout to attach to. */
export const DEFAULT_TYPE: Record<Activity, WorkoutType> = { run: 'easy', cycle: 'endurance', swim: 'endurance', strength: 'full', rest: 'rest' };

export interface StravaMatch {
  activity: StravaActivity;
  /** App activity; undefined for sports the app doesn't track. */
  kind?: Activity;
  /** Planned workout on the same day and activity it completes, if any. */
  workout?: Workout;
  /** Already imported earlier. */
  imported: boolean;
}

/**
 * Pairs each Strava activity with a planned workout of the same activity on the same day,
 * closest start time first; each workout is used once. Nothing is saved here.
 */
export function matchActivities(activities: StravaActivity[], workouts: Workout[]): StravaMatch[] {
  const importedIds = new Set(workouts.filter((w) => !w.deleted && w.result?.stravaId).map((w) => w.result!.stravaId!));
  const free = workouts.filter((w) => !w.deleted && w.status === 'planned');
  const minutes = (hhmm?: string) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : 12 * 60);
  const sorted = [...activities].sort((a, b) => a.startLocal.localeCompare(b.startLocal));
  const open = sorted.filter((a) => stravaActivity(a) && !importedIds.has(a.id));
  // Every same-day, same-activity pair, closest in time first; take a pair while both sides are free.
  const pairs = open.flatMap((a) =>
    free
      .filter((w) => w.date === a.startLocal.slice(0, 10) && w.activity === stravaActivity(a))
      .map((w) => ({ a, w, gap: Math.abs(minutes(w.startTime) - minutes(a.startLocal.slice(11, 16))) })),
  );
  const byActivity = new Map<number, Workout>();
  const used = new Set<string>();
  for (const p of pairs.sort((x, y) => x.gap - y.gap)) {
    if (byActivity.has(p.a.id) || used.has(p.w.id)) continue;
    byActivity.set(p.a.id, p.w);
    used.add(p.w.id);
  }
  return sorted.map((a) => ({ activity: a, kind: stravaActivity(a), workout: byActivity.get(a.id), imported: importedIds.has(a.id) }));
}

// ---------- API (served by the Cloudflare Worker) ----------

export class StravaError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function stravaStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/strava/status');
    return res.ok && ((await res.json()) as { configured: boolean }).configured;
  } catch {
    return false;
  }
}

export async function fetchStravaActivities(token: string, afterSec: number): Promise<{ activities: StravaActivity[]; token?: string }> {
  const res = await fetch(`/api/strava/activities?after=${afterSec}`, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { activities?: StravaActivity[]; token?: string; error?: string };
  if (!res.ok || !body.activities) throw new StravaError(body.error ?? `http_${res.status}`);
  return { activities: body.activities, token: body.token };
}

export async function disconnectStrava(token: string) {
  await fetch('/api/strava/disconnect', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
}
