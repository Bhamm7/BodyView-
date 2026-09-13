import type { MetricDef, MetricEntry, Settings } from '@/db/types';
import { lastNDays, today } from './date';
import { movingAverage, linearTrend, type Trend } from './stats';
import { toDisplay } from './metricUnits';
import type { Point, Series } from '@/components/charts';

/** Newest first. Several readings a day are allowed, so sort by timestamp. */
export function sortEntries(entries: MetricEntry[]): MetricEntry[] {
  return [...entries].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

export function latestEntry(entries: MetricEntry[]): MetricEntry | undefined {
  return sortEntries(entries)[0];
}

/**
 * One value per calendar day. Where a day has several readings they are
 * averaged, which is the honest summary for blood pressure and weight alike.
 */
export function dailyValues(
  entries: MetricEntry[],
  field: string,
): Map<string, number> {
  const buckets = new Map<string, number[]>();
  for (const e of entries) {
    const v = e.values[field];
    if (v == null || !Number.isFinite(v)) continue;
    const list = buckets.get(e.date) ?? [];
    list.push(v);
    buckets.set(e.date, list);
  }
  return new Map(
    [...buckets].map(([date, values]) => [
      date,
      values.reduce((a, b) => a + b, 0) / values.length,
    ]),
  );
}

export interface MetricChart {
  series: Series[];
  dates: string[];
  /** Trend of the first field over the window. */
  trend: Trend | null;
  hasData: boolean;
}

/**
 * Builds the chart series for a metric: one line per field, plus a dashed
 * moving average when the window is long enough to make it meaningful.
 */
export function buildMetricChart(
  def: MetricDef,
  entries: MetricEntry[],
  days: number,
  settings: Settings,
  { average = true }: { average?: boolean } = {},
): MetricChart {
  const dates = lastNDays(days, today());
  const series: Series[] = [];
  let trend: Trend | null = null;
  let hasData = false;

  def.fields.forEach((field, index) => {
    const byDate = dailyValues(entries, field.key);
    const data: Point[] = dates.map((d) => {
      const raw = byDate.get(d);
      return { x: d, y: raw == null ? null : toDisplay(def, raw, settings) };
    });
    if (data.some((p) => p.y != null)) hasData = true;

    series.push({
      key: field.key,
      label: field.label,
      color: field.color,
      data,
      unit: field.unit,
      precision: def.precision,
    });

    if (index === 0) {
      trend = linearTrend(data.map((p, i) => ({ x: i, y: p.y })));

      // A 7-day average only helps once there is more than a week on screen.
      if (average && days >= 14) {
        const smoothed = movingAverage(data.map((p) => p.y), 7);
        series.push({
          key: `${field.key}__avg`,
          label: '7-day average',
          color: field.color,
          dashed: true,
          data: dates.map((d, i) => ({ x: d, y: smoothed[i] })),
          unit: field.unit,
          precision: def.precision,
        });
      }
    }
  });

  return { series, dates, trend, hasData };
}

/**
 * Direction of travel as good/bad rather than up/down: a falling resting heart
 * rate is an improvement, falling sleep is not. Metrics with no stated polarity
 * — body weight above all, where the goal may be either direction — stay
 * neutral rather than having the app judge them.
 */
export function trendTone(def: MetricDef, delta: number): 'up' | 'down' | 'flat' {
  if (Math.abs(delta) < 10 ** -def.precision) return 'flat';
  const rising = delta > 0;
  if (def.lowerIsBetter) return rising ? 'down' : 'up';
  if (def.higherIsBetter) return rising ? 'up' : 'down';
  return 'flat';
}
