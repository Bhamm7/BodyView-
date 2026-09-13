import {
  addDays,
  differenceInCalendarDays,
  format,
  isValid,
  parseISO,
  startOfDay,
} from 'date-fns';
import type { ISODate } from '@/db/types';

/** Local calendar day as `YYYY-MM-DD`. Never use `toISOString()` — that is UTC. */
export function toISODate(d: Date = new Date()): ISODate {
  return format(d, 'yyyy-MM-dd');
}

export function fromISODate(d: ISODate): Date {
  const parsed = parseISO(d);
  return isValid(parsed) ? startOfDay(parsed) : startOfDay(new Date());
}

export const today = (): ISODate => toISODate();

export function shiftDate(d: ISODate, days: number): ISODate {
  return toISODate(addDays(fromISODate(d), days));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return differenceInCalendarDays(fromISODate(b), fromISODate(a));
}

/** Inclusive list of dates from `start` to `end`. */
export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  const n = daysBetween(start, end);
  for (let i = 0; i <= n; i++) out.push(shiftDate(start, i));
  return out;
}

/** The last `n` days ending today, oldest first. */
export function lastNDays(n: number, end: ISODate = today()): ISODate[] {
  return dateRange(shiftDate(end, -(n - 1)), end);
}

export function formatDay(d: ISODate): string {
  return format(fromISODate(d), 'EEE d MMM');
}

export function formatDayLong(d: ISODate): string {
  return format(fromISODate(d), 'EEEE d MMMM yyyy');
}

export function formatShort(d: ISODate): string {
  return format(fromISODate(d), 'd MMM');
}

export function formatTime(iso: string): string {
  const parsed = parseISO(iso);
  return isValid(parsed) ? format(parsed, 'HH:mm') : '';
}

/** "Today" / "Yesterday" / "Thu 3 Apr" for list headers. */
export function relativeDay(d: ISODate): string {
  const diff = daysBetween(d, today());
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff === -1) return 'Tomorrow';
  return formatDay(d);
}

/** "3d ago" style, for "last logged" readouts. */
export function agoLabel(d: ISODate): string {
  const diff = daysBetween(d, today());
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 0) return `in ${-diff}d`;
  if (diff < 7) return `${diff}d ago`;
  if (diff < 30) return `${Math.round(diff / 7)}w ago`;
  return `${Math.round(diff / 30)}mo ago`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** `HH:mm` for the current local time, for time inputs. */
export function nowTime(): string {
  return format(new Date(), 'HH:mm');
}

/** Combines a calendar date and an `HH:mm` time into a full ISO timestamp. */
export function combineDateTime(date: ISODate, time: string): string {
  const [h, m] = time.split(':').map(Number);
  const d = fromISODate(date);
  d.setHours(Number.isFinite(h) ? h : 12, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toISOString();
}
