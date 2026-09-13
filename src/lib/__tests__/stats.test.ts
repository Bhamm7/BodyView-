import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linearTrend, movingAverage, niceDomain, tickDecimals } from '../stats';

describe('movingAverage', () => {
  it('averages only what falls inside the window', () => {
    assert.deepEqual(movingAverage([1, 2, 3, 4], 2), [1, 1.5, 2.5, 3.5]);
  });

  it('ignores empty days rather than carrying an old reading forward', () => {
    // A reading 5 days ago and one today, with a 3-day window: the old value
    // must have dropped out by the time the new one lands.
    const result = movingAverage([10, null, null, null, null, 20], 3);
    assert.equal(result[0], 10);
    assert.equal(result[3], null, 'window has moved past the old reading');
    assert.equal(result[5], 20, 'only the fresh reading counts');
  });

  it('is null while the window holds no readings', () => {
    assert.deepEqual(movingAverage([null, null], 7), [null, null]);
  });
});

describe('tickDecimals', () => {
  it('adds precision when the axis spans a narrow range', () => {
    assert.equal(tickDecimals([82, 83.1]), 1, 'a 1.1 kg spread needs a decimal');
    assert.equal(tickDecimals([0.2, 0.9]), 2);
    assert.equal(tickDecimals([60, 180]), 0);
  });
});

describe('niceDomain', () => {
  it('pads the extremes', () => {
    const [lo, hi] = niceDomain([10, 20]);
    assert.ok(lo < 10 && hi > 20);
  });

  it('still produces a range for a single value', () => {
    const [lo, hi] = niceDomain([50]);
    assert.ok(hi > lo);
  });

  it('falls back for an empty series', () => {
    assert.deepEqual(niceDomain([]), [0, 1]);
  });
});

describe('linearTrend', () => {
  it('measures a steady decline', () => {
    const trend = linearTrend([
      { x: 0, y: 84 },
      { x: 1, y: 83 },
      { x: 2, y: 82 },
    ]);
    assert.ok(trend);
    assert.equal(trend.slope, -1);
    assert.equal(trend.delta, -2);
    assert.equal(trend.n, 3);
    assert.ok(trend.r2 > 0.99);
  });

  it('skips gaps', () => {
    const trend = linearTrend([
      { x: 0, y: 10 },
      { x: 1, y: null },
      { x: 2, y: 20 },
    ]);
    assert.equal(trend?.n, 2);
    assert.equal(trend?.slope, 5);
  });

  it('needs two points', () => {
    assert.equal(linearTrend([{ x: 0, y: 1 }]), null);
  });
});
