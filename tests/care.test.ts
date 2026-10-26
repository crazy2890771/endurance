import { describe, expect, it } from 'vitest';
import { backupDue, snoozeUntil } from '@/lib/care';

describe('monthly backup reminder', () => {
  const now = new Date('2026-10-26T08:00:00Z');
  it('asks only once there is something to back up', () => {
    expect(backupDue(undefined, false, now)).toBe(false);
    expect(backupDue(undefined, true, now)).toBe(true);
  });
  it('waits 30 days after the last backup', () => {
    expect(backupDue({ lastAt: '2026-10-01T08:00:00Z' }, true, now)).toBe(false);
    expect(backupDue({ lastAt: '2026-09-26T08:00:00Z' }, true, now)).toBe(true);
  });
  it('stays hidden for a week after "Later"', () => {
    const until = snoozeUntil(now);
    expect(until).toBe('2026-11-02T08:00:00.000Z');
    expect(backupDue({ snoozeUntil: until }, true, now)).toBe(false);
    expect(backupDue({ snoozeUntil: until }, true, new Date('2026-11-02T09:00:00Z'))).toBe(true);
  });
});
