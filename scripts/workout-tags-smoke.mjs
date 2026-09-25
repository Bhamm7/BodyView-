/**
 * Renaming a session and tagging it, then checking both reach the day view and
 * the calendar — and that the calendar legend matches the dots actually drawn.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-tags');
const PORT = 4323;
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

  console.log('\nStart a session');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Empty workout' }).click();
  await page.waitForTimeout(900);

  const nameField = page.locator('input[placeholder*="Push day"]');
  check('the name is editable', await nameField.isVisible());
  const tagButtons = await page.locator('.tag-row .chip').count();
  check('all seven tags are offered', tagButtons === 7, `${tagButtons} tags`);
  await page.screenshot({ path: `${SHOTS}/01-session.png`, fullPage: true });

  console.log('\nRename and tag it');
  await nameField.fill('Push day');
  await page.waitForTimeout(600);
  for (const tag of ['Chest', 'Shoulders']) {
    await page.locator('.tag-row .chip').filter({ hasText: new RegExp(`^${tag}$`) }).click();
    await page.waitForTimeout(300);
  }
  const pressed = await page.locator('.tag-row .chip[aria-pressed="true"]').allInnerTexts();
  check('the chosen tags are marked on', pressed.sort().join(',') === 'Chest,Shoulders', pressed.join(','));
  check('the header takes the new name', /Push day/.test(await page.locator('.app-header h1').innerText()));
  await page.screenshot({ path: `${SHOTS}/02-named.png`, fullPage: true });

  console.log('\nIt survives a reload (saved as you type)');
  await page.reload();
  await page.waitForTimeout(1200);
  check('the name persisted', (await page.locator('input[placeholder*="Push day"]').inputValue()) === 'Push day');
  const stillOn = await page.locator('.tag-row .chip[aria-pressed="true"]').count();
  check('the tags persisted', stillOn === 2, `${stillOn} on`);

  // Give the session a set so it shows as a real session everywhere.
  await page.getByRole('button', { name: /Add exercise/ }).first().click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet input').first().fill('bench');
  await page.waitForTimeout(400);
  await page.locator('.sheet .list-row').first().click();
  await page.waitForTimeout(400);
  const cells = page.locator('table.data input');
  await cells.nth(0).fill('100');
  await cells.nth(1).fill('8');
  await page.getByLabel('Mark set as done').first().click();
  await page.waitForTimeout(600);

  console.log('\nTraining list');
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(1000);
  const list = await page.locator('.app-main').innerText();
  check('the session is listed by name', /Push day/.test(list), list.slice(0, 150));
  check('its tags are listed too', /Chest/.test(list) && /Shoulders/.test(list));

  console.log('\nDay view');
  const today = new Date().toISOString().slice(0, 10);
  await page.goto(`${BASE}/#/day/${today}`);
  await page.waitForTimeout(1200);
  const day = await page.locator('.app-main').innerText();
  check('the day view shows the name', /Push day/.test(day), day.slice(0, 200));
  check('the day view shows the tags', /Chest/.test(day) && /Shoulders/.test(day));
  const pills = await page.locator('.tag-pill').count();
  check('tags render as pills', pills >= 2, `${pills} pills`);
  await page.screenshot({ path: `${SHOTS}/03-day.png`, fullPage: true });

  console.log('\nCalendar');
  await page.goto(`${BASE}/#/calendar`);
  await page.waitForTimeout(1200);
  const cal = await page.locator('.app-main').innerText();
  check('the calendar summary shows the name', /Push day/.test(cal), cal.slice(0, 250));
  check('the calendar summary shows the tags', /Chest/.test(cal));

  // Every dot colour drawn on the grid must appear in the legend.
  const colours = await page.evaluate(() => {
    const swatch = (el) => getComputedStyle(el).backgroundColor;
    return {
      dots: [...new Set([...document.querySelectorAll('.cal-dots i')].map(swatch))],
      legend: [...new Set([...document.querySelectorAll('.legend-row .dot')].map(swatch))],
    };
  });
  const unexplained = colours.dots.filter((c) => !colours.legend.includes(c));
  check(
    'every dot colour on the grid is in the legend',
    unexplained.length === 0,
    `unexplained: ${unexplained.join(', ')}`,
  );
  check('the legend has one entry per event kind', colours.legend.length === 5, `${colours.legend.length}`);
  await page.screenshot({ path: `${SHOTS}/04-calendar.png`, fullPage: true });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nTags smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll workout tag checks passed.');
