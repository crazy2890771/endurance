import type { Activity, Units } from '@/domain/types';

const KM_PER_MI = 1.609344;
const M_PER_YD = 0.9144;

/** Format a distance stored in km for display. Swims are shown in metres / yards. */
export function formatDistance(km: number | undefined, activity: Activity, units: Units): string {
  if (km === undefined || km === null || isNaN(km)) return '';
  if (activity === 'swim') {
    return units === 'imperial' ? `${Math.round((km * 1000) / M_PER_YD).toLocaleString()} yd` : `${Math.round(km * 1000).toLocaleString()} m`;
  }
  const v = units === 'imperial' ? km / KM_PER_MI : km;
  return `${trim(v)} ${units === 'imperial' ? 'mi' : 'km'}`;
}

/** Total distance (km-based) across activities. */
export function formatKm(km: number, units: Units): string {
  const v = units === 'imperial' ? km / KM_PER_MI : km;
  return `${trim(v)} ${units === 'imperial' ? 'mi' : 'km'}`;
}

export const distanceUnitLabel = (activity: Activity, units: Units) =>
  activity === 'swim' ? (units === 'imperial' ? 'yd' : 'm') : units === 'imperial' ? 'mi' : 'km';

/** Convert a value typed in the activity's display unit to km for storage. */
export function inputToKm(value: number, activity: Activity, units: Units): number {
  if (activity === 'swim') return units === 'imperial' ? (value * M_PER_YD) / 1000 : value / 1000;
  return units === 'imperial' ? value * KM_PER_MI : value;
}

/** Convert stored km to the activity's display unit (for prefilling inputs). */
export function kmToInput(km: number, activity: Activity, units: Units): number {
  if (activity === 'swim') return Math.round(units === 'imperial' ? (km * 1000) / M_PER_YD : km * 1000);
  return round2(units === 'imperial' ? km / KM_PER_MI : km);
}

export function formatDuration(min: number): string {
  if (!min) return '0 min';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const trim = (v: number) => (v >= 100 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString());

export function downloadFile(name: string, content: string | Blob, mime = 'text/plain') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csvEscape = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
