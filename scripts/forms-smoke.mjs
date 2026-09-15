/**
 * Exercises the two forms that changed: the stock sheet that could not be
 * saved, and the protocol sheet's per-dose / per-week / per-day switch.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-forms');
const PORT = 4319;
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
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  console.log('\nStock: the sheet that could not be saved');
  await page.goto(`${BASE}/#/inventory`);
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '+ Item' }).click();
  await page.locator('.sheet').waitFor();
  await page.waitForTimeout(400);

  const marks = await page.locator('.sheet .field .req').count();
  check('required fields are marked', marks >= 3, `${marks} markers`);

  // Nothing typed yet: Save is disabled and says why.
  const saveBtn = page.locator('.sheet').getByRole('button', { name: 'Save', exact: true });
  check('save starts disabled', await saveBtn.isDisabled());
  const note = await page.locator('.sheet .missing-note').innerText().catch(() => '');
  check('it says what is missing', /Still needed/.test(note), note);
  await page.screenshot({ path: `${SHOTS}/01-missing.png`, fullPage: true });

  // Typing only the unit size should be enough — remaining follows it.
  await page.locator('.sheet select').first().selectOption({ index: 1 });
  await page.locator('.sheet .input.numeric').first().fill('10');
  await page.waitForTimeout(400);
  const remaining = await page.locator('.sheet .input.numeric').nth(1).inputValue();
  check('remaining defaults to a full unit', remaining === '10', `got "${remaining}"`);
  check('save is now enabled', await saveBtn.isEnabled());
  check('the missing note is gone', (await page.locator('.sheet .missing-note').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/02-ready.png`, fullPage: true });
  await saveBtn.click();
  await page.waitForTimeout(700);
  check('the item saved', (await page.locator('.app-main .card').count()) > 0);

  console.log('\nCycles: per-dose / per-week / per-day');
  await page.goto(`${BASE}/#/cycles`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '+ Protocol' }).click();
  await page.locator('.sheet').waitFor();
  await page.waitForTimeout(400);

  await page.locator('.sheet select').first().selectOption({ label: 'Testosterone Enanthate' });
  await page.waitForTimeout(300);

  // Weekly basis, Mon/Thu: 500 a week must read as 250 an injection.
  await page.locator('.sheet').getByRole('button', { name: 'Per week' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Weekdays' }).click();
  await page.waitForTimeout(300);
  for (const day of ['Mon', 'Thu']) {
    const chip = page.locator('.sheet .chip').filter({ hasText: new RegExp(`^${day}$`) }).first();
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await page.locator('.sheet .input.big').first().fill('500');
  await page.waitForTimeout(500);

  const summary = await page.locator('.sheet .card').filter({ hasText: 'This works out as' }).innerText();
  check('500/week on Mon+Thu is 250 a dose', /Each dose\s+250\s*mg/.test(summary), summary.replace(/\n/g, ' | '));
  check('weekly total reads back as 500', /Per week\s+500\s*mg/.test(summary), '');
  check('daily average is shown', /Per day \(average\)\s+71\.4/.test(summary), '');
  await page.screenshot({ path: `${SHOTS}/03-per-week.png`, fullPage: true });

  // Switching basis must convert, not reinterpret the number.
  await page.locator('.sheet').getByRole('button', { name: 'Per dose' }).click();
  await page.waitForTimeout(400);
  const perDoseField = await page.locator('.sheet .input.big').first().inputValue();
  check('switching to per-dose shows 250', perDoseField === '250', `got "${perDoseField}"`);

  const summary2 = await page.locator('.sheet .card').filter({ hasText: 'This works out as' }).innerText();
  check('the weekly total is unchanged by the switch', /Per week\s+500\s*mg/.test(summary2), '');
  await page.screenshot({ path: `${SHOTS}/04-per-dose.png`, fullPage: true });

  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(700);

  // A Mon/Thu protocol is correctly absent from "Today" on any other weekday,
  // so check the Protocols tab, which lists it regardless of the date.
  await page.getByRole('button', { name: 'Protocols' }).click();
  await page.waitForTimeout(600);
  const listed = await page.locator('.app-main').innerText();
  check('protocol saved and listed', /Testosterone Enanthate/.test(listed), listed.slice(0, 160));
  check('it shows the weekly schedule', /Mon, Thu/.test(listed), '');
  await page.screenshot({ path: `${SHOTS}/05-protocol-saved.png`, fullPage: true });

  console.log('\nCatalogue');
  const count = await page.evaluate(async () => {
    const req = indexedDB.open('bodyview');
    return new Promise((res) => {
      req.onsuccess = () => {
        const c = req.result.transaction('compounds', 'readonly').objectStore('compounds').count();
        c.onsuccess = () => res(c.result);
      };
      setTimeout(() => res(-1), 5000);
    });
  });
  check('the expanded catalogue is present', count > 70, `${count} compounds`);

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nForms smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll form checks passed.');
