/**
 * Minimal Garmin FIT reader: just enough to pull the session summary (sport, start, time,
 * distance, heart rate) out of an activity file, plus unzipping Garmin Connect's "Export Original".
 * Runs in the browser; nothing is uploaded.
 */
import type { StravaActivity } from '@/lib/strava';

/** Seconds between the Unix epoch and the FIT epoch (1989-12-31T00:00:00Z). */
const FIT_EPOCH = 631065600;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}
interface Definition {
  global: number;
  little: boolean;
  fields: FieldDef[];
  devSize: number;
}

/** Values of the messages we care about: 18 = session, 34 = activity (local timestamp). */
type Msg = Record<number, number | undefined>;

function readValue(view: DataView, pos: number, f: FieldDef, little: boolean): number | undefined {
  // Only scalar base types; arrays/strings are skipped. Invalid markers (all 0xFF…) become undefined.
  switch (f.base & 0x1f) {
    case 0x00: // enum
    case 0x02: {
      // uint8
      const v = view.getUint8(pos);
      return v === 0xff ? undefined : v;
    }
    case 0x01: {
      const v = view.getInt8(pos);
      return v === 0x7f ? undefined : v;
    }
    case 0x04: {
      const v = view.getUint16(pos, little);
      return v === 0xffff ? undefined : v;
    }
    case 0x03: {
      const v = view.getInt16(pos, little);
      return v === 0x7fff ? undefined : v;
    }
    case 0x06: {
      const v = view.getUint32(pos, little);
      return v === 0xffffffff ? undefined : v;
    }
    case 0x05: {
      const v = view.getInt32(pos, little);
      return v === 0x7fffffff ? undefined : v;
    }
    case 0x0a: {
      // uint8z
      const v = view.getUint8(pos);
      return v === 0 ? undefined : v;
    }
    case 0x0b: {
      const v = view.getUint16(pos, little);
      return v === 0 ? undefined : v;
    }
    case 0x0c: {
      const v = view.getUint32(pos, little);
      return v === 0 ? undefined : v;
    }
    default:
      return undefined;
  }
}

export class FitError extends Error {}

/** Parses a .FIT file into its session summaries (one per sport in a multisport file). */
export function parseFit(buf: ArrayBuffer): { sessions: Msg[]; localOffsetSec?: number } {
  const view = new DataView(buf);
  if (buf.byteLength < 14) throw new FitError('too_short');
  const headerSize = view.getUint8(0);
  const dataSize = view.getUint32(4, true);
  if (String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)) !== '.FIT') throw new FitError('not_fit');
  const end = Math.min(headerSize + dataSize, buf.byteLength);
  const defs = new Map<number, Definition>();
  const sessions: Msg[] = [];
  let localOffsetSec: number | undefined;
  let pos = headerSize;

  while (pos < end) {
    const header = view.getUint8(pos++);
    let local: number;
    if (header & 0x80) {
      local = (header >> 5) & 0x03; // compressed-timestamp data message
    } else if (header & 0x40) {
      // definition message
      local = header & 0x0f;
      const little = view.getUint8(pos + 1) === 0;
      const global = view.getUint16(pos + 2, little);
      const n = view.getUint8(pos + 4);
      pos += 5;
      const fields: FieldDef[] = [];
      for (let i = 0; i < n; i++, pos += 3) fields.push({ num: view.getUint8(pos), size: view.getUint8(pos + 1), base: view.getUint8(pos + 2) });
      let devSize = 0;
      if (header & 0x20) {
        const nd = view.getUint8(pos++);
        for (let i = 0; i < nd; i++, pos += 3) devSize += view.getUint8(pos + 1);
      }
      defs.set(local, { global, little, fields, devSize });
      continue;
    } else {
      local = header & 0x0f;
    }
    const def = defs.get(local);
    if (!def) throw new FitError('corrupt');
    const msg: Msg = {};
    for (const f of def.fields) {
      if (pos + f.size > buf.byteLength) throw new FitError('corrupt');
      if (def.global === 18 || def.global === 34) msg[f.num] = readValue(view, pos, f, def.little);
      pos += f.size;
    }
    pos += def.devSize;
    if (def.global === 18) sessions.push(msg);
    if (def.global === 34 && msg[5] !== undefined && msg[253] !== undefined) localOffsetSec = msg[5] - msg[253];
  }
  return { sessions, localOffsetSec };
}

/** FIT sport (+ sub-sport) → the Strava sport names the matching code already understands. */
function sportType(sport?: number, sub?: number): string {
  if (sport === 1) return 'Run';
  if (sport === 2) return 'Ride';
  if (sport === 5) return 'Swim';
  if (sub === 6) return 'VirtualRide'; // indoor cycling
  if (sport === 4 || sport === 10) return 'WeightTraining'; // fitness equipment / training
  return 'Other';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Turns a FIT file into activities. `fallbackOffsetMin` (minutes east of UTC) is used when the
 * file has no local time, e.g. the phone's current offset.
 */
export function fitActivities(buf: ArrayBuffer, name: string, fallbackOffsetMin: number): StravaActivity[] {
  const { sessions, localOffsetSec } = parseFit(buf);
  return sessions
    .filter((s) => s[2] !== undefined)
    .map((s) => {
      const startUtc = (s[2]! + FIT_EPOCH) * 1000;
      const local = new Date(startUtc + (localOffsetSec ?? fallbackOffsetMin * 60) * 1000);
      const startLocal = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00`;
      const timer = s[8] ?? s[7] ?? 0; // total_timer_time, else total_elapsed_time (ms)
      return {
        // Stable per activity, so the same file is never imported twice.
        id: s[2]! + FIT_EPOCH,
        name,
        sportType: sportType(s[5], s[6]),
        startLocal,
        movingSec: Math.round(timer / 1000),
        elapsedSec: Math.round((s[7] ?? timer) / 1000),
        distanceM: s[9] !== undefined ? s[9] / 100 : 0,
        avgHr: s[16],
        maxHr: s[17],
        avgSpeed: s[14] !== undefined ? s[14] / 1000 : undefined,
      };
    });
}

// ---------- ZIP (Garmin Connect "Export Original") ----------

async function inflateRaw(data: Uint8Array): Promise<ArrayBuffer> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

/** The .fit files inside a ZIP (stored or deflated). */
export async function unzipFits(buf: ArrayBuffer): Promise<{ name: string; data: ArrayBuffer }[]> {
  const view = new DataView(buf);
  const out: { name: string; data: ArrayBuffer }[] = [];
  // Central directory: find the end record, then walk the entries (sizes are reliable there).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new FitError('bad_zip');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new FitError('bad_zip');
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.fit$/i.test(name)) continue;
    const start = localOff + 30 + view.getUint16(localOff + 26, true) + view.getUint16(localOff + 28, true);
    const raw = new Uint8Array(buf, start, compSize);
    if (method === 0) out.push({ name, data: raw.slice().buffer });
    else if (method === 8) out.push({ name, data: await inflateRaw(raw) });
  }
  return out;
}

/** Reads picked files (.fit or Garmin's .zip) into activities. */
export async function readActivityFiles(files: File[]): Promise<StravaActivity[]> {
  const offset = -new Date().getTimezoneOffset();
  const all: StravaActivity[] = [];
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const isZip = new DataView(buf).getUint32(0, true) === 0x04034b50;
    const fits = isZip ? await unzipFits(buf) : [{ name: f.name, data: buf }];
    for (const fit of fits) all.push(...fitActivities(fit.data, fit.name.replace(/\.fit$/i, '').replace(/^.*\//, ''), offset));
  }
  // The same activity picked twice counts once.
  return all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i);
}
