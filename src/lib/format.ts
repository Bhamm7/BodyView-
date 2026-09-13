import type { DoseUnit, WeightUnit } from '@/db/types';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export function kgTo(unit: WeightUnit, kg: number): number {
  return unit === 'kg' ? kg : kg / KG_PER_LB;
}

export function toKg(unit: WeightUnit, value: number): number {
  return unit === 'kg' ? value : value * KG_PER_LB;
}

export function cmTo(unit: 'cm' | 'in', cm: number): number {
  return unit === 'cm' ? cm : cm / CM_PER_IN;
}

export function toCm(unit: 'cm' | 'in', value: number): number {
  return unit === 'cm' ? value : value * CM_PER_IN;
}

/**
 * Trims trailing zeros after the decimal point: 72.50 -> "72.5", 72.00 -> "72".
 * Zeros before the point are significant — 2600 must never become "26".
 */
export function num(value: number | null | undefined, precision = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const fixed = value.toFixed(precision);
  if (precision <= 0 || !fixed.includes('.')) return fixed;
  return fixed.replace(/\.?0+$/, '');
}

export function signed(value: number, precision = 1): string {
  if (!Number.isFinite(value)) return '—';
  const s = num(Math.abs(value), precision);
  if (Math.abs(value) < 10 ** -precision / 2) return `±${s}`;
  return `${value > 0 ? '+' : '−'}${s}`;
}

export function compact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1_000_000) return `${num(value / 1_000_000, 1)}M`;
  if (Math.abs(value) >= 10_000) return `${num(value / 1000, 0)}k`;
  if (Math.abs(value) >= 1000) return `${num(value / 1000, 1)}k`;
  return num(value, 0);
}

/** Doses render tightly: "250 mg", "2.5 mg", "5000 IU". */
export function dose(value: number, unit: DoseUnit): string {
  return `${num(value, unit === 'mcg' || unit === 'iu' ? 0 : 2)} ${unitLabel(unit, value)}`;
}

export function unitLabel(unit: DoseUnit, qty = 1): string {
  if (unit === 'iu') return 'IU';
  if (unit === 'capsule') return qty === 1 ? 'capsule' : 'capsules';
  if (unit === 'tablet') return qty === 1 ? 'tablet' : 'tablets';
  if (unit === 'drop') return qty === 1 ? 'drop' : 'drops';
  return unit;
}

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function titleCase(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
