import { describe, expect, it } from 'vitest';
import { csvSport, durationSec, garminCsvActivities, parseCsv } from '@/lib/garminCsv';
import { readActivityFiles } from '@/lib/fit';
import { matchActivities, stravaResult } from '@/lib/strava';
import type { Workout } from '@/domain/types';

// Same shape as Garmin Connect's Activities → Export CSV (columns abridged, order as Garmin writes them).
const CSV = [
  '﻿"Activity Type","Date","Favorite","Title","Distance","Calories","Time","Avg HR","Max HR","Aerobic TE","Avg Run Cadence","Max Run Cadence","Avg Pace","Best Pace","Total Ascent","Total Descent","Steps","Moving Time","Elapsed Time","Min Elevation","Max Elevation"',
  '"Running","2026-10-30 06:12:41","false","Thawi Watthana - Intervals","6.79","512","00:40:13","162","181","4.1","168","190","5:55","4:10","5","4","6,812","00:39:50","00:42:02","3","8"',
  '"Running","2026-10-30 05:58:02","false","Thawi Watthana Running","0.28","20","00:01:53.7","118","125","0.3","150","160","6:50","6:20","0","0","286","00:01:53","00:01:55","3","4"',
  '"Indoor Cycling","2026-10-29 18:30:00","false","Indoor Cycling","0.00","410","00:51:40","128","150","2.0","--","--","--","--","--","--","--","00:51:40","00:51:40","--","--"',
  '"Treadmill Running","2026-10-28 19:05:10","false","Treadmill Running","7.18","560","00:52:00","143","160","3.0","165","175","7:14","6:10","--","--","7,950","00:52:00","00:52:10","--","--"',
  '"Running","2026-10-27 05:40:00","true","Thawi Watthana Running","21.23","1,620","02:30:01","145","168","4.3","166","178","7:04","5:40","9","9","25,100","02:28:40","02:35:12","2","10"',
  '"Pool Swim","2026-10-25 07:00:00","false","Pool Swim","1,500","300","00:35:00","130","150","2.1","--","--","2:20","1:55","--","--","--","00:33:00","00:40:00","--","--"',
  '"Walking","2026-10-24 17:00:00","false","Walk","2.10","120","00:30:00","95","110","0.5","--","--","14:17","12:00","--","--","3,000","00:29:00","00:31:00","--","--"',
].join('\r\n');

describe('Garmin "Export CSV"', () => {
  it('parses quoted fields, commas in numbers and the BOM', () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\r\n1,2,3\n');
    expect(rows).toEqual([['a', 'b,c', 'say "hi"'], ['1', '2', '3']]);
    expect(durationSec('00:40:13')).toBe(2413);
    expect(durationSec('01:53.7')).toBe(114);
    expect(durationSec('--')).toBeUndefined();
    expect(['Running', 'Treadmill Running', 'Indoor Cycling', 'Pool Swim', 'Strength Training', 'Walking'].map(csvSport)).toEqual(['Run', 'Run', 'Ride', 'Swim', 'WeightTraining', 'Other']);
  });

  it('turns rows into activities at local time', () => {
    const acts = garminCsvActivities(CSV);
    expect(acts).toHaveLength(7);
    const interval = acts[0];
    expect(interval).toMatchObject({ name: 'Thawi Watthana - Intervals', sportType: 'Run', startLocal: '2026-10-30T06:12:00', movingSec: 2390, elapsedSec: 2522, distanceM: 6790, avgHr: 162, maxHr: 181 });
    expect(interval.id).toBe(Math.floor(new Date(2026, 9, 30, 6, 12, 41).getTime() / 1000));
    expect(stravaResult(interval)).toMatchObject({ durationMin: 40, distanceKm: 6.79, avgHr: 162, avgPace: '5:52' });
    expect(acts[2]).toMatchObject({ sportType: 'Ride', distanceM: 0, movingSec: 3100 });
    expect(acts[4]).toMatchObject({ distanceM: 21230, movingSec: 8920 });
    expect(acts[5]).toMatchObject({ sportType: 'Swim', distanceM: 1500 });
  });

  it('matches the runs to the plan and leaves walks out', () => {
    const w = (p: Partial<Workout>): Workout => ({ id: 'x', date: '2026-10-30', activity: 'run', type: 'interval', durationMin: 60, status: 'planned', order: 0, createdAt: '', updatedAt: '', ...p });
    const m = matchActivities(garminCsvActivities(CSV), [w({ id: 'int', startTime: '06:00' }), w({ id: 'long', date: '2026-10-27', type: 'long', startTime: '05:30' })]);
    const by = Object.fromEntries(m.map((x) => [x.activity.name + x.activity.startLocal, x]));
    expect(by['Thawi Watthana - Intervals2026-10-30T06:12:00'].workout?.id).toBe('int');
    expect(by['Thawi Watthana Running2026-10-30T05:58:00'].workout).toBeUndefined(); // the warm-up becomes its own entry
    expect(by['Thawi Watthana Running2026-10-27T05:40:00'].workout?.id).toBe('long');
    expect(by['Walk2026-10-24T17:00:00'].kind).toBeUndefined();
  });

  it('is picked up by the Garmin import and explains unknown files', async () => {
    const acts = await readActivityFiles([new File([CSV], 'Activities.csv', { type: 'text/csv' })]);
    expect(acts).toHaveLength(7);
    expect(() => garminCsvActivities('"Name","When"\r\n"a","b"')).toThrow(/columns: Name, When/);
  });
});
