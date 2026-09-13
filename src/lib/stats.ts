/** Small numeric helpers shared by the charts and summary tiles. */

export function mean(values: number[]): number {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function min(values: number[]): number {
  return values.length ? Math.min(...values) : NaN;
}

export function max(values: number[]): number {
  return values.length ? Math.max(...values) : NaN;
}

/**
 * Trailing moving average over a fixed number of *positions*, where each
 * position is one calendar day. Days with no reading contribute nothing rather
 * than pulling an older reading forward, so a "7-day average" really only ever
 * averages the last 7 days; it is null while that window is empty.
 */
export function movingAverage(values: Array<number | null>, window: number): Array<number | null> {
  const out: Array<number | null> = [];
  for (let i = 0; i < values.length; i++) {
    const from = Math.max(0, i - window + 1);
    const seen: number[] = [];
    for (let j = from; j <= i; j++) {
      const v = values[j];
      if (v != null && Number.isFinite(v)) seen.push(v);
    }
    out.push(seen.length ? mean(seen) : null);
  }
  return out;
}

/**
 * Decimal places an axis needs so its ticks stay distinct: a 1.1 kg spread
 * must not render as "83, 83, 83".
 */
export function tickDecimals([lo, hi]: [number, number], max = 2): number {
  const span = Math.abs(hi - lo);
  if (span === 0) return Math.min(1, max);
  if (span < 1) return Math.min(2, max);
  if (span < 10) return Math.min(1, max);
  return 0;
}

export interface Trend {
  /** Change per day, in the series' own units. */
  slope: number;
  /** Change across the whole series. */
  delta: number;
  first: number;
  last: number;
  /** Goodness of fit, 0..1. Low values mean the trend is noise. */
  r2: number;
  n: number;
}

/** Ordinary least squares over (index, value) pairs, skipping gaps. */
export function linearTrend(points: Array<{ x: number; y: number | null }>): Trend | null {
  const pts = points.filter((p): p is { x: number; y: number } => p.y != null && Number.isFinite(p.y));
  if (pts.length < 2) return null;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const mx = mean(xs);
  const my = mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < pts.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = my - slope * mx;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < pts.length; i++) {
    ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
    ssTot += (ys[i] - my) ** 2;
  }

  const span = xs[xs.length - 1] - xs[0];
  return {
    slope,
    delta: slope * span,
    first: ys[0],
    last: ys[ys.length - 1],
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    n: pts.length,
  };
}

/** Nice axis bounds with a little headroom, snapped to a round step. */
export function niceDomain(values: number[], padRatio = 0.08): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.05 || 1;
    return [lo - pad, hi + pad];
  }
  const pad = (hi - lo) * padRatio;
  return [lo - pad, hi + pad];
}
