import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDate, parseLabRows, parseLabText } from '../labParse';

/** The rows of the first (usually only) draw in a parsed report. */
const rowsOf = (text: string) => parseLabText(text).draws[0]?.rows ?? [];

const find = (text: string, key: string) => rowsOf(text).find((r) => r.markerKey === key);

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
    const rows = rowsOf(
      ['Testosterone, Total    21.4 nmol/L   8.4 - 28.7', 'Free Testosterone  412 pmol/L  196 - 636'].join('\n'),
    );
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
    const rows = rowsOf('Zonulin  42 ng/mL');
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
    const rows = rowsOf(noise);
    assert.deepEqual(rows.map((r) => r.markerKey).filter(Boolean), ['sodium']);
  });

  it('takes the collection date off the report', () => {
    const result = parseLabText('Collected: 2026-09-18\nSodium 139 mmol/L');
    assert.equal(result.draws[0].date, '2026-09-18');
  });

  it('keeps one row per marker when a report repeats it', () => {
    const rows = rowsOf('ALT 34 U/L\nSomething else\nALT 34 U/L');
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
    assert.deepEqual(result.draws[0].rows.map((r) => r.markerKey), [
      'hemoglobin',
      'hematocrit',
      'cholesterol',
      'potassium',
    ]);
  });

  it('takes the date from the table', () => {
    assert.equal(parseLabText(csv).draws[0].date, '2026-09-18');
  });

  it('reads a quoted name containing a comma', () => {
    const row = rowsOf(csv).find((r) => r.markerKey === 'cholesterol');
    assert.equal(row?.value, 4.85);
    assert.equal(row?.unit, 'mmol/L');
  });

  it('reads separate low and high columns', () => {
    const table = [
      'Analyte\tValue\tUnit\tLow\tHigh',
      'Creatinine\t86\tumol/L\t62\t106',
    ].join('\n');
    const row = rowsOf(table)[0];
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
    const rows = rowsOf(
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
    );
    assert.deepEqual(rows.map((r) => r.reportedName), ['Hemoglobin']);
  });

  it('still reads a marker whose name starts like a metadata word', () => {
    const rows = rowsOf('Lactate 1.4 mmol/L');
    assert.equal(rows.length, 1);
  });
});

/**
 * The shape a MyHealth Records export actually has: a disclaimer above the
 * header, three columns with "Name" in them, a result column carrying its
 * unit as text beside a structured one that does not, ranges with the unit
 * repeated in brackets, and years of draws in one sheet.
 */
describe('portal export', () => {
  const HEADER = [
    'Date',
    'Ordered By',
    'Lab Group Name',
    'Group Status',
    'Laboratory Name',
    'Test Name',
    'Order Comment',
    'Result',
    'Structured Value',
    'Unit',
    'Reference Range (Units)',
    'Reference Range (Units) Minimum Value',
    'Reference Range (Units) Maximum Value',
    'Result Status',
  ];

  const row = (
    date: string,
    group: string,
    test: string,
    result: string,
    structured: string,
    unit: string,
    range: string,
  ) => [date, 'FONG, ZHI', group, 'Final', 'CCLAB', test, 'Sent to provider', result, structured, unit, range, '', '', 'Final'];

  const sheet = [
    ['My Personal Records is a service provided by Alberta Health.'],
    HEADER,
    row('2026-07-07 08:12:00', 'CBC and Differential', 'Hemoglobin', '148 g/L', '148', 'g/L', '135-175 (g/L) g/L'),
    row('2026-07-07 08:12:00', 'CBC and Differential', 'Auto WBC', '6.1 x10**9/L', '6.1', 'x10**9/L', '4.0-11.0 (x10**9/L) x10**9/L'),
    row('2026-07-07 08:12:00', 'Lipid Panel', 'HDL Cholesterol', '1.02 mmol/L', '1.02', 'mmol/L', '>=1.00 (mmol/L) mmol/L'),
    row('2026-07-07 08:12:00', 'Alanine Aminotransferase (ALT)', 'Alanine Aminotransferase (ALT)', '31 U/L', '31', 'U/L', '<70 (U/L) U/L'),
    row('2026-09-24 09:06:00', 'CBC and Differential', 'Hemoglobin', '161 g/L', '161', 'g/L', '135-175 (g/L) g/L'),
    row('2026-09-24 09:06:00', 'Luteinizing Hormone (LH)', 'Luteinizing Hormone (LH)', '<0.3 IU/L', '', '', '1.0-9.0 (IU/L) IU/L'),
    row('2026-09-24 09:06:00', 'Creatinine', 'eGFRcr', '94 mL/min/1.73m2', '94', 'mL/min/1.73m2', '>59 (mL/min/1.73m2) mL/min/1.73m2'),
    row('2026-09-24 09:06:00', 'Glucose, Fasting', 'Hours Fasting', '12.0 hour(s)', '12', 'hour(s)', ''),
  ];

  const parsed = () => parseLabRows(sheet)!;

  it('finds the header below the disclaimer', () => {
    assert.equal(parsed().shape, 'table');
  });

  it('splits the export into one draw per collection date', () => {
    assert.deepEqual(parsed().draws.map((d) => d.date), ['2026-07-07', '2026-09-24']);
  });

  it('takes the analyte from Test Name, not from the group or the lab', () => {
    const first = parsed().draws[0].rows;
    assert.deepEqual(first.map((r) => r.markerKey), ['hemoglobin', 'wbc', 'hdl', 'alt']);
  });

  it('prefers the structured value over the result text', () => {
    const hgb = parsed().draws[0].rows[0];
    assert.equal(hgb.value, 148);
    assert.equal(hgb.unit, 'g/L');
  });

  it('falls back to the result text when the structured value is empty', () => {
    const lh = parsed().draws[1].rows.find((r) => r.markerKey === 'lh');
    assert.equal(lh?.value, 0.3, 'a censored "<0.3" still charts at its limit');
    assert.equal(lh?.unit, 'IU/L');
  });

  it('reads a range that repeats its unit in brackets', () => {
    const hgb = parsed().draws[0].rows[0];
    assert.equal(hgb.low, 135);
    assert.equal(hgb.high, 175);
  });

  it('reads one-sided ranges, including >= and <', () => {
    const hdl = parsed().draws[0].rows.find((r) => r.markerKey === 'hdl');
    assert.equal(hdl?.low, 1);
    assert.equal(hdl?.high, undefined);

    const alt = parsed().draws[0].rows.find((r) => r.markerKey === 'alt');
    assert.equal(alt?.high, 70);

    const egfr = parsed().draws[1].rows.find((r) => r.markerKey === 'egfr');
    assert.equal(egfr?.low, 59);
  });

  it('tidies units so two labs land on one axis', () => {
    const wbc = parsed().draws[0].rows.find((r) => r.markerKey === 'wbc');
    assert.equal(wbc?.unit, '10^9/L');
  });

  it('keeps a row it cannot name, switched off', () => {
    const fasting = parsed().draws[1].rows.find((r) => r.reportedName === 'Hours Fasting');
    assert.equal(fasting?.keep, false);
    assert.equal(fasting?.markerKey, undefined);
  });

  it('reads a date held as an Excel serial number', () => {
    const serial = [HEADER, row('46289.3791666667', 'Creatinine', 'Creatinine', '92 umol/L', '92', 'umol/L', '50-120 (umol/L) umol/L')];
    assert.equal(parseLabRows(serial)!.draws[0].date, '2026-09-24');
  });
});

describe('units the report did not give', () => {
  it('leaves the unit empty rather than borrowing the table one', () => {
    const rows = parseLabRows([
      ['Test Name', 'Structured Value', 'Unit', 'Reference Range (Units)'],
      ['Iron Saturation Index', '0.21', '', '0.12-0.60'],
    ])!.draws[0].rows;
    assert.equal(rows[0].markerKey, 'ironSaturation');
    assert.equal(rows[0].unit, '', 'a fraction must not be labelled %');
    assert.equal(rows[0].low, 0.12);
  });
});
