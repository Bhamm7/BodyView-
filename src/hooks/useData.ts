import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useMemo } from 'react';
import { db, getSettings, saveSettings } from '@/db/db';
import { DEFAULT_SETTINGS } from '@/db/db';
import type {
  Compound,
  Exercise,
  Food,
  ID,
  ISODate,
  Settings,
} from '@/db/types';

/** Live settings with the defaults already merged in. */
export function useSettings(): [Settings, (patch: Partial<Settings>) => Promise<void>] {
  const settings = useLiveQuery(() => getSettings(), [], DEFAULT_SETTINGS);
  const update = useCallback((patch: Partial<Settings>) => saveSettings(patch), []);
  return [settings ?? DEFAULT_SETTINGS, update];
}

export function useCompounds(): Compound[] {
  return (
    useLiveQuery(
      () => db.compounds.filter((c) => !c.archived).sortBy('name'),
      [],
      [],
    ) ?? []
  );
}

/** Compound lookup by id, for rendering names and colours next to doses. */
export function useCompoundMap(): Map<ID, Compound> {
  const all = useLiveQuery(() => db.compounds.toArray(), [], []) ?? [];
  return useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);
}

export function useProtocols() {
  return useLiveQuery(() => db.protocols.toArray(), [], []) ?? [];
}

export function useActiveProtocols() {
  return useLiveQuery(() => db.protocols.filter((p) => p.active).toArray(), [], []) ?? [];
}

export function useInventory() {
  return useLiveQuery(() => db.inventory.toArray(), [], []) ?? [];
}

export function useDosesOn(date: ISODate) {
  return useLiveQuery(() => db.doses.where('date').equals(date).toArray(), [date], []) ?? [];
}

export function useMetricEntries(metric: string, limit = 400) {
  return (
    useLiveQuery(
      () => db.metrics.where('metric').equals(metric).reverse().sortBy('date').then((r) => r.slice(0, limit)),
      [metric, limit],
      [],
    ) ?? []
  );
}

export function useExercises(): Exercise[] {
  return (
    useLiveQuery(() => db.exercises.filter((e) => !e.archived).sortBy('name'), [], []) ?? []
  );
}

export function useExerciseMap(): Map<ID, Exercise> {
  const all = useLiveQuery(() => db.exercises.toArray(), [], []) ?? [];
  return useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);
}

export function useFoods(): Food[] {
  return useLiveQuery(() => db.foods.filter((f) => !f.archived).sortBy('name'), [], []) ?? [];
}

export function useMealsOn(date: ISODate) {
  return useLiveQuery(() => db.meals.where('date').equals(date).toArray(), [date], []) ?? [];
}

export function useActiveTarget() {
  return useLiveQuery(() => db.targets.filter((t) => t.active).first(), [], undefined);
}

export function useWorkoutsBetween(from: ISODate, to: ISODate) {
  return (
    useLiveQuery(
      () => db.workouts.where('date').between(from, to, true, true).toArray(),
      [from, to],
      [],
    ) ?? []
  );
}

export function useWorkoutSets(workoutId: ID | undefined) {
  return (
    useLiveQuery(
      () => (workoutId ? db.sets.where('workoutId').equals(workoutId).toArray() : []),
      [workoutId],
      [],
    ) ?? []
  );
}

/** The most recent unfinished session, so "Resume workout" can be offered. */
export function useOpenWorkout() {
  return useLiveQuery(
    () => db.workouts.filter((w) => !w.finishedAt).reverse().sortBy('startedAt').then((r) => r[0]),
    [],
    undefined,
  );
}
