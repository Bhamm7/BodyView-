#!/usr/bin/env node
/**
 * Static file server for a built BodyView (`dist/`).
 *
 * Deliberately dependency-free: this runs as a long-lived service, and a
 * server with no supply chain is one less thing to maintain or patch.
 *
 * Also hosts the sync API at /api/* backed by SQLite, so every device shares
 * one database. See server/db.mjs.
 *
 * Environment:
 *   PORT            port to listen on                    (default 8787)
 *   HOST            address to bind                      (default 127.0.0.1)
 *   ROOT            directory to serve                   (default ../dist)
 *   BODYVIEW_DB     SQLite file                          (default ../data/bodyview.db)
 *   BODYVIEW_TOKEN  require this bearer token on /api/*  (default: none)
 *   BODYVIEW_ALLOW_ORIGIN
 *                   allow this origin to call /api/*     (default: same-origin only)
 *
 * Binding to localhost by default is intentional: put a TLS terminator in
 * front (see docs/SELF-HOSTING.md). Set HOST=0.0.0.0 to expose it on the LAN
 * directly, accepting that browsers then treat it as an insecure origin and
 * disable the service worker.
 */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClock, openDatabase } from './db.mjs';
import { createApi } from './api.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(process.env.ROOT ?? join(HERE, '..', 'dist'));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_FILE = resolve(process.env.BODYVIEW_DB ?? join(HERE, '..', 'data', 'bodyview.db'));
const TOKEN = process.env.BODYVIEW_TOKEN ?? '';
/**
 * CORS stays off unless asked for. In the recommended setup this server hosts
 * both the app and the API, so they share an origin and need no CORS at all —
 * and leaving it open would let any site the user visits reach this API over
 * their private network.
 */
const ALLOW_ORIGIN = process.env.BODYVIEW_ALLOW_ORIGIN ?? '';

const db = openDatabase(DB_FILE);
const handleApi = createApi({ db, clock: createClock(db), token: TOKEN });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Hashed build assets are immutable and cached hard. The shell, the service
 * worker and the manifest must be revalidated, or an update never lands.
 */
function cacheControl(pathname) {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname === '/sw.js' || pathname === '/registerSW.js') return 'no-cache';
  if (pathname.endsWith('.webmanifest') || pathname.endsWith('.html')) return 'no-cache';
  return 'public, max-age=3600';
}

/** Resolves a URL path to a file inside ROOT, or null if it escapes. */
function resolveSafe(pathname) {
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const candidate = resolve(join(ROOT, normalize(decoded)));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;
  return candidate;
}

async function findFile(pathname) {
  const target = resolveSafe(pathname);
  if (!target) return null;
  try {
    const info = await stat(target);
    if (info.isFile()) return { path: target, size: info.size, mtime: info.mtime };
    if (info.isDirectory()) {
      const index = join(target, 'index.html');
      const indexInfo = await stat(index);
      if (indexInfo.isFile()) return { path: index, size: indexInfo.size, mtime: indexInfo.mtime };
    }
  } catch {
    /* falls through to the SPA fallback */
  }
  return null;
}

const server = createServer(async (req, res) => {
  if (ALLOW_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }

  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': MIME['.txt'], ...headers });
    res.end(body);
  };

  const pathname = (req.url ?? '/').split('?')[0];

  if (await handleApi(req, res, pathname)) return;

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }

  if (pathname === '/healthz') {
    return send(200, 'ok', { 'Cache-Control': 'no-store' });
  }

  let file = await findFile(pathname);

  // The app routes on the hash, so any unknown path is still the shell.
  // 404 genuinely-missing assets instead, so a broken reference is visible.
  if (!file && !extname(pathname)) {
    file = await findFile('/index.html');
  }

  if (!file) return send(404, 'Not found', { 'Cache-Control': 'no-store' });

  const type = MIME[extname(file.path).toLowerCase()] ?? 'application/octet-stream';
  const etag = `W/"${file.size}-${Number(file.mtime)}"`;

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl(pathname) });
    return res.end();
  }

  const headers = {
    'Content-Type': type,
    'Content-Length': String(file.size),
    'Cache-Control': cacheControl(pathname),
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }

  res.writeHead(200, headers);
  createReadStream(file.path)
    .on('error', () => res.destroy())
    .pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`BodyView serving ${ROOT}`);
  console.log(`  app      http://${HOST}:${PORT}`);
  console.log(`  sync api http://${HOST}:${PORT}/api/sync`);
  console.log(`  database ${DB_FILE}`);
  if (TOKEN) console.log('  auth     bearer token required');
  if (ALLOW_ORIGIN) console.log(`  cors     ${ALLOW_ORIGIN}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
}
