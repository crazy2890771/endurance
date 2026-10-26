/**
 * Roster parsers. All importers produce `ParsedDuty` rows which the user reviews
 * before anything is written to the database.
 */
import type { DutyType, HHmm, ISODate } from './types';

export interface ParsedDuty {
  date: ISODate;
  endDate?: ISODate;
  startTime?: HHmm;
  endTime?: HHmm;
  /** Raw duty code / summary as found in the file. */
  raw: string;
  title?: string;
  notes?: string;
  /** Matched duty type id, if any. */
  dutyTypeId?: string;
  /** Stable source id (e.g. ICS UID) used for duplicate detection. */
  sourceKey?: string;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): ISODate | undefined => {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return undefined;
  return `${y}-${pad(m)}-${pad(d)}`;
};

/**
 * Parse common roster date formats: 2026-10-21, 21/10/2026, 21.10.26, 21OCT26, 21 Oct 2026, 21-Oct-2026.
 * Day-first is assumed for slash/dot formats (standard in airline rosters outside the US).
 */
export function parseDate(input: string, fallbackYear?: number): ISODate | undefined {
  const s = input.trim().toUpperCase();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return iso(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[\s-]?([A-Z]{3})[A-Z]*[\s-]?(\d{2,4})?/);
  if (m && MONTHS[m[2]]) {
    const y = m[3] ? +m[3] : fallbackYear;
    if (y === undefined) return undefined;
    return iso(y, MONTHS[m[2]], +m[1]);
  }
  return undefined;
}

/** Parse 0630, 06:30, 6:30, 06.30, 06h30 into HH:mm. */
export function parseTime(input: string | undefined): HHmm | undefined {
  if (!input) return undefined;
  const m = input.trim().match(/^(\d{1,2})[:.h]?(\d{2})(?:[zZ]|L|LT)?$/);
  if (!m) return undefined;
  const h = +m[1];
  const min = +m[2];
  if (h > 23 || min > 59) return undefined;
  return `${pad(h)}:${pad(min)}`;
}

/** Match a raw roster code/summary to a duty type by code, label or keyword. */
export function matchDutyType(raw: string, types: DutyType[]): string | undefined {
  const s = raw.trim().toUpperCase();
  if (!s) return undefined;
  const tokens = s.split(/[^A-Z0-9]+/).filter(Boolean);
  // 1) exact code
  for (const t of types) if (t.code.toUpperCase() === s) return t.id;
  // 2) any token equals code or keyword
  for (const t of types) {
    const keys = [t.code, ...(t.keywords ?? [])].map((k) => k.toUpperCase());
    if (tokens.some((tok) => keys.includes(tok))) return t.id;
  }
  // 3) flight numbers like TG123 / FD3021 or a city-pair route BKK-HKT
  if (/\b[A-Z]{2}\d{2,4}\b/.test(s) || /\b[A-Z]{3}\s*[-–/]\s*[A-Z]{3}\b/.test(s)) {
    return types.find((t) => t.code.toUpperCase() === 'FLIGHT')?.id;
  }
  return undefined;
}

// ---------------- CSV ----------------

/** RFC-4180-ish CSV parser supporting quoted fields, `,` or `;` delimiters. */
export function parseCsvRows(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f !== ''));
}

const HEADERS: Record<'date' | 'duty' | 'start' | 'end' | 'endDate' | 'notes' | 'title', string[]> = {
  date: ['date', 'day', 'วันที่'],
  duty: ['duty', 'code', 'type', 'activity', 'duty code', 'ประเภท'],
  start: ['start', 'start time', 'report', 'begin', 'from', 'เริ่ม'],
  end: ['end', 'end time', 'release', 'finish', 'to', 'สิ้นสุด'],
  endDate: ['end date', 'enddate', 'release date'],
  title: ['title', 'description', 'route', 'flight', 'details'],
  notes: ['notes', 'note', 'remark', 'remarks', 'หมายเหตุ'],
};

export function parseDutyCsv(text: string, types: DutyType[]): ParsedDuty[] {
  const rows = parseCsvRows(text.replace(/^﻿/, ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  const col = (k: keyof typeof HEADERS) => header.findIndex((h) => HEADERS[k].includes(h));
  let idx = { date: col('date'), duty: col('duty'), start: col('start'), end: col('end'), endDate: col('endDate'), title: col('title'), notes: col('notes') };
  let body = rows.slice(1);
  if (idx.date < 0) {
    // No header row: assume date, duty, start, end, notes.
    idx = { date: 0, duty: 1, start: 2, end: 3, endDate: -1, title: -1, notes: 4 };
    body = rows;
  }
  const get = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  const out: ParsedDuty[] = [];
  for (const r of body) {
    const date = parseDate(get(r, idx.date) ?? '');
    if (!date) continue;
    const raw = get(r, idx.duty) ?? '';
    const endDate = parseDate(get(r, idx.endDate) ?? '');
    out.push({
      date,
      endDate: endDate && endDate > date ? endDate : undefined,
      startTime: parseTime(get(r, idx.start)),
      endTime: parseTime(get(r, idx.end)),
      raw,
      title: get(r, idx.title) || undefined,
      notes: get(r, idx.notes) || undefined,
      dutyTypeId: matchDutyType(raw, types),
    });
  }
  return out;
}

// ---------------- ICS ----------------

interface IcsProp {
  name: string;
  params: Record<string, string>;
  value: string;
}

function unfoldIcs(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}

function parseIcsLine(line: string): IcsProp | undefined {
  const i = line.indexOf(':');
  if (i < 0) return undefined;
  const [name, ...params] = line.slice(0, i).split(';');
  const p: Record<string, string> = {};
  for (const kv of params) {
    const [k, v] = kv.split('=');
    if (k && v) p[k.toUpperCase()] = v.replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
}

const unescapeIcs = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/**
 * Convert an ICS date/date-time to local date + time.
 * UTC (`Z`) values are converted to the device time zone; floating and TZID values are used as-is.
 */
export function icsToLocal(prop: IcsProp): { date: ISODate; time?: HHmm; allDay: boolean } | undefined {
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, , z] = m;
  if (!h) return { date: `${y}-${mo}-${d}`, allDay: true };
  if (z) {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    return {
      date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      allDay: false,
    };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, allDay: false };
}

export function parseDutyIcs(text: string, types: DutyType[]): ParsedDuty[] {
  const out: ParsedDuty[] = [];
  let cur: Record<string, IcsProp> | null = null;
  for (const line of unfoldIcs(text)) {
    if (line.startsWith('BEGIN:VEVENT')) cur = {};
    else if (line.startsWith('END:VEVENT')) {
      if (cur?.DTSTART) {
        const s = icsToLocal(cur.DTSTART);
        const e = cur.DTEND ? icsToLocal(cur.DTEND) : undefined;
        if (s) {
          const summary = unescapeIcs(cur.SUMMARY?.value ?? '');
          let endDate = e?.date;
          // All-day DTEND is exclusive.
          if (e?.allDay && endDate) {
            const dt = new Date(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10) - 1);
            endDate = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          }
          out.push({
            date: s.date,
            endDate: endDate && endDate > s.date ? endDate : undefined,
            startTime: s.time,
            endTime: e?.time,
            raw: summary,
            title: summary || undefined,
            notes: cur.DESCRIPTION ? unescapeIcs(cur.DESCRIPTION.value).slice(0, 500) : cur.LOCATION ? unescapeIcs(cur.LOCATION.value) : undefined,
            dutyTypeId: matchDutyType(summary, types),
            sourceKey: cur.UID ? `ics:${cur.UID.value}` : undefined,
          });
        }
      }
      cur = null;
    } else if (cur) {
      const p = parseIcsLine(line);
      if (p && !(p.name in cur)) cur[p.name] = p;
    }
  }
  return out;
}

// ---------------- PDF (text heuristics) ----------------

const DATE_AT_START = /^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[\s-]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*(?:[\s-]?\d{2,4})?)\b/i;
const TIME_RE = /\b([01]?\d|2[0-3])[:.h]?([0-5]\d)\b/g;

/**
 * Best-effort extraction from roster text lines (one line per day). The first
 * date on a line is the duty date, the first two times are start/end, and the
 * remaining text is matched against duty codes.
 */
export function parseRosterText(lines: string[], types: DutyType[], fallbackYear = new Date().getFullYear()): ParsedDuty[] {
  const out: ParsedDuty[] = [];
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, ' ').trim();
    const dm = line.match(DATE_AT_START);
    if (!dm) continue;
    const date = parseDate(dm[1], fallbackYear);
    if (!date) continue;
    const rest = line.slice(dm[0].length).replace(/^\s*(MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\b/i, '').trim();
    const times = [...rest.matchAll(TIME_RE)]
      .filter((m) => m[0].length >= 4)
      .map((m) => parseTime(m[0]))
      .filter(Boolean) as HHmm[];
    const text = rest.replace(TIME_RE, ' ').replace(/\s+/g, ' ').trim();
    out.push({
      date,
      startTime: times[0],
      endTime: times[1],
      raw: text || rest,
      title: text || undefined,
      dutyTypeId: matchDutyType(text || rest, types),
    });
  }
  return out;
}

/** One positioned piece of PDF text; `y` grows downwards from the top of the page. */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  str: string;
  font: string;
}

/** Extract positioned text from a PDF using pdf.js (loaded lazily). Runs entirely on the device. */
export async function extractPdfItems(file: ArrayBuffer): Promise<PdfTextItem[]> {
  // The legacy build carries polyfills that iOS Safari and older browsers need.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: file }).promise;
  const out: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      out.push({ page: p, x: item.transform[4], y: height - item.transform[5], str: item.str.trim(), font: item.fontName });
    }
  }
  return out;
}

/** Group positioned text into reading-order lines (for the generic roster heuristics). */
export function pdfItemsToLines(items: PdfTextItem[]): string[] {
  const rows = new Map<string, PdfTextItem[]>();
  for (const it of items) {
    const key = `${it.page}:${Math.round(it.y / 3) * 3}`;
    rows.set(key, [...(rows.get(key) ?? []), it]);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => {
      const [pa, ya] = a.split(':').map(Number);
      const [pb, yb] = b.split(':').map(Number);
      return pa - pb || ya - yb;
    })
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((i) => i.str).join(' '));
}

// ---------------- AIMS roster JSON (from the "ตารางแลกไฟลต์" roster app) ----------------

export interface AimsSector {
  flt?: string;
  from?: string;
  to?: string;
  dep?: string | null;
  arr?: string | null;
}

export interface AimsDay {
  date: string;
  status: string;
  code?: string;
  signOn?: string | null;
  signOff?: string | null;
  offNextDay?: boolean;
  sectors?: AimsSector[];
}

export const AIMS_STATUS_TYPE: Record<string, string> = { OFF: 'dt-off', OFF_AFTER: 'dt-off', '>OFF': 'dt-off', ROFF: 'dt-roff', REST: 'dt-rest', AL: 'dt-al' };

/** Pick the duty type for one AIMS day: flights by sectors, ground duties by their code prefix. */
export function aimsDutyType(d: AimsDay, types: DutyType[]): string | undefined {
  const has = (id: string) => types.some((t) => t.id === id);
  const byStatus = AIMS_STATUS_TYPE[d.status];
  if (byStatus) return has(byStatus) ? byStatus : undefined;
  if (d.status !== 'DUTY') return undefined;
  if (d.sectors?.length) return has('dt-flight') ? 'dt-flight' : undefined;
  const code = (d.code ?? '').toUpperCase();
  // AIMS counts DM1–DM4 (airport) and DH (home) as standby days.
  if (/^(DM|DH|SBY|STBY|HSBY|ASBY|RSV|RES)/.test(code)) return has('dt-standby') ? 'dt-standby' : undefined;
  if (/^(SIM|TRG|GS|BS|CRM|SEP|LINE|CHK)/.test(code)) return has('dt-dm') ? 'dt-dm' : undefined;
  return matchDutyType(code, types);
}

/** Human label for a flight day, e.g. "FD3402 DMK–URT–DMK". */
export function aimsRoute(sectors: AimsSector[]): string {
  const stops: string[] = [];
  for (const s of sectors) {
    if (s.from && stops[stops.length - 1] !== s.from) stops.push(s.from);
    if (s.to) stops.push(s.to);
  }
  const flts = sectors.map((s) => s.flt).filter(Boolean);
  return [flts[0], stops.join('–')].filter(Boolean).join(' ');
}

/** Collect days from one month doc `{days}`, an array of them, or `{months: {key: {days}}}`. A month's own days win over spill-over days. */
function aimsDays(data: unknown): AimsDay[] {
  const docs: { key?: string; days: AimsDay[] }[] = [];
  const push = (x: unknown, key?: string) => {
    const doc = x as { days?: unknown; key?: string };
    if (doc && Array.isArray(doc.days)) docs.push({ key: key ?? doc.key, days: doc.days as AimsDay[] });
  };
  if (Array.isArray(data)) data.forEach((x) => push(x));
  else if (data && typeof data === 'object' && 'months' in data) {
    for (const [k, v] of Object.entries((data as { months: Record<string, unknown> }).months ?? {})) push(v, k.replace(/^roster-/, ''));
  } else push(data);
  const byDate = new Map<string, AimsDay>();
  for (const own of [false, true]) {
    for (const doc of docs) {
      for (const d of doc.days) {
        if (!d || typeof d.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
        const isOwn = !doc.key || d.date.startsWith(doc.key);
        if (isOwn === own && (own || !byDate.has(d.date))) byDate.set(d.date, d);
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseAimsRosterJson(text: string, types: DutyType[]): ParsedDuty[] {
  const days = aimsDays(JSON.parse(text));
  return days.map((d) => {
    const sectors = Array.isArray(d.sectors) ? d.sectors : [];
    const startTime = parseTime(d.signOn ?? undefined);
    const endTime = parseTime(d.signOff ?? undefined);
    const next = new Date(+d.date.slice(0, 4), +d.date.slice(5, 7) - 1, +d.date.slice(8, 10) + 1);
    const nextIso = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
    const label = sectors.length ? aimsRoute(sectors) : d.code || (d.status === 'OFF_AFTER' ? '>OFF' : '');
    return {
      date: d.date,
      endDate: d.offNextDay && startTime && endTime && endTime > startTime ? nextIso : undefined,
      startTime,
      endTime,
      raw: [d.status, d.code, label].filter(Boolean).join(' '),
      title: label || undefined,
      notes: sectors.length > 1 ? sectors.map((s) => [s.flt, s.from && s.to ? `${s.from}-${s.to}` : '', s.dep && s.arr ? `${s.dep}-${s.arr}` : ''].filter(Boolean).join(' ')).join('\n') : undefined,
      dutyTypeId: aimsDutyType(d, types),
      sourceKey: `aims:${d.date}`,
    };
  });
}

export const CSV_TEMPLATE = `date,duty,start,end,title,notes
2026-10-20,DM,08:00,16:00,Ground school,
2026-10-21,OFF,,,,
2026-10-22,Flight,05:30,14:45,BKK-HKT-BKK,
2026-10-23,Flight,22:10,06:40,BKK-NRT,Overnight duty
2026-10-24,Rest,,,Layover NRT,
2026-10-25,Standby,04:00,16:00,Home standby,
2026-10-26,AL,,,,
`;
