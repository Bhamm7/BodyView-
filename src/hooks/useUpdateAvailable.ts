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

  /**
   * Fetches the app afresh.
   *
   * Touches nothing belonging to the browser or the user: no cookies, no saved
   * passwords or addresses, no autofill, and not the app's own database. Only
   * this app's cached program files, plus a one-off query string so the request
   * cannot be answered from cache.
   */
  const reload = useCallback(() => {
    const go = () => {
      const url = new URL(window.location.href);
      url.searchParams.set('v', Date.now().toString(36));
      window.location.replace(url.toString());
    };

    const jobs: Array<Promise<unknown>> = [];

    // Service-worker caches only — CacheStorage for this origin.
    if ('caches' in window) {
      jobs.push(
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .catch(() => undefined),
      );
    }

    // A worker from an earlier install would otherwise keep serving the old
    // build however many times the page is reloaded.
    if (navigator.serviceWorker?.getRegistrations) {
      jobs.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((reg) => reg.unregister())))
          .catch(() => undefined),
      );
    }

    void Promise.all(jobs).then(go, go);
  }, []);

  return { available, reload };
}
