import { BLOOD_MARKERS, markerDef, type MarkerDef } from '@/db/bloodMarkers';
import type { BloodResult, ISODate } from '@/db/types';

/**
 * Charting and comparison helpers for bloodwork.
 *
 * Two rules shape this file:
 *  - a result is only ever charted against others in the same unit, converting
 *    where a conversion is defined and refusing where it is not;
 *  - the lab's own reference interval always beats the built-in one.
 */

export type Flag = 'low' | 'high' | 'normal' | 'unknown';

/** The interval to judge a result against: the lab's, else the catalogue's. */
export function referenceFor(result: BloodResult): {
  low?: number;
  high?: number;
  fromLab: boolean;
  note?: string;
} {
  if (result.refLow != null || result.refHigh != null) {
    return { low: result.refLow, high: result.refHigh, fromLab: true };
  }
  const def = markerDef(result.marker);
  if (def?.ref) return { low: def.ref.low, high: def.ref.high, fromLab: false, note: def.ref.note };
  return { fromLab: false };
}

export function flagFor(result: BloodResult): Flag {
  const ref = referenceFor(result);
  const value = canonicalValue(result);
  if (value == null || (ref.low == null && ref.high == null)) return 'unknown';
  if (ref.low != null && value < ref.low) return 'low';
  if (ref.high != null && value > ref.high) return 'high';
  return 'normal';
}

/**
 * The value in the marker's canonical unit, or null when the reported unit
 * cannot be reconciled — better to omit a point than plot a wrong one.
 */
export function canonicalValue(result: BloodResult): number | null {
  const def = markerDef(result.marker);
  if (!def) return result.value;

  const unit = normalizeUnit(result.unit);
  if (!unit || unit === normalizeUnit(def.unit)) return result.value;

  const factor = Object.entries(def.conversions ?? {}).find(
    ([from]) => normalizeUnit(from) === unit,
  )?.[1];
  return factor != null ? result.value * factor : null;
}

/** Units differ only in punctuation and case across labs. */
export function normalizeUnit(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/µ/g, 'u')
    .replace(/\s+/g, '')
    .replace(/\^/g, '')
    .replace(/²/g, '2');
}

export function unitFor(marker: string, fallback = ''): string {
  return markerDef(marker)?.unit ?? fallback;
}

export function labelFor(marker: string, fallback: string): string {
  return markerDef(marker)?.label ?? fallback;
}

export interface MarkerSummary {
  marker: string;
  label: string;
  unit: string;
  def?: MarkerDef;
  /** Newest first. */
  points: Array<{ date: ISODate; value: number; result: BloodResult }>;
  latest?: { date: ISODate; value: number; result: BloodResult };
  previous?: { date: ISODate; value: number; result: BloodResult };
  /** Change from the previous panel to the latest. */
  delta?: number;
  percentChange?: number;
  flag: Flag;
}

/** Groups results by marker and orders each series newest first. */
export function summarise(results: BloodResult[]): MarkerSummary[] {
  const byMarker = new Map<string, BloodResult[]>();
  for (const result of results) {
    const list = byMarker.get(result.marker) ?? [];
    list.push(result);
    byMarker.set(result.marker, list);
  }

  const summaries: MarkerSummary[] = [];
  for (const [marker, list] of byMarker) {
    const points = list
      .map((result) => ({ date: result.date, value: canonicalValue(result), result }))
      .filter((p): p is { date: ISODate; value: number; result: BloodResult } => p.value != null)
      .sort((a, b) => b.date.localeCompare(a.date));

    const latest = points[0];
    const previous = points[1];
    const delta = latest && previous ? latest.value - previous.value : undefined;

    summaries.push({
      marker,
      label: labelFor(marker, list[0].label),
      unit: unitFor(marker, list[0].unit),
      def: markerDef(marker),
      points,
      latest,
      previous,
      delta,
      percentChange:
        delta != null && previous && previous.value !== 0
          ? (delta / Math.abs(previous.value)) * 100
          : undefined,
      flag: latest ? flagFor(latest.result) : 'unknown',
    });
  }

  return summaries.sort((a, b) => a.label.localeCompare(b.label));
}

export interface ChartGroup {
  unit: string;
  markers: MarkerSummary[];
  /** Shown as a band when every marker in the group shares one interval. */
  band?: { from: number; to: number };
}

/** The most series one chart carries before it becomes small multiples. */
export const MAX_SERIES_PER_CHART = 6;

/**
 * Groups selected markers into charts.
 *
 * Markers only share a chart when they share a unit — a chart with two y-scales
 * invites false comparisons, so a second unit gets a second chart instead. A
 * group with too many series is split into one chart per marker, since past
 * half a dozen lines a shared plot stops being readable.
 */
export function groupForCharts(summaries: MarkerSummary[]): ChartGroup[] {
  const byUnit = new Map<string, MarkerSummary[]>();
  for (const summary of summaries) {
    if (summary.points.length === 0) continue;
    const unit = summary.unit || '—';
    const list = byUnit.get(unit) ?? [];
    list.push(summary);
    byUnit.set(unit, list);
  }

  const groups: ChartGroup[] = [];
  for (const [unit, markers] of byUnit) {
    if (markers.length > MAX_SERIES_PER_CHART) {
      for (const marker of markers) groups.push({ unit, markers: [marker], band: bandFor([marker]) });
    } else {
      groups.push({ unit, markers, band: bandFor(markers) });
    }
  }

  return groups.sort((a, b) => b.markers.length - a.markers.length || a.unit.localeCompare(b.unit));
}

/** A shared reference band, only when every marker agrees on one. */
function bandFor(markers: MarkerSummary[]): { from: number; to: number } | undefined {
  const refs = markers.map((m) => (m.latest ? referenceFor(m.latest.result) : undefined));
  if (refs.some((r) => !r || r.low == null || r.high == null)) return undefined;
  const first = refs[0]!;
  const same = refs.every((r) => r!.low === first.low && r!.high === first.high);
  return same ? { from: first.low!, to: first.high! } : undefined;
}

/** Markers that have ever been recorded, for the picker. */
export function availableMarkers(results: BloodResult[]): MarkerSummary[] {
  return summarise(results);
}

/** Catalogue entries not yet recorded, so the picker can still offer them. */
export function cataloguePicks(recorded: Set<string>): MarkerDef[] {
  return BLOOD_MARKERS.filter((m) => !recorded.has(m.key));
}

export const FLAG_TONE: Record<Flag, string> = {
  low: 'warning',
  high: 'serious',
  normal: 'good',
  unknown: '',
};

export const FLAG_LABEL: Record<Flag, string> = {
  low: 'Below range',
  high: 'Above range',
  normal: 'In range',
  unknown: 'No range',
};
