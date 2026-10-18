/**
 * Two things read mid-task on a phone: which week of a cycle a compound is
 * in, and how long the rest has run while you scroll down to the next
 * exercise. The rest timer must stay pinned in view, not scroll away.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-rest-timer-weeks');
const PORT = 4327;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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

  console.log('\nA 12-week cycle started 15 days ago reads as week 3');
  const start = new Date();
  start.setDate(start.getDate() - 14);
  const end = new Date(start);
  end.setDate(end.getDate() + 83);
  await page.goto(`${BASE}/#/cycles`);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '+ Protocol' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet select').first().selectOption({ label: 'BPC-157' });
  await page.locator('.sheet .input.big').first().fill('250');
  const dates = page.locator('.sheet input[type="date"]');
  await dates.nth(0).fill(iso(start));
  await dates.nth(1).fill(iso(end));
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(700);
  const today = await page.locator('.app-main').innerText();
  check('the dose checklist shows the week', today.includes('Week 3 of 12 · Day 15 of 84'), today.slice(0, 400));
  await page.screenshot({ path: `${SHOTS}/01-today.png`, fullPage: true });
  await page.getByRole('button', { name: 'Protocols' }).click();
  await page.waitForTimeout(500);
  const running = await page.locator('.app-main').innerText();
  check('the protocol card shows the week', running.includes('Week 3 of 12 · Day 15 of 84'), running.slice(0, 400));
  await page.screenshot({ path: `${SHOTS}/02-protocols.png`, fullPage: true });

  console.log('\nThe rest timer stays pinned while scrolling');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Something else' }).click();
  await page.waitForTimeout(900);
  for (const name of ['bench press', 'squat', 'deadlift']) {
    await page.getByRole('button', { name: /Add exercise/ }).first().click();
    await page.locator('.sheet').waitFor();
    await page.locator('.sheet input').first().fill(name);
    await page.waitForTimeout(500);
    await page.locator('.sheet .list-row').first().click();
    await page.waitForTimeout(700);
  }
  check('no rest timer before a set is done', (await page.locator('.rest-pill').count()) === 0);
  await page.getByRole('button', { name: 'Mark set as done' }).first().click();
  await page.waitForTimeout(2300);
  const pill = page.locator('.rest-pill');
  check('the rest timer appears after a set', await pill.isVisible());
  check('it counts up', /\b[1-9]s\b/.test(await pill.innerText()), await pill.innerText());

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const box = await pill.boundingBox();
  const vw = page.viewportSize().width;
  check('it is still on screen after scrolling to the bottom', box && box.y >= 0 && box.y < 160, JSON.stringify(box));
  check('it sits at the right edge', box && box.x + box.width > vw - 40, JSON.stringify(box));
  const header = await page.locator('.app-header').boundingBox();
  check('it does not cover the header', box && header && box.y >= header.y + header.height, JSON.stringify({ box, header }));
  await page.screenshot({ path: `${SHOTS}/03-scrolled.png` });

  await page.getByRole('button', { name: 'Dismiss rest timer' }).click();
  await page.waitForTimeout(300);
  check('dismiss hides it', (await pill.count()) === 0);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nRest timer / weeks smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll rest timer and cycle week checks passed.');
