import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { fitActivities, parseFit, readActivityFiles, unzipFits } from '@/lib/fit';
import { stravaResult } from '@/lib/strava';

const FIT_EPOCH = 631065600;
const fitTime = (iso: string) => Date.parse(iso) / 1000 - FIT_EPOCH;

type Field = [num: number, size: number, base: number, value: number];

/** Builds a small FIT file: definition + data message per entry. */
function buildFit(messages: { global: number; local: number; fields: Field[]; dev?: number[] }[], extra: number[] = []): ArrayBuffer {
  const body: number[] = [];
  const le = (v: number, size: number) => Array.from({ length: size }, (_, i) => Math.floor(v / 2 ** (8 * i)) & 0xff);
  for (const m of messages) {
    const devFlag = m.dev ? 0x20 : 0;
    body.push(0x40 | devFlag | m.local, 0, 0, ...le(m.global, 2), m.fields.length);
    for (const [num, size, base] of m.fields) body.push(num, size, base);
    if (m.dev) {
      body.push(m.dev.length);
      for (const size of m.dev) body.push(0, size, 0);
    }
    body.push(m.local);
    for (const [, size, , value] of m.fields) body.push(...le(value, size));
    if (m.dev) for (const size of m.dev) body.push(...new Array(size).fill(7));
  }
  body.push(...extra);
  const header = [14, 0x20, 0, 0, ...le(body.length, 4), ...'.FIT'.split('').map((c) => c.charCodeAt(0)), 0, 0];
  return new Uint8Array([...header, ...body, 0, 0]).buffer;
}

const start = fitTime('2026-10-28T23:10:00Z'); // 06:10 in Bangkok
const runFit = () =>
  buildFit([
    // a record message with developer data before the session, to be skipped
    { global: 20, local: 1, fields: [[253, 4, 0x86, start + 10], [3, 1, 0x02, 140]], dev: [2, 1] },
    {
      global: 18,
      local: 2,
      fields: [
        [253, 4, 0x86, start + 2800],
        [2, 4, 0x86, start],
        [7, 4, 0x86, 2_800_000],
        [8, 4, 0x86, 2_700_000],
        [9, 4, 0x86, 800_000],
        [5, 1, 0x00, 1],
        [6, 1, 0x00, 0],
        [16, 1, 0x02, 142],
        [17, 1, 0x02, 171],
        [14, 2, 0x84, 2963],
      ],
    },
    { global: 34, local: 3, fields: [[253, 4, 0x86, start + 2800], [5, 4, 0x86, start + 2800 + 7 * 3600]] },
  ], [0x80 | (1 << 5) | 5, ...[1, 0, 0, 0, 140].slice(0, 5)]); // compressed-timestamp record (local 1)

describe('FIT files', () => {
  it('reads the session summary and the local time offset', () => {
    const { sessions, localOffsetSec } = parseFit(runFit());
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ 2: start, 7: 2_800_000, 8: 2_700_000, 9: 800_000, 5: 1, 16: 142 });
    expect(localOffsetSec).toBe(7 * 3600);
  });

  it('turns a run into an activity at local time, with results like Strava’s', () => {
    const [a] = fitActivities(runFit(), 'Morning run', 0);
    expect(a).toMatchObject({ sportType: 'Run', startLocal: '2026-10-29T06:10:00', movingSec: 2700, elapsedSec: 2800, distanceM: 8000, avgHr: 142, maxHr: 171 });
    expect(stravaResult(a)).toMatchObject({ durationMin: 45, distanceKm: 8, avgHr: 142, avgPace: '5:38' });
  });

  it('uses the phone’s offset when the file has no local time, and maps sports', () => {
    const ride = buildFit([{ global: 18, local: 0, fields: [[2, 4, 0x86, start], [8, 4, 0x86, 3_600_000], [9, 4, 0x86, 3_010_000], [5, 1, 0x00, 4], [6, 1, 0x00, 6]] }]);
    expect(fitActivities(ride, 'Zwift', 7 * 60)[0]).toMatchObject({ sportType: 'VirtualRide', startLocal: '2026-10-29T06:10:00', distanceM: 30100 });
    const gym = buildFit([{ global: 18, local: 0, fields: [[2, 4, 0x86, start], [8, 4, 0x86, 1_800_000], [5, 1, 0x00, 10], [6, 1, 0x00, 20]] }]);
    expect(fitActivities(gym, 'Gym', 420)[0].sportType).toBe('WeightTraining');
  });

  it('rejects files that are not FIT', () => {
    expect(() => parseFit(new TextEncoder().encode('hello, this is not a fit file').buffer)).toThrow();
  });
});

/** A ZIP with one stored and one deflated entry, like Garmin's export. */
function buildZip(entries: { name: string; data: Uint8Array; deflate: boolean }[]): ArrayBuffer {
  const out: number[] = [];
  const central: number[] = [];
  const le = (v: number, size: number) => Array.from({ length: size }, (_, i) => (v >>> (8 * i)) & 0xff);
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const comp = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const offset = out.length;
    out.push(...le(0x04034b50, 4), 20, 0, 0, 0, ...le(e.deflate ? 8 : 0, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(comp.length, 4), ...le(e.data.length, 4), ...le(name.length, 2), 0, 0, ...name, ...comp);
    central.push(...le(0x02014b50, 4), 20, 0, 20, 0, 0, 0, ...le(e.deflate ? 8 : 0, 2), 0, 0, 0, 0, 0, 0, 0, 0, ...le(comp.length, 4), ...le(e.data.length, 4), ...le(name.length, 2), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...le(offset, 4), ...name);
  }
  const cdOffset = out.length;
  out.push(...central, ...le(0x06054b50, 4), 0, 0, 0, 0, ...le(entries.length, 2), ...le(entries.length, 2), ...le(central.length, 4), ...le(cdOffset, 4), 0, 0);
  return new Uint8Array(out).buffer;
}

describe('Garmin "Export Original" zip', () => {
  it('extracts .fit files, stored or deflated, and dedupes repeats', async () => {
    const fit = new Uint8Array(runFit());
    const zip = buildZip([
      { name: '20481234_ACTIVITY.fit', data: fit, deflate: true },
      { name: 'readme.txt', data: new TextEncoder().encode('x'), deflate: false },
      { name: 'copy.fit', data: fit, deflate: false },
    ]);
    const files = await unzipFits(zip);
    expect(files.map((f) => f.name)).toEqual(['20481234_ACTIVITY.fit', 'copy.fit']);
    expect(new Uint8Array(files[0].data)).toEqual(fit);
    const acts = await readActivityFiles([new File([zip], 'export.zip'), new File([fit], 'again.fit')]);
    expect(acts).toHaveLength(1);
    expect(acts[0].name).toBe('20481234_ACTIVITY');
  });
});
