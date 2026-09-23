/**
 * SQLite storage for BodyView.
 *
 * Uses Node's built-in `node:sqlite`, so the server still has no dependencies.
 *
 * Every collection is stored as `(id, updated_at, client_updated_at, deleted,
 * data)` where `data` is the record JSON. That keeps the schema small and the
 * sync logic uniform; the SQL views at the bottom flatten the JSON into real
 * columns so the database is still pleasant to query by hand.
 *
 * Two clocks are tracked on purpose:
 *   `updated_at`        — assigned by this server, strictly increasing. It is
 *                         the sync cursor, so a client pulling "everything
 *                         since N" can never miss a write to a device clock.
 *   `client_updated_at` — the writing device's clock. Conflicts between two
 *                         devices are resolved last-write-wins on this, which
 *                         reflects the order the user actually made the edits.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Created when the database is opened, so a fresh install has every table the
 * current app uses. It is a starting point, not the whole truth: a client that
 * syncs a collection this list has never heard of gets the table made for it on
 * the spot (see {@link ensureCollection}), because the alternative is a server
 * that has to be restarted every time the app grows a feature.
 */
export const COLLECTIONS = [
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
  'plans',
  'workouts',
  'sets',
  'settings',
];

/**
 * Collection names are interpolated into SQL — they cannot be bound as
 * parameters — so what counts as a name is defined narrowly and checked here
 * rather than trusted from the request body.
 */
const COLLECTION_NAME = /^[a-z][A-Za-z0-9]{0,31}$/;

export const isCollection = (name) => typeof name === 'string' && COLLECTION_NAME.test(name);

const DDL = (name) => [
  `CREATE TABLE IF NOT EXISTS "${name}" (
     id                TEXT PRIMARY KEY,
     updated_at        INTEGER NOT NULL,
     client_updated_at INTEGER NOT NULL,
     deleted           INTEGER NOT NULL DEFAULT 0,
     data              TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "${name}_updated_at" ON "${name}" (updated_at)`,
];

/**
 * Makes sure a collection's table exists, creating it if this is the first the
 * server has heard of it. Idempotent, and cheap enough to call on every push.
 */
export function ensureCollection(db, name) {
  if (!isCollection(name)) return false;
  for (const sql of DDL(name)) db.exec(sql);
  return true;
}

/**
 * Every collection table in the database — the seeded ones plus any a client
 * has introduced since. Bookkeeping tables (`_meta`) and SQLite's own are not
 * collections and stay out.
 */
export function collections(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE '\\_%' ESCAPE '\\'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

export function openDatabase(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);

  // WAL keeps reads working while a sync writes, and survives power loss.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');

  for (const name of COLLECTIONS) ensureCollection(db, name);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  createViews(db);
  return db;
}

/**
 * Readable views over the JSON, so the database can be explored with plain SQL:
 *   sqlite3 bodyview.db "SELECT * FROM v_weight ORDER BY date DESC LIMIT 10;"
 */
function createViews(db) {
  const views = {
    v_metrics: `
      SELECT id,
             json_extract(data, '$.metric')     AS metric,
             json_extract(data, '$.date')       AS date,
             json_extract(data, '$.recordedAt') AS recorded_at,
             json_extract(data, '$.values')     AS values_json,
             json_extract(data, '$.note')       AS note
      FROM metrics WHERE deleted = 0`,

    v_weight: `
      SELECT id,
             json_extract(data, '$.date')           AS date,
             json_extract(data, '$.values.value')   AS kg,
             json_extract(data, '$.note')           AS note
      FROM metrics
      WHERE deleted = 0 AND json_extract(data, '$.metric') = 'weight'`,

    v_blood_pressure: `
      SELECT id,
             json_extract(data, '$.date')               AS date,
             json_extract(data, '$.values.systolic')    AS systolic,
             json_extract(data, '$.values.diastolic')   AS diastolic
      FROM metrics
      WHERE deleted = 0 AND json_extract(data, '$.metric') = 'bloodPressure'`,

    v_doses: `
      SELECT d.id,
             json_extract(d.data, '$.date')    AS date,
             json_extract(c.data, '$.name')    AS compound,
             json_extract(d.data, '$.dose')    AS dose,
             json_extract(d.data, '$.unit')    AS unit,
             json_extract(d.data, '$.skipped') AS skipped,
             json_extract(d.data, '$.takenAt') AS taken_at
      FROM doses d
      LEFT JOIN compounds c ON c.id = json_extract(d.data, '$.compoundId')
      WHERE d.deleted = 0`,

    v_protocols: `
      SELECT p.id,
             json_extract(c.data, '$.name')      AS compound,
             json_extract(p.data, '$.dose')      AS dose,
             json_extract(p.data, '$.unit')      AS unit,
             json_extract(p.data, '$.startDate') AS start_date,
             json_extract(p.data, '$.endDate')   AS end_date,
             json_extract(p.data, '$.active')    AS active,
             json_extract(p.data, '$.schedule')  AS schedule_json
      FROM protocols p
      LEFT JOIN compounds c ON c.id = json_extract(p.data, '$.compoundId')
      WHERE p.deleted = 0`,

    v_inventory: `
      SELECT i.id,
             json_extract(c.data, '$.name')        AS compound,
             json_extract(i.data, '$.remaining')   AS remaining,
             json_extract(i.data, '$.initial')     AS initial,
             json_extract(i.data, '$.unit')        AS unit,
             json_extract(i.data, '$.sealedCount') AS sealed,
             json_extract(i.data, '$.expiresOn')   AS expires_on
      FROM inventory i
      LEFT JOIN compounds c ON c.id = json_extract(i.data, '$.compoundId')
      WHERE i.deleted = 0`,

    v_meals: `
      SELECT id,
             json_extract(data, '$.date')            AS date,
             json_extract(data, '$.slot')            AS slot,
             json_extract(data, '$.name')            AS name,
             json_extract(data, '$.servings')        AS servings,
             json_extract(data, '$.macros.kcal')     AS kcal,
             json_extract(data, '$.macros.protein')  AS protein,
             json_extract(data, '$.macros.carbs')    AS carbs,
             json_extract(data, '$.macros.fat')      AS fat
      FROM meals WHERE deleted = 0`,

    v_daily_macros: `
      SELECT json_extract(data, '$.date')                 AS date,
             ROUND(SUM(json_extract(data, '$.macros.kcal')), 0)    AS kcal,
             ROUND(SUM(json_extract(data, '$.macros.protein')), 0) AS protein,
             ROUND(SUM(json_extract(data, '$.macros.carbs')), 0)   AS carbs,
             ROUND(SUM(json_extract(data, '$.macros.fat')), 0)     AS fat
      FROM meals WHERE deleted = 0
      GROUP BY date`,

    v_workouts: `
      SELECT id,
             json_extract(data, '$.date')       AS date,
             json_extract(data, '$.name')       AS name,
             json_extract(data, '$.startedAt')  AS started_at,
             json_extract(data, '$.finishedAt') AS finished_at
      FROM workouts WHERE deleted = 0`,

    v_sets: `
      SELECT s.id,
             json_extract(w.data, '$.date')     AS date,
             json_extract(e.data, '$.name')     AS exercise,
             json_extract(s.data, '$.weight')   AS weight,
             json_extract(s.data, '$.reps')     AS reps,
             json_extract(s.data, '$.rpe')      AS rpe,
             json_extract(s.data, '$.warmup')   AS warmup,
             json_extract(s.data, '$.done')     AS done
      FROM sets s
      LEFT JOIN workouts w  ON w.id = json_extract(s.data, '$.workoutId')
      LEFT JOIN exercises e ON e.id = json_extract(s.data, '$.exerciseId')
      WHERE s.deleted = 0`,
  };

  for (const [name, sql] of Object.entries(views)) {
    db.exec(`DROP VIEW IF EXISTS ${name}`);
    db.exec(`CREATE VIEW ${name} AS ${sql}`);
  }
}

/**
 * Server clock for sync cursors. Strictly increasing even when several writes
 * land in the same millisecond, so `updated_at > since` can never skip a row.
 */
export function createClock(db) {
  let last = 0;
  // Every table, not just the seeded ones: a cursor that started below a
  // dynamic collection's newest row would hand out values a client has already
  // seen, and the rows in between would never be pulled again.
  for (const name of collections(db)) {
    const row = db.prepare(`SELECT MAX(updated_at) AS m FROM "${name}"`).get();
    if (row?.m && row.m > last) last = row.m;
  }
  return () => {
    const now = Date.now();
    last = now > last ? now : last + 1;
    return last;
  };
}

/** Rows in one collection changed since a cursor, oldest first. */
export function changesSince(db, collection, since, limit) {
  return db
    .prepare(
      `SELECT id, updated_at, client_updated_at, deleted, data
       FROM "${collection}" WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`,
    )
    .all(since, limit)
    .map((row) => ({
      id: row.id,
      updatedAt: row.client_updated_at,
      serverUpdatedAt: row.updated_at,
      deleted: row.deleted === 1,
      data: row.deleted === 1 ? null : JSON.parse(row.data),
    }));
}

/**
 * Applies one incoming record, last-write-wins on the device clock.
 * Returns true if it was stored, false if an existing newer row won.
 */
export function applyChange(db, collection, change, now) {
  const incoming = Number(change.updatedAt) || 0;
  const existing = db
    .prepare(`SELECT client_updated_at FROM "${collection}" WHERE id = ?`)
    .get(change.id);

  // Ties go to the existing row, so replaying the same push is a no-op.
  if (existing && Number(existing.client_updated_at) >= incoming) return false;

  db.prepare(
    `INSERT INTO "${collection}" (id, updated_at, client_updated_at, deleted, data)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       client_updated_at = excluded.client_updated_at,
       deleted = excluded.deleted,
       data = excluded.data`,
  ).run(
    change.id,
    now,
    incoming,
    change.deleted ? 1 : 0,
    change.deleted ? '{}' : JSON.stringify(change.data ?? {}),
  );

  return true;
}

export function counts(db) {
  const out = {};
  for (const name of collections(db)) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name}" WHERE deleted = 0`).get();
    out[name] = row?.n ?? 0;
  }
  return out;
}

/** Drops tombstones that every device has certainly seen. */
export function pruneTombstones(db, olderThanMs) {
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const name of collections(db)) {
    const res = db
      .prepare(`DELETE FROM "${name}" WHERE deleted = 1 AND updated_at < ?`)
      .run(cutoff);
    removed += res.changes ?? 0;
  }
  return removed;
}
