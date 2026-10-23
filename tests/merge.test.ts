import { describe, expect, it } from 'vitest';
import { mergeRemote } from '@/sync/merge';
import type { SyncFields } from '@/domain/types';

type R = SyncFields & { v: string };
const r = (updatedAt: string, v: string, dirty: 0 | 1 = 0, deleted = false): R => ({ id: 'x', createdAt: '2026-01-01', updatedAt, v, dirty, deleted });

describe('sync merge', () => {
  it('takes remote when there is no local copy', () => {
    const d = mergeRemote(undefined, r('2026-10-01', 'a'));
    expect(d).toMatchObject({ action: 'take-remote', record: { v: 'a', dirty: 0 } });
  });

  it('takes a newer remote over a clean local copy', () => {
    expect(mergeRemote(r('2026-10-01', 'a'), r('2026-10-02', 'b')).action).toBe('take-remote');
  });

  it('ignores an older remote when local is clean', () => {
    expect(mergeRemote(r('2026-10-03', 'a'), r('2026-10-02', 'b')).action).toBe('noop');
  });

  it('keeps a newer dirty local edit and records the remote as a conflict', () => {
    const remote = r('2026-10-02', 'remote');
    const d = mergeRemote(r('2026-10-03', 'local', 1), remote);
    expect(d.action).toBe('keep-local');
    expect(d.action === 'keep-local' && d.conflictLoser).toEqual(remote);
  });

  it('takes a newer remote over an older dirty local edit and preserves the local one', () => {
    const local = r('2026-10-02', 'local', 1);
    const d = mergeRemote(local, r('2026-10-03', 'remote'));
    expect(d.action).toBe('take-remote');
    expect(d.action === 'take-remote' && d.conflictLoser).toEqual(local);
  });

  it('treats identical content as no conflict and clears the dirty flag', () => {
    const d = mergeRemote(r('2026-10-02', 'same', 1), r('2026-10-02', 'same'));
    expect(d).toMatchObject({ action: 'take-remote', record: { dirty: 0 } });
    expect('conflictLoser' in d && d.conflictLoser).toBeFalsy();
  });

  it('propagates remote deletions (tombstones)', () => {
    const d = mergeRemote(r('2026-10-01', 'a'), r('2026-10-02', 'a', 0, true));
    expect(d).toMatchObject({ action: 'take-remote', record: { deleted: true } });
  });
});
