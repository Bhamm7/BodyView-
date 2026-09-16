import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BloodResult } from '@/db/types';
import {
  canonicalValue,
  flagFor,
  groupForCharts,
  normalizeUnit,
  referenceFor,
  summarise,
} from '../blood';

const result = (over: Partial<BloodResult> = {}): BloodResult => ({
  id: 'r1',
  panelId: 'p1',
  date: '2026-03-12',
  marker: 'hemoglobin',
  label: 'Hemoglobin',
  value: 152,
  unit: 'g/L',
  ...over,
});

describe('normalizeUnit', () => {
  it('sees through punctuation and case differences between labs', () => {
    assert.equal(normalizeUnit('µmol/L'), normalizeUnit('umol/l'));
    assert.equal(normalizeUnit('10^9/L'), normalizeUnit('109/l'));
    assert.equal(normalizeUnit('mL/min/1.73m²'), normalizeUnit('ml/min/1.73m2'));
  });
});

describe('canonicalValue', () => {
  it('passes through a value already in the canonical unit', () => {
    assert.equal(canonicalValue(result()), 152);
  });

  it('converts US units to SI', () => {
    // 15.2 g/dL is 152 g/L.
    assert.equal(canonicalValue(result({ unit: 'g/dL', value: 15.2 })), 152);
    // 800 ng/dL testosterone is ~27.8 nmol/L.
    const t = canonicalValue(result({ marker: 'testosterone_total', unit: 'ng/dL', value: 800 }));
    assert.ok(t != null && Math.abs(t - 27.76) < 0.01, `${t}`);
  });

  it('refuses a unit it cannot reconcile rather than plotting it wrongly', () => {
    assert.equal(canonicalValue(result({ unit: 'furlongs' })), null);
  });

  it('passes an unknown marker through untouched', () => {
    assert.equal(canonicalValue(result({ marker: 'custom:novel', unit: 'arb/L', value: 7 })), 7);
  });
});

describe('referenceFor', () => {
  it('prefers the range printed on the report', () => {
    const ref = referenceFor(result({ refLow: 130, refHigh: 180 }));
    assert.deepEqual([ref.low, ref.high, ref.fromLab], [130, 180, true]);
  });

  it('falls back to the catalogue, and says so', () => {
    const ref = referenceFor(result());
    assert.equal(ref.fromLab, false);
    assert.equal(ref.low, 135);
  });

  it('has no range for an unknown marker', () => {
    const ref = referenceFor(result({ marker: 'custom:novel' }));
    assert.equal(ref.low, undefined);
    assert.equal(ref.high, undefined);
  });
});

describe('flagFor', () => {
  it('flags against the lab range in preference to the built-in one', () => {
    // 132 is below the catalogue's 135 but inside the lab's own 130-180.
    assert.equal(flagFor(result({ value: 132 })), 'low');
    assert.equal(flagFor(result({ value: 132, refLow: 130, refHigh: 180 })), 'normal');
  });

  it('flags high and normal', () => {
    assert.equal(flagFor(result({ value: 190 })), 'high');
    assert.equal(flagFor(result({ value: 150 })), 'normal');
  });

  it('is unknown without a range', () => {
    assert.equal(flagFor(result({ marker: 'custom:novel' })), 'unknown');
  });

  it('judges a converted value against the canonical range', () => {
    // 19.0 g/dL is 190 g/L, above range, despite the small-looking number.
    assert.equal(flagFor(result({ unit: 'g/dL', value: 19.0 })), 'high');
  });
});

describe('summarise', () => {
  const series = [
    result({ id: 'a', date: '2025-09-01', value: 145 }),
    result({ id: 'b', date: '2026-03-12', value: 152 }),
    result({ id: 'c', date: '2026-01-05', value: 149 }),
  ];

  it('orders each marker newest first', () => {
    const [hb] = summarise(series);
    assert.deepEqual(hb.points.map((p) => p.date), ['2026-03-12', '2026-01-05', '2025-09-01']);
  });

  it('compares the latest against the previous panel', () => {
    const [hb] = summarise(series);
    assert.equal(hb.latest?.value, 152);
    assert.equal(hb.previous?.value, 149);
    assert.equal(hb.delta, 3);
    assert.ok(Math.abs((hb.percentChange ?? 0) - 2.013) < 0.01);
  });

  it('has no delta from a single reading', () => {
    const [hb] = summarise([result()]);
    assert.equal(hb.delta, undefined);
    assert.equal(hb.previous, undefined);
  });

  it('drops points whose units cannot be reconciled', () => {
    const [hb] = summarise([result({ id: 'a' }), result({ id: 'b', date: '2026-01-01', unit: 'furlongs' })]);
    assert.equal(hb.points.length, 1);
  });

  it('separates different markers', () => {
    const summaries = summarise([result(), result({ id: 'z', marker: 'tsh', label: 'TSH', value: 1.8, unit: 'mIU/L' })]);
    assert.equal(summaries.length, 2);
  });
});

describe('groupForCharts', () => {
  const make = (marker: string, label: string, unit: string, value: number) =>
    result({ id: marker, marker, label, unit, value });

  it('puts markers sharing a unit on one chart', () => {
    const groups = groupForCharts(
      summarise([
        make('ldl', 'LDL', 'mmol/L', 2.4),
        make('hdl', 'HDL', 'mmol/L', 1.3),
        make('triglycerides', 'Trigs', 'mmol/L', 1.1),
      ]),
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0].markers.length, 3);
    assert.equal(groups[0].unit, 'mmol/L');
  });

  it('never mixes units on one chart', () => {
    const groups = groupForCharts(
      summarise([make('ldl', 'LDL', 'mmol/L', 2.4), make('tsh', 'TSH', 'mIU/L', 1.8)]),
    );
    assert.equal(groups.length, 2);
    assert.deepEqual(groups.map((g) => g.unit).sort(), ['mIU/L', 'mmol/L']);
  });

  it('splits a crowded unit group into small multiples', () => {
    const many = ['sodium', 'potassium', 'chloride', 'urea', 'glucose', 'calcium', 'magnesium'].map(
      (m, i) => make(m, m, 'mmol/L', i + 1),
    );
    const groups = groupForCharts(summarise(many));
    assert.equal(groups.length, 7, 'one chart each rather than seven lines on one');
    assert.ok(groups.every((g) => g.markers.length === 1));
  });

  it('shows a shared band only when every marker agrees on one', () => {
    const shared = groupForCharts(summarise([make('sodium', 'Na', 'mmol/L', 140)]));
    assert.deepEqual(shared[0].band, { from: 135, to: 145 });

    const mixed = groupForCharts(
      summarise([make('sodium', 'Na', 'mmol/L', 140), make('potassium', 'K', 'mmol/L', 4.2)]),
    );
    assert.equal(mixed[0].band, undefined, 'different ranges must not share one band');
  });

  it('skips markers with nothing to plot', () => {
    const groups = groupForCharts(summarise([result({ unit: 'furlongs' })]));
    assert.equal(groups.length, 0);
  });
});
