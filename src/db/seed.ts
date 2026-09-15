import { db, DEFAULT_SETTINGS, getSettings, saveSettings } from './db';
import type { Compound, Exercise, Food, NutritionTarget } from './types';

/**
 * First-run catalogues. These are reference lists only — no doses are
 * suggested for compounds; the user enters whatever their own protocol is.
 */

/**
 * Seeded rows get an id derived from their name rather than a random one, so
 * every device generates the *same* id for "BPC-157". Two devices that each
 * seeded themselves before being connected then merge into one catalogue
 * instead of two rival copies of it.
 *
 * User-created records keep random ids; only these built-in lists are derived.
 */
function seedId(kind: string, name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `seed-${kind}-${slug}`;
}

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

  { name: 'Retatrutide', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#fb7185' },
  { name: 'Survodutide', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#f9a8d4' },
  { name: 'Cagrilintide', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#e879f9' },
  { name: 'AOD-9604', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#67e8f9' },
  { name: 'Hexarelin', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#7dd3fc' },
  { name: 'Sermorelin', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#93c5fd' },
  { name: 'MOTS-c', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#5eead4' },
  { name: 'Epitalon', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#34d399' },
  { name: 'Thymosin Alpha-1', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#6ee7b7' },
  { name: 'PT-141 (Bremelanotide)', category: 'peptide', defaultUnit: 'mg', route: 'subcutaneous', color: '#c4b5fd' },
  { name: 'Melanotan II', category: 'peptide', defaultUnit: 'mcg', route: 'subcutaneous', color: '#a5b4fc' },
  { name: 'HGH (Somatropin)', category: 'peptide', defaultUnit: 'iu', route: 'subcutaneous', color: '#818cf8' },

  // Performance compounds
  { name: 'Testosterone Enanthate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#f97316' },
  { name: 'Testosterone Cypionate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fb923c' },
  { name: 'Testosterone Propionate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fdba74' },
  { name: 'Testosterone Undecanoate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fed7aa' },
  { name: 'Sustanon 250', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#f59e0b' },
  { name: 'Primobolan (Methenolone Enanthate)', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#d97706' },
  { name: 'Primobolan Acetate (oral)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#b45309' },
  { name: 'Nandrolone Decanoate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#facc15' },
  { name: 'Nandrolone Phenylpropionate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#fde047' },
  { name: 'Boldenone Undecylenate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#eab308' },
  { name: 'Masteron (Drostanolone Propionate)', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#a3e635' },
  { name: 'Masteron Enanthate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#bef264' },
  { name: 'Trenbolone Acetate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#ef4444' },
  { name: 'Trenbolone Enanthate', category: 'ped', defaultUnit: 'mg', route: 'intramuscular', color: '#f87171' },
  { name: 'Anavar (Oxandrolone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#84cc16' },
  { name: 'Winstrol (Stanozolol)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#65a30d' },
  { name: 'Turinabol', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#4d7c0f' },
  { name: 'Dianabol (Methandienone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#22c55e' },
  { name: 'Anadrol (Oxymetholone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#16a34a' },
  { name: 'Superdrol (Methasterone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#15803d' },
  { name: 'HCG', category: 'ped', defaultUnit: 'iu', route: 'subcutaneous', color: '#4ade80' },

  // SARMs and other research compounds
  { name: 'Ostarine (MK-2866)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#2dd4bf' },
  { name: 'Ligandrol (LGD-4033)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#14b8a6' },
  { name: 'RAD-140 (Testolone)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#0d9488' },
  { name: 'Cardarine (GW-501516)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#0891b2' },
  { name: 'MK-677 (Ibutamoren)', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#06b6d4' },
  { name: 'S-23', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#22d3ee' },
  { name: 'YK-11', category: 'ped', defaultUnit: 'mg', route: 'oral', color: '#a5f3fc' },

  // Ancillaries
  { name: 'Anastrozole', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#94a3b8' },
  { name: 'Exemestane', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#9ca3af' },
  { name: 'Letrozole', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#d4d4d8' },
  { name: 'Tamoxifen', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#a1a1aa' },
  { name: 'Clomiphene (Clomid)', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#e4e4e7' },
  { name: 'Enclomiphene', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#f4f4f5' },
  { name: 'Cabergoline', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#8b5cf6' },
  { name: 'Finasteride', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#c084fc' },
  { name: 'Dutasteride', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#d8b4fe' },
  { name: 'Telmisartan', category: 'ancillary', defaultUnit: 'mg', route: 'oral', color: '#cbd5e1' },
  { name: 'Metformin', category: 'medication', defaultUnit: 'mg', route: 'oral', color: '#60a5fa' },
  { name: 'Levothyroxine (T4)', category: 'medication', defaultUnit: 'mcg', route: 'oral', color: '#38bdf8' },
  { name: 'Liothyronine (T3)', category: 'medication', defaultUnit: 'mcg', route: 'oral', color: '#0ea5e9' },
  { name: 'Tadalafil', category: 'medication', defaultUnit: 'mg', route: 'oral', color: '#fbbf24' },

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
  { name: 'Vitamin B6', category: 'vitamin', defaultDose: 25, defaultUnit: 'mg', route: 'oral', color: '#f9a8d4' },
  { name: 'Folate', category: 'vitamin', defaultDose: 400, defaultUnit: 'mcg', route: 'oral', color: '#86efac' },
  { name: 'Iron', category: 'vitamin', defaultDose: 18, defaultUnit: 'mg', route: 'oral', color: '#b91c1c' },
  { name: 'Iodine', category: 'vitamin', defaultDose: 150, defaultUnit: 'mcg', route: 'oral', color: '#7c3aed' },
  { name: 'Selenium', category: 'vitamin', defaultDose: 200, defaultUnit: 'mcg', route: 'oral', color: '#a8a29e' },
  { name: 'CoQ10', category: 'supplement', defaultDose: 200, defaultUnit: 'mg', route: 'oral', color: '#fcd34d' },
  { name: 'Berberine', category: 'supplement', defaultDose: 500, defaultUnit: 'mg', route: 'oral', color: '#ca8a04' },
  { name: 'NAC', category: 'supplement', defaultDose: 600, defaultUnit: 'mg', route: 'oral', color: '#94a3b8' },
  { name: 'TUDCA', category: 'supplement', defaultDose: 500, defaultUnit: 'mg', route: 'oral', color: '#84cc16' },
  { name: 'Beta-Alanine', category: 'supplement', defaultDose: 3.2, defaultUnit: 'g', route: 'oral', color: '#f472b6' },
  { name: 'Taurine', category: 'supplement', defaultDose: 2, defaultUnit: 'g', route: 'oral', color: '#22d3ee' },
  { name: 'Glycine', category: 'supplement', defaultDose: 3, defaultUnit: 'g', route: 'oral', color: '#e2e8f0' },
  { name: 'Psyllium Husk', category: 'supplement', defaultDose: 5, defaultUnit: 'g', route: 'oral', color: '#a16207' },
  { name: 'Electrolytes', category: 'supplement', defaultDose: 1, defaultUnit: 'g', route: 'oral', color: '#38bdf8' },
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
 * Bumped whenever entries are added to the catalogues above, so existing
 * installs pick them up. See {@link topUpCatalogue}.
 */
export const CATALOGUE_VERSION = 2;

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
      // `bulkPut`, not `bulkAdd`: with derived ids a row that arrived from the
      // server is simply overwritten with identical content rather than
      // colliding.
      if ((await db.compounds.count()) === 0) {
        await db.compounds.bulkPut(
          COMPOUND_SEED.map((c) => ({ ...c, id: seedId('compound', c.name) })),
        );
      }
      if ((await db.exercises.count()) === 0) {
        await db.exercises.bulkPut(
          EXERCISE_SEED.map((e) => ({ ...e, id: seedId('exercise', e.name) })),
        );
      }
      if ((await db.foods.count()) === 0) {
        await db.foods.bulkPut(FOOD_SEED.map((f) => ({ ...f, id: seedId('food', f.name) })));
      }
      if ((await db.targets.count()) === 0) {
        await db.targets.put({ ...DEFAULT_TARGET, id: seedId('target', DEFAULT_TARGET.name) });
      }
    },
  );

  await saveSettings({
    ...DEFAULT_SETTINGS,
    ...settings,
    seededAt: new Date().toISOString(),
    catalogueVersion: CATALOGUE_VERSION,
  });
}

/**
 * Adds catalogue entries introduced since this device was first seeded.
 *
 * Only genuinely missing ids are written, so an entry the user has edited —
 * renamed, recoloured, given a different default — is never overwritten. An
 * entry they deleted does come back once, on the upgrade that adds it; that is
 * the cost of not keeping a tombstone for every built-in row forever.
 */
export async function topUpCatalogue(): Promise<number> {
  const settings = await getSettings();
  if (!settings.seededAt) return 0; // a fresh install seeds in full instead
  if ((settings.catalogueVersion ?? 1) >= CATALOGUE_VERSION) return 0;

  let added = 0;

  await db.transaction('rw', [db.compounds, db.exercises, db.foods], async () => {
    const addMissing = async <T extends { id: string }>(
      table: { bulkGet: (keys: string[]) => Promise<Array<T | undefined>>; bulkAdd: (rows: T[]) => Promise<unknown> },
      rows: T[],
    ) => {
      const existing = await table.bulkGet(rows.map((r) => r.id));
      const fresh = rows.filter((_, i) => existing[i] === undefined);
      if (fresh.length > 0) {
        await table.bulkAdd(fresh);
        added += fresh.length;
      }
    };

    await addMissing(db.compounds, COMPOUND_SEED.map((c) => ({ ...c, id: seedId('compound', c.name) })));
    await addMissing(db.exercises, EXERCISE_SEED.map((e) => ({ ...e, id: seedId('exercise', e.name) })));
    await addMissing(db.foods, FOOD_SEED.map((f) => ({ ...f, id: seedId('food', f.name) })));
  });

  await saveSettings({ catalogueVersion: CATALOGUE_VERSION });
  return added;
}
