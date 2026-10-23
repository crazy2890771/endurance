import type { SyncFields } from '@/domain/types';

export type MergeDecision<T> =
  | { action: 'take-remote'; record: T; conflictLoser?: T }
  | { action: 'keep-local'; conflictLoser?: T }
  | { action: 'noop' };

/** Compare two records ignoring local-only bookkeeping fields. */
export function sameContent(a: object, b: object): boolean {
  const strip = (r: object) => {
    const { dirty: _d, ...rest } = r as SyncFields & Record<string, unknown>;
    return JSON.stringify(rest, Object.keys(rest).sort());
  };
  return strip(a) === strip(b);
}

/**
 * Decide how to merge a record pulled from the cloud into local storage.
 *
 * - No local copy → take remote.
 * - Local copy is clean (already synced) → take remote if it is at least as new.
 * - Local copy has unpushed changes → both devices edited it: keep the newer
 *   `updatedAt` (last-write-wins) and return the other version as a conflict
 *   so it can be shown to the user instead of silently discarded.
 */
export function mergeRemote<T extends SyncFields>(local: T | undefined, remote: T): MergeDecision<T> {
  const incoming = { ...remote, dirty: 0 as const };
  if (!local) return { action: 'take-remote', record: incoming };
  if (sameContent(local, remote)) return local.dirty ? { action: 'take-remote', record: incoming } : { action: 'noop' };
  if (!local.dirty) {
    return remote.updatedAt >= local.updatedAt ? { action: 'take-remote', record: incoming } : { action: 'noop' };
  }
  // Concurrent edit. Deleted-vs-edited counts as a conflict too.
  if (remote.updatedAt > local.updatedAt) return { action: 'take-remote', record: incoming, conflictLoser: local };
  return { action: 'keep-local', conflictLoser: remote };
}
