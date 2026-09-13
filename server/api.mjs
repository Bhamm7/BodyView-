/**
 * Sync API.
 *
 * One endpoint does the work: a client posts the records it has changed since
 * it last synced, and gets back everything else that changed on the server in
 * the meantime. Conflicts are resolved last-write-wins on the device clock,
 * which is the right model for a single user with a phone and a desktop.
 */
import {
  applyChange,
  changesSince,
  COLLECTIONS,
  counts,
  isCollection,
  pruneTombstones,
} from './db.mjs';

/** Rows returned per collection per round; a client loops while `hasMore`. */
const PAGE = 500;
const MAX_BODY = 32 * 1024 * 1024;
/** Tombstones are kept well past any plausible offline stretch. */
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Pulls the next page of server changes.
 *
 * When a collection is truncated at PAGE the cursor cannot simply advance to
 * "now", or the untruncated rows past that point would be skipped. It advances
 * only as far as the earliest truncation instead; anything re-sent next round
 * applies identically, so overlap is harmless but a gap would not be.
 */
function pull(db, since) {
  const changes = {};
  let truncatedFloor = Infinity;
  let maxSeen = since;
  let total = 0;

  for (const collection of COLLECTIONS) {
    const rows = changesSince(db, collection, since, PAGE + 1);
    const truncated = rows.length > PAGE;
    const page = truncated ? rows.slice(0, PAGE) : rows;
    if (page.length === 0) continue;

    changes[collection] = page;
    total += page.length;

    const last = page[page.length - 1].serverUpdatedAt;
    if (last > maxSeen) maxSeen = last;
    if (truncated) truncatedFloor = Math.min(truncatedFloor, last);
  }

  const hasMore = truncatedFloor !== Infinity;
  return { changes, total, hasMore, nextSince: hasMore ? truncatedFloor : maxSeen };
}

/** Validates and applies an incoming batch, returning how many rows stuck. */
function push(db, incoming, clock) {
  if (!incoming || typeof incoming !== 'object') return { applied: 0, rejected: 0 };

  let applied = 0;
  let rejected = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [collection, rows] of Object.entries(incoming)) {
      if (!isCollection(collection) || !Array.isArray(rows)) {
        rejected += Array.isArray(rows) ? rows.length : 1;
        continue;
      }
      for (const row of rows) {
        if (!row || typeof row.id !== 'string' || !row.id) {
          rejected++;
          continue;
        }
        if (!row.deleted && (typeof row.data !== 'object' || row.data === null)) {
          rejected++;
          continue;
        }
        if (applyChange(db, collection, row, clock())) applied++;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { applied, rejected };
}

/**
 * Returns a request handler for `/api/*`, or null for paths it does not own so
 * the caller can fall through to serving static files.
 */
export function createApi({ db, clock, token }) {
  let lastPrune = 0;

  const authorized = (req) => {
    if (!token) return true;
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Constant-time-ish comparison; lengths differing is already a mismatch.
    if (provided.length !== token.length) return false;
    let diff = 0;
    for (let i = 0; i < token.length; i++) diff |= provided.charCodeAt(i) ^ token.charCodeAt(i);
    return diff === 0;
  };

  return async function handleApi(req, res, pathname) {
    if (!pathname.startsWith('/api/')) return false;

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return true;
    }

    if (!authorized(req)) {
      json(res, 401, { error: 'Unauthorized' });
      return true;
    }

    try {
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, {
          ok: true,
          now: Date.now(),
          collections: counts(db),
          requiresToken: !!token,
        });
        return true;
      }

      if (pathname === '/api/sync' && req.method === 'POST') {
        const body = await readBody(req);
        const since = Number.isFinite(Number(body.since)) ? Math.max(0, Number(body.since)) : 0;

        const { applied, rejected } = push(db, body.changes, clock);
        const result = pull(db, since);

        // Opportunistic housekeeping, at most once a day.
        if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
          lastPrune = Date.now();
          pruneTombstones(db, TOMBSTONE_TTL_MS);
        }

        json(res, 200, {
          now: result.nextSince,
          changes: result.changes,
          pulled: result.total,
          applied,
          rejected,
          hasMore: result.hasMore,
        });
        return true;
      }

      if (pathname === '/api/export' && req.method === 'GET') {
        const tables = {};
        for (const collection of COLLECTIONS) {
          tables[collection] = changesSince(db, collection, 0, Number.MAX_SAFE_INTEGER)
            .filter((row) => !row.deleted)
            .map((row) => row.data);
        }
        json(res, 200, {
          format: 'bodyview-backup',
          version: 1,
          exportedAt: new Date().toISOString(),
          tables,
        });
        return true;
      }

      json(res, 404, { error: 'Unknown endpoint' });
      return true;
    } catch (err) {
      const status = err?.status ?? 500;
      if (status >= 500) console.error('API error:', err);
      json(res, status, { error: err?.message ?? 'Server error' });
      return true;
    }
  };
}
