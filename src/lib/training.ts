import type { Exercise, ISODate, SetLog, Workout } from '@/db/types';

/** Epley estimated one-rep max. Reps above ~12 extrapolate poorly, so cap it. */
export function e1rm(weight: number, reps: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, 12) / 30);
}

/** Weight × reps, the standard tonnage measure. Warm-ups are excluded. */
export function setVolume(set: SetLog): number {
  if (set.warmup || !set.done) return 0;
  return (set.weight ?? 0) * (set.reps ?? 0);
}

export function workoutVolume(sets: SetLog[]): number {
  return sets.reduce((acc, s) => acc + setVolume(s), 0);
}

export function workingSets(sets: SetLog[]): SetLog[] {
  return sets.filter((s) => s.done && !s.warmup);
}

export interface ExercisePR {
  exerciseId: string;
  /** Heaviest completed single, whatever the rep count. */
  topWeight: number;
  topWeightReps: number;
  topWeightDate?: ISODate;
  /** Best estimated 1RM across all sets. */
  bestE1rm: number;
  bestE1rmDate?: ISODate;
  /** Best tonnage in a single session. */
  bestSessionVolume: number;
  bestSessionVolumeDate?: ISODate;
  totalSets: number;
  lastPerformed?: ISODate;
}

/** Rolls every logged set for one exercise into its personal records. */
export function personalRecords(
  exerciseId: string,
  sets: SetLog[],
  workoutDates: Map<string, ISODate>,
): ExercisePR {
  const pr: ExercisePR = {
    exerciseId,
    topWeight: 0,
    topWeightReps: 0,
    bestE1rm: 0,
    bestSessionVolume: 0,
    totalSets: 0,
  };

  const volumeByWorkout = new Map<string, number>();

  for (const s of workingSets(sets)) {
    const date = workoutDates.get(s.workoutId);
    pr.totalSets++;
    if (date && (!pr.lastPerformed || date > pr.lastPerformed)) pr.lastPerformed = date;

    const w = s.weight ?? 0;
    const r = s.reps ?? 0;
    if (w > pr.topWeight) {
      pr.topWeight = w;
      pr.topWeightReps = r;
      pr.topWeightDate = date;
    }
    const est = e1rm(w, r);
    if (est > pr.bestE1rm) {
      pr.bestE1rm = est;
      pr.bestE1rmDate = date;
    }
    volumeByWorkout.set(s.workoutId, (volumeByWorkout.get(s.workoutId) ?? 0) + setVolume(s));
  }

  for (const [workoutId, vol] of volumeByWorkout) {
    if (vol > pr.bestSessionVolume) {
      pr.bestSessionVolume = vol;
      pr.bestSessionVolumeDate = workoutDates.get(workoutId);
    }
  }

  return pr;
}

/** Per-muscle working-set counts, the usual weekly-volume landmark. */
export function setsByMuscle(sets: SetLog[], exercises: Map<string, Exercise>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of workingSets(sets)) {
    const ex = exercises.get(s.exerciseId);
    if (!ex) continue;
    out.set(ex.muscle, (out.get(ex.muscle) ?? 0) + 1);
  }
  return out;
}

export function workoutDuration(workout: Workout): number | null {
  if (!workout.finishedAt) return null;
  const ms = new Date(workout.finishedAt).getTime() - new Date(workout.startedAt).getTime();
  return ms > 0 ? ms / 1000 : null;
}

/** Formats a set the way it reads in a log: "100 × 8", "8 reps", "12:30". */
export function setLabel(set: SetLog, kind: Exercise['kind'], weightUnit: string): string {
  if (kind === 'cardio' || kind === 'timed') {
    const parts: string[] = [];
    if (set.duration) parts.push(`${Math.round(set.duration / 60)} min`);
    if (set.distance) parts.push(`${(set.distance / 1000).toFixed(2)} km`);
    return parts.join(' · ') || '—';
  }
  if (set.weight != null && set.reps != null) return `${set.weight} ${weightUnit} × ${set.reps}`;
  if (set.reps != null) return `${set.reps} reps`;
  return '—';
}

/**
 * Quick tags for a session. A short fixed list on purpose — these are meant to
 * be tapped mid-workout, and a longer list stops being one tap.
 */
export const TRAINING_TAGS = [
  'Chest',
  'Back',
  'Legs',
  'Arms',
  'Shoulders',
  'Core',
  'Cardio',
] as const;

export type TrainingTag = (typeof TRAINING_TAGS)[number];

/**
 * The `order` a newly added exercise should take within a session.
 *
 * One past the highest in use, not the count of blocks: after an exercise is
 * removed those differ, and reusing a live order merges two different
 * exercises into a single block.
 */
export function nextBlockOrder(existingOrders: number[]): number {
  return Math.max(-1, ...existingOrders) + 1;
}

/** A session's name, falling back to its tags when it was never named. */
export function workoutTitle(workout: { name?: string; tags?: string[] }): string {
  const name = workout.name?.trim();
  if (name) return name;
  if (workout.tags?.length) return workout.tags.join(' · ');
  return 'Workout';
}

export const MUSCLE_LABELS: Record<string, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core',
  forearms: 'Forearms',
  fullBody: 'Full body',
  cardio: 'Cardio',
};
