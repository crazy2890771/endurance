/**
 * Reader for the AIMS "Personal Crew Schedule Report" PDF (Thai AirAsia).
 *
 * Page 1 holds a grid with one column per date (header "DD/MM" + weekday). Reading a
 * column top to bottom:
 * - a status word (OFF, ROFF, REST, AL, >OFF) for a free day;
 * - a ground duty: code (DM2, DH1, SBY…) then its start and end time;
 * - a flight duty: report time in **bold**, then per sector the flight number, departure
 *   time (optionally prefixed "A" for actual), origin, destination, arrival time and a
 *   crew code in brackets, and finally the sign-off time in bold.
 * A "→" means the duty carries on past midnight; the next column starts with "↓" and the
 * rest of it. "*DMK" marks a deadhead sector. "Delay hh:mm" lines and single-letter
 * markers at the bottom of the grid are ignored.
 *
 * Everything runs on the device; no crew names are read.
 */
import { AIMS_STATUS_TYPE, aimsDutyType, aimsRoute, type AimsSector, type ParsedDuty, type PdfTextItem } from './importers';
import type { DutyType, HHmm, ISODate } from './types';

const DATE_HEAD = /^(\d{2})\/(\d{2})$/;
const WEEKDAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/;
const TIME = /^A?(\d{1,2}):(\d{2})$/;
const FLIGHT = /^[A-Z]{2}\d{2,4}[A-Z]?$/;
const STATION = /^\*?[A-Z]{3}$/;
const CREW_CODE = /^\[.*\]$|^\(c\)$/i;
const MARKERS = /^[A-Za-z](,[A-Za-z])*$/;
const STATUS = new Set(['OFF', 'ROFF', 'REST', 'AL', '>OFF', 'SICK', 'SL', 'ULV', 'LVE']);

export const isAimsRoster = (items: PdfTextItem[]) => items.some((i) => /Personal Crew Schedule Report/i.test(i.str));

interface Sector extends AimsSector {
  dh?: boolean;
}

interface OpenDuty {
  date: ISODate;
  start?: HHmm;
  sectors: Sector[];
  continues: boolean;
}

const hhmm = (s: string): HHmm | undefined => {
  const m = s.match(TIME);
  if (!m || +m[1] > 23 || +m[2] > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};

/** Report period from the header line "01/10/2026 - 31/10/2026". */
function period(items: PdfTextItem[]): { from: ISODate; to: ISODate } | undefined {
  for (const it of items) {
    const m = it.str.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return { from: `${m[3]}-${m[2]}-${m[1]}`, to: `${m[6]}-${m[5]}-${m[4]}` };
  }
  return undefined;
}

export function parseAimsRoster(items: PdfTextItem[], types: DutyType[]): ParsedDuty[] {
  const per = period(items);
  // The date header is the row with the most "DD/MM" cells.
  const heads = items.filter((i) => DATE_HEAD.test(i.str));
  const rows = new Map<string, PdfTextItem[]>();
  for (const h of heads) rows.set(`${h.page}:${Math.round(h.y)}`, [...(rows.get(`${h.page}:${Math.round(h.y)}`) ?? []), h]);
  const header = [...rows.values()].sort((a, b) => b.length - a.length)[0];
  if (!header?.length) return [];
  header.sort((a, b) => a.x - b.x);
  const page = header[0].page;
  const headY = header[0].y;
  const boldFont = header[0].font;

  const startYear = per ? +per.from.slice(0, 4) : new Date().getFullYear();
  const startMonth = per ? +per.from.slice(5, 7) : +header[0].str.slice(3, 5);
  const cols = header.map((h) => {
    const [, dd, mm] = h.str.match(DATE_HEAD)!;
    const year = +mm < startMonth ? startYear + 1 : startYear;
    return { date: `${year}-${mm}-${dd}` as ISODate, left: h.x - 6, tokens: [] as PdfTextItem[] };
  });

  const onPage = items.filter((i) => i.page === page);
  const stop = onPage.find((i) => /^(Total Hours|Other Crew)/i.test(i.str));
  const bottom = stop ? stop.y : Infinity;
  for (const it of onPage) {
    if (it.y <= headY + 4 || it.y >= bottom) continue;
    if (WEEKDAY.test(it.str) || CREW_CODE.test(it.str) || MARKERS.test(it.str)) continue;
    let c = 0;
    while (c + 1 < cols.length && it.x >= cols[c + 1].left) c++;
    cols[c].tokens.push(it);
  }

  const out: ParsedDuty[] = [];
  let open: OpenDuty | null = null;

  const typeFor = (code: string, sectors = 0) =>
    aimsDutyType({ date: '', status: 'DUTY', code, sectors: sectors ? [{}] : [] }, types);

  const close = (endTime?: HHmm, endDate?: ISODate) => {
    if (!open) return;
    const d = open;
    open = null;
    const sectors = d.sectors.filter((s) => s.flt);
    const start = d.start ?? sectors[0]?.dep ?? undefined;
    const end = endTime ?? [...sectors].reverse().find((s) => s.arr)?.arr ?? undefined;
    if (!start && !sectors.length) return;
    const allDh = sectors.length > 0 && sectors.every((s) => s.dh);
    const route = aimsRoute(sectors);
    out.push({
      date: d.date,
      // Only needed when the times alone don't say it ended the next day.
      endDate: endDate && endDate > d.date && start && end && end > start ? endDate : undefined,
      startTime: start,
      endTime: end,
      raw: sectors.map((s) => s.flt).join(' '),
      title: (allDh ? 'DH ' : '') + route || undefined,
      notes: sectors
        .map((s) => [s.flt, s.from && s.to ? `${s.from}-${s.to}` : '', s.dep && s.arr ? `${s.dep}-${s.arr}` : '', s.dh ? '(DH)' : ''].filter(Boolean).join(' '))
        .join('\n') || undefined,
      dutyTypeId: typeFor('', sectors.length),
      sourceKey: `aims:${d.date}:${start ?? ''}`,
    });
  };

  for (const col of cols) {
    col.tokens.sort((a, b) => a.y - b.y || a.x - b.x);
    if (open && !(open as OpenDuty).continues) close();
    if (open) (open as OpenDuty).continues = false;
    const carried = !!open;
    const emitted = out.length;
    let ground: { code: string; start?: HHmm } | null = null;
    let skipTime = false;

    for (const tk of col.tokens) {
      const s = tk.str;
      const cur: OpenDuty | null = open;
      const sector = cur?.sectors[cur.sectors.length - 1];
      const t = hhmm(s);
      if (s === '↓') continue;
      if (s === '→') {
        if (cur) cur.continues = true;
        continue;
      }
      if (/^Delay$/i.test(s)) {
        skipTime = true;
        continue;
      }
      if (t) {
        if (skipTime) {
          skipTime = false;
          continue;
        }
        if (tk.font === boldFont) {
          if (cur) close(t, col.date);
          else open = { date: col.date, start: t, sectors: [], continues: false };
        } else if (sector && !sector.dep) sector.dep = t;
        else if (sector && sector.to && !sector.arr) sector.arr = t;
        else if (ground && !ground.start) ground.start = t;
        else if (ground) {
          out.push({ date: col.date, startTime: ground.start, endTime: t, raw: ground.code, title: ground.code, dutyTypeId: typeFor(ground.code), sourceKey: `aims:${col.date}:${ground.start ?? ''}` });
          ground = null;
        }
        continue;
      }
      if (FLIGHT.test(s)) {
        if (!open) open = { date: col.date, sectors: [], continues: false };
        (open as OpenDuty).sectors.push({ flt: s });
        continue;
      }
      if (STATION.test(s) && sector && (!sector.from || !sector.to)) {
        const code = s.replace('*', '');
        if (!sector.from) {
          sector.from = code;
          sector.dh = s.startsWith('*');
        } else sector.to = code;
        continue;
      }
      if (STATUS.has(s.toUpperCase())) {
        const id = AIMS_STATUS_TYPE[s.toUpperCase()];
        out.push({ date: col.date, raw: s, title: s === '>OFF' ? '>OFF' : undefined, dutyTypeId: id && types.some((x) => x.id === id) ? id : undefined, sourceKey: `aims:${col.date}:${s}` });
        continue;
      }
      if (/^[A-Z][A-Z0-9]{1,5}$/.test(s) && !cur) {
        if (ground) out.push({ date: col.date, raw: ground.code, title: ground.code, dutyTypeId: typeFor(ground.code), sourceKey: `aims:${col.date}:${ground.code}` });
        ground = { code: s };
      }
    }
    if (ground) out.push({ date: col.date, startTime: ground.start, raw: ground.code, title: ground.code, dutyTypeId: typeFor(ground.code), sourceKey: `aims:${col.date}:${ground.code}` });
    // A day that only finishes the previous day's duty isn't a flight day: it's off once rested.
    const own = out.slice(emitted).some((d) => d.date === col.date) || (open as OpenDuty | null)?.date === col.date;
    if (carried && out.length > emitted && !own && !open) {
      const id = AIMS_STATUS_TYPE['>OFF'];
      out.push({ date: col.date, raw: '↓', title: '>OFF', dutyTypeId: types.some((x) => x.id === id) ? id : undefined, sourceKey: `aims:${col.date}:>OFF` });
    }
  }
  close();

  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}
