import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import type { ISODate } from '@/db/types';
import { fromISODate, toISODate } from './date';

/**
 * The 5–6 week grid a month view renders, including the leading and trailing
 * days that belong to neighbouring months.
 */
export function monthGrid(month: ISODate, weekStartsOn: 0 | 1): ISODate[] {
  const base = fromISODate(month);
  const start = startOfWeek(startOfMonth(base), { weekStartsOn });
  const end = endOfWeek(endOfMonth(base), { weekStartsOn });
  return eachDayOfInterval({ start, end }).map(toISODate);
}

export function weekdayLabels(weekStartsOn: 0 | 1): string[] {
  const base = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return weekStartsOn === 1 ? [...base.slice(1), base[0]] : base;
}

export function isSameMonth(date: ISODate, month: ISODate): boolean {
  return date.slice(0, 7) === month.slice(0, 7);
}

export function shiftMonth(month: ISODate, delta: number): ISODate {
  const d = fromISODate(month);
  d.setDate(1);
  d.setMonth(d.getMonth() + delta);
  return toISODate(d);
}
