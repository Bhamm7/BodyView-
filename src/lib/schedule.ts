import type { DoseUnit, ISODate, Protocol, Schedule } from '@/db/types';
import { daysBetween, fromISODate } from './date';
import { dose as formatDose, pluralize } from './format';

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
 * How many administrations a week the pattern calls for — scheduled days
 * multiplied by the doses taken on each of them.
 */
export function dosesPerWeek(schedule: Schedule): number {
  const times = Math.max(1, schedule.timesPerDay);
  switch (schedule.kind) {
    case 'everyNDays':
      return (7 / Math.max(1, schedule.intervalDays ?? 1)) * times;
    case 'weekdays':
      return (schedule.days ?? []).length * times;
    case 'cycling': {
      const on = Math.max(1, schedule.daysOn ?? 1);
      const off = Math.max(0, schedule.daysOff ?? 0);
      return ((7 * on) / (on + off)) * times;
    }
  }
}

/** What an entered amount means: one administration, a day's worth, a week's. */
export type DoseBasis = 'dose' | 'day' | 'week';

/**
 * Converts an amount entered on any basis into the per-administration dose the
 * protocol stores. "160 mg a week, split Mon and Thu" is stored as 80 mg, so
 * the checklist, the stock burn-down and the adherence maths all keep working
 * on one number without knowing how it was typed in.
 */
export function perDoseFromBasis(amount: number, basis: DoseBasis, schedule: Schedule): number {
  if (basis === 'dose') return amount;
  const perWeek = dosesPerWeek(schedule);
  if (!Number.isFinite(perWeek) || perWeek <= 0) return amount;
  return (basis === 'week' ? amount : amount * 7) / perWeek;
}

/** True when the pattern puts a dose on every calendar day in the window. */
export function isDaily(schedule: Schedule): boolean {
  switch (schedule.kind) {
    case 'everyNDays':
      return Math.max(1, schedule.intervalDays ?? 1) === 1;
    case 'weekdays':
      return (schedule.days ?? []).length === 7;
    case 'cycling':
      return Math.max(0, schedule.daysOff ?? 0) === 0;
  }
}

export interface DoseRate {
  /** Average amount per calendar day, in the protocol's own unit. */
  perDay: number;
  /** Average amount per calendar week, in the protocol's own unit. */
  perWeek: number;
  unit: DoseUnit;
  /** Which of the two reads naturally for this schedule. */
  cadence: 'day' | 'week';
  /** The headline rate, e.g. "250 mg/week" or "5 g/day". */
  label: string;
  /** Both rates, for places with room: "250 mg/week · 35.7 mg/day". */
  longLabel: string;
}

/**
 * Normalizes a protocol to a rate, so "125 mg, Mon and Thu" reads as the
 * 250 mg/week it actually is. Daily protocols are quoted per day, everything
 * less frequent per week — a weekly total is how those are prescribed and
 * discussed, and it is the number that makes two protocols comparable.
 */
export function doseRate(protocol: Protocol): DoseRate {
  const perDay = dailyAverageDose(protocol);
  const perWeek = perDay * 7;
  // How it was entered wins: someone who typed a weekly total is telling you
  // which number they think in. Failing that, daily schedules read per day and
  // anything less frequent per week.
  const cadence: 'day' | 'week' =
    protocol.doseBasis === 'week'
      ? 'week'
      : protocol.doseBasis === 'day'
        ? 'day'
        : isDaily(protocol.schedule)
          ? 'day'
          : 'week';
  const unit = protocol.unit;
  const label = `${formatDose(cadence === 'day' ? perDay : perWeek, unit)}/${cadence}`;
  const other =
    cadence === 'day'
      ? `${formatDose(perWeek, unit)}/week`
      : `${formatDose(perDay, unit)}/day`;
  return { perDay, perWeek, unit, cadence, label, longLabel: `${label} · ${other}` };
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
