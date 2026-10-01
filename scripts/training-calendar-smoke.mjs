/**
 * Reading a month of training by body group.
 *
 * Starting a session now asks which group it is and names it accordingly, and
 * the training calendar turns those names into something readable at a glance.
 * The checks follow one group from the start sheet through to a filtered month.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-training-calendar');
const PORT = 4327;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
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

/**
 * Puts a session on a given day of this month.
 *
 * The start sheet always dates a session today, so spreading a month out has to
 * go in at the data layer — which is the point of the calendar: days apart, not
 * three sessions stacked on one square.
 */
async function seedSession(page, dayOfMonth, group) {
  await page.evaluate(
    ({ dayOfMonth, group }) =>
      new Promise((done, fail) => {
        const req = indexedDB.open('bodyview');
        req.onerror = () => fail(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const date = `${new Date().toISOString().slice(0, 8)}${String(dayOfMonth).padStart(2, '0')}`;
          const tx = db.transaction('workouts', 'readwrite');
          tx.objectStore('workouts').put({
            id: `smoke-${group}-${dayOfMonth}`,
            date,
            name: group,
            tags: [group],
            startedAt: `${date}T10:00:00.000Z`,
            finishedAt: `${date}T11:00:00.000Z`,
            updatedAt: Date.now(),
          });
          tx.oncomplete = () => done(date);
          tx.onerror = () => fail(tx.error);
        };
      }),
    { dayOfMonth, group },
  );
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

  console.log('\nStarting a session asks which group it is');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  const picks = await page.locator('.group-pick').allInnerTexts();
  check('every body group is offered', picks.length === 7, picks.join(', '));
  for (const group of ['Chest', 'Back', 'Legs', 'Arms']) {
    check(`${group} can be picked`, picks.includes(group), picks.join(', '));
  }
  check('there is still a way out for anything else',
    await page.getByRole('button', { name: 'Something else' }).isVisible());
  await page.screenshot({ path: `${SHOTS}/01-picker.png`, fullPage: true });

  console.log('\nThe pick becomes the name, not just a tag');
  await page.locator('.group-pick').filter({ hasText: /^Legs$/ }).click();
  await page.waitForTimeout(1000);
  const nameField = page.locator('input[placeholder*="Push day"]');
  check('the session is named for the group', (await nameField.inputValue()) === 'Legs');
  const on = await page.locator('.tag-row .chip[aria-pressed="true"]').allInnerTexts();
  check('and tagged with it too', on.join(',').includes('Legs'), on.join(','));

  console.log('\nA month of training, read by group');
  // Three separate days, which is what a month of training actually looks like.
  await seedSession(page, 4, 'Back');
  await seedSession(page, 6, 'Chest');
  await seedSession(page, 9, 'Arms');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.waitForTimeout(1000);

  const cells = await page.locator('.cal-day.train-day.trained').count();
  check('each trained day is marked', cells >= 4, `${cells} trained days`);
  const grid = await page.locator('.cal-grid').nth(1).innerText();
  for (const group of ['Legs', 'Back', 'Chest', 'Arms']) {
    check(`${group} is named on the grid, not just coloured`, grid.includes(group), grid.slice(0, 120));
  }
  await page.screenshot({ path: `${SHOTS}/02-month.png`, fullPage: true });

  console.log('\nThe month tallies each group');
  const summary = await page.locator('.app-main').innerText();
  check(
    'a per-group count is shown',
    /Legs\s+1/.test(summary) && /Back\s+1/.test(summary) && /Shoulders\s+0/.test(summary),
    summary.slice(-260),
  );

  console.log('\nTapping a group filters the month to it');
  await page.locator('.chip.group').filter({ hasText: /^Legs/ }).click();
  await page.waitForTimeout(500);
  check('the chip reads as on', (await page.locator('.chip.group[aria-pressed="true"]').count()) === 1);
  const filtered = await page.locator('.cal-grid').nth(1).innerText();
  check('legs days still show', filtered.includes('Legs'));
  check('the other groups drop out', !filtered.includes('Back') && !filtered.includes('Chest'), filtered.slice(0, 120));
  // Dimmed rather than blanked, so the month keeps its shape while one group is
  // singled out — otherwise a filtered view looks like a month off.
  const dimmed = await page.locator('.cal-day.train-day.muted').count();
  check('days that were trained but filtered out stay visible, dimmed', dimmed >= 1, `${dimmed} dimmed`);
  await page.screenshot({ path: `${SHOTS}/03-filtered.png`, fullPage: true });

  console.log('\nTapping it again clears the filter');
  await page.locator('.chip.group').filter({ hasText: /^Legs/ }).click();
  await page.waitForTimeout(500);
  const cleared = await page.locator('.cal-grid').nth(1).innerText();
  check(
    'every group is back',
    cleared.includes('Back') && cleared.includes('Chest') && cleared.includes('Arms'),
    cleared.slice(0, 120),
  );
  check('nothing is left dimmed', (await page.locator('.cal-day.train-day.muted').count()) === 0);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nTraining calendar smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll training calendar checks passed.');
