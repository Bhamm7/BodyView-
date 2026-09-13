import type { Food, Macros, MealEntry, MealSlot } from '@/db/types';

export const EMPTY_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

export const MEAL_SLOTS: Array<{ value: MealSlot; label: string; icon: string }> = [
  { value: 'breakfast', label: 'Breakfast', icon: '🍳' },
  { value: 'lunch', label: 'Lunch', icon: '🥗' },
  { value: 'dinner', label: 'Dinner', icon: '🍽️' },
  { value: 'snack', label: 'Snack', icon: '🍎' },
  { value: 'preworkout', label: 'Pre-workout', icon: '⚡' },
  { value: 'postworkout', label: 'Post-workout', icon: '🥤' },
];

export const MACRO_COLORS = {
  protein: 'var(--c-1)',
  carbs: 'var(--c-4)',
  fat: 'var(--c-2)',
  fiber: 'var(--c-3)',
} as const;

/** Calories implied by the macros, used to sanity-check a manual entry. */
export function kcalFromMacros(m: Pick<Macros, 'protein' | 'carbs' | 'fat'>): number {
  return m.protein * 4 + m.carbs * 4 + m.fat * 9;
}

export function scaleMacros(per: Macros, servings: number): Macros {
  return {
    kcal: per.kcal * servings,
    protein: per.protein * servings,
    carbs: per.carbs * servings,
    fat: per.fat * servings,
    fiber: (per.fiber ?? 0) * servings,
  };
}

export function addMacros(a: Macros, b: Macros): Macros {
  return {
    kcal: a.kcal + b.kcal,
    protein: a.protein + b.protein,
    carbs: a.carbs + b.carbs,
    fat: a.fat + b.fat,
    fiber: (a.fiber ?? 0) + (b.fiber ?? 0),
  };
}

export function totalMacros(entries: MealEntry[]): Macros {
  return entries.reduce((acc, e) => addMacros(acc, e.macros), { ...EMPTY_MACROS });
}

export function groupBySlot(entries: MealEntry[]): Map<MealSlot, MealEntry[]> {
  const out = new Map<MealSlot, MealEntry[]>();
  for (const slot of MEAL_SLOTS) out.set(slot.value, []);
  for (const entry of entries) {
    const list = out.get(entry.slot) ?? [];
    list.push(entry);
    out.set(entry.slot, list);
  }
  for (const [slot, list] of out) {
    out.set(
      slot,
      list.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
    );
  }
  return out;
}

/** Serving description, e.g. "150 g" or "2 × medium". */
export function servingLabel(food: Food, servings: number): string {
  const amount = food.servingSize * servings;
  const unit = food.servingUnit;
  if (unit === 'g' || unit === 'ml') return `${Math.round(amount)} ${unit}`;
  return `${Number(servings.toFixed(2))} × ${unit}`;
}

/** Percentage of energy from each macro, for the day's split readout. */
export function macroSplit(m: Macros): { protein: number; carbs: number; fat: number } {
  const total = kcalFromMacros(m);
  if (total <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (m.protein * 4 * 100) / total,
    carbs: (m.carbs * 4 * 100) / total,
    fat: (m.fat * 9 * 100) / total,
  };
}
