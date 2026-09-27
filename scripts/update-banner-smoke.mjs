/**
 * The stale-page banner: shown when the server is serving a different build
 * from the one running, hidden when they match.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-update');
const VERSION_FILE = resolve(ROOT, 'dist/version.json');
const PORT = 4325;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const original = readFileSync(VERSION_FILE, 'utf8');

const server = spawn(process.execPath, [resolve(ROOT, 'server/serve.mjs')], {
  cwd: ROOT, stdio: 'pipe',
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BODYVIEW_DB: resolve(SHOTS, 'u.db') },
});
server.stderr.on('data', (d) => {
  const t = String(d);
  if (!t.includes('Experimental') && !t.includes('trace-warnings')) process.stderr.write(t);
});

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${BASE}/version.json`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

const run = async () => {
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ?? undefined,
  });
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('\nServer and page in step');
  await page.goto(`${BASE}/#/`);
  await page.waitForTimeout(1500);
  check('no banner when they match', (await page.locator('.update-banner').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/01-in-step.png` });

  console.log('\nServer gets a newer build while the page is open');
  // Stand in for a rebuild on the mini: the served commit moves on.
  writeFileSync(VERSION_FILE, JSON.stringify({ commit: 'deadbee', builtAt: new Date().toISOString() }, null, 2));

  // The page re-checks whenever it comes back to the foreground.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(1500);

  check('the banner appears', (await page.locator('.update-banner').count()) === 1);
  const text = await page.locator('.update-banner').innerText().catch(() => '');
  check('it says what happened', /newer version/i.test(text), text);
  check('it offers a reload', (await page.locator('.update-banner button').innerText()) === 'Reload');
  await page.screenshot({ path: `${SHOTS}/02-stale.png` });

  console.log('\nReloading clears it once the builds agree again');
  writeFileSync(VERSION_FILE, original);
  await page.locator('.update-banner button').click();
  await page.waitForTimeout(2000);
  check('the banner is gone after reloading', (await page.locator('.update-banner').count()) === 0);
  check('the app still works', (await page.locator('.app-header h1').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/03-reloaded.png` });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nUpdate banner smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally {
  writeFileSync(VERSION_FILE, original);
  server.kill('SIGTERM');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll update banner checks passed.');
