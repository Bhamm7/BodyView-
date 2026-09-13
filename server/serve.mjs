#!/usr/bin/env node
/**
 * Static file server for a built BodyView (`dist/`).
 *
 * Deliberately dependency-free: this runs as a long-lived service, and a
 * server with no supply chain is one less thing to maintain or patch.
 *
 * Environment:
 *   PORT       port to listen on            (default 8787)
 *   HOST       address to bind              (default 127.0.0.1)
 *   ROOT       directory to serve           (default ../dist)
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

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(process.env.ROOT ?? join(HERE, '..', 'dist'));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';

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
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': MIME['.txt'], ...headers });
    res.end(body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(405, 'Method not allowed', { Allow: 'GET, HEAD' });
  }

  const pathname = (req.url ?? '/').split('?')[0];

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
  console.log(`  http://${HOST}:${PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
