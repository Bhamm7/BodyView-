import type { DoseUnit } from '@/db/types';

/** Mass units share a common base (micrograms) and convert freely. */
const MASS_IN_MCG: Partial<Record<DoseUnit, number>> = {
  g: 1_000_000,
  mg: 1000,
  mcg: 1,
};

export function isMass(unit: DoseUnit): boolean {
  return unit in MASS_IN_MCG;
}

/**
 * Converts between dose units. Returns `null` when the units are not
 * comparable (e.g. IU to mg depends on the compound), so callers can tell the
 * user instead of silently producing a wrong number.
 */
export function convert(value: number, from: DoseUnit, to: DoseUnit): number | null {
  if (from === to) return value;
  const a = MASS_IN_MCG[from];
  const b = MASS_IN_MCG[to];
  if (a != null && b != null) return (value * a) / b;
  return null;
}

/** Picks the friendliest unit for a mass: 0.5 mg -> 500 mcg, 2500 mg -> 2.5 g. */
export function humanizeMass(value: number, unit: DoseUnit): { value: number; unit: DoseUnit } {
  if (!isMass(unit)) return { value, unit };
  const mcg = convert(value, unit, 'mcg') ?? value;
  if (mcg >= 1_000_000) return { value: mcg / 1_000_000, unit: 'g' };
  if (mcg >= 1000) return { value: mcg / 1000, unit: 'mg' };
  return { value: mcg, unit: 'mcg' };
}

export const DOSE_UNITS: DoseUnit[] = ['mg', 'mcg', 'g', 'iu', 'ml', 'capsule', 'tablet', 'drop'];
