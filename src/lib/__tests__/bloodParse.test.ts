import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findDate, matchMarker, parseCsv, parseLine, parseReport } from '../bloodParse';

describe('matchMarker', () => {
  it('matches common names', () => {
    assert.equal(matchMarker('Hemoglobin').key, 'hemoglobin');
    assert.equal(matchMarker('TSH').key, 'tsh');
    assert.equal(matchMarker('ALT').key, 'alt');
  });

  it('prefers the longer alias, so a qualifier is not lost', () => {
    assert.equal(matchMarker('Free Testosterone').key, 'testosterone_free');
    assert.equal(matchMarker('Testosterone, Total').key, 'testosterone_total');
    assert.equal(matchMarker('HDL Cholesterol').key, 'hdl');
    assert.equal(matchMarker('Non-HDL Cholesterol').key, 'non_hdl');
  });

  it('respects word boundaries', () => {
    // "K" is potassium's alias but must not match inside another word.
    assert.equal(matchMarker('Ketones').known, false);
    assert.equal(matchMarker('Potassium').key, 'potassium');
  });

  it('keeps an unknown marker instead of discarding it', () => {
    const match = matchMarker('Some Novel Assay');
    assert.equal(match.known, false);
    assert.equal(match.key, 'custom:some_novel_assay');
  });
});

describe('parseLine', () => {
  it('reads name, value and unit', () => {
    const r = parseLine('Hemoglobin 152 g/L');
    assert.equal(r?.marker, 'hemoglobin');
    assert.equal(r?.value, 152);
    assert.equal(r?.unit, 'g/L');
    assert.equal(r?.known, true);
  });

  it('reads a parenthesised reference range', () => {
    const r = parseLine('Potassium 4.2 mmol/L (3.5 - 5.1)');
    assert.equal(r?.value, 4.2);
    assert.equal(r?.refLow, 3.5);
    assert.equal(r?.refHigh, 5.1);
  });

  it('reads a one-sided reference', () => {
    assert.equal(parseLine('ALT 32 U/L (< 50)')?.refHigh, 50);
    assert.equal(parseLine('eGFR 95 mL/min (> 90)')?.refLow, 90);
  });

  it('handles a colon separator and tabs', () => {
    assert.equal(parseLine('TSH: 1.85 mIU/L')?.value, 1.85);
    assert.equal(parseLine('Ferritin\t180\tµg/L')?.value, 180);
  });

  it('handles decimals written with a comma', () => {
    assert.equal(parseLine('Creatinine 88,5 µmol/L')?.value, 88.5);
  });

  it('falls back to the catalogue unit when the report omits one', () => {
    assert.equal(parseLine('Platelets 250')?.unit, '10^9/L');
  });

  it('keeps an unrecognised marker with its printed name', () => {
    const r = parseLine('Reticulocyte Haemoglobin 33.1 pg');
    assert.equal(r?.known, false);
    assert.equal(r?.label, 'Reticulocyte Haemoglobin');
    assert.equal(r?.value, 33.1);
  });

  it('ignores headers and separators', () => {
    assert.equal(parseLine('Collected: 2026-03-12'), null);
    assert.equal(parseLine('Patient: Brett'), null);
    assert.equal(parseLine('--------'), null);
    assert.equal(parseLine(''), null);
  });

  it('refuses a line with no number rather than inventing one', () => {
    assert.equal(parseLine('Hemoglobin pending'), null);
    assert.equal(parseLine('Testosterone see comment'), null);
  });
});

describe('parseReport', () => {
  const report = `
MyHealth Alberta — Laboratory Report
Patient: Brett H
Collected: 2026-03-12
Reported: 2026-03-14

Test                     Result    Unit        Reference
Hemoglobin               152       g/L         (135 - 170)
Hematocrit               0.451     L/L         (0.400 - 0.500)
White Blood Cell Count   6.1       10^9/L      (4.0 - 11.0)
Platelet Count           243       10^9/L      (150 - 400)
Testosterone, Total      24.8      nmol/L      (8.4 - 28.7)
Free Testosterone        512       pmol/L      (196 - 636)
Estradiol                118       pmol/L
SHBG                     31.2      nmol/L      (18 - 54)
ALT                      41        U/L         (< 50)
Creatinine               94        µmol/L      (62 - 115)
eGFR                     92        mL/min/1.73m2 (> 90)
LDL Cholesterol          2.41      mmol/L      (< 3.40)
HDL Cholesterol          1.32      mmol/L
Triglycerides            1.05      mmol/L
TSH                      1.85      mIU/L       (0.32 - 4.00)
Some Unlisted Assay      7.7       arb/L
`;

  it('finds the collection date', () => {
    assert.equal(parseReport(report).date, '2026-03-12');
  });

  it('reads every result line', () => {
    const { results } = parseReport(report);
    assert.equal(results.length, 16, results.map((r) => r.label).join(' | '));
  });

  it('assigns the well-known markers correctly', () => {
    const { results } = parseReport(report);
    const by = (key: string) => results.find((r) => r.marker === key);
    assert.equal(by('hemoglobin')?.value, 152);
    assert.equal(by('testosterone_total')?.value, 24.8);
    assert.equal(by('testosterone_free')?.value, 512);
    assert.equal(by('hdl')?.value, 1.32);
    assert.equal(by('ldl')?.value, 2.41);
    assert.equal(by('tsh')?.value, 1.85);
  });

  it('does not confuse total and free testosterone', () => {
    const { results } = parseReport(report);
    assert.equal(results.filter((r) => r.marker === 'testosterone_total').length, 1);
    assert.equal(results.filter((r) => r.marker === 'testosterone_free').length, 1);
  });

  it('captures the lab reference ranges', () => {
    const { results } = parseReport(report);
    const hb = results.find((r) => r.marker === 'hemoglobin');
    assert.equal(hb?.refLow, 135);
    assert.equal(hb?.refHigh, 170);
    assert.equal(results.find((r) => r.marker === 'alt')?.refHigh, 50);
  });

  it('keeps an unlisted marker rather than dropping it', () => {
    const unlisted = parseReport(report).results.find((r) => !r.known);
    assert.equal(unlisted?.label, 'Some Unlisted Assay');
    assert.equal(unlisted?.value, 7.7);
  });

  it('skips the header rows', () => {
    const labels = parseReport(report).results.map((r) => r.label.toLowerCase());
    assert.equal(labels.some((l) => l.includes('patient')), false);
    assert.equal(labels.some((l) => l.includes('collected')), false);
  });

  it('returns nothing for text with no results', () => {
    const { results } = parseReport('No results are available at this time.');
    assert.equal(results.length, 0);
  });
});

describe('findDate', () => {
  it('reads the formats reports use', () => {
    assert.equal(findDate('Collected 2026-03-12'), '2026-03-12');
    assert.equal(findDate('Collected 12 Mar 2026'), '2026-03-12');
    assert.equal(findDate('Collected Mar 12, 2026'), '2026-03-12');
  });

  it('is undefined when there is no date', () => {
    assert.equal(findDate('Hemoglobin 152 g/L'), undefined);
  });
});

describe('parseCsv', () => {
  it('reads a header-based export', () => {
    const csv = [
      'Test Name,Result,Units,Ref Low,Ref High',
      'Hemoglobin,152,g/L,135,170',
      'TSH,1.85,mIU/L,0.32,4.0',
    ].join('\n');
    const { results } = parseCsv(csv);
    assert.equal(results.length, 2);
    assert.equal(results[0].marker, 'hemoglobin');
    assert.equal(results[0].refHigh, 170);
    assert.equal(results[1].value, 1.85);
  });

  it('reads a bare three-column export', () => {
    const { results } = parseCsv('Hemoglobin,152,g/L\nFerritin,180,µg/L');
    assert.equal(results.length, 2);
    assert.equal(results[1].marker, 'ferritin');
  });

  it('tolerates quoted cells', () => {
    const { results } = parseCsv('"Test Name","Result","Units"\n"Testosterone, Total","24.8","nmol/L"');
    assert.equal(results[0].marker, 'testosterone_total');
    assert.equal(results[0].value, 24.8);
  });

  it('holds back rows it cannot read instead of dropping them', () => {
    const { results, unmatched } = parseCsv('Test Name,Result\nHemoglobin,152\nBroken,pending');
    assert.equal(results.length, 1);
    assert.deepEqual(unmatched, ['Broken,pending']);
  });
});
