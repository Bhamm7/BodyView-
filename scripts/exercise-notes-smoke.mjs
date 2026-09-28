/**
 * The setup note on an exercise: seat angle, foot placement, pin position.
 *
 * It is written once on the exercise itself, not per session, so the checks
 * follow it from the library through to the middle of a workout — which is
 * the only place it actually earns its keep.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-exercise-notes');
const PORT = 4326;
const BASE = `http://localhost:${PORT}`;
const NOTE = 'Seat 4 · back pad one notch back · feet high and toes out · pin 11';

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

  console.log('\nFind an exercise in the library');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Exercises' }).click();
  await page.waitForTimeout(600);
  await page.locator('input[placeholder*="Search exercises"]').fill('leg press');
  await page.waitForTimeout(500);
  const row = page.locator('.list-row').first();
  check('the library is searchable', await row.isVisible());
  await row.click();
  await page.waitForTimeout(800);

  console.log('\nWrite the setup note');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('.sheet').waitFor();
  const notes = page.locator('.sheet textarea');
  check('the sheet has a notes field', await notes.isVisible());
  const hint = await page.locator('.sheet').innerText();
  check('it says what the field is for', /seat/i.test(hint) && /Shown while you log/i.test(hint));
  check('there is a photo field beside it', await page.locator('.sheet input[type="file"]').count() > 0);
  await notes.fill(NOTE);
  await page.screenshot({ path: `${SHOTS}/01-sheet.png`, fullPage: true });
  await page.locator('.sheet').getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(900);

  console.log('\nIt shows on the exercise');
  const detail = await page.locator('.app-main').innerText();
  check('the note is on the exercise page', detail.includes('feet high and toes out'), detail.slice(0, 200));
  await page.screenshot({ path: `${SHOTS}/02-detail.png`, fullPage: true });

  console.log('\nIt survives a reload');
  await page.reload();
  await page.waitForTimeout(1200);
  check('still there after reload', (await page.locator('.app-main').innerText()).includes('pin 11'));

  console.log('\nAnd it is there mid-workout, which is the point');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Empty workout' }).click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /Add exercise/ }).first().click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet input').first().fill('leg press');
  await page.waitForTimeout(500);
  await page.locator('.sheet .list-row').first().click();
  await page.waitForTimeout(700);
  const session = await page.locator('.app-main').innerText();
  check('the note is shown while logging the exercise', session.includes('Seat 4'), session.slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/03-session.png`, fullPage: true });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nExercise notes smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll exercise note checks passed.');
