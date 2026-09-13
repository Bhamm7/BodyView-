import type { Compound, InventoryItem, ISODate, Protocol } from '@/db/types';
import { dailyAverageDose, isScheduledOn, isWithinWindow } from './schedule';
import { convert } from './units';
import { shiftDate, today } from './date';

export interface Projection {
  item: InventoryItem;
  compound?: Compound;
  /** Active protocols that will draw on this item. */
  protocols: Protocol[];
  /** Consumption per calendar day in the item's unit; null when idle. */
  dailyUse: number | null;
  /** Stock on hand including sealed spares, in the item's unit. */
  totalRemaining: number;
  /** Whole days of supply left; null when it outlasts every protocol. */
  daysLeft: number | null;
  /** Projected date the stock hits zero. */
  runsOutOn: ISODate | null;
  /** Every protocol finishes before the stock does. */
  coversProtocol: boolean;
  /** A dose unit could not be reconciled with the stock unit (e.g. IU vs mg). */
  unitMismatch: boolean;
  status: 'ok' | 'low' | 'critical' | 'empty' | 'unknown';
  percentLeft: number | null;
  expiringSoon: boolean;
}

const DEFAULT_REORDER_DAYS = 14;
/** Five years of simulation is "effectively never runs out". */
const MAX_PROJECTION_DAYS = 1825;

/** Stock on hand: the open unit plus any sealed spares. */
export function totalRemaining(item: InventoryItem): number {
  const sealed = (item.sealedCount ?? 0) * Math.max(0, item.initial || 0);
  return Math.max(0, item.remaining) + sealed;
}

/** Protocols that will consume this item from `from` onwards. */
function drawingProtocols(item: InventoryItem, protocols: Protocol[], from: ISODate): Protocol[] {
  return protocols.filter(
    (p) => p.compoundId === item.compoundId && p.active && (!p.endDate || p.endDate >= from),
  );
}

/**
 * Projects when an inventory item runs out, driven by the active protocols for
 * the same compound.
 *
 * The burn-down is simulated a day at a time rather than divided by an average,
 * so an every-other-day or 5-on/2-off protocol lands on the right calendar
 * date. Doses are converted into the item's unit; where that is impossible the
 * projection is flagged instead of guessed.
 */
export function project(
  item: InventoryItem,
  protocols: Protocol[],
  compounds: Map<string, Compound>,
  from: ISODate = today(),
): Projection {
  const relevant = drawingProtocols(item, protocols, from);
  const running = relevant.filter((p) => isWithinWindow(p, from));

  let unitMismatch = false;
  const perDay = (p: Protocol, value: number): number => {
    const converted = convert(value, p.unit, item.unit);
    if (converted == null) {
      unitMismatch = true;
      return 0;
    }
    return converted;
  };

  const dailyUse = running.reduce((acc, p) => acc + perDay(p, dailyAverageDose(p)), 0);
  const stock = totalRemaining(item);

  let daysLeft: number | null = null;
  if (relevant.length > 0 && stock > 0) {
    let left = stock;
    for (let day = 0; day < MAX_PROJECTION_DAYS; day++) {
      const date = shiftDate(from, day);
      // Once every protocol has ended, nothing more is consumed.
      if (!relevant.some((p) => !p.endDate || date <= p.endDate)) break;

      let used = 0;
      for (const p of relevant) {
        if (!isScheduledOn(p, date)) continue;
        used += perDay(p, p.dose * Math.max(1, p.schedule.timesPerDay));
      }
      if (used >= left) {
        daysLeft = day;
        break;
      }
      left -= used;
    }
  }

  const runsOutOn = daysLeft != null ? shiftDate(from, daysLeft) : null;

  const allBounded = relevant.length > 0 && relevant.every((p) => !!p.endDate);
  const lastEnd = allBounded
    ? relevant.reduce((acc, p) => (p.endDate! > acc ? p.endDate! : acc), relevant[0].endDate!)
    : null;
  const coversProtocol = lastEnd != null && (runsOutOn == null || runsOutOn >= lastEnd);

  const reorderDays = item.reorderDays ?? DEFAULT_REORDER_DAYS;
  let status: Projection['status'];
  if (stock <= 0) status = 'empty';
  else if (relevant.length === 0) status = 'unknown';
  else if (daysLeft == null) status = 'ok';
  else if (daysLeft <= Math.ceil(reorderDays / 2)) status = 'critical';
  else if (daysLeft <= reorderDays) status = 'low';
  else status = 'ok';

  const capacity = Math.max(0, item.initial || 0) * (1 + (item.sealedCount ?? 0));
  const percentLeft = capacity > 0 ? Math.min(100, (stock / capacity) * 100) : null;

  return {
    item,
    compound: compounds.get(item.compoundId),
    protocols: relevant,
    dailyUse: running.length > 0 && dailyUse > 0 ? dailyUse : null,
    totalRemaining: stock,
    daysLeft,
    runsOutOn,
    coversProtocol,
    unitMismatch,
    status,
    percentLeft,
    expiringSoon: !!item.expiresOn && item.expiresOn <= shiftDate(from, 60),
  };
}

/**
 * How much more stock is needed to finish every bounded protocol.
 * Positive means a shortfall; null when a protocol is open-ended (there is no
 * finish line to buy up to).
 */
export function shortfall(projection: Projection, from: ISODate = today()): number | null {
  const { protocols, item } = projection;
  if (protocols.length === 0 || protocols.some((p) => !p.endDate)) return null;

  const end = protocols.reduce((acc, p) => (p.endDate! > acc ? p.endDate! : acc), protocols[0].endDate!);

  let needed = 0;
  for (let day = 0; day < MAX_PROJECTION_DAYS; day++) {
    const date = shiftDate(from, day);
    if (date > end) break;
    for (const p of protocols) {
      if (!isScheduledOn(p, date)) continue;
      needed += convert(p.dose * Math.max(1, p.schedule.timesPerDay), p.unit, item.unit) ?? 0;
    }
  }
  return needed - projection.totalRemaining;
}

export const STATUS_LABEL: Record<Projection['status'], string> = {
  ok: 'In stock',
  low: 'Running low',
  critical: 'Reorder now',
  empty: 'Out of stock',
  unknown: 'No active protocol',
};

export const STATUS_ORDER: Record<Projection['status'], number> = {
  empty: 0,
  critical: 1,
  low: 2,
  unknown: 3,
  ok: 4,
};
