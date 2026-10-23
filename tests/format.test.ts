import { describe, expect, it } from 'vitest';
import { formatDistance, formatDuration, inputToKm, kmToInput } from '@/lib/format';
import { dateRange, monthGrid, weekDays } from '@/lib/dates';
import { translate } from '@/i18n';
import { en } from '@/i18n/en';
import { th } from '@/i18n/th';

describe('units', () => {
  it('formats run / swim distances', () => {
    expect(formatDistance(10, 'run', 'metric')).toBe('10 km');
    expect(formatDistance(1.5, 'swim', 'metric')).toBe('1,500 m');
    expect(formatDistance(16.09344, 'run', 'imperial')).toBe('10 mi');
  });
  it('converts inputs both ways', () => {
    expect(inputToKm(1500, 'swim', 'metric')).toBe(1.5);
    expect(kmToInput(1.5, 'swim', 'metric')).toBe(1500);
    expect(kmToInput(inputToKm(5, 'run', 'imperial'), 'run', 'imperial')).toBe(5);
  });
  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 min');
    expect(formatDuration(100)).toBe('1h 40m');
    expect(formatDuration(120)).toBe('2h');
  });
});

describe('dates', () => {
  it('builds Monday-first weeks', () => {
    expect(weekDays('2026-10-23', 1)).toEqual(dateRange('2026-10-19', '2026-10-25'));
    expect(weekDays('2026-10-23', 0)[0]).toBe('2026-10-18');
  });
  it('builds whole-week month grids', () => {
    const g = monthGrid('2026-10-15', 1);
    expect(g[0]).toBe('2026-09-28');
    expect(g.length % 7).toBe(0);
    expect(g[g.length - 1]).toBe('2026-11-01');
  });
});

describe('i18n', () => {
  it('has a Thai string for every English key', () => {
    for (const k of Object.keys(en)) expect(th[k as keyof typeof en], k).toBeTruthy();
  });
  it('interpolates params', () => {
    expect(translate('en', 'home.completedOf', { done: 4, total: 7 })).toBe('4/7 completed');
    expect(translate('th', 'home.completedOf', { done: 4, total: 7 })).toBe('เสร็จ 4/7');
  });
});
