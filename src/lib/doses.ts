import { db, uid } from '@/db/db';
import type { DoseLog, ID, ISODate, Protocol } from '@/db/types';
import { combineDateTime, nowTime } from './date';
import { isScheduledOn } from './schedule';
import { convert } from './units';

export interface DueDose {
  protocol: Protocol;
  /** 0-based index when a protocol is dosed more than once a day. */
  slot: number;
  log?: DoseLog;
}

/** Every dose the schedules call for on `date`, matched against what was logged. */
export function dueDoses(date: ISODate, protocols: Protocol[], logs: DoseLog[]): DueDose[] {
  const byKey = new Map<string, DoseLog>();
  for (const log of logs) {
    if (log.protocolId) byKey.set(`${log.protocolId}:${log.slot ?? 0}`, log);
  }

  const out: DueDose[] = [];
  for (const protocol of protocols) {
    if (!isScheduledOn(protocol, date)) continue;
    const times = Math.max(1, protocol.schedule.timesPerDay);
    for (let slot = 0; slot < times; slot++) {
      out.push({ protocol, slot, log: byKey.get(`${protocol.id}:${slot}`) });
    }
  }
  return out;
}

/** Doses logged on a date that no schedule asked for (ad-hoc entries). */
export function extraDoses(logs: DoseLog[], due: DueDose[]): DoseLog[] {
  const claimed = new Set(due.map((d) => d.log?.id).filter(Boolean));
  return logs.filter((l) => !claimed.has(l.id));
}

/**
 * Draws `amount` of a compound out of stock, opening a sealed unit when the
 * currently open one runs dry. Returns the quantity it could not account for
 * (because of a unit mismatch or an empty shelf).
 */
export async function consumeFromInventory(
  compoundId: ID,
  amount: number,
  unit: DoseLog['unit'],
): Promise<number> {
  const items = await db.inventory.where('compoundId').equals(compoundId).toArray();
  if (items.length === 0) return amount;

  // Use what is already open first, then whatever expires soonest.
  const ordered = items.sort((a, b) => {
    if (a.remaining > 0 !== b.remaining > 0) return a.remaining > 0 ? -1 : 1;
    return (a.expiresOn ?? '9999').localeCompare(b.expiresOn ?? '9999');
  });

  let outstanding = amount;
  for (const item of ordered) {
    if (outstanding <= 0) break;
    const needed = convert(outstanding, unit, item.unit);
    if (needed == null) continue; // units cannot be reconciled; leave it alone

    let take = Math.min(item.remaining, needed);
    let remaining = item.remaining - take;
    let sealed = item.sealedCount ?? 0;

    // Open sealed units as needed to cover the rest of the dose.
    let stillNeeded = needed - take;
    while (stillNeeded > 0 && sealed > 0 && item.initial > 0) {
      sealed -= 1;
      remaining = item.initial;
      const fromNew = Math.min(remaining, stillNeeded);
      remaining -= fromNew;
      take += fromNew;
      stillNeeded -= fromNew;
    }

    if (take <= 0) continue;
    await db.inventory.update(item.id, { remaining, sealedCount: sealed });
    const consumed = convert(take, item.unit, unit);
    outstanding -= consumed ?? 0;
  }

  return Math.max(0, outstanding);
}

/** Returns stock after an accidental log is undone. */
async function restoreToInventory(compoundId: ID, amount: number, unit: DoseLog['unit']) {
  const items = await db.inventory.where('compoundId').equals(compoundId).toArray();
  const target = items.sort((a, b) => b.remaining - a.remaining)[0];
  if (!target) return;
  const back = convert(amount, unit, target.unit);
  if (back == null) return;
  await db.inventory.update(target.id, {
    remaining: Math.min(target.initial || Infinity, target.remaining + back),
  });
}

/** Records a scheduled dose as taken and draws it out of stock. */
export async function takeDose(
  due: DueDose,
  { date, time = nowTime(), site, note }: { date: ISODate; time?: string; site?: string; note?: string },
): Promise<DoseLog> {
  const log: DoseLog = {
    id: due.log?.id ?? uid(),
    compoundId: due.protocol.compoundId,
    protocolId: due.protocol.id,
    date,
    takenAt: combineDateTime(date, time),
    dose: due.protocol.dose,
    unit: due.protocol.unit,
    slot: due.slot,
    site,
    note,
  };
  await db.doses.put(log);
  await consumeFromInventory(log.compoundId, log.dose, log.unit);
  return log;
}

/** Marks a scheduled dose as deliberately skipped; stock is untouched. */
export async function skipDose(due: DueDose, date: ISODate): Promise<void> {
  await db.doses.put({
    id: due.log?.id ?? uid(),
    compoundId: due.protocol.compoundId,
    protocolId: due.protocol.id,
    date,
    takenAt: combineDateTime(date, nowTime()),
    dose: due.protocol.dose,
    unit: due.protocol.unit,
    slot: due.slot,
    skipped: true,
  });
}

/** Undoes a logged dose, returning it to stock when it was actually taken. */
export async function undoDose(log: DoseLog): Promise<void> {
  await db.doses.delete(log.id);
  if (!log.skipped) await restoreToInventory(log.compoundId, log.dose, log.unit);
}

/** Adherence over a window: how many scheduled doses were actually taken. */
export function adherence(
  dates: ISODate[],
  protocols: Protocol[],
  logs: DoseLog[],
): { taken: number; scheduled: number; percent: number } {
  const byKey = new Set(
    logs.filter((l) => !l.skipped && l.protocolId).map((l) => `${l.date}:${l.protocolId}:${l.slot ?? 0}`),
  );

  let scheduled = 0;
  let taken = 0;
  for (const date of dates) {
    for (const p of protocols) {
      if (!isScheduledOn(p, date)) continue;
      const times = Math.max(1, p.schedule.timesPerDay);
      for (let slot = 0; slot < times; slot++) {
        scheduled++;
        if (byKey.has(`${date}:${p.id}:${slot}`)) taken++;
      }
    }
  }

  return { taken, scheduled, percent: scheduled === 0 ? 100 : (taken / scheduled) * 100 };
}
