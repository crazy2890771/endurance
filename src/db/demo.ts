/**
 * Realistic sample roster + training plan, generated relative to today so the
 * app is explorable on first launch. All demo records are tagged in their notes.
 */
import type { Activity, Duty, HRZone, Workout, WorkoutType } from '@/domain/types';
import { addDaysISO, todayISO, weekStart } from '@/lib/dates';
import { db } from './db';
import { ensureInitialized, newId, nowIso } from './repo';

type W = [Activity, WorkoutType, number, number | undefined, HRZone | undefined, string?];
type D = [string, string?, string?, string?];

// Three-week repeating pattern, Monday-first.
const DUTY_PATTERN: D[] = [
  ['dt-dm', '08:00', '16:00', 'Recurrent training'],
  ['dt-off'],
  ['dt-flight', '05:30', '14:45', 'BKK–HKT–BKK–CNX–BKK'],
  ['dt-al'],
  ['dt-roff'],
  ['dt-off'],
  ['dt-standby', '04:00', '16:00', 'Home standby'],
  ['dt-flight', '22:10', '06:40', 'BKK–NRT'],
  ['dt-rest', undefined, undefined, 'Layover NRT'],
  ['dt-flight', '09:30', '15:20', 'NRT–BKK'],
  ['dt-off'],
  ['dt-off'],
  ['dt-standby', '12:00', '23:59', 'Airport standby'],
  ['dt-dm', '09:00', '12:00', 'Simulator briefing'],
  ['dt-flight', '06:15', '13:00', 'BKK–SIN–BKK'],
  ['dt-off'],
  ['dt-flight', '14:00', '22:30', 'BKK–HKG–BKK'],
  ['dt-off'],
  ['dt-roff'],
  ['dt-al'],
  ['dt-standby', '05:00', '17:00', 'Home standby'],
];

const WORKOUT_PATTERN: (W | null)[] = [
  ['cycle', 'easy', 45, 18, 2],
  ['run', 'easy', 45, 7.5, 2],
  null,
  ['run', 'interval', 50, 8, 4, '6 × 800 m'],
  ['run', 'long', 100, 18, 2],
  ['swim', 'technique', 40, 1.5, 2],
  ['strength', 'upper', 40, undefined, undefined],
  null,
  ['run', 'recovery', 30, 5, 1],
  null,
  ['run', 'tempo', 50, 10, 3],
  ['cycle', 'endurance', 90, 40, 2],
  ['strength', 'lower', 40, undefined, undefined],
  ['swim', 'endurance', 45, 2, 2],
  null,
  ['run', 'easy', 40, 7, 2],
  ['strength', 'mobility', 25, undefined, undefined],
  ['run', 'interval', 55, 9, 4, '5 × 1 km'],
  ['run', 'long', 110, 20, 2],
  ['cycle', 'easy', 60, 25, 2],
  ['swim', 'easy', 30, 1.2, 1],
];

export async function loadDemoData() {
  await ensureInitialized();
  const today = todayISO();
  const start = addDaysISO(weekStart(today, 1), -21);
  const ts = nowIso();
  const workouts: Workout[] = [];
  const duties: Duty[] = [];

  for (let i = 0; i < 42; i++) {
    const date = addDaysISO(start, i);
    const [dutyTypeId, startTime, endTime, title] = DUTY_PATTERN[i % DUTY_PATTERN.length];
    duties.push({
      id: newId(), date, dutyTypeId, startTime, endTime, title, source: 'manual', notes: 'Demo data',
      createdAt: ts, updatedAt: ts, dirty: 1,
    });

    const p = WORKOUT_PATTERN[i % WORKOUT_PATTERN.length];
    if (!p) continue;
    const [activity, type, durationMin, distanceKm, hrZone, target] = p;
    const past = date < today;
    // Mostly completed in the past, with the occasional skipped session — like real life.
    const skipped = past && i % 9 === 4;
    const intervals = type === 'interval'
      ? [{ reps: target?.startsWith('6') ? 6 : 5, distanceM: target?.startsWith('6') ? 800 : 1000, recoverySec: 90 }]
      : undefined;
    const w: Workout = {
      id: newId(), date, activity, type, durationMin, distanceKm, hrZone, target, intervals,
      startTime: startTime && startTime < '09:00' ? '17:30' : '07:00',
      location: activity === 'swim' ? 'pool' : activity === 'strength' ? undefined : i % 4 === 0 ? 'indoor' : 'outdoor',
      notes: 'Demo data',
      status: past ? (skipped ? 'skipped' : 'completed') : 'planned',
      order: 0,
      createdAt: ts, updatedAt: ts, dirty: 1,
    };
    if (past && !skipped) {
      const f = 0.92 + ((i * 37) % 17) / 100; // deterministic ±8% variation
      w.result = {
        durationMin: Math.round(durationMin * f),
        distanceKm: distanceKm ? Math.round(distanceKm * f * 100) / 100 : undefined,
        rpe: hrZone && hrZone >= 4 ? 8 : activity === 'strength' ? 6 : 4,
        completedAt: ts,
      };
    }
    workouts.push(w);
  }

  await db.transaction('rw', db.workouts, db.duties, async () => {
    await db.workouts.bulkPut(workouts);
    await db.duties.bulkPut(duties);
  });
}
