/**
 * Checks that focusing a field never leaves it hidden behind the tab bar, and
 * that focusing a field already in view does not move the page.
 *
 * The on-screen keyboard cannot be simulated headlessly, so this covers the
 * half that can be: the fixed tab bar obstructing a field, and the rule that a
 * visible field is left alone.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-keyboard');
const PORT = 4324;
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

  // A session long enough that fields end up under the tab bar.
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Empty workout' }).click();
  await page.waitForTimeout(800);
  for (const name of ['bench', 'squat', 'row', 'curl']) {
    await page.getByRole('button', { name: /Add exercise/ }).first().click();
    await page.locator('.sheet').waitFor();
    await page.locator('.sheet input').first().fill(name);
    await page.waitForTimeout(350);
    await page.locator('.sheet .list-row').first().click();
    await page.waitForTimeout(350);
  }

  /** Is the element clear of the tab bar? */
  const clearOfTabBar = (selector, nth = 0) =>
    page.evaluate(
      ({ selector, nth }) => {
        const el = document.querySelectorAll(selector)[nth];
        const bar = document.querySelector('.tabbar');
        if (!el || !bar) return null;
        const r = el.getBoundingClientRect();
        const b = bar.getBoundingClientRect();
        const barVisible = getComputedStyle(bar).display !== 'none';
        return {
          bottom: Math.round(r.bottom),
          barTop: Math.round(b.top),
          barVisible,
          covered: barVisible && r.bottom > b.top,
          onScreen: r.top >= 0 && r.bottom <= window.innerHeight,
        };
      },
      { selector, nth },
    );

  console.log('\nA field parked under the tab bar');
  // Scroll so the last set cell sits behind the bar, then focus it.
  const cells = page.locator('table.data input');
  const lastIndex = (await cells.count()) - 1;
  await page.evaluate((i) => {
    const el = document.querySelectorAll('table.data input')[i];
    const bar = document.querySelector('.tabbar').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    // Put it just under the top edge of the tab bar.
    window.scrollBy({ top: r.top - (bar.top - 10), behavior: 'instant' });
  }, lastIndex);
  await page.waitForTimeout(300);

  const before = await clearOfTabBar('table.data input', lastIndex);
  check('the field starts covered by the tab bar', before?.covered === true, JSON.stringify(before));
  await page.screenshot({ path: `${SHOTS}/01-covered.png` });

  await cells.nth(lastIndex).focus();
  await page.waitForTimeout(900); // smooth scroll settles

  const after = await clearOfTabBar('table.data input', lastIndex);
  check('focusing it scrolls it clear', after?.covered === false, JSON.stringify(after));
  check('and leaves it on screen', after?.onScreen === true, JSON.stringify(after));
  await page.screenshot({ path: `${SHOTS}/02-revealed.png` });

  console.log('\nA field already in view is left alone');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  const nameField = page.locator('input[placeholder*="Push day"]');
  const yBefore = await page.evaluate(() => Math.round(window.scrollY));
  await nameField.focus();
  await page.waitForTimeout(800);
  const yAfter = await page.evaluate(() => Math.round(window.scrollY));
  check('the page does not move', Math.abs(yAfter - yBefore) <= 2, `${yBefore} -> ${yAfter}`);

  console.log('\nTyping does not move the page');
  await nameField.fill('');
  const yTypeBefore = await page.evaluate(() => Math.round(window.scrollY));
  await page.keyboard.type('Push day');
  await page.waitForTimeout(600);
  const yTypeAfter = await page.evaluate(() => Math.round(window.scrollY));
  check('scroll is unchanged while typing', Math.abs(yTypeAfter - yTypeBefore) <= 2, `${yTypeBefore} -> ${yTypeAfter}`);

  console.log('\nScroll margins are set');
  const margins = await page.evaluate(() => {
    const el = document.querySelector('textarea[aria-label="Session notes"]');
    const s = getComputedStyle(el);
    return { top: s.scrollMarginTop, bottom: s.scrollMarginBottom };
  });
  check('fields reserve room for the header and tab bar', margins.top !== '0px' && margins.bottom !== '0px', JSON.stringify(margins));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nKeyboard smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll keyboard checks passed.');
