import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compact, dose, duration, num, signed } from '../format';

describe('num', () => {
  it('keeps significant zeros before the decimal point', () => {
    assert.equal(num(2600, 0), '2600');
    assert.equal(num(100, 0), '100');
    assert.equal(num(10000, 0), '10000');
  });

  it('trims trailing zeros after the decimal point', () => {
    assert.equal(num(72.5, 1), '72.5');
    assert.equal(num(72.0, 1), '72');
    assert.equal(num(72.5, 2), '72.5');
    assert.equal(num(0.25, 2), '0.25');
  });

  it('rounds to the requested precision', () => {
    assert.equal(num(82.44, 1), '82.4');
    assert.equal(num(82.46, 1), '82.5');
    assert.equal(num(1999.6, 0), '2000');
  });

  it('renders zero and missing values', () => {
    assert.equal(num(0, 0), '0');
    assert.equal(num(0, 2), '0');
    assert.equal(num(null), '—');
    assert.equal(num(undefined), '—');
    assert.equal(num(NaN), '—');
  });

  it('handles negatives', () => {
    assert.equal(num(-2600, 0), '-2600');
    assert.equal(num(-1.5, 1), '-1.5');
  });
});

describe('signed', () => {
  it('marks direction explicitly', () => {
    assert.equal(signed(1.2, 1), '+1.2');
    assert.equal(signed(-1.2, 1), '−1.2');
    assert.equal(signed(0, 1), '±0');
  });

  it('treats sub-precision changes as flat', () => {
    assert.equal(signed(0.02, 1), '±0');
  });
});

describe('compact', () => {
  it('shortens large numbers without mangling small ones', () => {
    assert.equal(compact(950), '950');
    assert.equal(compact(1500), '1.5k');
    assert.equal(compact(12500), '13k');
    assert.equal(compact(2_400_000), '2.4M');
  });
});

describe('dose', () => {
  it('renders units the way they are written', () => {
    assert.equal(dose(250, 'mcg'), '250 mcg');
    assert.equal(dose(5000, 'iu'), '5000 IU');
    assert.equal(dose(2.5, 'mg'), '2.5 mg');
    assert.equal(dose(1, 'capsule'), '1 capsule');
    assert.equal(dose(2, 'capsule'), '2 capsules');
  });
});

describe('duration', () => {
  it('formats rest and session times', () => {
    assert.equal(duration(45), '45s');
    assert.equal(duration(90), '1m 30s');
    assert.equal(duration(3725), '1h 02m');
  });
});
