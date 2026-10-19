/**
 * Training housekeeping: logging a session for a day that has already
 * passed, and deleting a session that is still in progress, from both the
 * Training tab and the session itself.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-workout-backfill');
const PORT = 4329;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const p2 = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT, stdio: 'pipe',
});
server.stderr.on('data', (d) => process.stderr.write(d));

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const run = async () => {
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ?? undefined,
  });
  const page = await (await browser.newContext({ ...devices['iPhone 13'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });
  const sheet = page.locator('.sheet');
  const confirmDialog = async () => {
    await page.waitForTimeout(300);
    await page.locator('[role="dialog"], .sheet, .confirm').last().getByRole('button', { name: 'Delete', exact: true }).click();
    await page.waitForTimeout(700);
  };

  console.log('\nLog a session for three days ago');
  const past = new Date();
  past.setDate(past.getDate() - 3);
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await sheet.waitFor();
  const dateInput = sheet.getByLabel('Workout date');
  check('the start sheet has a date, set to today', (await dateInput.inputValue()) === iso(new Date()));
  await dateInput.fill(iso(past));
  await page.waitForTimeout(200);
  check('it says the session is for a past day', (await sheet.innerText()).includes(`Logging a past session for ${label(past)}`));
  await page.screenshot({ path: `${SHOTS}/01-start-sheet.png` });
  await sheet.getByRole('button', { name: 'Something else' }).click();
  await page.waitForTimeout(900);
  check('the session opens on that day', (await page.getByLabel('Session date').inputValue()) === iso(past));
  await page.getByRole('button', { name: /Add exercise/ }).first().click();
  await sheet.waitFor();
  await sheet.locator('input').first().fill('bench press');
  await page.waitForTimeout(500);
  await sheet.locator('.list-row').first().click();
  await page.waitForTimeout(700);
  const cells = page.locator('table input');
  await cells.nth(0).fill('100');
  await cells.nth(1).fill('8');
  await page.getByRole('button', { name: 'Mark set as done' }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.waitForTimeout(1000);
  const list = await page.locator('.app-main').innerText();
  check('it is listed under its own day', list.includes(`${label(past)} · 1 set`), list.slice(0, 500));
  check('it has no made-up duration and is not in progress', !list.includes('in progress') && !/1 set · \d/.test(list), list.slice(0, 500));

  console.log('\nThe calendar shows it on that day');
  await page.goto(`${BASE}/#/day/${iso(past)}`);
  await page.waitForTimeout(900);
  check('the day view has the workout', (await page.locator('.app-main').innerText()).includes('Workout'));

  console.log('\nDelete an in-progress session from the Training tab');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Something else' }).click();
  await page.waitForTimeout(900);
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(900);
  check('it shows as in progress', (await page.getByText('In progress').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/02-in-progress.png` });
  await page.getByRole('button', { name: 'Delete session' }).click();
  await confirmDialog();
  check('it is gone from the tab', (await page.getByText('In progress').count()) === 0);
  check('only the past session remains', (await page.locator('.list-row').filter({ hasText: /set/ }).count()) === 1);

  console.log('\nDelete one from inside the session');
  await page.getByRole('button', { name: '+ Workout' }).click();
  await sheet.waitFor();
  await sheet.getByRole('button', { name: 'Something else' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Delete session' }).click();
  await confirmDialog();
  check('it goes back to Training', page.url().endsWith('/training'));
  check('nothing in progress is left', (await page.getByText('In progress').count()) === 0);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nWorkout backfill smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll workout backfill and delete checks passed.');
