import { describe, expect, it } from 'vitest';
import { BUILTIN_DUTY_TYPES } from '@/domain/catalog';
import { CSV_TEMPLATE, matchDutyType, parseAimsRosterJson, parseCsvRows, parseDate, parseDutyCsv, parseDutyIcs, parseRosterText, parseTime } from '@/domain/importers';
import type { DutyType } from '@/domain/types';

const ts = '2026-01-01T00:00:00.000Z';
const types: DutyType[] = BUILTIN_DUTY_TYPES.map((t) => ({ ...t, createdAt: ts, updatedAt: ts }));

describe('date & time parsing', () => {
  it.each([
    ['2026-10-21', '2026-10-21'],
    ['21/10/2026', '2026-10-21'],
    ['21.10.26', '2026-10-21'],
    ['21OCT26', '2026-10-21'],
    ['21 Oct 2026', '2026-10-21'],
    ['21-OCT-2026', '2026-10-21'],
    ['31/02/2026', undefined],
    ['hello', undefined],
  ])('parseDate(%s)', (input, out) => expect(parseDate(input)).toBe(out));

  it('uses the fallback year for "21 OCT"', () => expect(parseDate('21 OCT', 2026)).toBe('2026-10-21'));

  it.each([
    ['0630', '06:30'],
    ['6:30', '06:30'],
    ['06.30', '06:30'],
    ['2359', '23:59'],
    ['2460', undefined],
    ['', undefined],
  ])('parseTime(%s)', (input, out) => expect(parseTime(input)).toBe(out));
});

describe('duty type matching', () => {
  it.each([
    ['OFF', 'dt-off'],
    ['SBY', 'dt-standby'],
    ['Home standby', 'dt-standby'],
    ['AL', 'dt-al'],
    ['ROFF', 'dt-roff'],
    ['TG623 BKK-NRT', 'dt-flight'],
    ['BKK–HKT–BKK', 'dt-flight'],
    ['Layover NRT', 'dt-rest'],
    ['zzz', undefined],
  ])('%s → %s', (raw, id) => expect(matchDutyType(raw, types)).toBe(id));
});

describe('CSV', () => {
  it('parses quoted fields and semicolons', () => {
    expect(parseCsvRows('a;"b;c";"d ""x"""\n1;2;3')).toEqual([
      ['a', 'b;c', 'd "x"'],
      ['1', '2', '3'],
    ]);
  });

  it('parses the bundled template', () => {
    const rows = parseDutyCsv(CSV_TEMPLATE, types);
    expect(rows).toHaveLength(7);
    expect(rows[2]).toMatchObject({ date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45', title: 'BKK-HKT-BKK' });
    expect(rows[3]).toMatchObject({ startTime: '22:10', endTime: '06:40', notes: 'Overnight duty' });
    expect(rows.every((r) => r.dutyTypeId)).toBe(true);
  });

  it('works without a header row', () => {
    const rows = parseDutyCsv('21/10/2026,OFF\n22/10/2026,SBY,0400,1600', types);
    expect(rows.map((r) => r.dutyTypeId)).toEqual(['dt-off', 'dt-standby']);
    expect(rows[1].startTime).toBe('04:00');
  });

  it('skips rows with invalid dates', () => {
    expect(parseDutyCsv('date,duty\nnot-a-date,OFF\n2026-10-21,OFF', types)).toHaveLength(1);
  });
});

describe('ICS', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:abc-1',
    'DTSTART:20261022T053000',
    'DTEND:20261022T144500',
    'SUMMARY:FD3021 BKK-HKT',
    'DESCRIPTION:Report 05:30\\nRelease 14:45',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:abc-2',
    'DTSTART;VALUE=DATE:20261026',
    'DTEND;VALUE=DATE:20261029',
    'SUMMARY:Annual leave AL',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:abc-3',
    'DTSTART;TZID=Asia/Bangkok:20261025T040000',
    'DTEND;TZID=Asia/Bangkok:20261025T160000',
    'SUMMARY:Home Stand',
    ' by',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('parses timed, all-day and folded events', () => {
    const rows = parseDutyIcs(ics, types);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-10-22', startTime: '05:30', endTime: '14:45', dutyTypeId: 'dt-flight', sourceKey: 'ics:abc-1' });
    expect(rows[0].notes).toContain('Release 14:45');
    // All-day DTEND is exclusive → leave ends on the 28th
    expect(rows[1]).toMatchObject({ date: '2026-10-26', endDate: '2026-10-28', dutyTypeId: 'dt-al' });
    expect(rows[2]).toMatchObject({ raw: 'Home Standby', dutyTypeId: 'dt-standby', startTime: '04:00' });
  });

  it('converts UTC times to the local zone', () => {
    const rows = parseDutyIcs('BEGIN:VEVENT\nDTSTART:20261022T000000Z\nSUMMARY:OFF\nEND:VEVENT', types);
    const expected = new Date(Date.UTC(2026, 9, 22, 0, 0));
    expect(rows[0].startTime).toBe(`${String(expected.getHours()).padStart(2, '0')}:${String(expected.getMinutes()).padStart(2, '0')}`);
  });
});

describe('PDF roster text heuristics', () => {
  it('extracts one duty per dated line', () => {
    const rows = parseRosterText(
      ['Crew roster October 2026', '20OCT Mon DM 0800 1600 Ground school', '21OCT Tue OFF', '22OCT Wed FD3021 BKK-HKT 0530 1445', 'Page 1 of 1'],
      types,
      2026,
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2026-10-20', dutyTypeId: 'dt-dm', startTime: '08:00', endTime: '16:00' });
    expect(rows[1]).toMatchObject({ date: '2026-10-21', dutyTypeId: 'dt-off' });
    expect(rows[2]).toMatchObject({ date: '2026-10-22', dutyTypeId: 'dt-flight', startTime: '05:30', endTime: '14:45' });
  });
});

describe('AIMS roster JSON (ตารางแลกไฟลต์)', () => {
  const month = (_key: string, days: object[]) => ({ days, source: 'image', savedAt: 1 });
  const oct = month('2026-10', [
    { date: '2026-10-01', status: 'DUTY', code: '', signOn: '08:50', signOff: '20:04', offNextDay: false, sectors: [{ flt: 'FD175', from: 'DMK', to: 'CNX', dep: '09:50', arr: '11:05' }, { flt: 'FD176', from: 'CNX', to: 'DMK', dep: '11:45', arr: '12:55' }] },
    { date: '2026-10-02', status: 'DUTY', code: 'DH3', signOn: '15:00', signOff: '23:00', sectors: [] },
    { date: '2026-10-03', status: 'ROFF', signOn: null, signOff: null, sectors: [] },
    { date: '2026-10-04', status: 'DUTY', code: 'DM2', signOn: '09:00', signOff: '17:00', sectors: [] },
    { date: '2026-10-05', status: 'OFF_AFTER', sectors: [] },
    { date: '2026-10-06', status: 'OTHER', sectors: [] },
    { date: '2026-10-07', status: 'DUTY', signOn: '19:05', signOff: '04:25', offNextDay: true, sectors: [{ flt: 'FD140', from: 'DMK', to: 'HKG' }] },
    { date: '2026-11-01', status: 'OFF', sectors: [] },
  ]);

  it('maps statuses, flights, standby and ground codes', () => {
    const rows = parseAimsRosterJson(JSON.stringify(oct), types);
    expect(rows.map((r) => r.dutyTypeId)).toEqual(['dt-flight', 'dt-standby', 'dt-roff', 'dt-standby', 'dt-off', undefined, 'dt-flight', 'dt-off']);
    expect(rows[0]).toMatchObject({ startTime: '08:50', endTime: '20:04', title: 'FD175 DMK–CNX–DMK', sourceKey: 'aims:2026-10-01' });
    expect(rows[0].notes).toContain('FD176 CNX-DMK 11:45-12:55');
    expect(rows[1].title).toBe('DH3');
  });

  it('keeps overnight duties as end-before-start (rules treat them as ending next day)', () => {
    const r = parseAimsRosterJson(JSON.stringify(oct), types)[6];
    expect(r).toMatchObject({ startTime: '19:05', endTime: '04:25', endDate: undefined });
  });

  it("lets a month's own document win over another month's spill-over days", () => {
    const nov = month('2026-11', [{ date: '2026-11-01', status: 'DUTY', code: 'DM3', signOn: '11:00', signOff: '19:00', sectors: [] }]);
    const rows = parseAimsRosterJson(JSON.stringify({ months: { 'roster-2026-10': oct, 'roster-2026-11': nov } }), types);
    expect(rows.find((r) => r.date === '2026-11-01')?.dutyTypeId).toBe('dt-standby');
    expect(rows.filter((r) => r.date === '2026-11-01')).toHaveLength(1);
  });
});
