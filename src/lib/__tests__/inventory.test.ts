import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Compound, InventoryItem, Protocol, Schedule } from '@/db/types';
import { project, shortfall, totalRemaining } from '../inventory';
import { convert as convertOrNull } from '../units';

const FROM = '2026-01-01';

const compound: Compound = {
  id: 'c1',
  name: 'Test Compound',
  category: 'peptide',
  defaultUnit: 'mg',
  color: '#fff',
};
const compounds = new Map([[compound.id, compound]]);

const item = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i1',
  compoundId: 'c1',
  form: 'vial',
  remaining: 100,
  initial: 100,
  unit: 'mg',
  ...over,
});

const protocol = (schedule: Schedule, over: Partial<Protocol> = {}): Protocol => ({
  id: 'p1',
  compoundId: 'c1',
  dose: 10,
  unit: 'mg',
  schedule,
  startDate: FROM,
  active: true,
  ...over,
});

const daily = (timesPerDay = 1): Schedule => ({ kind: 'everyNDays', intervalDays: 1, timesPerDay });

describe('totalRemaining', () => {
  it('adds sealed spares to the open unit', () => {
    assert.equal(totalRemaining(item({ remaining: 40, initial: 100, sealedCount: 2 })), 240);
  });

  it('ignores negative stock', () => {
    assert.equal(totalRemaining(item({ remaining: -5, sealedCount: 0 })), 0);
  });
});

describe('project', () => {
  it('counts down a daily protocol to the exact run-out date', () => {
    // 100 mg at 10 mg/day: day 0..9 consume it, so the 10th dose empties it.
    const p = project(item(), [protocol(daily())], compounds, FROM);
    assert.equal(p.dailyUse, 10);
    assert.equal(p.daysLeft, 9);
    assert.equal(p.runsOutOn, '2026-01-10');
    // 9 days left against the default 14-day reorder threshold.
    assert.equal(p.status, 'low');
  });

  it('doubles the burn rate for twice-daily dosing', () => {
    const p = project(item(), [protocol(daily(2))], compounds, FROM);
    assert.equal(p.dailyUse, 20);
    assert.equal(p.daysLeft, 4);
    assert.equal(p.status, 'critical');
  });

  it('stretches an every-other-day protocol over twice the calendar', () => {
    const p = project(
      item({ remaining: 50, initial: 50 }),
      [protocol({ kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 })],
      compounds,
      FROM,
    );
    assert.equal(p.dailyUse, 5);
    // Doses land on days 0,2,4,6,8: the fifth dose (day 8) empties 50 mg.
    assert.equal(p.daysLeft, 8);
  });

  it('converts mcg doses against an mg stock', () => {
    const p = project(
      item({ remaining: 10, initial: 10, unit: 'mg' }),
      [protocol(daily(), { dose: 500, unit: 'mcg' })],
      compounds,
      FROM,
    );
    assert.equal(p.dailyUse, 0.5);
    assert.equal(p.daysLeft, 19);
    assert.equal(p.unitMismatch, false);
  });

  it('flags units it cannot reconcile instead of guessing', () => {
    const p = project(
      item({ unit: 'mg' }),
      [protocol(daily(), { dose: 100, unit: 'iu' })],
      compounds,
      FROM,
    );
    assert.equal(p.unitMismatch, true);
    assert.equal(p.daysLeft, null);
  });

  it('sums several protocols drawing on the same stock', () => {
    const p = project(
      item({ remaining: 100, initial: 100 }),
      [protocol(daily()), protocol(daily(), { id: 'p2', dose: 15 })],
      compounds,
      FROM,
    );
    assert.equal(p.dailyUse, 25);
    assert.equal(p.daysLeft, 3);
  });

  it('reports stock that outlasts a bounded protocol as covered', () => {
    const p = project(
      item({ remaining: 100, initial: 100 }),
      [protocol(daily(), { dose: 5, endDate: '2026-01-10' })],
      compounds,
      FROM,
    );
    assert.equal(p.daysLeft, null);
    assert.equal(p.runsOutOn, null);
    assert.equal(p.coversProtocol, true);
    assert.equal(p.status, 'ok');
  });

  it('does not treat an open-ended protocol as covered', () => {
    const p = project(item({ remaining: 100000, initial: 100000 }), [protocol(daily())], compounds, FROM);
    assert.equal(p.coversProtocol, false);
  });

  it('ignores protocols that already ended', () => {
    const p = project(item(), [protocol(daily(), { endDate: '2025-12-31' })], compounds, FROM);
    assert.equal(p.protocols.length, 0);
    assert.equal(p.status, 'unknown');
    assert.equal(p.daysLeft, null);
  });

  it('accounts for a protocol that has not started yet', () => {
    const p = project(
      item({ remaining: 30, initial: 30 }),
      [protocol(daily(), { startDate: '2026-01-11' })],
      compounds,
      FROM,
    );
    // No consumption until the 11th, then 10 mg/day empties 30 mg on day 12.
    assert.equal(p.dailyUse, null, 'nothing is being consumed today');
    assert.equal(p.runsOutOn, '2026-01-13');
  });

  it('reports empty stock', () => {
    const p = project(item({ remaining: 0 }), [protocol(daily())], compounds, FROM);
    assert.equal(p.status, 'empty');
  });

  it('uses the reorder threshold for the low warning', () => {
    const p = project(
      item({ remaining: 100, initial: 100, reorderDays: 30 }),
      [protocol(daily(), { dose: 4 })],
      compounds,
      FROM,
    );
    assert.equal(p.daysLeft, 24);
    assert.equal(p.status, 'low');
  });

  it('computes percent left across open and sealed stock', () => {
    const p = project(item({ remaining: 50, initial: 100, sealedCount: 1 }), [], compounds, FROM);
    assert.equal(p.totalRemaining, 150);
    assert.equal(p.percentLeft, 75);
  });
});

describe('shortfall', () => {
  it('reports how much more is needed to finish a cycle', () => {
    // 10 mg/day for 20 days = 200 mg needed, 100 mg on hand.
    const p = project(item(), [protocol(daily(), { endDate: '2026-01-20' })], compounds, FROM);
    assert.equal(shortfall(p, FROM), 100);
  });

  it('is negative when there is surplus', () => {
    const p = project(item(), [protocol(daily(), { dose: 2, endDate: '2026-01-10' })], compounds, FROM);
    assert.equal(shortfall(p, FROM), -80);
  });

  it('is unknown for an open-ended protocol', () => {
    const p = project(item(), [protocol(daily())], compounds, FROM);
    assert.equal(shortfall(p, FROM), null);
  });
});

describe('consumption accounting', () => {
  // consumeFromInventory needs IndexedDB, so the arithmetic it relies on is
  // covered here through the pure conversion path instead.
  it('converts a mcg dose into an mg stock draw', () => {
    const drawn = convertOrNull(250, 'mcg', 'mg');
    assert.equal(drawn, 0.25);
  });

  it('refuses to convert IU into a mass unit', () => {
    assert.equal(convertOrNull(100, 'iu', 'mg'), null);
  });
});
