import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Protocol, Schedule } from '@/db/types';
import {
  administrationsPerWeek,
  dailyAverageDose,
  dailyFromPerDose,
  isScheduledOn,
  perDoseFromDaily,
  perDoseFromWeekly,
  scheduleLabel,
  weeklyFromPerDose,
} from '../schedule';
import { dateRange } from '../date';

const protocol = (schedule: Schedule, over: Partial<Protocol> = {}): Protocol => ({
  id: 'p1',
  compoundId: 'c1',
  dose: 100,
  unit: 'mg',
  schedule,
  startDate: '2026-01-01',
  active: true,
  ...over,
});

const daysHit = (p: Protocol, from: string, to: string): string[] =>
  dateRange(from, to).filter((d) => isScheduledOn(p, d));

describe('isScheduledOn', () => {
  it('fires every day for a daily protocol', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 });
    assert.equal(daysHit(p, '2026-01-01', '2026-01-07').length, 7);
  });

  it('fires every other day anchored to the start date', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 });
    assert.deepEqual(daysHit(p, '2026-01-01', '2026-01-07'), [
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
      '2026-01-07',
    ]);
  });

  it('respects the protocol window', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }, {
      startDate: '2026-01-03',
      endDate: '2026-01-05',
    });
    assert.deepEqual(daysHit(p, '2026-01-01', '2026-01-08'), [
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ]);
  });

  it('never fires when inactive', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }, { active: false });
    assert.equal(daysHit(p, '2026-01-01', '2026-01-10').length, 0);
  });

  it('fires on the selected weekdays', () => {
    // 2026-01-01 is a Thursday; Mon = 1, Thu = 4.
    const p = protocol({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 });
    assert.deepEqual(daysHit(p, '2026-01-01', '2026-01-14'), [
      '2026-01-01',
      '2026-01-05',
      '2026-01-08',
      '2026-01-12',
    ]);
  });

  it('follows an on/off cycling pattern from the start date', () => {
    const p = protocol({ kind: 'cycling', daysOn: 5, daysOff: 2, timesPerDay: 1 });
    assert.deepEqual(daysHit(p, '2026-01-01', '2026-01-14'), [
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-08',
      '2026-01-09',
      '2026-01-10',
      '2026-01-11',
      '2026-01-12',
    ]);
  });
});

describe('dailyAverageDose', () => {
  it('averages an every-other-day dose across the calendar', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 });
    assert.equal(dailyAverageDose(p), 50);
  });

  it('multiplies by doses per day', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 3 });
    assert.equal(dailyAverageDose(p), 300);
  });

  it('scales a twice-weekly protocol to 2/7 of the daily dose', () => {
    const p = protocol({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 });
    assert.equal(dailyAverageDose(p), (100 * 2) / 7);
  });

  it('scales a cycling protocol by its duty ratio', () => {
    const p = protocol({ kind: 'cycling', daysOn: 5, daysOff: 2, timesPerDay: 1 });
    assert.equal(dailyAverageDose(p), (100 * 5) / 7);
  });
});

describe('scheduleLabel', () => {
  it('reads naturally for the common patterns', () => {
    assert.equal(scheduleLabel({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }), 'Every day');
    assert.equal(
      scheduleLabel({ kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 }),
      'Every other day',
    );
    assert.equal(
      scheduleLabel({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 2 }),
      'Every day × 2/day',
    );
    assert.equal(scheduleLabel({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 }), 'Mon, Thu');
    assert.equal(
      scheduleLabel({ kind: 'cycling', daysOn: 5, daysOff: 2, timesPerDay: 1 }),
      '5 on / 2 off',
    );
  });
});

describe('dose basis conversion', () => {
  const daily: Schedule = { kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 };
  const twiceWeekly: Schedule = { kind: 'weekdays', days: [1, 4], timesPerDay: 1 };
  const eod: Schedule = { kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 };

  it('counts administrations per week', () => {
    assert.equal(administrationsPerWeek(daily), 7);
    assert.equal(administrationsPerWeek(twiceWeekly), 2);
    assert.equal(administrationsPerWeek(eod), 3.5);
    assert.equal(administrationsPerWeek({ ...daily, timesPerDay: 3 }), 21);
    assert.equal(administrationsPerWeek({ kind: 'cycling', daysOn: 5, daysOff: 2, timesPerDay: 1 }), 5);
  });

  it('splits a weekly total across the week, the way PED doses are quoted', () => {
    // 500 mg/week on a Mon/Thu split is 250 mg an injection.
    assert.equal(perDoseFromWeekly(500, twiceWeekly), 250);
    assert.equal(perDoseFromWeekly(700, daily), 100);
  });

  it('round-trips between per-dose and weekly', () => {
    for (const schedule of [daily, twiceWeekly, eod]) {
      const perDose = perDoseFromWeekly(500, schedule);
      assert.ok(perDose != null);
      assert.ok(Math.abs(weeklyFromPerDose(perDose, schedule) - 500) < 1e-9);
    }
  });

  it('agrees with the daily average used for stock projection', () => {
    for (const schedule of [daily, twiceWeekly, eod]) {
      const protocol = { dose: 100, schedule } as Protocol;
      assert.ok(Math.abs(dailyFromPerDose(100, schedule) - dailyAverageDose(protocol)) < 1e-9);
    }
  });

  it('round-trips between per-dose and daily', () => {
    const perDose = perDoseFromDaily(50, twiceWeekly);
    assert.ok(perDose != null);
    assert.ok(Math.abs(dailyFromPerDose(perDose, twiceWeekly) - 50) < 1e-9);
  });

  it('has no answer when the schedule never fires', () => {
    const noDays: Schedule = { kind: 'weekdays', days: [], timesPerDay: 1 };
    assert.equal(administrationsPerWeek(noDays), 0);
    assert.equal(perDoseFromWeekly(500, noDays), null);
    assert.equal(perDoseFromDaily(50, noDays), null);
  });
});
