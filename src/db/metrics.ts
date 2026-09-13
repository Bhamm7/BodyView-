import type { MetricDef, MetricKey } from './types';

/**
 * The metric catalogue. Adding an entry here is all that is needed for a new
 * metric to appear in quick-entry, history, charts and the calendar.
 */
export const METRICS: MetricDef[] = [
  {
    key: 'weight',
    label: 'Weight',
    unit: 'kg',
    unitSystem: 'mass',
    icon: '⚖️',
    precision: 1,
    fields: [{ key: 'value', label: 'Weight', min: 20, max: 400, step: 0.1, color: 'var(--c-1)' }],
  },
  {
    key: 'bodyFat',
    label: 'Body fat',
    unit: '%',
    icon: '📐',
    precision: 1,
    lowerIsBetter: true,
    fields: [{ key: 'value', label: 'Body fat', min: 2, max: 60, step: 0.1, color: 'var(--c-2)' }],
  },
  {
    key: 'bloodPressure',
    label: 'Blood pressure',
    unit: 'mmHg',
    icon: '🩸',
    precision: 0,
    lowerIsBetter: true,
    band: { from: 90, to: 120, field: 'systolic' },
    fields: [
      { key: 'systolic', label: 'Systolic', short: 'SYS', min: 60, max: 220, step: 1, color: 'var(--c-3)' },
      { key: 'diastolic', label: 'Diastolic', short: 'DIA', min: 40, max: 140, step: 1, color: 'var(--c-4)' },
    ],
  },
  {
    key: 'restingHr',
    label: 'Resting HR',
    unit: 'bpm',
    icon: '❤️',
    precision: 0,
    lowerIsBetter: true,
    band: { from: 45, to: 65 },
    fields: [{ key: 'value', label: 'Resting HR', min: 30, max: 140, step: 1, color: 'var(--c-3)' }],
  },
  {
    key: 'hrv',
    label: 'HRV',
    unit: 'ms',
    icon: '📈',
    precision: 0,
    higherIsBetter: true,
    fields: [{ key: 'value', label: 'HRV', min: 5, max: 250, step: 1, color: 'var(--c-5)' }],
  },
  {
    key: 'sleep',
    label: 'Sleep',
    unit: 'h',
    icon: '😴',
    precision: 1,
    band: { from: 7, to: 9 },
    higherIsBetter: true,
    fields: [{ key: 'value', label: 'Sleep', min: 0, max: 16, step: 0.25, color: 'var(--c-6)' }],
  },
  {
    key: 'steps',
    label: 'Steps',
    unit: 'steps',
    icon: '👟',
    precision: 0,
    higherIsBetter: true,
    fields: [{ key: 'value', label: 'Steps', min: 0, max: 60000, step: 100, color: 'var(--c-2)' }],
  },
  {
    key: 'waist',
    label: 'Waist',
    unit: 'cm',
    unitSystem: 'length',
    icon: '📏',
    precision: 1,
    lowerIsBetter: true,
    fields: [{ key: 'value', label: 'Waist', min: 40, max: 200, step: 0.5, color: 'var(--c-4)' }],
  },
  {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    icon: '🌡️',
    precision: 1,
    fields: [{ key: 'value', label: 'Temperature', min: 33, max: 43, step: 0.1, color: 'var(--c-3)' }],
  },
  {
    key: 'glucose',
    label: 'Glucose',
    unit: 'mmol/L',
    icon: '🩸',
    precision: 1,
    lowerIsBetter: true,
    band: { from: 4, to: 5.6 },
    fields: [{ key: 'value', label: 'Glucose', min: 1, max: 30, step: 0.1, color: 'var(--c-5)' }],
  },
  {
    key: 'mood',
    label: 'Mood',
    unit: '/10',
    icon: '🙂',
    precision: 0,
    higherIsBetter: true,
    fields: [{ key: 'value', label: 'Mood', min: 1, max: 10, step: 1, color: 'var(--c-6)' }],
  },
  {
    key: 'energy',
    label: 'Energy',
    unit: '/10',
    icon: '⚡',
    precision: 0,
    higherIsBetter: true,
    fields: [{ key: 'value', label: 'Energy', min: 1, max: 10, step: 1, color: 'var(--c-1)' }],
  },
];

const BY_KEY = new Map(METRICS.map((m) => [m.key, m]));

export function metricDef(key: MetricKey): MetricDef {
  const def = BY_KEY.get(key);
  if (!def) throw new Error(`Unknown metric: ${key}`);
  return def;
}

export const DEFAULT_DASHBOARD_METRICS: MetricKey[] = [
  'weight',
  'bloodPressure',
  'restingHr',
  'sleep',
];
