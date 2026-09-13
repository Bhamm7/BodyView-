import { db, getSettings } from '@/db/db';
import { nowISO, today } from './date';

const FORMAT = 'bodyview-backup';
const VERSION = 1;

export interface Backup {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

/** Every table, as a single JSON document the user can keep or move devices with. */
export async function exportBackup(): Promise<Backup> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) {
      tables[table.name] = await table.toArray();
    }
  });
  return { format: FORMAT, version: VERSION, exportedAt: nowISO(), tables };
}

export async function downloadBackup(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bodyview-${today()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  imported: Record<string, number>;
  skipped: string[];
}

/**
 * Restores a backup. `mode: 'replace'` wipes each table first; `'merge'` keeps
 * existing rows and overwrites only those with matching ids.
 */
export async function importBackup(
  raw: unknown,
  mode: 'replace' | 'merge' = 'replace',
): Promise<ImportResult> {
  if (!isBackup(raw)) throw new Error('That file is not a BodyView backup.');
  if (raw.version > VERSION) {
    throw new Error('This backup was made by a newer version of BodyView.');
  }

  const imported: Record<string, number> = {};
  const skipped: string[] = [];
  const known = new Map(db.tables.map((t) => [t.name, t]));

  await db.transaction('rw', db.tables, async () => {
    for (const [name, rows] of Object.entries(raw.tables)) {
      const table = known.get(name);
      if (!table) {
        skipped.push(name);
        continue;
      }
      if (mode === 'replace') await table.clear();
      if (Array.isArray(rows) && rows.length > 0) {
        await table.bulkPut(rows as never[]);
      }
      imported[name] = Array.isArray(rows) ? rows.length : 0;
    }
  });

  return { imported, skipped };
}

function isBackup(value: unknown): value is Backup {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<Backup>;
  return v.format === FORMAT && typeof v.version === 'number' && typeof v.tables === 'object';
}

/** CSV of one table, for spreadsheet users. */
export async function exportCsv(tableName: string): Promise<string> {
  const table = db.tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`Unknown table: ${tableName}`);
  const rows = await table.toArray();
  if (rows.length === 0) return '';

  const columns = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
  const escape = (v: unknown): string => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => escape((r as Record<string, unknown>)[c])).join(',')),
  ].join('\n');
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}

/** Asks the browser to keep our IndexedDB out of automatic eviction. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted?.()) return true;
  return navigator.storage.persist();
}

export { getSettings };
