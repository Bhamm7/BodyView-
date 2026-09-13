/**
 * Two-device sync test.
 *
 * Runs the real server with a real SQLite file and drives two independent
 * browser profiles against it, asserting that data made on one appears on the
 * other, that deletions propagate, and that offline edits reconcile on
 * reconnection.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-sync');
const DB = resolve(ROOT, '.smoke-sync/bodyview.db');
const PORT = 4318;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const server = spawn(process.execPath, [resolve(ROOT, 'server/serve.mjs')], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BODYVIEW_DB: DB },
});
server.stderr.on('data', (d) => {
  const text = String(d);
  if (!text.includes('ExperimentalWarning') && !text.includes('trace-warnings')) {
    process.stderr.write(text);
  }
});

/** Prefer a pre-installed Chromium; otherwise let Playwright resolve its own. */
const chromePath = () => globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ?? undefined;

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

/** Connects a page to the sync server through the Settings UI. */
async function connect(page) {
  await page.goto(`${BASE}/#/settings`);
  await page.waitForTimeout(800);
  await page.locator('input[placeholder="https://…"]').fill(BASE);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForTimeout(2500);
}

/** Logs a weight reading through the UI. */
async function logWeight(page, value) {
  await page.goto(`${BASE}/#/health/weight`);
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: '+ Log' }).first().click();
  await page.locator('.sheet .input.big').first().waitFor();
  await page.locator('.sheet .input.big').first().fill(value);
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);
}

const run = async () => {
  await waitForServer();
  const browser = await chromium.launch({ executablePath: chromePath() });

  const mkDevice = async (name) => {
    const context = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(`${name}: ${m.text()}`);
    });
    return { context, page, errors };
  };

  console.log('\nPhone connects to the server');
  const phone = await mkDevice('phone');
  await connect(phone.page);
  const phoneState = await phone.page.locator('.card').filter({ hasText: 'Sync' }).first().innerText();
  check('phone reports connected', /Connected/.test(phoneState), phoneState.slice(0, 120));
  await phone.page.screenshot({ path: `${SHOTS}/01-phone-connected.png`, fullPage: true });

  console.log('\nPhone logs a weigh-in');
  await logWeight(phone.page, '84.2');
  await phone.page.waitForTimeout(3500); // debounced push
  const health = await (await fetch(`${BASE}/api/health`)).json();
  check('server stored the reading', health.collections.metrics >= 1, JSON.stringify(health.collections.metrics));

  const beforeSecondDevice = (await (await fetch(`${BASE}/api/health`)).json()).collections.compounds;

  console.log('\nDesktop connects and receives it');
  const desktop = await mkDevice('desktop');
  await connect(desktop.page);
  await desktop.page.goto(`${BASE}/#/health/weight`);
  await desktop.page.waitForTimeout(1500);
  check('desktop sees the phone’s reading', (await desktop.page.getByText('84.2').count()) > 0);
  await desktop.page.screenshot({ path: `${SHOTS}/02-desktop-received.png`, fullPage: true });

  console.log('\nDesktop logs its own, phone receives it');
  await logWeight(desktop.page, '83.5');
  await desktop.page.waitForTimeout(3500);
  await phone.page.goto(`${BASE}/#/health/weight`);
  await phone.page.waitForTimeout(3000);
  check('phone sees the desktop’s reading', (await phone.page.getByText('83.5').count()) > 0);

  console.log('\nSeeded catalogues are shared, not duplicated');
  const compounds = (await (await fetch(`${BASE}/api/health`)).json()).collections.compounds;
  check(
    'a second device does not duplicate the catalogue',
    compounds > 0 && compounds === beforeSecondDevice,
    `${beforeSecondDevice} before, ${compounds} after`,
  );
  await desktop.page.goto(`${BASE}/#/cycles`);
  await desktop.page.waitForTimeout(1200);
  await desktop.page.getByRole('button', { name: 'Library' }).click();
  await desktop.page.waitForTimeout(600);
  const listed = await desktop.page.locator('.list-row').count();
  check('desktop library is not doubled', listed === compounds, `showing ${listed} of ${compounds}`);

  console.log('\nDeletion propagates');
  await phone.page.goto(`${BASE}/#/health/weight`);
  await phone.page.waitForTimeout(1200);
  await phone.page.locator('.list-row').filter({ hasText: '84.2' }).first().click();
  await phone.page.locator('.sheet').waitFor();
  await phone.page.locator('.sheet').getByRole('button', { name: 'Delete' }).click();
  await phone.page.waitForTimeout(3500);
  await desktop.page.goto(`${BASE}/#/health/weight`);
  await desktop.page.waitForTimeout(3000);
  check('deleted reading is gone from the desktop', (await desktop.page.getByText('84.2').count()) === 0);

  console.log('\nOffline edits reconcile on reconnection');
  await phone.context.setOffline(true);
  await logWeight(phone.page, '81.7');
  await phone.page.waitForTimeout(1500);
  check('phone still records while offline', (await phone.page.getByText('81.7').count()) > 0);
  await phone.page.screenshot({ path: `${SHOTS}/03-phone-offline.png`, fullPage: true });
  await phone.context.setOffline(false);
  await phone.page.waitForTimeout(1000);
  await phone.page.goto(`${BASE}/#/settings`);
  await phone.page.getByRole('button', { name: 'Sync now' }).click();
  await phone.page.waitForTimeout(2500);
  await desktop.page.goto(`${BASE}/#/health/weight`);
  await desktop.page.waitForTimeout(3000);
  check('offline reading reached the desktop', (await desktop.page.getByText('81.7').count()) > 0);

  console.log('\nSQL is queryable by hand');
  const exported = await (await fetch(`${BASE}/api/export`)).json();
  check('export returns the shared data', Array.isArray(exported.tables.metrics));

  console.log('\nAuth');
  const noToken = await fetch(`${BASE}/api/health`);
  check('open server allows access', noToken.ok);

  const allErrors = [...phone.errors, ...desktop.errors];
  check('no uncaught page errors', allErrors.length === 0, allErrors.slice(0, 2).join(' | '));

  await browser.close();
};

try {
  await run();
} catch (err) {
  console.error('\nSync smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally {
  server.kill('SIGTERM');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll sync checks passed.');
