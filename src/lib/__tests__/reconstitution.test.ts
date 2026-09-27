import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  concentrationOf,
  dosesPerVial,
  isReconstitutable,
  solventForConcentration,
  unitsForDose,
  volumeForDose,
} from '../reconstitution';

const close = (actual: number | null, expected: number, tolerance = 1e-9) => {
  assert.ok(actual != null, 'expected a value, got null');
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} !== ${expected}`);
};

describe('concentrationOf', () => {
  it('divides the labelled amount by the solvent added', () => {
    // A 10 mg vial with 2 mL of water is 5 mg/mL.
    const c = concentrationOf(10, 'mg', 2);
    close(c?.perMl ?? null, 5);
    assert.equal(c?.unit, 'mg');
  });

  it('keeps the unit the vial is labelled in, including IU', () => {
    // A 5000 IU vial in 2 mL is 2500 IU/mL.
    const c = concentrationOf(5000, 'iu', 2);
    close(c?.perMl ?? null, 2500);
    assert.equal(c?.unit, 'iu');
  });

  it('has no answer without both numbers', () => {
    assert.equal(concentrationOf(null, 'mg', 2), null);
    assert.equal(concentrationOf(10, 'mg', null), null);
    assert.equal(concentrationOf(10, 'mg', 0), null);
    assert.equal(concentrationOf(0, 'mg', 2), null);
  });
});

describe('volumeForDose', () => {
  const tenMgInTwoMl = concentrationOf(10, 'mg', 2); // 5 mg/mL

  it('converts a dose to a volume', () => {
    close(volumeForDose(1, 'mg', tenMgInTwoMl), 0.2);
  });

  it('converts across mass units', () => {
    // 250 mcg out of 5 mg/mL is 0.05 mL.
    close(volumeForDose(250, 'mcg', tenMgInTwoMl), 0.05);
  });

  it('declines when the units cannot be reconciled', () => {
    // IU from a milligram vial depends on the compound.
    assert.equal(volumeForDose(100, 'iu', tenMgInTwoMl), null);
  });

  it('works within IU', () => {
    const hcg = concentrationOf(5000, 'iu', 2); // 2500 IU/mL
    close(volumeForDose(500, 'iu', hcg), 0.2);
  });

  it('has no answer without a dose or a concentration', () => {
    assert.equal(volumeForDose(null, 'mg', tenMgInTwoMl), null);
    assert.equal(volumeForDose(1, 'mg', null), null);
    assert.equal(volumeForDose(0, 'mg', tenMgInTwoMl), null);
  });
});

describe('unitsForDose', () => {
  it('reads the volume off a U-100 syringe', () => {
    // 5 mg/mL, 250 mcg = 0.05 mL = 5 units.
    close(unitsForDose(250, 'mcg', concentrationOf(10, 'mg', 2)), 5);
  });

  it('halving the water doubles the strength and halves the units', () => {
    close(unitsForDose(250, 'mcg', concentrationOf(10, 'mg', 1)), 2.5);
  });

  it('doubling the water halves the strength and doubles the units', () => {
    close(unitsForDose(250, 'mcg', concentrationOf(10, 'mg', 4)), 10);
  });

  it('a whole-vial dose is the whole volume', () => {
    close(unitsForDose(10, 'mg', concentrationOf(10, 'mg', 2)), 200);
  });

  it('handles a realistic semaglutide vial', () => {
    // 5 mg in 2 mL is 2.5 mg/mL; a 0.25 mg dose is 0.1 mL, i.e. 10 units.
    close(unitsForDose(0.25, 'mg', concentrationOf(5, 'mg', 2)), 10);
  });
});

describe('solventForConcentration', () => {
  it('says how much to add for a target strength', () => {
    // 10 mg to 5 mg/mL needs 2 mL.
    close(solventForConcentration(10, 'mg', 5, 'mg'), 2);
  });

  it('converts the target unit', () => {
    // 10 mg to 5000 mcg/mL is the same 5 mg/mL, so still 2 mL.
    close(solventForConcentration(10, 'mg', 5000, 'mcg'), 2);
  });

  it('declines on an unreconcilable target unit', () => {
    assert.equal(solventForConcentration(10, 'mg', 100, 'iu'), null);
  });

  it('round-trips against concentrationOf', () => {
    const ml = solventForConcentration(10, 'mg', 4, 'mg');
    close(concentrationOf(10, 'mg', ml)?.perMl ?? null, 4);
  });
});

describe('dosesPerVial', () => {
  it('counts the doses in a vial', () => {
    assert.equal(dosesPerVial(10, 'mg', 250, 'mcg'), 40);
    assert.equal(dosesPerVial(5, 'mg', 0.25, 'mg'), 20);
  });

  it('is independent of how much water was added', () => {
    // Dilution changes the volume per dose, never the number of doses.
    assert.equal(dosesPerVial(10, 'mg', 500, 'mcg'), 20);
  });

  it('declines on an unreconcilable unit', () => {
    assert.equal(dosesPerVial(10, 'mg', 100, 'iu'), null);
  });
});

describe('isReconstitutable', () => {
  it('covers the forms that get mixed', () => {
    for (const form of ['vial', 'powder', 'pen']) {
      assert.equal(isReconstitutable(form), true, form);
    }
  });

  it('excludes the ones that do not', () => {
    for (const form of ['capsule', 'tablet', 'liquid', 'other']) {
      assert.equal(isReconstitutable(form), false, form);
    }
  });
});
