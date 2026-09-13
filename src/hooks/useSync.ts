import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { onLocalChange } from '@/db/db';
import type { SyncState, SyncStatus } from '@/db/sync-types';
import { getSyncState, sync } from '@/lib/sync';

/** Periodic catch-up, on top of the event-driven triggers below. */
const POLL_MS = 60_000;
/** Local writes settle before a push, so a burst of edits is one round trip. */
const DEBOUNCE_MS = 2_500;

export function useSyncState(): SyncState | undefined {
  return useLiveQuery(() => getSyncState(), []);
}

/**
 * Keeps this device in step with the server.
 *
 * Syncs on mount, whenever the app comes back to the foreground, when the
 * network returns, shortly after a local change, and on a slow poll as a
 * backstop. Mounted once, from the app shell.
 */
export function useAutoSync(): { status: SyncStatus; syncNow: () => Promise<void> } {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(async () => {
    const state = await getSyncState();
    if (!state.enabled || !state.serverUrl) {
      setStatus('idle');
      return;
    }
    setStatus('syncing');
    const result = await sync();
    setStatus(result.ok ? 'ok' : result.offline ? 'offline' : 'error');
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
  }, [run]);

  useEffect(() => {
    void run();

    const onVisible = () => {
      if (document.visibilityState === 'visible') void run();
    };
    const onOnline = () => void run();

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    const poll = setInterval(() => void run(), POLL_MS);

    // Any edit made on this device schedules a debounced push, so a burst of
    // set logging during a workout becomes a single request.
    const unsubscribe = onLocalChange(schedule);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(poll);
      unsubscribe();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [run, schedule]);

  return { status, syncNow: run };
}
