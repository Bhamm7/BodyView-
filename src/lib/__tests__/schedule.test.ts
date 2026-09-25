import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Protocol, Schedule } from '@/db/types';
import {
  dailyAverageDose,
  doseRate,
  dosesPerWeek,
  isDaily,
  isScheduledOn,
  perDoseFromBasis,
  scheduleLabel,
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

describe('doseRate', () => {
  it('quotes an every-other-day protocol per week', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 });
    const rate = doseRate(p);
    assert.equal(rate.cadence, 'week');
    assert.equal(rate.perWeek, 350);
    assert.equal(rate.label, '350 mg/week');
  });

  it('quotes a daily protocol per day', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 });
    const rate = doseRate(p);
    assert.equal(rate.cadence, 'day');
    assert.equal(rate.label, '100 mg/day');
    assert.equal(rate.perWeek, 700);
  });

  it('sums the week for a two-day split', () => {
    const p = protocol({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 }, { dose: 125 });
    assert.equal(doseRate(p).label, '250 mg/week');
  });

  it('counts every dose of a multi-dose day', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 2 }, { dose: 2.5 });
    assert.equal(doseRate(p).label, '5 mg/day');
  });

  it('prorates a cycled protocol over its off days', () => {
    const p = protocol({ kind: 'cycling', daysOn: 2, daysOff: 5, timesPerDay: 1 });
    assert.equal(doseRate(p).cadence, 'week');
    assert.equal(doseRate(p).perWeek, 200);
  });

  it('always offers the other cadence alongside', () => {
    const p = protocol({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 }, { dose: 125 });
    assert.match(doseRate(p).longLabel, /250 mg\/week · 35.71 mg\/day/);
  });

  it('treats every pattern that hits all seven days as daily', () => {
    assert.equal(isDaily({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }), true);
    assert.equal(isDaily({ kind: 'weekdays', days: [0, 1, 2, 3, 4, 5, 6], timesPerDay: 1 }), true);
    assert.equal(isDaily({ kind: 'cycling', daysOn: 5, daysOff: 0, timesPerDay: 1 }), true);
    assert.equal(isDaily({ kind: 'cycling', daysOn: 5, daysOff: 2, timesPerDay: 1 }), false);
  });

  it('agrees with the daily average used for stock projections', () => {
    const p = protocol({ kind: 'weekdays', days: [1, 3, 5], timesPerDay: 1 });
    assert.equal(doseRate(p).perDay, dailyAverageDose(p));
  });
});

describe('dose basis', () => {
  it('counts administrations a week for each schedule shape', () => {
    assert.equal(dosesPerWeek({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }), 7);
    assert.equal(dosesPerWeek({ kind: 'everyNDays', intervalDays: 7, timesPerDay: 1 }), 1);
    assert.equal(dosesPerWeek({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 }), 2);
    assert.equal(dosesPerWeek({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 3 }), 21);
    assert.equal(dosesPerWeek({ kind: 'cycling', daysOn: 2, daysOff: 5, timesPerDay: 1 }), 2);
  });

  it('splits a weekly total across the scheduled days', () => {
    const twice: Schedule = { kind: 'weekdays', days: [1, 4], timesPerDay: 1 };
    assert.equal(perDoseFromBasis(160, 'week', twice), 80);
  });

  it('keeps a weekly total intact on a once-a-week schedule', () => {
    const weekly: Schedule = { kind: 'everyNDays', intervalDays: 7, timesPerDay: 1 };
    assert.equal(perDoseFromBasis(160, 'week', weekly), 160);
  });

  it('leaves a per-dose amount alone', () => {
    const daily: Schedule = { kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 };
    assert.equal(perDoseFromBasis(160, 'dose', daily), 160);
  });

  it('spreads a daily total over a less frequent schedule', () => {
    const eod: Schedule = { kind: 'everyNDays', intervalDays: 2, timesPerDay: 1 };
    // 10 mg a day, dosed every other day, is 20 mg each time.
    assert.equal(perDoseFromBasis(10, 'day', eod), 20);
  });

  it('round-trips: what is entered is what the rate reports back', () => {
    const schedule: Schedule = { kind: 'weekdays', days: [1, 4], timesPerDay: 1 };
    const stored = perDoseFromBasis(160, 'week', schedule);
    const rate = doseRate(protocol(schedule, { dose: stored }));
    assert.equal(rate.perWeek, 160);
    assert.equal(rate.label, '160 mg/week');
  });
});

describe('doseRate follows how the dose was entered', () => {
  it('quotes a weekly-entered protocol per week, even on a daily schedule', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }, {
      dose: 22.857,
      doseBasis: 'week',
    });
    assert.equal(doseRate(p).cadence, 'week');
    assert.equal(doseRate(p).label, '160 mg/week');
  });

  it('quotes a daily-entered protocol per day, even on a weekly schedule', () => {
    const p = protocol({ kind: 'everyNDays', intervalDays: 7, timesPerDay: 1 }, {
      dose: 70,
      doseBasis: 'day',
    });
    assert.equal(doseRate(p).cadence, 'day');
    assert.equal(doseRate(p).label, '10 mg/day');
  });

  it('falls back to the schedule when no basis was recorded', () => {
    const weekly = protocol({ kind: 'everyNDays', intervalDays: 7, timesPerDay: 1 }, { dose: 160 });
    assert.equal(doseRate(weekly).cadence, 'week');
    const daily = protocol({ kind: 'everyNDays', intervalDays: 1, timesPerDay: 1 }, { dose: 5 });
    assert.equal(doseRate(daily).cadence, 'day');
  });

  it('a per-dose entry still reads by its schedule', () => {
    const p = protocol({ kind: 'weekdays', days: [1, 4], timesPerDay: 1 }, {
      dose: 80,
      doseBasis: 'dose',
    });
    assert.equal(doseRate(p).label, '160 mg/week');
  });
});
