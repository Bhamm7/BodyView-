import type { ID } from './types';

/** A record deleted locally, waiting to be pushed so other devices delete it too. */
export interface Tombstone {
  /** `${table}:${id}` — unique per record. */
  key: string;
  table: string;
  id: ID;
  updatedAt: number;
}

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'error';

/**
 * This device's sync configuration and cursors. Local only: it is never synced,
 * so the server address and token do not travel between devices or into a
 * backup file.
 */
export interface SyncState {
  id: 'state';
  /** Base URL of the BodyView server, e.g. `https://mini.tailnet.ts.net`. */
  serverUrl: string;
  /** Bearer token, when the server is configured to require one. */
  token?: string;
  enabled: boolean;
  /** Server cursor: everything up to here has been pulled. */
  lastSyncedAt: number;
  /** Local cursor: every local change up to here has been pushed. */
  lastPushedAt: number;
  /** Wall-clock time of the last successful sync, for the UI. */
  lastSuccessAt?: number;
  lastError?: string;
}
