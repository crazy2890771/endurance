import {
  addDays as dfAddDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { HHmm, ISODate } from '@/domain/types';

export const toISODate = (d: Date): ISODate => format(d, 'yyyy-MM-dd');
export const fromISODate = (s: ISODate): Date => parseISO(s);
export const todayISO = (): ISODate => toISODate(new Date());

export const addDaysISO = (s: ISODate, n: number): ISODate => toISODate(dfAddDays(fromISODate(s), n));

export const diffDays = (a: ISODate, b: ISODate): number =>
  differenceInCalendarDays(fromISODate(a), fromISODate(b));

export const weekStart = (s: ISODate, weekStartsOn: 0 | 1 = 1): ISODate =>
  toISODate(startOfWeek(fromISODate(s), { weekStartsOn }));

export const weekDays = (s: ISODate, weekStartsOn: 0 | 1 = 1): ISODate[] => {
  const start = weekStart(s, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDaysISO(start, i));
};

/** Inclusive list of dates from `from` to `to`. */
export const dateRange = (from: ISODate, to: ISODate): ISODate[] => {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d);
  return out;
};

/** Whole weeks covering the month that contains `s` (5 or 6 rows of 7 days). */
export const monthGrid = (s: ISODate, weekStartsOn: 0 | 1 = 1): ISODate[] => {
  const d = fromISODate(s);
  const first = weekStart(toISODate(startOfMonth(d)), weekStartsOn);
  const lastWeek = weekStart(toISODate(endOfMonth(d)), weekStartsOn);
  return dateRange(first, addDaysISO(lastWeek, 6));
};

export const monthBounds = (s: ISODate): [ISODate, ISODate] => {
  const d = fromISODate(s);
  return [toISODate(startOfMonth(d)), toISODate(endOfMonth(d))];
};

export const parseHHmm = (t: HHmm): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Minutes since the Unix epoch for a local date + time — handy for comparing intervals. */
export const toEpochMin = (date: ISODate, time: HHmm = '00:00'): number => {
  const [y, mo, d] = date.split('-').map(Number);
  const mins = parseHHmm(time);
  return Math.round(new Date(y, mo - 1, d, Math.floor(mins / 60), mins % 60).getTime() / 60000);
};

export const isValidISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(fromISODate(s).getTime());
export const isValidHHmm = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
