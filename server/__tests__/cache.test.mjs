import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Caching rules for the served build.
 *
 * The one that matters: routing is hash-based, so the app is always loaded
 * from "/". If that response is cacheable, the shell goes stale while pointing
 * at asset hashes that no longer exist — the update silently never arrives.
 */
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bodyview-cache-'));
  server = spawn(process.execPath, [resolve(process.cwd(), 'server/serve.mjs')], {
    stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BODYVIEW_DB: join(dir, 'c.db') },
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/version.json`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 125));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
});

const cacheControl = async (path, headers = {}) => {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  return { status: res.status, cc: res.headers.get('cache-control') ?? '', etag: res.headers.get('etag') };
};

describe('cache headers', () => {
  it('never caches the shell at the root, which is how the app is loaded', async () => {
    const { cc } = await cacheControl('/');
    assert.match(cc, /no-cache/, `"/" was ${cc}`);
  });

  it('never caches the shell under any other route either', async () => {
    for (const path of ['/index.html', '/training', '/some/deep/route']) {
      const { cc } = await cacheControl(path);
      assert.match(cc, /no-cache/, `${path} was ${cc}`);
    }
  });

  it('keeps the no-cache header on a 304 revalidation', async () => {
    const first = await cacheControl('/');
    assert.ok(first.etag, 'no ETag to revalidate with');
    const second = await cacheControl('/', { 'If-None-Match': first.etag });
    assert.equal(second.status, 304);
    assert.match(second.cc, /no-cache/);
  });

  it('caches hashed assets hard, since their names change on every build', async () => {
    const html = await (await fetch(`${BASE}/`)).text();
    const asset = html.match(/\/assets\/[A-Za-z0-9_.-]+\.js/)?.[0];
    assert.ok(asset, 'no hashed asset referenced by the shell');
    const { cc } = await cacheControl(asset);
    assert.match(cc, /immutable/, `${asset} was ${cc}`);
  });

  it('never caches the version stamp, or it cannot report what is deployed', async () => {
    const { cc } = await cacheControl('/version.json');
    assert.match(cc, /no-store/);
  });

  it('revalidates the service worker and the manifest', async () => {
    for (const path of ['/sw.js', '/manifest.webmanifest']) {
      const { cc } = await cacheControl(path);
      assert.match(cc, /no-cache/, `${path} was ${cc}`);
    }
  });
});
