import { db, SYNCED_COLLECTIONS, type SyncedCollection } from '@/db/db';
import type { SyncState } from '@/db/sync-types';

/**
 * Sync engine.
 *
 * The server holds the database of record; each device keeps a full local copy
 * so the app keeps working with no connection, and reconciles when it has one.
 *
 * Each round trip pushes everything changed locally since `lastPushedAt` and
 * pulls everything the server has seen since `lastSyncedAt`. Conflicts resolve
 * last-write-wins on the editing device's clock.
 */

export interface SyncOutcome {
  ok: boolean;
  pushed: number;
  pulled: number;
  /** Set when the server could not be reached at all, as opposed to refusing. */
  offline?: boolean;
  error?: string;
}

interface RemoteChange {
  id: string;
  updatedAt: number;
  deleted?: boolean;
  data?: Record<string, unknown> | null;
}

const DEFAULT_STATE: SyncState = {
  id: 'state',
  serverUrl: '',
  enabled: false,
  lastSyncedAt: 0,
  lastPushedAt: 0,
};

export async function getSyncState(): Promise<SyncState> {
  const stored = await db._sync.get('state');
  return { ...DEFAULT_STATE, ...stored };
}

export async function setSyncState(patch: Partial<SyncState>): Promise<SyncState> {
  const next = { ...(await getSyncState()), ...patch, id: 'state' as const };
  await db._sync.put(next);
  return next;
}

/** Trims a pasted URL into a usable origin, tolerating a missing scheme. */
export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return '';
  }
}

function authHeaders(state: SyncState): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

/** Checks a server is reachable and the token is accepted, before saving it. */
export async function testConnection(
  serverUrl: string,
  token?: string,
): Promise<{ ok: boolean; error?: string; requiresToken?: boolean }> {
  const base = normalizeServerUrl(serverUrl);
  if (!base) return { ok: false, error: 'That does not look like a URL.' };

  try {
    const res = await fetch(`${base}/api/health`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) {
      return { ok: false, error: 'The server rejected that access token.' };
    }
    if (!res.ok) return { ok: false, error: `Server replied ${res.status}.` };
    const body = await res.json();
    if (!body?.ok) return { ok: false, error: 'That URL is not a BodyView server.' };
    return { ok: true, requiresToken: !!body.requiresToken };
  } catch (err) {
    return { ok: false, error: reachError(err) };
  }
}

function reachError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return 'The server did not respond in time.';
  }
  return 'Could not reach the server. Is it running, and are you on the same network?';
}

/** Collects local changes and tombstones into the wire format. */
async function collectLocalChanges(state: SyncState, ceiling: number) {
  const changes: Record<string, RemoteChange[]> = {};
  let pushed = 0;

  for (const collection of SYNCED_COLLECTIONS) {
    const rows = await db
      .table(collection)
      .where('updatedAt')
      .between(state.lastPushedAt, ceiling, false, true)
      .toArray();
    if (rows.length === 0) continue;
    changes[collection] = rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      updatedAt: Number(row.updatedAt) || ceiling,
      data: row,
    }));
    pushed += rows.length;
  }

  const tombstones = await db._tombstones.toArray();
  for (const tomb of tombstones) {
    const list = changes[tomb.table] ?? [];
    list.push({ id: tomb.id, updatedAt: tomb.updatedAt, deleted: true });
    changes[tomb.table] = list;
    pushed += 1;
  }

  return { changes, pushed, tombstoneKeys: tombstones.map((t) => t.key) };
}

/**
 * Writes server records into the local database.
 *
 * Rows keep the `updatedAt` the server reports, which is what stops them being
 * mistaken for fresh local edits and pushed straight back.
 */
async function applyRemoteChanges(changes: Record<string, RemoteChange[]>): Promise<number> {
  let applied = 0;

  for (const [collection, rows] of Object.entries(changes)) {
    if (!SYNCED_COLLECTIONS.includes(collection as SyncedCollection)) continue;
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const deletions = rows.filter((r) => r.deleted).map((r) => r.id);
    const puts = rows
      .filter((r) => !r.deleted && r.data && typeof r.data === 'object')
      .map((r) => ({ ...r.data, id: r.id, updatedAt: r.updatedAt }));

    const table = db.table(collection);
    await db.transaction('rw', [table, db._tombstones], async () => {
      // A record deleted on the server is deleted here without a new tombstone;
      // the deletion is already known upstream.
      if (deletions.length > 0) {
        await table.bulkDelete(deletions);
        await db._tombstones.bulkDelete(deletions.map((id) => `${collection}:${id}`));
      }
      if (puts.length > 0) await table.bulkPut(puts);
    });

    applied += deletions.length + puts.length;
  }

  return applied;
}

let inFlight: Promise<SyncOutcome> | null = null;

/**
 * Runs one sync. Concurrent callers share the in-flight run rather than
 * queueing a second round trip.
 */
export function sync(): Promise<SyncOutcome> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncOutcome> {
  const state = await getSyncState();
  if (!state.enabled || !state.serverUrl) {
    return { ok: false, pushed: 0, pulled: 0, error: 'Sync is not set up.' };
  }

  let pushedTotal = 0;
  let pulledTotal = 0;
  let cursor = state.lastSyncedAt;
  let pushCursor = state.lastPushedAt;

  try {
    // The server pages large pulls; keep going until it says it is done.
    for (let round = 0; round < 50; round++) {
      const ceiling = Date.now();
      const current = await getSyncState();
      const { changes, pushed, tombstoneKeys } = await collectLocalChanges(
        { ...current, lastPushedAt: pushCursor },
        ceiling,
      );

      const res = await fetch(`${state.serverUrl}/api/sync`, {
        method: 'POST',
        headers: authHeaders(state),
        body: JSON.stringify({ since: cursor, changes }),
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 401) {
        const error = 'The server rejected this device’s access token.';
        await setSyncState({ lastError: error });
        return { ok: false, pushed: pushedTotal, pulled: pulledTotal, error };
      }
      if (!res.ok) throw new Error(`Server replied ${res.status}`);

      const body = await res.json();
      pushedTotal += pushed;
      pulledTotal += await applyRemoteChanges(body.changes ?? {});

      // Only advance past what the server confirmed receiving.
      cursor = Number(body.now) || cursor;
      pushCursor = ceiling;
      if (tombstoneKeys.length > 0) await db._tombstones.bulkDelete(tombstoneKeys);

      await setSyncState({
        lastSyncedAt: cursor,
        lastPushedAt: pushCursor,
        lastSuccessAt: Date.now(),
        lastError: undefined,
      });

      if (!body.hasMore) break;
    }

    return { ok: true, pushed: pushedTotal, pulled: pulledTotal };
  } catch (err) {
    const offline = !navigator.onLine || err instanceof TypeError;
    const error = offline ? reachError(err) : ((err as Error)?.message ?? 'Sync failed');
    await setSyncState({ lastError: error });
    return { ok: false, pushed: pushedTotal, pulled: pulledTotal, offline, error };
  }
}

/**
 * Replaces everything on this device with the server's copy.
 *
 * The escape hatch for a device that built up its own seeded catalogues before
 * being connected, which would otherwise push duplicates.
 */
export async function replaceLocalWithServer(): Promise<SyncOutcome> {
  const state = await getSyncState();
  if (!state.serverUrl) return { ok: false, pushed: 0, pulled: 0, error: 'Sync is not set up.' };

  await db.transaction('rw', db.tables, async () => {
    for (const collection of SYNCED_COLLECTIONS) await db.table(collection).clear();
    await db._tombstones.clear();
  });
  await setSyncState({ lastSyncedAt: 0, lastPushedAt: Date.now(), enabled: true });
  return sync();
}

/** Whether this device has sync switched on and pointed somewhere. */
export async function isSyncConfigured(): Promise<boolean> {
  const state = await getSyncState();
  return state.enabled && !!state.serverUrl;
}
