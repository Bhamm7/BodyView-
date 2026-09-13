import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DoseLog, Protocol, Schedule } from '@/db/types';
import { adherence, dueDoses, extraDoses } from '../doses';
import { dateRange } from '../date';

const protocol = (over: Partial<Protocol> = {}, schedule?: Schedule): Protocol => ({
  id: 'p1',
  compoundId: 'c1',
  dose: 100,
  unit: 'mg',
  schedule: schedule ?? { kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 },
  startDate: '2026-01-01',
  active: true,
  ...over,
});

const log = (over: Partial<DoseLog> = {}): DoseLog => ({
  id: 'l1',
  compoundId: 'c1',
  protocolId: 'p1',
  date: '2026-01-01',
  takenAt: '2026-01-01T08:00:00.000Z',
  dose: 100,
  unit: 'mg',
  slot: 0,
  ...over,
});

describe('dueDoses', () => {
  it('lists one entry per scheduled dose', () => {
    const p = protocol({}, { kind: 'everyNDays', intervalDays: 1, timesPerDay: 3 });
    const due = dueDoses('2026-01-01', [p], []);
    assert.equal(due.length, 3);
    assert.deepEqual(due.map((d) => d.slot), [0, 1, 2]);
    assert.equal(due.every((d) => d.log === undefined), true);
  });

  it('matches logged doses to their slot', () => {
    const p = protocol({}, { kind: 'everyNDays', intervalDays: 1, timesPerDay: 2 });
    const due = dueDoses('2026-01-01', [p], [log({ slot: 1 })]);
    assert.equal(due[0].log, undefined);
    assert.equal(due[1].log?.id, 'l1');
  });

  it('lists nothing on an unscheduled day', () => {
    const p = protocol({}, { kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 });
    assert.equal(dueDoses('2026-01-02', [p], []).length, 0);
  });
});

describe('extraDoses', () => {
  it('surfaces ad-hoc logs that no schedule claimed', () => {
    const p = protocol();
    const scheduled = log();
    const adhoc = log({ id: 'l2', protocolId: undefined, slot: undefined });
    const due = dueDoses('2026-01-01', [p], [scheduled, adhoc]);
    const extras = extraDoses([scheduled, adhoc], due);
    assert.deepEqual(extras.map((e) => e.id), ['l2']);
  });
});

describe('adherence', () => {
  const week = dateRange('2026-01-01', '2026-01-07');

  it('is 100% when nothing is scheduled', () => {
    assert.equal(adherence(week, [], []).percent, 100);
  });

  it('counts taken doses against scheduled ones', () => {
    const p = protocol();
    const logs = ['2026-01-01', '2026-01-02', '2026-01-03'].map((date, i) =>
      log({ id: `l${i}`, date }),
    );
    const result = adherence(week, [p], logs);
    assert.equal(result.scheduled, 7);
    assert.equal(result.taken, 3);
    assert.ok(Math.abs(result.percent - (3 / 7) * 100) < 1e-9);
  });

  it('does not count a skipped dose as taken', () => {
    const p = protocol();
    const result = adherence(week, [p], [log({ skipped: true })]);
    assert.equal(result.taken, 0);
  });

  it('counts every slot of a multi-dose day', () => {
    const p = protocol({}, { kind: 'everyNDays', intervalDays: 1, timesPerDay: 2 });
    const result = adherence(['2026-01-01'], [p], [log({ slot: 0 })]);
    assert.equal(result.scheduled, 2);
    assert.equal(result.taken, 1);
    assert.equal(result.percent, 50);
  });
});
