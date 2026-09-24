import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDate, parseLabText } from '../labParse';

const find = (text: string, key: string) =>
  parseLabText(text).rows.find((r) => r.markerKey === key);

describe('parseLabText — lines', () => {
  it('reads name, value, unit and range from a padded report line', () => {
    const row = find('Hemoglobin            152 g/L         (135 - 175)', 'hemoglobin');
    assert.equal(row?.value, 152);
    assert.equal(row?.unit, 'g/L');
    assert.equal(row?.low, 135);
    assert.equal(row?.high, 175);
    assert.equal(row?.keep, true);
  });

  it('reads a tab-separated line', () => {
    const row = find('TSH\t1.84\tmIU/L\t0.20-4.00', 'tsh');
    assert.equal(row?.value, 1.84);
    assert.equal(row?.high, 4);
  });

  it('keeps the report out-of-range mark', () => {
    const row = find('ALT  74  U/L  10 - 50  H', 'alt');
    assert.equal(row?.value, 74);
    assert.equal(row?.reportedFlag, 'high');
  });

  it('handles a labelled reference range', () => {
    const row = find('Creatinine, serum: 86 umol/L  Reference: 62-106', 'creatinine');
    assert.equal(row?.value, 86);
    assert.equal(row?.low, 62);
  });

  it('takes the number out of a censored result', () => {
    const row = find('Estradiol <18 pmol/L', 'estradiol');
    assert.equal(row?.value, 18);
  });

  it('reads a one-sided range', () => {
    const row = find('eGFR 96 mL/min/1.73m2 >90', 'egfr');
    assert.equal(row?.value, 96);
    assert.equal(row?.low, 90);
  });

  it('falls back to the built-in range when the report prints none', () => {
    const row = find('Ferritin 210 ug/L', 'ferritin');
    assert.equal(row?.low, 30);
    assert.equal(row?.high, 400);
  });

  it('does not mistake free testosterone for total', () => {
    const rows = parseLabText(
      ['Testosterone, Total    21.4 nmol/L   8.4 - 28.7', 'Free Testosterone  412 pmol/L  196 - 636'].join('\n'),
    ).rows;
    assert.deepEqual(
      rows.map((r) => r.markerKey),
      ['testosterone', 'freeTestosterone'],
    );
  });

  it('converts a non-SI value and moves its range with it', () => {
    const row = find('Testosterone 800 ng/dL (300 - 1000)', 'testosterone');
    assert.equal(row?.unit, 'nmol/L');
    assert.equal(Math.round((row?.value ?? 0) * 10) / 10, 27.7);
    assert.equal(Math.round(row?.low ?? 0), 10);
    assert.equal(row?.converted, true);
  });

  it('keeps an unrecognised marker, but off by default', () => {
    const rows = parseLabText('Zonulin  42 ng/mL').rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].markerKey, undefined);
    assert.equal(rows[0].keep, false);
    assert.equal(rows[0].label, 'Zonulin');
  });

  it('ignores headers, addresses and accession lines', () => {
    const noise = [
      'ALBERTA PRECISION LABORATORIES',
      'Collected: 2026-09-18 08:14',
      'Accession 2026-0918-44812',
      'Page 1 of 3',
      'Sodium 139 mmol/L 135-145',
    ].join('\n');
    const rows = parseLabText(noise).rows;
    assert.deepEqual(rows.map((r) => r.markerKey).filter(Boolean), ['sodium']);
  });

  it('takes the collection date off the report', () => {
    const result = parseLabText('Collected: 2026-09-18\nSodium 139 mmol/L');
    assert.equal(result.date, '2026-09-18');
  });

  it('keeps one row per marker when a report repeats it', () => {
    const rows = parseLabText('ALT 34 U/L\nSomething else\nALT 34 U/L').rows;
    assert.equal(rows.filter((r) => r.markerKey === 'alt').length, 1);
  });
});

describe('parseLabText — spreadsheet export', () => {
  const csv = [
    'Test Name,Result,Units,Reference Range,Collection Date',
    'Hemoglobin,151,g/L,135 - 175,2026-09-18',
    'Hematocrit,0.46,L/L,0.40 - 0.50,2026-09-18',
    '"Cholesterol, Total",4.85,mmol/L,< 5.20,2026-09-18',
    'Potassium,4.4,mmol/L,3.5 - 5.1,2026-09-18',
  ].join('\n');

  it('reads a headed table', () => {
    const result = parseLabText(csv);
    assert.equal(result.shape, 'table');
    assert.deepEqual(result.rows.map((r) => r.markerKey), [
      'hemoglobin',
      'hematocrit',
      'cholesterol',
      'potassium',
    ]);
  });

  it('takes the date from the table', () => {
    assert.equal(parseLabText(csv).date, '2026-09-18');
  });

  it('reads a quoted name containing a comma', () => {
    const row = parseLabText(csv).rows.find((r) => r.markerKey === 'cholesterol');
    assert.equal(row?.value, 4.85);
    assert.equal(row?.unit, 'mmol/L');
  });

  it('reads separate low and high columns', () => {
    const table = [
      'Analyte\tValue\tUnit\tLow\tHigh',
      'Creatinine\t86\tumol/L\t62\t106',
    ].join('\n');
    const row = parseLabText(table).rows[0];
    assert.equal(row.low, 62);
    assert.equal(row.high, 106);
  });
});

describe('parseDate', () => {
  it('reads the formats reports print', () => {
    assert.equal(parseDate('Collected 2026-09-18 07:55'), '2026-09-18');
    assert.equal(parseDate('18-Sep-2026'), '2026-09-18');
    assert.equal(parseDate('Sep 18, 2026'), '2026-09-18');
    assert.equal(parseDate('2026/09/18'), '2026-09-18');
    assert.equal(parseDate('no date here'), undefined);
  });
});

describe('report furniture', () => {
  it('leaves collection stamps and accession numbers out', () => {
    const rows = parseLabText(
      [
        'Collected: 2026-08-08 07:30',
        'Received: 2026-08-08 09:12',
        'Accession: 2026-0808-55120',
        'Patient: HAMM, BRETT',
        'DOB: 1988-04-02',
        'Page 1 of 2',
        'Ordered by: Dr A Smith',
        'Phone: 403 555 0134',
        'Hemoglobin 148 g/L 135 - 175',
      ].join('\n'),
    ).rows;
    assert.deepEqual(rows.map((r) => r.reportedName), ['Hemoglobin']);
  });

  it('still reads a marker whose name starts like a metadata word', () => {
    const rows = parseLabText('Lactate 1.4 mmol/L').rows;
    assert.equal(rows.length, 1);
  });
});
