import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MetricEntry } from '@/db/types';
import { metricDef } from '@/db/metrics';
import { dailyValues, latestEntry, sortEntries, trendTone } from '../metricSeries';

const entry = (over: Partial<MetricEntry> = {}): MetricEntry => ({
  id: 'm1',
  metric: 'weight',
  date: '2026-01-01',
  recordedAt: '2026-01-01T08:00:00.000Z',
  values: { value: 80 },
  ...over,
});

describe('dailyValues', () => {
  it('averages several readings taken on the same day', () => {
    const values = dailyValues(
      [
        entry({ id: 'a', values: { value: 80 } }),
        entry({ id: 'b', recordedAt: '2026-01-01T20:00:00.000Z', values: { value: 82 } }),
      ],
      'value',
    );
    assert.equal(values.get('2026-01-01'), 81);
  });

  it('skips readings missing that field', () => {
    const values = dailyValues([entry({ values: { systolic: 120 } })], 'value');
    assert.equal(values.size, 0);
  });
});

describe('latestEntry', () => {
  it('returns the most recent reading by timestamp', () => {
    const older = entry({ id: 'old', recordedAt: '2026-01-01T06:00:00.000Z' });
    const newer = entry({ id: 'new', recordedAt: '2026-01-01T21:00:00.000Z' });
    assert.equal(latestEntry([older, newer])?.id, 'new');
    assert.equal(sortEntries([older, newer])[0].id, 'new');
  });
});

describe('trendTone', () => {
  it('treats a falling resting heart rate as an improvement', () => {
    assert.equal(trendTone(metricDef('restingHr'), -4), 'up');
    assert.equal(trendTone(metricDef('restingHr'), 4), 'down');
  });

  it('treats more sleep as an improvement', () => {
    assert.equal(trendTone(metricDef('sleep'), 0.8), 'up');
    assert.equal(trendTone(metricDef('sleep'), -0.8), 'down');
  });

  it('stays neutral on body weight, where the goal may be either direction', () => {
    assert.equal(trendTone(metricDef('weight'), -2), 'flat');
    assert.equal(trendTone(metricDef('weight'), 2), 'flat');
  });

  it('is flat for a change below the metric precision', () => {
    assert.equal(trendTone(metricDef('restingHr'), 0.2), 'flat');
  });
});
