/**
 * Records a reconstituted vial and checks the arithmetic reaches the places it
 * matters: the stock card, and the dose checklist where the draw is read off.
 *
 * Scenario: a 10 mg BPC-157 vial mixed with 2 mL, dosed at 250 mcg.
 *   10 mg / 2 mL   = 5 mg/mL
 *   250 mcg        = 0.05 mL = 5 units on a U-100 syringe
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-recon');
const PORT = 4326;
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

  console.log('\nA daily 250 mcg BPC-157 protocol');
  await page.goto(`${BASE}/#/cycles`);
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '+ Protocol' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet select').first().selectOption({ label: 'BPC-157' });
  await page.waitForTimeout(300);
  await page.locator('.sheet .input.big').first().fill('250');
  await page.locator('.sheet select').nth(1).selectOption('mcg');
  await page.waitForTimeout(300);
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(800);

  console.log('\nRecord the vial: 10 mg in 2 mL');
  await page.goto(`${BASE}/#/inventory`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '+ Item' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet select').first().selectOption({ label: 'BPC-157' });
  await page.waitForTimeout(300);
  await page.locator('.sheet .input.numeric').first().fill('10');
  await page.locator('.sheet select').nth(2).selectOption('mg');
  await page.waitForTimeout(400);

  check('a vial offers the reconstitution recorder',
    (await page.getByRole('button', { name: /This vial is reconstituted/ }).count()) === 1);
  await page.getByRole('button', { name: /This vial is reconstituted/ }).click();
  await page.waitForTimeout(400);

  await page.locator('input[aria-label="Solvent added in millilitres"]').fill('2');
  await page.waitForTimeout(600);

  const panel = await page.locator('.sheet .card').filter({ hasText: 'Reconstitution' }).innerText();
  check('strength is 5 mg/mL', /5\s*mg\/mL/.test(panel), panel.replace(/\n/g, ' | '));
  check('the draw is 0.05 mL', /0\.05\s*mL/.test(panel), '');
  // Assert the whole row, so the number cannot be matched from the footnote.
  check('which is 5 units', /250 mcg\s+0\.05 mL\s+5(?!\d)/.test(panel), panel.replace(/\n/g, ' | '));
  check('it says how many doses the vial holds', /40 doses/.test(panel), '');
  check('it names the syringe it assumes', /U-100/.test(panel), '');
  await page.screenshot({ path: `${SHOTS}/01-calculator.png`, fullPage: true });

  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(900);

  console.log('\nIt is remembered on the stock card');
  const card = await page.locator('.app-main').innerText();
  check('the card shows it was reconstituted', /reconstituted/i.test(card), card.slice(0, 200));
  check('with the solvent volume', /2 mL/.test(card), '');
  check('and the strength', /5 mg\/mL/.test(card), '');
  await page.screenshot({ path: `${SHOTS}/02-stock-card.png`, fullPage: true });

  console.log('\nAnd on the dose checklist, where you actually draw it');
  await page.goto(`${BASE}/#/cycles`);
  await page.waitForTimeout(1200);
  const checklist = await page.locator('.app-main').innerText();
  check('the checklist shows the units to draw', /draw 5 units/.test(checklist), checklist.slice(0, 250));
  await page.screenshot({ path: `${SHOTS}/03-checklist.png`, fullPage: true });

  console.log('\nRe-opening the item shows what was recorded');
  await page.goto(`${BASE}/#/inventory`);
  await page.waitForTimeout(900);
  await page.locator('.app-main .card').filter({ hasText: 'BPC-157' }).first().click();
  await page.locator('.sheet').waitFor();
  await page.waitForTimeout(500);
  check('the solvent volume was stored',
    (await page.locator('input[aria-label="Solvent added in millilitres"]').inputValue()) === '2');

  console.log('\nChanging the water changes the draw');
  await page.locator('input[aria-label="Solvent added in millilitres"]').fill('1');
  await page.waitForTimeout(600);
  const halved = await page.locator('.sheet .card').filter({ hasText: 'Reconstitution' }).innerText();
  check('half the water is twice the strength', /10\s*mg\/mL/.test(halved), halved.replace(/\n/g, ' | '));
  check('and half the units', /250 mcg\s+0\.025 mL\s+2\.5(?!\d)/.test(halved), halved.replace(/\n/g, ' | '));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nReconstitution smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll reconstitution checks passed.');
