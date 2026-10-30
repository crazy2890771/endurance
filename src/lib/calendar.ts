import type { CalEvent } from '../../worker/calendar';
import type { Activity, Duty, DutyType, Workout } from '@/domain/types';
import { dutyEndDate } from '@/domain/rules';
import { addDaysISO } from '@/lib/dates';
import { formatDuration } from '@/lib/format';

export type { CalEvent };

const EMOJI: Record<Activity, string> = { run: '🏃', cycle: '🚴', swim: '🏊', strength: '🏋️', rest: '' };

/** Local date + HH:mm on this phone → UTC ISO. */
const instant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();

/**
 * Calendar events for the iPhone Calendar: every duty (flights timed, days off all-day) and every
 * planned or completed workout. Skipped and deleted ones are left out. UIDs are stable, so an edit
 * updates the same event.
 */
export function calendarEvents(workouts: Workout[], duties: Duty[], dutyTypes: DutyType[], opts: { name: (w: Workout) => string; zone: (z: number) => string }): CalEvent[] {
  const events: CalEvent[] = [];
  for (const d of duties) {
    if (d.deleted) continue;
    const type = dutyTypes.find((x) => x.id === d.dutyTypeId);
    const code = type?.code ?? '';
    const icon = d.dutyTypeId === 'dt-flight' ? '✈️ ' : d.dutyTypeId === 'dt-standby' || d.dutyTypeId === 'dt-dm' ? '🕒 ' : '';
    // AIMS markers like ">OFF" just repeat the code.
    const extra = d.title && d.title.replace(/^>/, '') !== code ? ` · ${d.title}` : '';
    const title = `${icon}${code}${extra}`;
    if (d.startTime && d.endTime) {
      events.push({ uid: `d-${d.id}`, title, notes: d.notes, start: instant(d.date, d.startTime), end: instant(dutyEndDate(d), d.endTime) });
    } else {
      events.push({ uid: `d-${d.id}`, title, notes: d.notes, start: d.date, end: addDaysISO(d.endDate ?? d.date, 1), allDay: true });
    }
  }
  for (const w of workouts) {
    if (w.deleted || w.status === 'skipped' || w.activity === 'rest') continue;
    const done = w.status === 'completed';
    const mins = done ? (w.result?.durationMin ?? w.durationMin) : w.durationMin;
    const title = `${done ? '✓ ' : ''}${EMOJI[w.activity]} ${opts.name(w)}`.trim();
    const notes = [[formatDuration(mins), w.hrZone ? opts.zone(w.hrZone) : ''].filter(Boolean).join(' · '), w.target, w.notes].filter(Boolean).join('\n');
    if (w.startTime) {
      const start = instant(w.date, w.startTime);
      events.push({ uid: `w-${w.id}`, title, notes, start, end: new Date(Date.parse(start) + Math.max(mins, 5) * 60000).toISOString() });
    } else {
      events.push({ uid: `w-${w.id}`, title: `${title} · ${formatDuration(mins)}`, notes, start: w.date, end: addDaysISO(w.date, 1), allDay: true });
    }
  }
  return events;
}

// ---------- private link ----------

export const newCalendarToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** https:// link (for copying) and webcal:// link (tapping it offers “Subscribe” on iPhone). */
export function calendarLinks(token: string, origin = window.location.origin) {
  const https = `${origin}/api/cal/${token}.ics`;
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

export async function uploadCalendar(token: string, name: string, events: CalEvent[]) {
  const res = await fetch(`/api/cal/${token}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, events }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function deleteCalendar(token: string) {
  await fetch(`/api/cal/${token}`, { method: 'DELETE' }).catch(() => undefined);
}
