/**
 * Calendar subscription: the app uploads its duties and workouts as simple events to a private
 * link (/api/cal/<token>), and the iPhone Calendar subscribes to /api/cal/<token>.ics. The secret
 * token is the only key; one Durable Object per token holds the latest upload.
 */
import type { DONamespace, DOState } from './push';

export interface CalEvent {
  uid: string;
  title: string;
  notes?: string;
  /** Timed: UTC ISO start/end. All-day: YYYY-MM-DD start, exclusive end. */
  start: string;
  end: string;
  allDay?: boolean;
}

interface Feed {
  name: string;
  events: CalEvent[];
  updatedAt: string;
}

const TOKEN = /^[A-Za-z0-9_-]{32,64}$/;
const MAX_EVENTS = 1500;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

// ---------- iCalendar ----------

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Folds a content line at 75 octets (UTF-8 safe), as RFC 5545 requires. */
export function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const utcStamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const dateStamp = (d: string) => d.replace(/-/g, '');

export function toICS(feed: Feed, now = new Date()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ground Time//Roster and training//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(feed.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const stamp = utcStamp(now.toISOString());
  for (const e of feed.events) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}@ground-time`, `DTSTAMP:${stamp}`);
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(e.end)}`, 'TRANSP:TRANSPARENT');
    else lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
    lines.push(`SUMMARY:${esc(e.title)}`);
    if (e.notes) lines.push(`DESCRIPTION:${esc(e.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------- validation ----------

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isInstant = (s: unknown) => typeof s === 'string' && !Number.isNaN(Date.parse(s)) && /T/.test(s);
const str = (s: unknown, max: number) => (typeof s === 'string' ? s.slice(0, max) : '');

export function cleanEvents(raw: unknown): CalEvent[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_EVENTS) return null;
  const out: CalEvent[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    const allDay = e.allDay === true;
    if (!e || typeof e.uid !== 'string' || !e.uid || (allDay ? !isDate(e.start) || !isDate(e.end) : !isInstant(e.start) || !isInstant(e.end))) return null;
    out.push({ uid: str(e.uid, 100), title: str(e.title, 200), notes: str(e.notes, 1000) || undefined, start: e.start as string, end: e.end as string, allDay: allDay || undefined });
  }
  return out;
}

// ---------- Durable Object ----------

export class CalendarFeed {
  constructor(private state: DOState) {}

  async fetch(req: Request): Promise<Response> {
    const s = this.state.storage;
    if (req.method === 'PUT') {
      await s.put('feed', await req.json());
      return json({ ok: true });
    }
    if (req.method === 'DELETE') {
      await s.deleteAll();
      return json({ ok: true });
    }
    const feed = await s.get<Feed>('feed');
    return feed ? json(feed) : json({ error: 'not_found' }, 404);
  }
}

// ---------- routes ----------

export async function handleCalendar(req: Request, env: { CALENDARS?: DONamespace }): Promise<Response> {
  if (!env.CALENDARS) return json({ error: 'not_configured' }, 503);
  const m = new URL(req.url).pathname.match(/^\/api\/cal\/([^/.]+)(\.ics)?$/);
  if (!m || !TOKEN.test(m[1])) return json({ error: 'not_found' }, 404);
  const stub = env.CALENDARS.get(env.CALENDARS.idFromName(m[1]));

  if (m[2]) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'not_found' }, 404);
    const res = await stub.fetch('https://do/feed');
    if (!res.ok) return new Response('Not found', { status: 404 });
    return new Response(toICS((await res.json()) as Feed), {
      headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'content-disposition': 'inline; filename="ground-time.ics"' },
    });
  }
  if (req.method === 'PUT') {
    const body = (await req.json().catch(() => null)) as { name?: unknown; events?: unknown } | null;
    const events = cleanEvents(body?.events);
    if (!events) return json({ error: 'bad_request' }, 400);
    const feed: Feed = { name: str(body?.name, 60) || 'Ground Time', events, updatedAt: new Date().toISOString() };
    return stub.fetch('https://do/feed', { method: 'PUT', body: JSON.stringify(feed) });
  }
  if (req.method === 'DELETE') return stub.fetch('https://do/feed', { method: 'DELETE' });
  return json({ error: 'not_found' }, 404);
}
