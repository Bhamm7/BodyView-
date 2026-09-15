import type { ISODate, Protocol, Schedule } from '@/db/types';
import { daysBetween, fromISODate } from './date';
import { pluralize } from './format';

/** Whether the protocol's window covers this date (ignores the schedule). */
export function isWithinWindow(protocol: Protocol, date: ISODate): boolean {
  if (daysBetween(protocol.startDate, date) < 0) return false;
  if (protocol.endDate && daysBetween(protocol.endDate, date) > 0) return false;
  return true;
}

/** Whether a dose is due on this date, per the protocol's schedule pattern. */
export function isScheduledOn(protocol: Protocol, date: ISODate): boolean {
  if (!protocol.active || !isWithinWindow(protocol, date)) return false;
  const { schedule } = protocol;
  const offset = daysBetween(protocol.startDate, date);

  switch (schedule.kind) {
    case 'everyNDays': {
      const n = Math.max(1, schedule.intervalDays ?? 1);
      return offset % n === 0;
    }
    case 'weekdays': {
      const dow = fromISODate(date).getDay();
      return (schedule.days ?? []).includes(dow);
    }
    case 'cycling': {
      const on = Math.max(1, schedule.daysOn ?? 1);
      const off = Math.max(0, schedule.daysOff ?? 0);
      return offset % (on + off) < on;
    }
  }
}

/** Total scheduled dose for a date, in the protocol's own unit. */
export function scheduledDoseOn(protocol: Protocol, date: ISODate): number {
  if (!isScheduledOn(protocol, date)) return 0;
  return protocol.dose * Math.max(1, protocol.schedule.timesPerDay);
}

/**
 * Average consumption per calendar day, used for inventory burn-down.
 * A 2 mg dose every other day averages 1 mg/day.
 */
export function dailyAverageDose(protocol: Protocol): number {
  const perDosingDay = protocol.dose * Math.max(1, protocol.schedule.timesPerDay);
  const { schedule } = protocol;

  switch (schedule.kind) {
    case 'everyNDays':
      return perDosingDay / Math.max(1, schedule.intervalDays ?? 1);
    case 'weekdays': {
      const n = (schedule.days ?? []).length;
      return (perDosingDay * n) / 7;
    }
    case 'cycling': {
      const on = Math.max(1, schedule.daysOn ?? 1);
      const off = Math.max(0, schedule.daysOff ?? 0);
      return (perDosingDay * on) / (on + off);
    }
  }
}

/**
 * How many individual administrations a schedule calls for in a week.
 *
 * This is what converts between the two ways people talk about a dose: "250 mg
 * twice a week" and "500 mg a week" describe the same protocol, and compounds
 * are conventionally discussed one way or the other depending on the compound.
 */
export function administrationsPerWeek(schedule: Schedule): number {
  const perDosingDay = Math.max(1, schedule.timesPerDay);
  switch (schedule.kind) {
    case 'everyNDays':
      return (7 / Math.max(1, schedule.intervalDays ?? 1)) * perDosingDay;
    case 'weekdays':
      return (schedule.days ?? []).length * perDosingDay;
    case 'cycling': {
      const on = Math.max(1, schedule.daysOn ?? 1);
      const off = Math.max(0, schedule.daysOff ?? 0);
      return ((on * 7) / (on + off)) * perDosingDay;
    }
  }
}

/** Weekly total implied by a per-administration dose. */
export function weeklyFromPerDose(dose: number, schedule: Schedule): number {
  return dose * administrationsPerWeek(schedule);
}

/**
 * Per-administration dose implied by a weekly total. Returns null when the
 * schedule has no administrations at all (no weekdays picked), where the
 * question has no answer rather than a zero one.
 */
export function perDoseFromWeekly(weekly: number, schedule: Schedule): number | null {
  const n = administrationsPerWeek(schedule);
  if (n <= 0) return null;
  return weekly / n;
}

/** Daily average implied by a per-administration dose. */
export function dailyFromPerDose(dose: number, schedule: Schedule): number {
  return weeklyFromPerDose(dose, schedule) / 7;
}

/** Per-administration dose implied by a daily average. */
export function perDoseFromDaily(daily: number, schedule: Schedule): number | null {
  return perDoseFromWeekly(daily * 7, schedule);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function scheduleLabel(schedule: Schedule): string {
  const times = schedule.timesPerDay > 1 ? ` × ${schedule.timesPerDay}/day` : '';
  switch (schedule.kind) {
    case 'everyNDays': {
      const n = Math.max(1, schedule.intervalDays ?? 1);
      if (n === 1) return `Every day${times}`;
      if (n === 2) return `Every other day${times}`;
      return `Every ${n} days${times}`;
    }
    case 'weekdays': {
      const days = (schedule.days ?? []).slice().sort();
      if (days.length === 7) return `Every day${times}`;
      if (days.length === 0) return 'No days selected';
      return `${days.map((d) => DOW[d]).join(', ')}${times}`;
    }
    case 'cycling': {
      const on = Math.max(1, schedule.daysOn ?? 1);
      const off = Math.max(0, schedule.daysOff ?? 0);
      return `${on} on / ${off} off${times}`;
    }
  }
}

/** Human summary of how far through a protocol today is. */
export function protocolProgress(
  protocol: Protocol,
  date: ISODate,
): { day: number; total: number | null; label: string; percent: number | null } {
  const day = daysBetween(protocol.startDate, date) + 1;
  if (!protocol.endDate) {
    return { day, total: null, label: `Day ${day}`, percent: null };
  }
  const total = daysBetween(protocol.startDate, protocol.endDate) + 1;
  const percent = total > 0 ? Math.min(100, Math.max(0, (day / total) * 100)) : null;
  return { day, total, label: `Day ${day} of ${total}`, percent };
}

/** Days left in the protocol window, or null when open-ended. */
export function daysRemaining(protocol: Protocol, date: ISODate): number | null {
  if (!protocol.endDate) return null;
  return Math.max(0, daysBetween(date, protocol.endDate));
}

export function remainingLabel(protocol: Protocol, date: ISODate): string {
  const left = daysRemaining(protocol, date);
  if (left == null) return 'Ongoing';
  if (left === 0) return 'Last day';
  return `${pluralize(left, 'day')} left`;
}

export const WEEKDAY_LABELS = DOW;
