/**
 * Garmin Connect "Export CSV" (Activities list → Export CSV): one row per activity with its
 * summary. Columns are found by name, so extra or reordered columns don't matter.
 */
import type { StravaActivity } from '@/lib/strava';

export class CsvError extends Error {}

/** RFC 4180-style parser: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  return rows;
}

const clean = (v?: string) => (v ?? '').trim();
const missing = (v: string) => !v || v === '--' || v === '-';

/** "1,234.5" → 1234.5; "--" → undefined. */
const num = (v?: string) => {
  const s = clean(v).replace(/,/g, '');
  return missing(s) || Number.isNaN(Number(s)) ? undefined : Number(s);
};

/** "1:02:03", "40:13", "40:13.2", "01:53.7" → seconds. */
export function durationSec(v?: string): number | undefined {
  const s = clean(v);
  if (missing(s)) return undefined;
  const parts = s.split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  return Math.round(parts.reduce((acc, p) => acc * 60 + p, 0));
}

/** Garmin activity type text → the sport names the plan matching understands. */
export function csvSport(type: string): string {
  const t = type.toLowerCase();
  if (/run/.test(t)) return 'Run';
  if (/cycl|bik|ride|spin/.test(t)) return 'Ride';
  if (/swim/.test(t)) return 'Swim';
  if (/strength|hiit|cardio|weight|crossfit/.test(t)) return 'WeightTraining';
  return 'Other';
}

/** First column whose header matches one of the names (case-insensitive). */
function column(header: string[], ...names: string[]) {
  const h = header.map((x) => x.trim().toLowerCase());
  for (const n of names) {
    const i = h.indexOf(n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Activities from a Garmin Connect CSV. Dates are local wall-clock times; the id is the start as
 * Unix seconds on this phone, the same id a .FIT of that activity gets, so neither is imported twice.
 */
export function garminCsvActivities(text: string, units: 'metric' | 'imperial' = 'metric'): StravaActivity[] {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new CsvError('empty');
  const [header, ...data] = rows;
  const col = {
    type: column(header, 'Activity Type', 'Type'),
    date: column(header, 'Date', 'Start Time'),
    title: column(header, 'Title', 'Activity Name', 'Name'),
    distance: column(header, 'Distance'),
    time: column(header, 'Time', 'Duration'),
    moving: column(header, 'Moving Time'),
    elapsed: column(header, 'Elapsed Time'),
    avgHr: column(header, 'Avg HR', 'Average Heart Rate'),
    maxHr: column(header, 'Max HR', 'Max Heart Rate'),
  };
  if (col.date < 0 || col.type < 0) throw new CsvError(`columns: ${header.slice(0, 6).join(', ')}`);
  const out: StravaActivity[] = [];
  for (const r of data) {
    const m = clean(r[col.date]).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) continue;
    const [, y, mo, d, hh, mm, ss = '00'] = m;
    const sport = csvSport(clean(r[col.type]));
    const timer = durationSec(r[col.time]) ?? durationSec(r[col.moving]) ?? durationSec(r[col.elapsed]) ?? 0;
    let distanceM = (num(r[col.distance]) ?? 0) * (units === 'imperial' ? 1609.344 : 1000);
    // Swims are listed in metres (or yards), not km.
    if (sport === 'Swim') distanceM = num(r[col.distance]) ?? 0;
    out.push({
      id: Math.floor(new Date(+y, +mo - 1, +d, +hh, +mm, +ss).getTime() / 1000),
      name: clean(r[col.title]) || clean(r[col.type]),
      sportType: sport,
      startLocal: `${y}-${mo}-${d}T${hh}:${mm}:00`,
      movingSec: durationSec(r[col.moving]) ?? timer,
      elapsedSec: durationSec(r[col.elapsed]) ?? timer,
      distanceM: Math.round(distanceM),
      avgHr: num(r[col.avgHr]),
      maxHr: num(r[col.maxHr]),
    });
  }
  return out;
}
