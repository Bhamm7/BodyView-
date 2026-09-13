/**
 * End-to-end smoke test: builds are served by `vite preview`, then a real
 * browser walks the core flows — log a metric, start a protocol, add stock,
 * log food, record a set — asserting the data survives a reload.
 *
 * Run with `npm run smoke`. Screenshots land in .smoke/.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke');
const PORT = 4317;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: ROOT,
  stdio: 'pipe',
});
server.stderr.on('data', (d) => process.stderr.write(d));

const failures = [];
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    console.log(`  ✗ ${name} ${detail}`);
    failures.push(name);
  }
};

/** Prefer a pre-installed Chromium; otherwise let Playwright resolve its own. */
function chromePath() {
  return globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ?? undefined;
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('preview server did not start');
}

const run = async () => {
  await waitForServer();

  const browser = await chromium.launch({ executablePath: chromePath() });
  const context = await browser.newContext({ ...devices['iPhone 13'], isMobile: true, hasTouch: true });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });

  const go = async (hash) => {
    await page.goto(`${BASE}/#${hash}`);
    await page.waitForLoadState('networkidle');
  };

  console.log('\nDashboard');
  await go('/');
  await page.waitForSelector('.app-header');
  check('dashboard renders', await page.locator('.app-header h1').isVisible());
  check('tab bar is present', (await page.locator('.tabbar a').count()) === 6);
  await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

  console.log('\nLog a weight reading');
  await go('/health');
  await page.getByRole('button', { name: '+ Log' }).first().click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet .list-row').filter({ hasText: 'Weight' }).first().click();
  await page.locator('.input.big').first().waitFor();
  await page.locator('.input.big').first().fill('82.4');
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(400);
  check('weight appears on the health screen', (await page.getByText('82.4').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/02-health.png`, fullPage: true });

  console.log('\nMetric detail');
  await page.locator('.grid .card').filter({ hasText: 'Weight' }).first().click();
  await page.waitForTimeout(600);
  check('metric detail opens', (await page.getByText('History').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/03-metric-detail.png`, fullPage: true });

  console.log('\nStart a protocol');
  await go('/cycles');
  await page.getByRole('button', { name: '+ Protocol' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet select').first().selectOption({ label: 'BPC-157' });
  await page.locator('.sheet .input.big').first().fill('250');
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(500);
  check('dose checklist lists the new protocol', (await page.getByText('BPC-157').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/04-cycles.png`, fullPage: true });

  console.log('\nTake the dose');
  await page.getByLabel('Mark as taken').first().click();
  await page.waitForTimeout(500);
  check('dose is marked taken', (await page.getByLabel('Undo dose').count()) > 0);

  console.log('\nAdd stock and project run-out');
  await go('/inventory');
  await page.getByRole('button', { name: '+ Item' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet select').first().selectOption({ label: 'BPC-157' });
  const numbers = page.locator('.sheet .input.numeric');
  await numbers.nth(0).fill('5');           // unit size
  await numbers.nth(1).fill('5');           // remaining
  await page.locator('.sheet select').nth(2).selectOption('mg');
  await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForTimeout(600);
  const stockText = await page.locator('.app-main').innerText();
  check('a run-out projection is shown', /days? left|runs out|Covers/.test(stockText), stockText.slice(0, 160));
  await page.screenshot({ path: `${SHOTS}/05-inventory.png`, fullPage: true });

  console.log('\nLog food');
  await go('/nutrition');
  await page.getByRole('button', { name: '+ Food' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet input').first().fill('chicken');
  await page.waitForTimeout(300);
  await page.locator('.sheet .list-row').first().click();
  await page.locator('.sheet').getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(500);
  check('calories are totalled', /kcal/.test(await page.locator('.app-main').innerText()));
  await page.screenshot({ path: `${SHOTS}/06-nutrition.png`, fullPage: true });

  console.log('\nLog a workout set');
  await go('/training');
  await page.getByRole('button', { name: '+ Workout' }).click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet').getByRole('button', { name: 'Empty workout' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /Add exercise/ }).first().click();
  await page.locator('.sheet').waitFor();
  await page.locator('.sheet input').first().fill('bench');
  await page.waitForTimeout(300);
  await page.locator('.sheet .list-row').first().click();
  await page.waitForTimeout(400);
  const cells = page.locator('table.data input');
  await cells.nth(0).fill('100');
  await cells.nth(1).fill('8');
  await page.getByLabel('Mark set as done').first().click();
  await page.waitForTimeout(400);
  check('set is recorded', /1 set|Rest/.test(await page.locator('.app-main').innerText()));
  await page.screenshot({ path: `${SHOTS}/07-workout.png`, fullPage: true });

  console.log('\nCalendar');
  await go('/calendar');
  await page.waitForTimeout(600);
  check('calendar grid renders', (await page.locator('.cal-day').count()) >= 28);
  const dots = await page.locator('.cal-dots i').count();
  check('today is marked with activity', dots > 0, `${dots} dots`);
  await page.screenshot({ path: `${SHOTS}/08-calendar.png`, fullPage: true });

  console.log('\nPersistence across reload');
  await go('/health');
  await page.reload();
  await page.waitForTimeout(800);
  check('weight survived a reload', (await page.getByText('82.4').count()) > 0);

  console.log('\nPWA wiring');
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  check('manifest is standalone', manifest.display === 'standalone');
  check('manifest ships a maskable icon', manifest.icons.some((i) => i.purpose === 'maskable'));
  const sw = await fetch(`${BASE}/sw.js`);
  check('service worker is served', sw.ok);

  console.log('\nDesktop layout');
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const dpage = await desktop.newPage();
  await dpage.goto(`${BASE}/#/`);
  await dpage.waitForTimeout(800);
  check('sidebar replaces the tab bar', await dpage.locator('.sidebar').isVisible());
  check('tab bar is hidden on desktop', !(await dpage.locator('.tabbar').isVisible()));
  await dpage.screenshot({ path: `${SHOTS}/09-desktop.png`, fullPage: true });

  console.log('\nDark theme (the default design)');
  const dark = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const darkPage = await dark.newPage();
  await darkPage.goto(`${BASE}/#/`);
  await darkPage.waitForTimeout(900);
  const bg = await darkPage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark surface is applied', bg === 'rgb(11, 14, 20)', bg);
  await darkPage.screenshot({ path: `${SHOTS}/11-dark-dashboard.png`, fullPage: true });

  // A fresh context has its own IndexedDB, so give the chart something to draw.
  await darkPage.goto(`${BASE}/#/health/weight`);
  await darkPage.waitForTimeout(900);
  for (const [value, dayOffset] of [['83.1', 14], ['82.6', 7], ['82.0', 0]]) {
    await darkPage.getByRole('button', { name: '+ Log' }).first().click();
    await darkPage.locator('.sheet .input.big').first().waitFor();
    await darkPage.locator('.sheet .input.big').first().fill(value);
    const when = new Date(Date.now() - dayOffset * 86400000).toISOString().slice(0, 10);
    await darkPage.locator('.sheet input[type="date"]').fill(when);
    await darkPage.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
    await darkPage.waitForTimeout(500);
  }
  await darkPage.waitForTimeout(800);
  check('chart renders in dark mode', (await darkPage.locator('svg.recharts-surface').count()) > 0);
  await darkPage.screenshot({ path: `${SHOTS}/12-dark-chart.png`, fullPage: true });

  console.log('\nLight theme');
  await dpage.goto(`${BASE}/#/settings`);
  await dpage.waitForTimeout(500);
  await dpage.getByRole('button', { name: 'Light', exact: true }).click();
  await dpage.waitForTimeout(400);
  check('light theme applies', (await dpage.locator('html').getAttribute('data-theme')) === 'light');
  await dpage.screenshot({ path: `${SHOTS}/10-light.png`, fullPage: true });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
};

try {
  await run();
} catch (err) {
  console.error('\nSmoke run threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally {
  server.kill('SIGTERM');
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll smoke checks passed.');
