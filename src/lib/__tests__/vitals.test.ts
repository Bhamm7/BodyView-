import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MetricEntry, VitalsSession } from '@/db/types';
import {
  bpSessions,
  nearestSession,
  sessionForTime,
  splitAverage,
  weeklyAverages,
} from '../vitals';

let n = 0;
const bp = (date: string, sys: number, dia: number, session?: VitalsSession): MetricEntry => ({
  id: `bp${n++}`,
  metric: 'bloodPressure',
  date,
  recordedAt: `${date}T08:00:00.000Z`,
  values: { systolic: sys, diastolic: dia },
  session,
});
const hr = (date: string, value: number, session?: VitalsSession): MetricEntry => ({
  id: `hr${n++}`,
  metric: 'restingHr',
  date,
  recordedAt: `${date}T08:00:00.000Z`,
  values: { value },
  session,
});

describe('session from the clock', () => {
  it('splits the day into morning, midday and night', () => {
    assert.equal(sessionForTime('06:30'), 'am');
    assert.equal(sessionForTime('10:59'), 'am');
    assert.equal(sessionForTime('13:00'), undefined);
    assert.equal(sessionForTime('17:00'), 'pm');
    assert.equal(sessionForTime('23:10'), 'pm');
  });
  it('always picks one for the session form', () => {
    assert.equal(nearestSession('12:00'), 'am');
    assert.equal(nearestSession('15:00'), 'pm');
  });
});

describe('bpSessions', () => {
  it('averages the readings in a session and leaves untagged ones out', () => {
    const sessions = bpSessions(
      [
        bp('2026-10-01', 120, 80, 'am'),
        bp('2026-10-01', 124, 82, 'am'),
        bp('2026-10-01', 160, 100), // midday, untagged
        bp('2026-10-01', 130, 85, 'pm'),
      ],
      [hr('2026-10-01', 60, 'am'), hr('2026-10-01', 90)],
    );
    assert.equal(sessions.length, 2);
    const [pm, am] = sessions;
    assert.equal(pm.session, 'pm');
    assert.deepEqual([am.systolic, am.diastolic, am.readings, am.hr], [122, 81, 2, 60]);
    assert.equal(pm.hr, null);
  });
});

describe('averages', () => {
  it('weights each session equally, however many readings it has', () => {
    const sessions = bpSessions([
      bp('2026-10-01', 110, 70, 'am'),
      bp('2026-10-01', 110, 70, 'am'),
      bp('2026-10-01', 110, 70, 'am'),
      bp('2026-10-01', 130, 90, 'pm'),
    ]);
    const split = splitAverage(sessions);
    assert.equal(split.am?.systolic, 110);
    assert.equal(split.pm?.systolic, 130);
    assert.equal(split.all?.systolic, 120);
    assert.equal(split.all?.sessions, 2);
  });

  it('buckets by calendar week and keeps empty weeks', () => {
    const sessions = bpSessions([
      bp('2026-10-05', 120, 80, 'am'), // Monday
      bp('2026-10-11', 130, 80, 'pm'), // Sunday, same Monday-start week
      bp('2026-10-19', 140, 90, 'am'),
    ]);
    const weeks = weeklyAverages(sessions, '2026-10-20', 3, 1);
    assert.deepEqual(weeks.map((w) => w.start), ['2026-10-05', '2026-10-12', '2026-10-19']);
    assert.equal(weeks[0].all?.systolic, 125);
    assert.equal(weeks[1].all, null);
    assert.equal(weeks[2].am?.systolic, 140);
  });
});
