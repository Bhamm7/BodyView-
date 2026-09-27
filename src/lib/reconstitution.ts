import type { DoseUnit } from '@/db/types';
import { convert } from './units';

/**
 * Reconstitution arithmetic.
 *
 * A lyophilised vial is labelled by mass (or IU); what goes into the syringe is
 * a volume. The bridge is the amount of solvent added, which is exactly the
 * thing that gets forgotten between the day a vial is mixed and the day it runs
 * out. Recording it turns "how much did I put in this?" into a stored fact.
 *
 * These are pure conversions on the user's own numbers. Nothing here suggests
 * what to mix or how much to take.
 */

/** Insulin syringes are marked in units, 100 to the millilitre. */
export const UNITS_PER_ML = 100;

export interface Concentration {
  /** Amount of compound per millilitre, in `unit`. */
  perMl: number;
  unit: DoseUnit;
}

/**
 * Strength of a reconstituted vial: the labelled amount over the solvent added.
 * Null when either number is missing or zero, where there is no answer.
 */
export function concentrationOf(
  vialAmount: number | null | undefined,
  vialUnit: DoseUnit,
  solventMl: number | null | undefined,
): Concentration | null {
  if (!vialAmount || !solventMl || vialAmount <= 0 || solventMl <= 0) return null;
  return { perMl: vialAmount / solventMl, unit: vialUnit };
}

/**
 * Volume in millilitres that delivers `dose`.
 *
 * Returns null when the dose unit cannot be reconciled with the vial's — an IU
 * dose from a milligram vial depends on the compound, and guessing a volume
 * there would be worse than declining to answer.
 */
export function volumeForDose(
  dose: number | null | undefined,
  doseUnit: DoseUnit,
  concentration: Concentration | null,
): number | null {
  if (!dose || dose <= 0 || !concentration) return null;
  const inVialUnit = convert(dose, doseUnit, concentration.unit);
  if (inVialUnit == null) return null;
  return inVialUnit / concentration.perMl;
}

/** The same volume read off an insulin syringe. */
export function unitsForDose(
  dose: number | null | undefined,
  doseUnit: DoseUnit,
  concentration: Concentration | null,
  unitsPerMl: number = UNITS_PER_ML,
): number | null {
  const ml = volumeForDose(dose, doseUnit, concentration);
  return ml == null ? null : ml * unitsPerMl;
}

/**
 * Solvent needed to land on a target concentration — the question asked before
 * mixing, rather than after.
 */
export function solventForConcentration(
  vialAmount: number | null | undefined,
  vialUnit: DoseUnit,
  targetPerMl: number | null | undefined,
  targetUnit: DoseUnit,
): number | null {
  if (!vialAmount || !targetPerMl || vialAmount <= 0 || targetPerMl <= 0) return null;
  const target = convert(targetPerMl, targetUnit, vialUnit);
  if (target == null) return null;
  return vialAmount / target;
}

/** Doses a vial yields at a given dose size. */
export function dosesPerVial(
  vialAmount: number | null | undefined,
  vialUnit: DoseUnit,
  dose: number | null | undefined,
  doseUnit: DoseUnit,
): number | null {
  if (!vialAmount || !dose || vialAmount <= 0 || dose <= 0) return null;
  const inVialUnit = convert(dose, doseUnit, vialUnit);
  if (inVialUnit == null || inVialUnit <= 0) return null;
  return vialAmount / inVialUnit;
}

/** Forms that are reconstituted; others have nothing to mix. */
export function isReconstitutable(form: string): boolean {
  return form === 'vial' || form === 'powder' || form === 'pen';
}

export const SOLVENTS = [
  'Bacteriostatic water',
  'Sterile water',
  'Sodium chloride 0.9%',
  'Supplied diluent',
] as const;
