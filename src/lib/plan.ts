import type { ID, ISODate, TrainingPlan, WorkoutTemplate } from '@/db/types';
import { fromISODate } from './date';

/**
 * What a plan calls for on a date.
 *
 * A weekday plan answers straight from the calendar. A rotation has no opinion
 * about dates at all — it only knows which session is next — so it answers the
 * same whatever day is asked about, which is the point: miss Tuesday and
 * Wednesday still owes you the session Tuesday would have.
 */
export function plannedTemplateId(plan: TrainingPlan, date: ISODate): ID | null {
  if (!plan.active) return null;
  if (plan.kind === 'weekday') {
    const dow = fromISODate(date).getDay();
    return plan.days?.find((d) => d.day === dow)?.templateId ?? null;
  }
  const order = plan.rotation ?? [];
  if (order.length === 0) return null;
  const position = ((plan.position ?? 0) % order.length + order.length) % order.length;
  return order[position];
}

/** The plan's position moved on by one session, wrapping at the end. */
export function advanced(plan: TrainingPlan): number {
  const length = (plan.rotation ?? []).length;
  if (plan.kind !== 'rotation' || length === 0) return plan.position ?? 0;
  return ((plan.position ?? 0) + 1) % length;
}

/** The session after the one due now — shown as "then" on the plan card. */
export function upcomingTemplateIds(plan: TrainingPlan, count: number): ID[] {
  const order = plan.rotation ?? [];
  if (plan.kind !== 'rotation' || order.length === 0) return [];
  const start = ((plan.position ?? 0) % order.length + order.length) % order.length;
  return Array.from({ length: count }, (_, i) => order[(start + i + 1) % order.length]);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One line describing the plan's shape, for a list row. */
export function planSummary(plan: TrainingPlan, templates: Map<ID, WorkoutTemplate>): string {
  if (plan.kind === 'weekday') {
    const days = (plan.days ?? []).slice().sort((a, b) => a.day - b.day);
    if (days.length === 0) return 'No days assigned yet';
    return days.map((d) => `${DOW[d.day]} ${templates.get(d.templateId)?.name ?? '—'}`).join(' · ');
  }
  const order = plan.rotation ?? [];
  if (order.length === 0) return 'No sessions added yet';
  return order.map((id) => templates.get(id)?.name ?? '—').join(' → ');
}

export const PLAN_DAY_LABELS = DOW;
