import Dexie, { type EntityTable } from 'dexie';
import type {
  Compound,
  Cycle,
  DoseLog,
  Exercise,
  Food,
  InventoryItem,
  MealEntry,
  MealPlan,
  MetricEntry,
  NutritionTarget,
  Protocol,
  SetLog,
  Settings,
  Workout,
  WorkoutTemplate,
} from './types';
import { DEFAULT_DASHBOARD_METRICS } from './metrics';

/**
 * BodyView keeps everything in IndexedDB so the app works offline and no
 * health data leaves the device. Compound indexes are declared for the
 * lookups the UI actually performs (mostly "by date" and "by parent id").
 */
class BodyViewDB extends Dexie {
  metrics!: EntityTable<MetricEntry, 'id'>;
  compounds!: EntityTable<Compound, 'id'>;
  protocols!: EntityTable<Protocol, 'id'>;
  cycles!: EntityTable<Cycle, 'id'>;
  doses!: EntityTable<DoseLog, 'id'>;
  inventory!: EntityTable<InventoryItem, 'id'>;
  foods!: EntityTable<Food, 'id'>;
  meals!: EntityTable<MealEntry, 'id'>;
  mealPlans!: EntityTable<MealPlan, 'id'>;
  targets!: EntityTable<NutritionTarget, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  templates!: EntityTable<WorkoutTemplate, 'id'>;
  workouts!: EntityTable<Workout, 'id'>;
  sets!: EntityTable<SetLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor() {
    super('bodyview');
    this.version(1).stores({
      metrics: 'id, metric, date, [metric+date], recordedAt',
      compounds: 'id, name, category, archived',
      protocols: 'id, compoundId, active, startDate, cycleId',
      cycles: 'id, startDate',
      doses: 'id, date, compoundId, protocolId, [compoundId+date], [protocolId+date]',
      inventory: 'id, compoundId, expiresOn',
      foods: 'id, name, favorite, archived',
      meals: 'id, date, slot, [date+slot], foodId',
      mealPlans: 'id, name',
      targets: 'id, active',
      exercises: 'id, name, muscle, primary, archived',
      templates: 'id, name',
      workouts: 'id, date, templateId',
      sets: 'id, workoutId, exerciseId, [workoutId+order], [exerciseId+id]',
      settings: 'id',
    });
  }
}

export const db = new BodyViewDB();

export const DEFAULT_SETTINGS: Settings = {
  id: 'settings',
  theme: 'auto',
  weightUnit: 'kg',
  lengthUnit: 'cm',
  weekStartsOn: 1,
  dashboardMetrics: DEFAULT_DASHBOARD_METRICS,
};

export async function getSettings(): Promise<Settings> {
  const stored = await db.settings.get('settings');
  return stored ? { ...DEFAULT_SETTINGS, ...stored } : DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: 'settings' });
}

/** Short, sortable, collision-resistant id. */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Wipes every table. Used by Settings → "Erase all data". */
export async function eraseAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });
}
