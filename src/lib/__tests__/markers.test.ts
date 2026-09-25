import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayDecimals, markerDef, matchMarker, rangeStatus, toCanonicalUnit } from '../markers';

describe('matchMarker', () => {
  it('matches the names an Alberta export uses', () => {
    const cases: Array<[string, string]> = [
      ['Alanine Aminotransferase (ALT)', 'alt'],
      ['Auto WBC', 'wbc'],
      ['eGFRcr', 'egfr'],
      ['Sex Hormone Binding Globulin (SHBG)', 'shbg'],
      ['Testosterone, Free, Calculated', 'freeTestosterone'],
      ['Testosterone, Total', 'testosterone'],
      ['Low Density Lipoprotein Cholesterol (Calculated)', 'ldl'],
      ['Non High Density Lipoprotein Cholesterol', 'nonHdl'],
      ['Prostate Specific Antigen (PSA), total', 'psa'],
      ['Hemoglobin A1c', 'hba1c'],
      ['Neutrophil Absolute', 'neutrophils'],
      ['Lipoprotein A Lp(a)', 'lpa'],
      ['C-Reactive Protein (CRP)', 'crp'],
      ['Homocysteine, Total', 'homocysteine'],
      ['T4, Free', 'freeT4'],
      ['Urate', 'uricAcid'],
      ['Total Iron Binding Capacity', 'tibc'],
    ];
    for (const [reported, key] of cases) {
      assert.equal(matchMarker(reported)?.key, key, `${reported} should match ${key}`);
    }
  });

  it('does not invent a match for something it has never seen', () => {
    assert.equal(matchMarker('Hours Fasting'), undefined);
    assert.equal(matchMarker('Surgical Pathology'), undefined);
    assert.equal(matchMarker(''), undefined);
  });

  it('keeps total and free testosterone apart', () => {
    assert.equal(matchMarker('Testosterone, Free')?.key, 'freeTestosterone');
    assert.equal(matchMarker('Testosterone')?.key, 'testosterone');
  });
});

describe('toCanonicalUnit', () => {
  it('leaves a value already in the canonical unit alone', () => {
    const def = markerDef('testosterone')!;
    const out = toCanonicalUnit(def, 21.4, 'nmol/L');
    assert.equal(out.converted, false);
    assert.equal(out.value, 21.4);
  });

  it('converts a US unit into the SI one', () => {
    const def = markerDef('testosterone')!;
    const out = toCanonicalUnit(def, 800, 'ng/dL');
    assert.equal(out.unit, 'nmol/L');
    assert.equal(Math.round(out.value * 10) / 10, 27.7);
  });

  it('leaves an unknown unit as reported rather than guessing', () => {
    const def = markerDef('ferritin')!;
    const out = toCanonicalUnit(def, 210, 'squigs/L');
    assert.equal(out.converted, false);
    assert.equal(out.unit, 'squigs/L');
  });
});

describe('rangeStatus', () => {
  it('reads a two-sided range', () => {
    assert.equal(rangeStatus(150, { low: 135, high: 175 }), 'in');
    assert.equal(rangeStatus(180, { low: 135, high: 175 }), 'high');
    assert.equal(rangeStatus(130, { low: 135, high: 175 }), 'low');
  });

  it('reads a one-sided range', () => {
    assert.equal(rangeStatus(0.9, { low: 1 }), 'low');
    assert.equal(rangeStatus(80, { high: 70 }), 'high');
  });

  it('says nothing without a range', () => {
    assert.equal(rangeStatus(12), 'unknown');
    assert.equal(rangeStatus(12, {}), 'unknown');
  });
});

describe('displayDecimals', () => {
  it('widens until a small value actually shows', () => {
    const iron = markerDef('ironSaturation')!;
    assert.equal(iron.decimals, 0, 'the table expects whole percents');
    assert.ok(displayDecimals(0.28, iron) >= 2, '0.28 must not render as 0');
  });

  it('leaves a large value at the marker figure', () => {
    assert.equal(displayDecimals(313, markerDef('mchc')), 0);
  });

  it('copes with zero and nonsense', () => {
    assert.equal(displayDecimals(0, markerDef('mchc')), 0);
    assert.equal(displayDecimals(Number.NaN, markerDef('alt')), 0);
  });
});
