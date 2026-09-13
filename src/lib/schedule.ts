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
