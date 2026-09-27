import { useCallback, useEffect, useState } from 'react';

/**
 * Notices when the server is serving a newer build than the one running.
 *
 * Self-hosting splits "deployed" from "loaded": the machine can be rebuilt
 * while a phone keeps showing whatever it cached. Guessing which side is stale
 * is the single most common confusion, so the page checks and says.
 *
 * The build stamps its own commit at compile time (see vite.config.ts) and
 * /version.json reports the commit the server is serving; a mismatch means
 * this page is behind.
 */

/** Slow: a rebuild is a manual act, not something that happens by the minute. */
const POLL_MS = 5 * 60 * 1000;

export function useUpdateAvailable(): { available: boolean; reload: () => void } {
  const [available, setAvailable] = useState(false);

  const check = useCallback(async () => {
    // A build made without git cannot compare itself to anything.
    if (!__BUILD_COMMIT__ || __BUILD_COMMIT__ === 'unknown') return;

    try {
      const res = await fetch(`${window.location.origin}/version.json`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { commit?: string };
      if (body.commit && body.commit !== 'unknown' && body.commit !== __BUILD_COMMIT__) {
        setAvailable(true);
      }
    } catch {
      // Offline, or served from somewhere without a version stamp. Not worth
      // surfacing — the app works either way.
    }
  }, []);

  useEffect(() => {
    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => void check(), POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [check]);

  const reload = useCallback(() => {
    // Clear any service-worker caches first, or a reload can be served the very
    // build we are trying to leave behind.
    const done = () => window.location.reload();
    if ('caches' in window) {
      void caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => undefined)
        .then(done);
    } else {
      done();
    }
  }, []);

  return { available, reload };
}
