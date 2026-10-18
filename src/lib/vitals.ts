import { startOfWeek } from 'date-fns';
import type { ISODate, MetricEntry, VitalsSession } from '@/db/types';
import { fromISODate, shiftDate, toISODate } from './date';

/**
 * Home blood pressure, the way it is usually measured: two or three readings
 * together each morning and each night. Readings are grouped into those
 * sessions and each session is averaged first, so a three-reading session
 * counts the same as a two-reading one. Readings without a session tag (a
 * midday check) are not part of any of these averages.
 */

export const SESSION_LABEL: Record<VitalsSession, string> = { am: 'Morning', pm: 'Night' };

/**
 * The session a reading taken at `time` (HH:mm) most likely belongs to.
 * Before 11:00 is morning, from 17:00 is night, and the middle of the day is
 * neither.
 */
export function sessionForTime(time: string): VitalsSession | undefined {
  const hour = Number(time.split(':')[0]);
  if (!Number.isFinite(hour)) return undefined;
  if (hour < 11) return 'am';
  if (hour >= 17) return 'pm';
  return undefined;
}

/** For the session form, which always needs one: whichever half of the day it is. */
export function nearestSession(time: string): VitalsSession {
  return sessionForTime(time) ?? (Number(time.split(':')[0]) < 14 ? 'am' : 'pm');
}

export interface BpSession {
  date: ISODate;
  session: VitalsSession;
  systolic: number;
  diastolic: number;
  /** Number of readings averaged into this session. */
  readings: number;
  /** Resting HR logged in the same session, if any (averaged). */
  hr: number | null;
}

const avg = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Morning and night sessions, newest first. Untagged readings are dropped. */
export function bpSessions(bp: MetricEntry[], hr: MetricEntry[] = []): BpSession[] {
  const groups = new Map<string, { date: ISODate; session: VitalsSession; sys: number[]; dia: number[]; hr: number[] }>();
  const group = (e: MetricEntry) => {
    const key = `${e.date}|${e.session}`;
    let g = groups.get(key);
    if (!g) {
      g = { date: e.date, session: e.session!, sys: [], dia: [], hr: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const e of bp) {
    if (!e.session) continue;
    const { systolic, diastolic } = e.values;
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) continue;
    const g = group(e);
    g.sys.push(systolic);
    g.dia.push(diastolic);
  }
  for (const e of hr) {
    if (!e.session || !Number.isFinite(e.values.value)) continue;
    const key = `${e.date}|${e.session}`;
    // Heart rate only belongs to a session that has blood pressure in it.
    groups.get(key)?.hr.push(e.values.value);
  }
  return [...groups.values()]
    .filter((g) => g.sys.length > 0)
    .map((g) => ({
      date: g.date,
      session: g.session,
      systolic: avg(g.sys)!,
      diastolic: avg(g.dia)!,
      readings: g.sys.length,
      hr: avg(g.hr),
    }))
    .sort((a, b) => (a.date === b.date ? b.session.localeCompare(a.session) : b.date.localeCompare(a.date)));
}

export interface BpAverage {
  systolic: number;
  diastolic: number;
  /** Sessions averaged. */
  sessions: number;
  /** Resting HR averaged over the sessions that logged one. */
  hr: number | null;
}

/** Mean of session means; null when there are no sessions. */
export function averageSessions(sessions: BpSession[]): BpAverage | null {
  if (sessions.length === 0) return null;
  return {
    systolic: avg(sessions.map((s) => s.systolic))!,
    diastolic: avg(sessions.map((s) => s.diastolic))!,
    sessions: sessions.length,
    hr: avg(sessions.map((s) => s.hr).filter((v): v is number => v != null)),
  };
}

export interface BpSplit {
  am: BpAverage | null;
  pm: BpAverage | null;
  all: BpAverage | null;
}

export function splitAverage(sessions: BpSession[]): BpSplit {
  return {
    am: averageSessions(sessions.filter((s) => s.session === 'am')),
    pm: averageSessions(sessions.filter((s) => s.session === 'pm')),
    all: averageSessions(sessions),
  };
}

/** Sessions dated within [from, to], inclusive. */
export function sessionsBetween(sessions: BpSession[], from: ISODate, to: ISODate): BpSession[] {
  return sessions.filter((s) => s.date >= from && s.date <= to);
}

export interface BpWeek extends BpSplit {
  /** First day of the week. */
  start: ISODate;
}

/**
 * The last `weeks` calendar weeks ending with the one containing `end`,
 * oldest first. Weeks with no sessions are kept, with null averages, so a
 * gap reads as a gap.
 */
export function weeklyAverages(
  sessions: BpSession[],
  end: ISODate,
  weeks: number,
  weekStartsOn: 0 | 1,
): BpWeek[] {
  const last = toISODate(startOfWeek(fromISODate(end), { weekStartsOn }));
  const out: BpWeek[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = shiftDate(last, -7 * i);
    out.push({ start, ...splitAverage(sessionsBetween(sessions, start, shiftDate(start, 6))) });
  }
  return out;
}
