/**
 * Optional Supabase cloud sync.
 *
 * Local IndexedDB is always the source of truth for the UI; the cloud is a
 * replica. Every record carries `updatedAt` (client edit time) and a `dirty`
 * flag. A sync pulls rows changed on the server since the last cursor, merges
 * them (see merge.ts), then pushes local dirty rows. The server enforces
 * last-write-wins with a trigger, so an older edit can never overwrite a newer one.
 */
import type { SupabaseClient, Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { db, SYNCED_TABLES, type SyncedTable } from '@/db/db';
import { newId, nowIso, onLocalChange, updateSettings } from '@/db/repo';
import type { AppSettings, SyncFields } from '@/domain/types';
import { mergeRemote } from './merge';

export const REMOTE_TABLE = 'kel_records';

export type SyncState = 'not-configured' | 'offline' | 'signed-out' | 'idle' | 'syncing' | 'error';

interface Status {
  state: SyncState;
  email?: string;
  error?: string;
  pending: number;
}

let status: Status = { state: 'not-configured', pending: 0 };
const subs = new Set<() => void>();
const setStatus = (s: Partial<Status>) => {
  status = { ...status, ...s };
  subs.forEach((f) => f());
};
export const useSyncStatus = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => status,
  );

export interface SyncConfig {
  url: string;
  anonKey: string;
  fromEnv: boolean;
}

const ENV_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ENV_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function resolveConfig(s: AppSettings | undefined): SyncConfig | null {
  if (s?.sync.url && s.sync.anonKey) return { url: s.sync.url, anonKey: s.sync.anonKey, fromEnv: false };
  if (ENV_URL && ENV_KEY) return { url: ENV_URL, anonKey: ENV_KEY, fromEnv: true };
  return null;
}

let client: SupabaseClient | null = null;
let clientKey = '';

export async function getClient(cfg: SyncConfig): Promise<SupabaseClient> {
  const key = `${cfg.url}|${cfg.anonKey}`;
  if (client && clientKey === key) return client;
  const { createClient } = await import('@supabase/supabase-js');
  client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'kel-supabase-auth' },
  });
  clientKey = key;
  client.auth.onAuthStateChange((_e, session) => {
    setStatus({ email: session?.user.email ?? undefined });
    if (session) void syncNow();
  });
  return client;
}

async function currentConfig() {
  return resolveConfig(await db.settings.get('app'));
}

async function getSession(): Promise<{ sb: SupabaseClient; session: Session } | null> {
  const cfg = await currentConfig();
  if (!cfg) return null;
  const sb = await getClient(cfg);
  const { data } = await sb.auth.getSession();
  return data.session ? { sb, session: data.session } : null;
}

export async function countPending(): Promise<number> {
  let n = 0;
  for (const t of SYNCED_TABLES) n += await db.table(t).where('dirty').equals(1).count();
  return n;
}

export async function refreshStatus() {
  const pending = await countPending();
  const cfg = await currentConfig();
  if (!cfg) return setStatus({ state: 'not-configured', pending, email: undefined });
  if (!navigator.onLine) return setStatus({ state: 'offline', pending });
  const s = await getSession().catch(() => null);
  if (!s) return setStatus({ state: 'signed-out', pending, email: undefined });
  if (status.state !== 'syncing' && status.state !== 'error') setStatus({ state: 'idle', pending, email: s.session.user.email ?? undefined });
  else setStatus({ pending, email: s.session.user.email ?? undefined });
}

interface RemoteRow {
  id: string;
  table_name: SyncedTable;
  data: SyncFields;
  updated_at: string;
  deleted: boolean;
  server_updated_at: string;
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync() {
  const cfg = await currentConfig();
  if (!cfg) return refreshStatus();
  if (!navigator.onLine) return refreshStatus();
  const s = await getSession().catch(() => null);
  if (!s) return refreshStatus();
  const { sb, session } = s;
  setStatus({ state: 'syncing', error: undefined });
  try {
    const settings = await db.settings.get('app');
    // ---- pull ----
    let cursor = settings?.sync.lastPulledAt ?? '1970-01-01T00:00:00Z';
    for (;;) {
      const { data, error } = await sb
        .from(REMOTE_TABLE)
        .select('id,table_name,data,updated_at,deleted,server_updated_at')
        .gt('server_updated_at', cursor)
        .order('server_updated_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      const rows = (data ?? []) as RemoteRow[];
      if (rows.length === 0) break;
      await applyRemote(rows);
      cursor = rows[rows.length - 1].server_updated_at;
      await updateSettings((cur) => ({ sync: { ...cur.sync, lastPulledAt: cursor } }));
      if (rows.length < 500) break;
    }
    // ---- push ----
    for (const t of SYNCED_TABLES) {
      const dirty = (await db.table(t).where('dirty').equals(1).toArray()) as SyncFields[];
      for (let i = 0; i < dirty.length; i += 200) {
        const chunk = dirty.slice(i, i + 200);
        const payload = chunk.map((r) => {
          const { dirty: _d, ...data } = r;
          return { id: r.id, user_id: session.user.id, table_name: t, data, updated_at: r.updatedAt, deleted: !!r.deleted };
        });
        const { error } = await sb.from(REMOTE_TABLE).upsert(payload, { onConflict: 'user_id,table_name,id' });
        if (error) throw error;
        // Clear the dirty flag only if the record was not edited again meanwhile.
        await db.transaction('rw', db.table(t), async () => {
          for (const r of chunk) {
            const cur = (await db.table(t).get(r.id)) as SyncFields | undefined;
            if (cur && cur.updatedAt === r.updatedAt) await db.table(t).update(r.id, { dirty: 0 });
          }
        });
      }
    }
    await updateSettings((cur) => ({ sync: { ...cur.sync, lastSyncedAt: nowIso(), lastError: undefined } }));
    setStatus({ state: 'idle', error: undefined, pending: await countPending() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e);
    await updateSettings((cur) => ({ sync: { ...cur.sync, lastError: msg } }));
    setStatus({ state: 'error', error: msg, pending: await countPending() });
  }
}

async function applyRemote(rows: RemoteRow[]) {
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.conflicts], async () => {
    for (const row of rows) {
      if (!SYNCED_TABLES.includes(row.table_name)) continue;
      const table = db.table(row.table_name);
      const remote = { ...row.data, id: row.id, updatedAt: row.data.updatedAt ?? row.updated_at, deleted: row.deleted } as SyncFields;
      const local = (await table.get(row.id)) as SyncFields | undefined;
      const d = mergeRemote(local, remote);
      if (d.action === 'take-remote') await table.put(d.record);
      if (d.action !== 'noop' && d.conflictLoser) {
        await db.conflicts.put({
          id: newId(),
          table: row.table_name,
          recordId: row.id,
          local: d.action === 'take-remote' ? d.conflictLoser : local,
          remote: d.action === 'take-remote' ? remote : d.conflictLoser,
          keptVersion: d.action === 'take-remote' ? 'remote' : 'local',
          createdAt: nowIso(),
        });
      }
    }
  });
}

/** Restore the version from a conflict that was not kept. It becomes a new local edit and syncs normally. */
export async function resolveConflictWith(conflictId: string) {
  const c = await db.conflicts.get(conflictId);
  if (!c) return;
  const version = (c.keptVersion === 'remote' ? c.local : c.remote) as SyncFields;
  await db.table(c.table).put({ ...version, updatedAt: nowIso(), dirty: 1 });
  await db.conflicts.delete(conflictId);
  void syncNow();
}

export async function sendMagicLink(email: string) {
  const cfg = await currentConfig();
  if (!cfg) throw new Error('Sync not configured');
  const sb = await getClient(cfg);
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/settings/sync` } });
  if (error) throw error;
}

export async function signOut() {
  const cfg = await currentConfig();
  if (!cfg) return;
  const sb = await getClient(cfg);
  await sb.auth.signOut();
  await refreshStatus();
}

let started = false;
/** Start background sync triggers: on load, when back online, after local edits and every 5 minutes. */
export function startSyncScheduler() {
  if (started) return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms = 3000) => {
    clearTimeout(timer);
    timer = setTimeout(() => void syncNow(), ms);
  };
  onLocalChange(() => {
    void refreshStatus();
    soon();
  });
  window.addEventListener('online', () => soon(500));
  window.addEventListener('offline', () => void refreshStatus());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon(500));
  setInterval(() => void syncNow(), 5 * 60 * 1000);
  void (async () => {
    const cfg = await currentConfig();
    if (cfg) await getClient(cfg); // processes a magic-link redirect if present
    await syncNow();
  })();
}
