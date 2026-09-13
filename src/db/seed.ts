import { db, DEFAULT_SETTINGS, getSettings, saveSettings, uid } from './db';
import type { Compound, Exercise, Food, NutritionTarget } from './types';

/**
 * First-run catalogues. These are reference lists only — no doses are
 * suggested for compounds; the user enters whatever their own protocol is.
 */

const COMPOUND_SEED: Array<Omit<Compound, 'id'>> = [
  // Peptides
  { name: 'BPC-157', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#38bdf8' },
  { name: 'TB-500', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#22d3ee' },
  { name: 'Ipamorelin', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#818cf8' },
  { name: 'CJC-1295', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#a78bfa' },
  { name: 'Tesamorelin', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#c084fc' },
  { name: 'Semaglutide', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#f472b6' },
  { name: 'Tirzepatide', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#fb7185' },
  { name: 'GHK-Cu', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#2dd4bf' },

  // Performance compounds
  { name: 'Testosterone Enanthate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#f97316' },
  { name: 'Testosterone Cypionate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fb923c' },
  { name: 'Testosterone Propionate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fdba74' },
  { name: 'Nandrolone Decanoate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#facc15' },
  { name: 'Boldenone Undecylenate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#eab308' },
  { name: 'Masteron', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#a3e635' },
  { name: 'Anavar (Oxandrolone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#84cc16' },
  { name: 'HCG', category: 'ped', defaultUnit: 'iu', route: 'subcutaneous', color: '#4ade80' },

  // Ancillaries
  { name: 'Anastrozole', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#94a3b8' },
  { name: 'Tamoxifen', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#a1a1aa' },
  { name: 'Telmisartan', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#cbd5e1' },

  // Vitamins & supplements
  { name: 'Vitamin D3', category: 'vitamin', defaultDose: 5000, defaultUnit: 'iu', route: 'oral', color: '#fcd34d' },
  { name: 'Vitamin K2 (MK-7)', category: 'vitamin', defaultDose: 100, defaultUnit: 'mcg', route: 'oral', color: '#fde047' },
  { name: 'Vitamin C', category: 'vitamin', defaultDose: 1000, defaultUnit: 'mg', route: 'oral', color: '#fb923c' },
  { name: 'Vitamin B12', category: 'vitamin', defaultDose: 1000, defaultUnit: 'mcg', route: 'oral', color: '#f472b6' },
  { name: 'Magnesium Glycinate', category: 'vitamin', defaultDose: 400, defaultUnit: 'mg', route: 'oral', color: '#60a5fa' },
  { name: 'Zinc', category: 'vitamin', defaultDose: 25, defaultUnit: 'mg', route: 'oral', color: '#93c5fd' },
  { name: 'Omega-3 (EPA/DHA)', category: 'supplement', defaultDose: 2, defaultUnit: 'g', route: 'oral', color: '#38bdf8' },
  { name: 'Creatine Monohydrate', category: 'supplement', defaultDose: 5, defaultUnit: 'g', route: 'oral', color: '#e2e8f0' },
  { name: 'Ashwagandha', category: 'supplement', defaultDose: 600, defaultUnit: 'mg', route: 'oral', color: '#a3a3a3' },
  { name: 'L-Citrulline', category: 'supplement', defaultDose: 6, defaultUnit: 'g', route: 'oral', color: '#5eead4' },
  { name: 'Caffeine', category: 'supplement', defaultDose: 200, defaultUnit: 'mg', route: 'oral', color: '#d6a67c' },
];

const EX = (
  name: string,
  muscle: Exercise['muscle'],
  equipment: string,
  opts: { kind?: Exercise['kind']; primary?: boolean } = {},
): Omit<Exercise, 'id'> => ({
  name,
  muscle,
  equipment,
  kind: opts.kind ?? 'strength',
  primary: opts.primary,
});

const EXERCISE_SEED: Array<Omit<Exercise, 'id'>> = [
  EX('Barbell Back Squat', 'quads', 'Barbell', { primary: true }),
  EX('Front Squat', 'quads', 'Barbell'),
  EX('Leg Press', 'quads', 'Machine'),
  EX('Bulgarian Split Squat', 'quads', 'Dumbbell'),
  EX('Leg Extension', 'quads', 'Machine'),
  EX('Romanian Deadlift', 'hamstrings', 'Barbell', { primary: true }),
  EX('Conventional Deadlift', 'back', 'Barbell', { primary: true }),
  EX('Lying Leg Curl', 'hamstrings', 'Machine'),
  EX('Seated Leg Curl', 'hamstrings', 'Machine'),
  EX('Hip Thrust', 'glutes', 'Barbell'),
  EX('Standing Calf Raise', 'calves', 'Machine'),
  EX('Seated Calf Raise', 'calves', 'Machine'),
  EX('Barbell Bench Press', 'chest', 'Barbell', { primary: true }),
  EX('Incline Barbell Press', 'chest', 'Barbell'),
  EX('Incline Dumbbell Press', 'chest', 'Dumbbell'),
  EX('Flat Dumbbell Press', 'chest', 'Dumbbell'),
  EX('Cable Fly', 'chest', 'Cable'),
  EX('Pec Deck', 'chest', 'Machine'),
  EX('Dips', 'chest', 'Bodyweight', { kind: 'bodyweight' }),
  EX('Pull-Up', 'back', 'Bodyweight', { kind: 'bodyweight', primary: true }),
  EX('Chin-Up', 'back', 'Bodyweight', { kind: 'bodyweight' }),
  EX('Lat Pulldown', 'back', 'Cable'),
  EX('Barbell Row', 'back', 'Barbell'),
  EX('Chest-Supported Row', 'back', 'Machine'),
  EX('Seated Cable Row', 'back', 'Cable'),
  EX('Straight-Arm Pulldown', 'back', 'Cable'),
  EX('Overhead Press', 'shoulders', 'Barbell', { primary: true }),
  EX('Seated Dumbbell Press', 'shoulders', 'Dumbbell'),
  EX('Lateral Raise', 'shoulders', 'Dumbbell'),
  EX('Cable Lateral Raise', 'shoulders', 'Cable'),
  EX('Rear Delt Fly', 'shoulders', 'Dumbbell'),
  EX('Face Pull', 'shoulders', 'Cable'),
  EX('Barbell Curl', 'biceps', 'Barbell'),
  EX('Incline Dumbbell Curl', 'biceps', 'Dumbbell'),
  EX('Hammer Curl', 'biceps', 'Dumbbell'),
  EX('Preacher Curl', 'biceps', 'Machine'),
  EX('Close-Grip Bench Press', 'triceps', 'Barbell'),
  EX('Triceps Pushdown', 'triceps', 'Cable'),
  EX('Overhead Cable Extension', 'triceps', 'Cable'),
  EX('Skullcrusher', 'triceps', 'Barbell'),
  EX('Hanging Leg Raise', 'core', 'Bodyweight', { kind: 'bodyweight' }),
  EX('Cable Crunch', 'core', 'Cable'),
  EX('Plank', 'core', 'Bodyweight', { kind: 'timed' }),
  EX('Ab Wheel Rollout', 'core', 'Other'),
  EX('Farmer Carry', 'forearms', 'Dumbbell', { kind: 'timed' }),
  EX('Wrist Curl', 'forearms', 'Dumbbell'),
  EX('Treadmill Run', 'cardio', 'Machine', { kind: 'cardio' }),
  EX('Incline Walk', 'cardio', 'Machine', { kind: 'cardio' }),
  EX('Stationary Bike', 'cardio', 'Machine', { kind: 'cardio' }),
  EX('Rowing Machine', 'cardio', 'Machine', { kind: 'cardio' }),
  EX('Stair Climber', 'cardio', 'Machine', { kind: 'cardio' }),
  EX('Assault Bike', 'cardio', 'Machine', { kind: 'cardio' }),
];

const F = (
  name: string,
  servingSize: number,
  servingUnit: string,
  kcal: number,
  protein: number,
  carbs: number,
  fat: number,
  fiber = 0,
): Omit<Food, 'id'> => ({
  name,
  servingSize,
  servingUnit,
  per: { kcal, protein, carbs, fat, fiber },
});

/** Per-100 g (or per-unit) values for staples, to make logging fast on day one. */
const FOOD_SEED: Array<Omit<Food, 'id'>> = [
  F('Chicken breast, raw', 100, 'g', 120, 22.5, 0, 2.6),
  F('Chicken thigh, raw', 100, 'g', 177, 19.7, 0, 10.9),
  F('Lean beef mince 5%', 100, 'g', 137, 21.5, 0, 5),
  F('Ribeye steak', 100, 'g', 271, 24.8, 0, 18.9),
  F('Salmon fillet', 100, 'g', 208, 20.4, 0, 13.4),
  F('Cod fillet', 100, 'g', 82, 17.8, 0, 0.7),
  F('Tuna, canned in water', 100, 'g', 116, 25.5, 0, 0.8),
  F('Whole egg', 1, 'egg', 72, 6.3, 0.4, 4.8),
  F('Egg white', 100, 'g', 52, 10.9, 0.7, 0.2),
  F('Greek yoghurt 0%', 100, 'g', 59, 10.3, 3.6, 0.4),
  F('Cottage cheese', 100, 'g', 98, 11.1, 3.4, 4.3),
  F('Whole milk', 100, 'ml', 61, 3.2, 4.8, 3.3),
  F('Whey protein isolate', 30, 'g', 113, 25, 1.5, 0.6),
  F('White rice, cooked', 100, 'g', 130, 2.7, 28.2, 0.3, 0.4),
  F('Brown rice, cooked', 100, 'g', 123, 2.7, 25.6, 1, 1.6),
  F('Rolled oats, dry', 100, 'g', 379, 13.2, 67.7, 6.5, 10.1),
  F('Sweet potato, raw', 100, 'g', 86, 1.6, 20.1, 0.1, 3),
  F('White potato, raw', 100, 'g', 77, 2, 17.5, 0.1, 2.1),
  F('Pasta, cooked', 100, 'g', 158, 5.8, 30.9, 0.9, 1.8),
  F('Wholemeal bread', 1, 'slice', 82, 4, 13.8, 1.1, 2),
  F('Banana', 1, 'medium', 105, 1.3, 27, 0.4, 3.1),
  F('Apple', 1, 'medium', 95, 0.5, 25.1, 0.3, 4.4),
  F('Blueberries', 100, 'g', 57, 0.7, 14.5, 0.3, 2.4),
  F('Broccoli, raw', 100, 'g', 34, 2.8, 6.6, 0.4, 2.6),
  F('Spinach, raw', 100, 'g', 23, 2.9, 3.6, 0.4, 2.2),
  F('Avocado', 100, 'g', 160, 2, 8.5, 14.7, 6.7),
  F('Almonds', 100, 'g', 579, 21.2, 21.6, 49.9, 12.5),
  F('Peanut butter', 100, 'g', 588, 25.1, 19.6, 50.4, 6),
  F('Olive oil', 100, 'ml', 884, 0, 0, 100),
  F('Butter', 100, 'g', 717, 0.9, 0.1, 81.1),
  F('Cheddar cheese', 100, 'g', 403, 24.9, 1.3, 33.1),
  F('Black beans, cooked', 100, 'g', 132, 8.9, 23.7, 0.5, 8.7),
  F('Lentils, cooked', 100, 'g', 116, 9, 20.1, 0.4, 7.9),
  F('Tofu, firm', 100, 'g', 144, 17.3, 2.8, 8.7, 2.3),
  F('Honey', 100, 'g', 304, 0.3, 82.4, 0),
  F('Dark chocolate 85%', 100, 'g', 598, 7.8, 45.9, 42.6, 10.9),
];

const DEFAULT_TARGET: Omit<NutritionTarget, 'id'> = {
  name: 'Maintenance',
  macros: { kcal: 2600, protein: 190, carbs: 270, fat: 80, fiber: 35 },
  active: true,
};

/**
 * Populates the reference catalogues exactly once. Safe to call on every boot:
 * it no-ops as soon as `seededAt` is recorded in settings.
 */
export async function seedIfEmpty(): Promise<void> {
  const settings = await getSettings();
  if (settings.seededAt) return;

  await db.transaction(
    'rw',
    [db.compounds, db.exercises, db.foods, db.targets],
    async () => {
      if ((await db.compounds.count()) === 0) {
        await db.compounds.bulkAdd(COMPOUND_SEED.map((c) => ({ ...c, id: uid() })));
      }
      if ((await db.exercises.count()) === 0) {
        await db.exercises.bulkAdd(EXERCISE_SEED.map((e) => ({ ...e, id: uid() })));
      }
      if ((await db.foods.count()) === 0) {
        await db.foods.bulkAdd(FOOD_SEED.map((f) => ({ ...f, id: uid() })));
      }
      if ((await db.targets.count()) === 0) {
        await db.targets.add({ ...DEFAULT_TARGET, id: uid() });
      }
    },
  );

  await saveSettings({ ...DEFAULT_SETTINGS, ...settings, seededAt: new Date().toISOString() });
}
