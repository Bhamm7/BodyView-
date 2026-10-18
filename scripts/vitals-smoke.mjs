/**
 * Morning and night vitals: two or three blood pressure readings taken
 * together plus a resting heart rate, averaged per session, per 7 days and
 * per week. A midday reading must not move any of those numbers.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-vitals');
const PORT = 4328;
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

  const sheet = page.locator('.sheet');
  const logSession = async ({ session, readings, hr, date, time }) => {
    await page.getByRole('button', { name: '+ Session' }).click();
    await sheet.waitFor();
    await sheet.getByRole('button', { name: session, exact: true }).click();
    if (readings.length === 3) await sheet.getByRole('button', { name: '+ Third reading' }).click();
    for (const [i, [sys, dia]] of readings.entries()) {
      await sheet.getByLabel(`Reading ${i + 1} systolic`).fill(String(sys));
      await sheet.getByLabel(`Reading ${i + 1} diastolic`).fill(String(dia));
    }
    if (hr != null) await sheet.getByLabel('Resting heart rate').fill(String(hr));
    if (date) await sheet.locator('input[type="date"]').fill(date);
    if (time) await sheet.locator('input[type="time"]').fill(time);
    return sheet;
  };

  console.log('\nThe Health tab leads to vitals');
  await page.goto(`${BASE}/#/health`);
  await page.waitForTimeout(1200);
  await page.getByText('Vitals · morning & night').click();
  await page.waitForTimeout(700);
  check('the vitals page opens', page.url().endsWith('/health/vitals'));
  check('it explains itself when empty', (await page.locator('.app-main').innerText()).includes('two or three'));

  console.log('\nLog a morning session with three readings and a heart rate');
  await logSession({ session: 'Morning', readings: [[120, 80], [124, 82], [122, 78]], hr: 58, time: '07:00' });
  const avgText = await sheet.innerText();
  check('the sheet shows the running average', avgText.includes('122/80'), avgText.slice(-300));
  await page.screenshot({ path: `${SHOTS}/01-sheet.png`, fullPage: true });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);

  console.log('\nAnd a night session with two');
  await logSession({ session: 'Night', readings: [[130, 85], [134, 87]], hr: 62, time: '21:30' });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);

  console.log('\nAnd one from last week');
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  await logSession({ session: 'Morning', readings: [[140, 90], [140, 90]], hr: 70, date: iso(lastWeek), time: '07:00' });
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);

  console.log('\nA midday reading is logged but left out');
  await page.goto(`${BASE}/#/health/bloodPressure`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: '+ Log' }).click();
  await sheet.waitFor();
  await sheet.getByLabel('Systolic').fill('170');
  await sheet.getByLabel('Diastolic').fill('105');
  await sheet.locator('input[type="time"]').fill('13:00');
  await sheet.getByRole('button', { name: 'Neither', exact: true }).click();
  check('a single reading can choose a session', await sheet.getByText('Morning and night readings feed').isVisible());
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);
  const history = await page.locator('.app-main').innerText();
  check('tagged readings say which session in the history', history.includes('· Morning') && history.includes('· Night'));

  console.log('\nThe vitals page adds it up');
  await page.getByRole('button', { name: /Morning & night averages/ }).click();
  await page.waitForTimeout(900);
  const am = await page.getByTestId('today-am').innerText();
  const pm = await page.getByTestId('today-pm').innerText();
  check('today morning is the mean of three readings', am.includes('122/80') && am.includes('3 readings') && am.includes('HR 58'), am);
  check('today night is the mean of two', pm.includes('132/86') && pm.includes('2 readings'), pm);
  const main = await page.locator('.app-main').innerText();
  check('the 7-day average leaves out midday and last week', main.includes('127/83'), main.slice(0, 600));
  check('it compares with the prior 7 days', /[-−]13 SYS vs prior 7d/.test(main), main.slice(0, 600));
  check('resting HR averages the sessions', /Resting HR · 7d\s*60\s*bpm/i.test(main), main.slice(0, 600));
  check('the 170/105 midday reading appears nowhere', !main.includes('170'));
  const rows = page.getByTestId('weekly-table').locator('tbody tr');
  check('the weekly table has this week and last', (await rows.count()) === 2, String(await rows.count()));
  check('last week reads 140/90', (await rows.nth(1).innerText()).includes('140/90'));
  check('there are two trend charts', (await page.locator('.recharts-wrapper').count()) === 2);
  await page.screenshot({ path: `${SHOTS}/02-vitals.png`, fullPage: true });

  console.log('\nIt survives a reload');
  await page.reload();
  await page.waitForTimeout(1200);
  check('still there after reload', (await page.getByTestId('today-pm').innerText()).includes('132/86'));

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nVitals smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll vitals checks passed.');
