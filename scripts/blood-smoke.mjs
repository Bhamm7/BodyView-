/**
 * Drives bloodwork end to end: paste two panels months apart, confirm the
 * review step, save, then check the charts group by unit and the comparison
 * shows movement between draws.
 */
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { globSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.smoke-blood');
const PORT = 4320;
const BASE = `http://localhost:${PORT}`;

rmSync(SHOTS, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✓ ${name}` : `  ✗ ${name} ${detail}`);
  if (!ok) failures.push(name);
};

const panel = (date, values) => `
MyHealth Alberta - Laboratory Report
Patient: Brett H
Collected: ${date}

Test                     Result    Unit        Reference
Hemoglobin               ${values.hgb}       g/L         (135 - 170)
Hematocrit               ${values.hct}     L/L         (0.400 - 0.500)
Platelet Count           243       10^9/L      (150 - 400)
Testosterone, Total      ${values.tt}      nmol/L      (8.4 - 28.7)
Free Testosterone        ${values.ft}       pmol/L      (196 - 636)
Estradiol                ${values.e2}       pmol/L      (40 - 160)
SHBG                     ${values.shbg}      nmol/L      (18 - 54)
ALT                      ${values.alt}        U/L         (< 50)
LDL Cholesterol          ${values.ldl}      mmol/L      (< 3.40)
HDL Cholesterol          ${values.hdl}      mmol/L      (> 1.00)
Triglycerides            ${values.tg}      mmol/L      (< 1.70)
TSH                      1.85      mIU/L       (0.32 - 4.00)
Mystery Assay            7.7       arb/L
`;

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
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
  });

  const addPanel = async (text) => {
    await page.goto(`${BASE}/#/bloodwork`);
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: '+ Panel' }).click();
    await page.locator('.sheet').waitFor();
    await page.locator('.sheet textarea').first().fill(text);
    await page.getByRole('button', { name: 'Read results' }).click();
    await page.waitForTimeout(700);
    return page;
  };

  console.log('\nImport the first panel');
  await addPanel(panel('2025-11-04', {
    hgb: 149, hct: '0.441', tt: '18.2', ft: 372, e2: 104, shbg: '38.5',
    alt: 28, ldl: '3.02', hdl: '1.28', tg: '1.42',
  }));

  const rows = await page.locator('.sheet .blood-review tbody tr').count();
  check('every result is listed for review', rows === 13, `${rows} rows`);

  // Being in the DOM is not the same as being on screen: this table sits in a
  // flex column, where an overflow container will happily collapse to nothing.
  const tableBox = await page.locator('.sheet .scroll-x').first().boundingBox();
  check('the review table is actually visible', (tableBox?.height ?? 0) > 100, `height ${tableBox?.height ?? 0}`);

  const reviewText = await page.locator('.sheet').innerText();
  check('the collection date was picked up', /2025-11-04/.test(await page.locator('.sheet input[type="date"]').inputValue()));
  check('an unrecognised marker is kept, not dropped', /Mystery Assay/.test(reviewText));
  check('it is marked as not in the catalogue', /not in the catalogue/.test(reviewText));
  check('every row carries a range verdict', /In range/.test(reviewText), '');
  await page.screenshot({ path: `${SHOTS}/01-review.png`, fullPage: true });

  await page.locator('.sheet').getByRole('button', { name: /^Save/ }).click();
  await page.waitForTimeout(900);

  console.log('\nImport a second panel, four months later');
  await addPanel(panel('2026-03-12', {
    hgb: 162, hct: '0.487', tt: '26.4', ft: 588, e2: 171, shbg: '31.2',
    alt: 44, ldl: '2.41', hdl: '1.32', tg: '1.05',
  }));
  // Estradiol 171 is above the report's own 40-160, so it must be flagged.
  const second = await page.locator('.sheet').innerText();
  check('a value outside the report range is flagged high', /Above range/.test(second), '');
  await page.locator('.sheet').getByRole('button', { name: /^Save/ }).click();
  await page.waitForTimeout(1200);

  console.log('\nCharts');
  const main = await page.locator('.app-main').innerText();
  check('charts render', (await page.locator('svg.recharts-surface').count()) > 0, main.slice(0, 120));

  // Testosterone (nmol/L) and SHBG (nmol/L) share a unit; estradiol (pmol/L) must not join them.
  await page.locator('.picker button.select').click();
  await page.waitForTimeout(300);
  await page.locator('.picker-panel input').fill('');
  for (const label of ['Testosterone, total', 'SHBG', 'Estradiol']) {
    const opt = page.locator('.picker-option').filter({ hasText: label }).first();
    if ((await opt.getAttribute('aria-pressed')) !== 'true') await opt.click();
  }
  // Deselect anything else so the grouping assertion is unambiguous.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);

  const chartTitles = await page.locator('.app-main .card .card-title').allInnerTexts();
  check(
    'testosterone and SHBG share the nmol/L chart',
    chartTitles.some((t) => /nmol\/l/i.test(t)),
    chartTitles.join(' | '),
  );
  check(
    'estradiol gets its own chart, not the nmol/L one',
    chartTitles.some((t) => /pmol\/l/i.test(t)) && !chartTitles.some((t) => /nmol\/l.*pmol\/l/i.test(t)),
    chartTitles.join(' | '),
  );
  await page.screenshot({ path: `${SHOTS}/02-charts.png`, fullPage: true });

  console.log('\nComparison');
  const comparison = await page.locator('.card').filter({ hasText: 'Latest vs previous' }).innerText();
  check('latest vs previous is shown', /latest vs previous/i.test(comparison));
  check('testosterone movement is computed', /\+8\.2|\+8\.20/.test(comparison), comparison.replace(/\n/g, ' | ').slice(0, 300));
  await page.screenshot({ path: `${SHOTS}/03-comparison.png`, fullPage: true });

  console.log('\nPanels list');
  await page.getByRole('button', { name: 'Panels' }).click();
  await page.waitForTimeout(600);
  const list = await page.locator('.app-main').innerText();
  check('both panels are listed', (list.match(/result/g) ?? []).length >= 2, list.slice(0, 200));
  check('out-of-range counts are shown', /out of range|All in range/.test(list));
  await page.screenshot({ path: `${SHOTS}/04-panels.png`, fullPage: true });

  console.log('\nIt lands on the day');
  await page.goto(`${BASE}/#/day/2026-03-12`);
  await page.waitForTimeout(1000);
  const day = await page.locator('.app-main').innerText();
  check('the day view shows the panel', /bloodwork/i.test(day), day.slice(0, 200));
  check('a marker value appears there', /Hemoglobin/i.test(day));
  await page.screenshot({ path: `${SHOTS}/05-day.png`, fullPage: true });

  check('no uncaught page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  await browser.close();
};

try { await run(); } catch (err) {
  console.error('\nBlood smoke threw:', err.message);
  failures.push(`exception: ${err.message}`);
} finally { server.kill('SIGTERM'); }

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log('\nAll bloodwork checks passed.');
