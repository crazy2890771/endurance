import { describe, expect, it } from 'vitest';
import { CalendarFeed, cleanEvents, fold, handleCalendar, toICS } from '../worker/calendar';
import type { DONamespace } from '../worker/push';
import { calendarEvents } from '@/lib/calendar';
import { BUILTIN_DUTY_TYPES } from '@/domain/catalog';
import type { DutyType, Workout } from '@/domain/types';

function fakeCalendars(): DONamespace {
  const objs = new Map<string, CalendarFeed>();
  return {
    idFromName: (n) => n,
    get: (id) => {
      const name = id as string;
      if (!objs.has(name)) {
        const data = new Map<string, unknown>();
        objs.set(name, new CalendarFeed({ storage: { get: async (k) => data.get(k) as never, put: async (k, v) => void data.set(k, v), deleteAll: async () => data.clear(), setAlarm: async () => {}, deleteAlarm: async () => {} } }));
      }
      return { fetch: (url, init) => objs.get(name)!.fetch(new Request(url, init)) };
    },
  };
}
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const call = (ns: DONamespace, path: string, init?: RequestInit) => handleCalendar(new Request(`https://endurance.example.workers.dev${path}`, init), { CALENDARS: ns });

describe('calendar feed (server)', () => {
  it('writes valid iCalendar: timed and all-day events, escaping, folding', () => {
    const ics = toICS(
      {
        name: 'Ground Time',
        updatedAt: '',
        events: [
          { uid: 'd-1', title: '✈️ Flight · FD3231 DMK–URT–DMK', notes: 'FD3231 DMK-URT 16:20-17:30\nFD3232; back', start: '2026-10-15T08:20:00.000Z', end: '2026-10-15T18:12:00.000Z' },
          { uid: 'd-2', title: 'OFF', start: '2026-10-16', end: '2026-10-17', allDay: true },
        ],
      },
      new Date('2026-10-30T00:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261015T082000Z\r\nDTEND:20261015T181200Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261016\r\nDTEND;VALUE=DATE:20261017');
    expect(ics).toContain('DESCRIPTION:FD3231 DMK-URT 16:20-17:30\\nFD3232\\; back');
    expect(ics).toContain('UID:d-1@ground-time');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it('folds long Thai lines without splitting a character', () => {
    const line = `SUMMARY:${'วิ่งยาว '.repeat(20)}`;
    const folded = fold(line);
    expect(folded.split('\r\n ').join('')).toBe(line);
    for (const part of folded.split('\r\n')) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });

  it('rejects malformed events', () => {
    expect(cleanEvents([{ uid: 'x', title: 't', start: '2026-10-16', end: '2026-10-17', allDay: true }])).toHaveLength(1);
    expect(cleanEvents([{ uid: 'x', title: 't', start: 'tomorrow', end: '2026-10-17' }])).toBeNull();
    expect(cleanEvents([{ title: 't', start: '2026-10-16', end: '2026-10-17', allDay: true }])).toBeNull();
    expect(cleanEvents('nope')).toBeNull();
    expect(cleanEvents(new Array(1501).fill({ uid: 'x', start: '2026-10-16', end: '2026-10-17', allDay: true }))).toBeNull();
  });

  it('stores an upload behind the token, serves it as .ics, and deletes it', async () => {
    const ns = fakeCalendars();
    expect((await call(ns, `/api/cal/${TOKEN}.ics`)).status).toBe(404);
    expect((await call(ns, '/api/cal/short.ics')).status).toBe(404);
    const put = await call(ns, `/api/cal/${TOKEN}`, { method: 'PUT', body: JSON.stringify({ name: 'Ground Time', events: [{ uid: 'w-1', title: '🏃 วิ่งเบา', start: '2026-11-02T23:30:00.000Z', end: '2026-11-03T00:15:00.000Z' }] }) });
    expect(put.status).toBe(200);
    const res = await call(ns, `/api/cal/${TOKEN}.ics`);
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8');
    expect(await res.text()).toContain('SUMMARY:🏃 วิ่งเบา');
    expect((await call(ns, `/api/cal/${TOKEN}`, { method: 'PUT', body: '{"events":"x"}' })).status).toBe(400);
    await call(ns, `/api/cal/${TOKEN}`, { method: 'DELETE' });
    expect((await call(ns, `/api/cal/${TOKEN}.ics`)).status).toBe(404);
    expect((await handleCalendar(new Request(`https://x/api/cal/${TOKEN}.ics`), {})).status).toBe(503);
  });
});

describe('calendar events (app)', () => {
  const types: DutyType[] = BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: '', updatedAt: '' }));
  const base = { source: 'aims' as const, createdAt: '', updatedAt: '' };
  const w = (p: Partial<Workout>): Workout => ({ id: 'w', date: '2026-11-04', activity: 'run', type: 'interval', durationMin: 60, hrZone: 4, status: 'planned', order: 0, createdAt: '', updatedAt: '', ...p });
  const opts = { name: (x: Workout) => `${x.activity}-${x.type}`, zone: (z: number) => `Z${z}` };

  it('makes flights timed (overnight ends next day), days off all-day, workouts timed or all-day', () => {
    const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();
    const ev = calendarEvents(
      [w({ id: 'a', startTime: '17:00', target: '6×800', notes: 'track' }), w({ id: 'b', date: '2026-11-05', type: 'easy', durationMin: 45, hrZone: 2 }), w({ id: 'c', status: 'skipped' }), w({ id: 'd', status: 'completed', startTime: '06:00', result: { durationMin: 50, completedAt: '' } })],
      [
        { id: 'f', date: '2026-10-15', dutyTypeId: 'dt-flight', startTime: '15:20', endTime: '01:12', title: 'FD3231 DMK–URT–DMK', notes: 'FD3231', ...base },
        { id: 'o', date: '2026-10-16', dutyTypeId: 'dt-off', title: '>OFF', ...base },
        { id: 's', date: '2026-11-01', dutyTypeId: 'dt-standby', startTime: '11:00', endTime: '19:00', title: 'DM2', ...base },
        { id: 'x', date: '2026-11-02', dutyTypeId: 'dt-off', deleted: true, ...base },
        { id: 'r', date: '2026-10-14', dutyTypeId: 'dt-rest', ...base },
      ],
      types,
      opts,
    );
    const by = Object.fromEntries(ev.map((e) => [e.uid, e]));
    expect(Object.keys(by).sort()).toEqual(['d-f', 'd-o', 'd-r', 'd-s', 'w-a', 'w-b', 'w-d']);
    expect(by['d-r']).toMatchObject({ title: 'Rest', allDay: true });
    expect(by['d-f']).toMatchObject({ title: '✈️ Flight · FD3231 DMK–URT–DMK', start: local('2026-10-15', '15:20'), end: local('2026-10-16', '01:12'), notes: 'FD3231' });
    expect(by['d-o']).toMatchObject({ title: 'OFF', start: '2026-10-16', end: '2026-10-17', allDay: true });
    expect(by['d-s'].title).toBe('🕒 Standby · DM2');
    expect(by['w-a']).toMatchObject({ title: '🏃 run-interval', start: local('2026-11-04', '17:00'), end: local('2026-11-04', '18:00'), notes: '1h · Z4\n6×800\ntrack' });
    expect(by['w-b']).toMatchObject({ title: '🏃 run-easy · 45 min', start: '2026-11-05', end: '2026-11-06', allDay: true });
    expect(by['w-d'].title).toBe('✓ 🏃 run-interval');
    expect(Date.parse(by['w-d'].end) - Date.parse(by['w-d'].start)).toBe(50 * 60000);
  });
});
