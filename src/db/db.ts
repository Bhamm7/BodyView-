import Dexie, { type EntityTable, type Table } from 'dexie';
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
import type { SyncState, Tombstone } from './sync-types';

/**
 * Collections that take part in sync, in the order they are pushed. Adding a
 * table here is all that is needed for it to sync — it must match the
 * COLLECTIONS list in server/db.mjs.
 */
export const SYNCED_COLLECTIONS = [
  'metrics',
  'compounds',
  'protocols',
  'cycles',
  'doses',
  'inventory',
  'foods',
  'meals',
  'mealPlans',
  'targets',
  'exercises',
  'templates',
  'workouts',
  'sets',
  'settings',
] as const;

export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

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

  /** Local-only: records deleted here, waiting to be pushed to the server. */
  _tombstones!: EntityTable<Tombstone, 'key'>;
  /** Local-only: this device's sync configuration and cursors. */
  _sync!: EntityTable<SyncState, 'id'>;

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

    // v2 adds sync: an `updatedAt` index on every synced table so "what changed
    // since" is an index scan, plus two local-only tables that never leave the
    // device. Existing rows are backfilled in the upgrade below.
    this.version(2)
      .stores({
        metrics: 'id, metric, date, [metric+date], recordedAt, updatedAt',
        compounds: 'id, name, category, archived, updatedAt',
        protocols: 'id, compoundId, active, startDate, cycleId, updatedAt',
        cycles: 'id, startDate, updatedAt',
        doses:
          'id, date, compoundId, protocolId, [compoundId+date], [protocolId+date], updatedAt',
        inventory: 'id, compoundId, expiresOn, updatedAt',
        foods: 'id, name, favorite, archived, updatedAt',
        meals: 'id, date, slot, [date+slot], foodId, updatedAt',
        mealPlans: 'id, name, updatedAt',
        targets: 'id, active, updatedAt',
        exercises: 'id, name, muscle, primary, archived, updatedAt',
        templates: 'id, name, updatedAt',
        workouts: 'id, date, templateId, updatedAt',
        sets: 'id, workoutId, exerciseId, [workoutId+order], [exerciseId+id], updatedAt',
        settings: 'id, updatedAt',
        _tombstones: 'key, table, updatedAt',
        _sync: 'id',
      })
      .upgrade(async (tx) => {
        // Everything that already exists is stamped once so the first sync
        // uploads it rather than silently ignoring it.
        const stamp = Date.now();
        for (const name of SYNCED_COLLECTIONS) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: { updatedAt?: number }) => {
              if (row.updatedAt == null) row.updatedAt = stamp;
            });
        }
      });

    this.installChangeTracking();
  }

  /**
   * Stamps `updatedAt` on every local write so the sync engine can tell what
   * has changed.
   *
   * An `updatedAt` already present on the incoming value is respected rather
   * than overwritten — that is how records arriving from the server keep the
   * timestamp of the device that actually made the edit, instead of looking
   * like a fresh local change and bouncing straight back up.
   *
   * The corollary: local writes must pass values built fresh, never a record
   * read back from the database with its old timestamp still attached. Use
   * `touch()` if you ever need to re-put a record you just read.
   */
  private installChangeTracking() {
    for (const name of SYNCED_COLLECTIONS) {
      const table = this.table(name) as Table<Record<string, unknown>, string>;

      table.hook('creating', (_primKey, obj) => {
        if (obj.updatedAt != null) return;
        obj.updatedAt = Date.now();
        queueMicrotask(notifyLocalChange);
      });

      table.hook('updating', (mods) => {
        const changes = mods as Record<string, unknown>;
        if ('updatedAt' in changes) return;
        queueMicrotask(notifyLocalChange);
        return { updatedAt: Date.now() };
      });
    }
  }
}

export const db = new BodyViewDB();

/**
 * Notified whenever this device makes a change of its own. Records arriving
 * from the server carry their own `updatedAt` and so do not fire this, which
 * is what stops a sync from triggering another sync.
 */
const localChangeListeners = new Set<() => void>();

export function onLocalChange(listener: () => void): () => void {
  localChangeListeners.add(listener);
  return () => localChangeListeners.delete(listener);
}

function notifyLocalChange(): void {
  for (const listener of localChangeListeners) {
    try {
      listener();
    } catch (err) {
      console.error('local change listener failed', err);
    }
  }
}

/** Re-put a record you read from the database, as a genuine local change. */
export function touch<T extends { updatedAt?: number }>(record: T): T {
  return { ...record, updatedAt: Date.now() };
}

/**
 * Deletes a record and leaves a tombstone, so the deletion reaches the other
 * devices instead of the record simply reappearing on the next sync.
 */
export async function removeRecord(collection: SyncedCollection, id: string): Promise<void> {
  await db.transaction('rw', [db.table(collection), db._tombstones], async () => {
    await db.table(collection).delete(id);
    await db._tombstones.put({
      key: `${collection}:${id}`,
      table: collection,
      id,
      updatedAt: Date.now(),
    });
  });
  notifyLocalChange();
}

/** Bulk form of {@link removeRecord}. */
export async function removeRecords(collection: SyncedCollection, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const updatedAt = Date.now();
  await db.transaction('rw', [db.table(collection), db._tombstones], async () => {
    await db.table(collection).bulkDelete(ids);
    await db._tombstones.bulkPut(
      ids.map((id) => ({ key: `${collection}:${id}`, table: collection, id, updatedAt })),
    );
  });
  notifyLocalChange();
}

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

/**
 * Wipes every record. Sync configuration is deliberately kept, so the user is
 * not silently disconnected — Settings warns that a connected server will push
 * the data back on the next sync.
 */
export async function eraseAll(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(
      db.tables.filter((t) => t.name !== '_sync').map((t) => t.clear()),
    );
  });
}

/** The data tables, excluding local-only sync bookkeeping. */
export function dataTables() {
  return db.tables.filter((t) => !t.name.startsWith('_'));
}
