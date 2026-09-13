import type { MetricDef, Settings } from '@/db/types';
import { cmTo, kgTo, toCm, toKg } from './format';

/**
 * Metrics are stored in canonical units (kg, cm) and converted only for
 * display, so switching units never rewrites history.
 */
export function metricUnit(def: MetricDef, settings: Settings): string {
  if (def.unitSystem === 'mass') return settings.weightUnit;
  if (def.unitSystem === 'length') return settings.lengthUnit;
  return def.unit;
}

export function toDisplay(def: MetricDef, value: number, settings: Settings): number {
  if (def.unitSystem === 'mass') return round(kgTo(settings.weightUnit, value), 2);
  if (def.unitSystem === 'length') return round(cmTo(settings.lengthUnit, value), 2);
  return value;
}

export function toStored(def: MetricDef, value: number, settings: Settings): number {
  if (def.unitSystem === 'mass') return toKg(settings.weightUnit, value);
  if (def.unitSystem === 'length') return toCm(settings.lengthUnit, value);
  return value;
}

/** Field ranges are authored in canonical units; convert for the input's clamp. */
export function displayRange(
  def: MetricDef,
  field: { min: number; max: number; step: number },
  settings: Settings,
): { min: number; max: number; step: number } {
  if (!def.unitSystem) return field;
  return {
    min: Math.floor(toDisplay(def, field.min, settings)),
    max: Math.ceil(toDisplay(def, field.max, settings)),
    step: def.unitSystem === 'mass' && settings.weightUnit === 'lb' ? 0.2 : field.step,
  };
}

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}
