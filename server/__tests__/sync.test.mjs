import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, mkdtempSync } from 'node:fs';
import { applyChange, changesSince, counts, createClock, openDatabase, pruneTombstones } from '../db.mjs';

let db;
let clock;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'bodyview-'));
  db = openDatabase(join(dir, 'test.db'));
  clock = createClock(db);
});

const record = (id, updatedAt, value) => ({
  id,
  updatedAt,
  data: { metric: 'weight', date: '2026-01-01', values: { value } },
});

describe('applyChange', () => {
  it('stores a new record', () => {
    assert.equal(applyChange(db, 'metrics', record('a', 100, 82), clock()), true);
    assert.equal(counts(db).metrics, 1);
  });

  it('lets a newer device edit win', () => {
    applyChange(db, 'metrics', record('a', 100, 82), clock());
    assert.equal(applyChange(db, 'metrics', record('a', 200, 81), clock()), true);
    assert.equal(changesSince(db, 'metrics', 0, 10)[0].data.values.value, 81);
  });

  it('rejects an older device edit', () => {
    applyChange(db, 'metrics', record('a', 200, 81), clock());
    assert.equal(applyChange(db, 'metrics', record('a', 100, 82), clock()), false);
    assert.equal(changesSince(db, 'metrics', 0, 10)[0].data.values.value, 81);
  });

  it('treats a replayed push as a no-op', () => {
    applyChange(db, 'metrics', record('a', 100, 82), clock());
    assert.equal(applyChange(db, 'metrics', record('a', 100, 82), clock()), false);
  });

  it('stores a deletion as a tombstone rather than dropping the row', () => {
    applyChange(db, 'metrics', record('a', 100, 82), clock());
    applyChange(db, 'metrics', { id: 'a', updatedAt: 200, deleted: true }, clock());
    const rows = changesSince(db, 'metrics', 0, 10);
    assert.equal(rows.length, 1, 'the tombstone is still there to be synced');
    assert.equal(rows[0].deleted, true);
    assert.equal(rows[0].data, null);
    assert.equal(counts(db).metrics, 0, 'but it does not count as live data');
  });

  it('lets a later edit resurrect a deleted record', () => {
    applyChange(db, 'metrics', { id: 'a', updatedAt: 100, deleted: true }, clock());
    assert.equal(applyChange(db, 'metrics', record('a', 200, 80), clock()), true);
    assert.equal(counts(db).metrics, 1);
  });
});

describe('changesSince', () => {
  it('returns only rows past the cursor', () => {
    applyChange(db, 'metrics', record('a', 100, 82), clock());
    const cursor = changesSince(db, 'metrics', 0, 10)[0].serverUpdatedAt;
    assert.equal(changesSince(db, 'metrics', cursor, 10).length, 0);

    applyChange(db, 'metrics', record('b', 300, 80), clock());
    const next = changesSince(db, 'metrics', cursor, 10);
    assert.equal(next.length, 1);
    assert.equal(next[0].id, 'b');
  });

  it('orders oldest first so a paged pull cannot skip a row', () => {
    for (let i = 0; i < 5; i++) applyChange(db, 'metrics', record(`r${i}`, 100 + i, 80), clock());
    const rows = changesSince(db, 'metrics', 0, 10);
    const cursors = rows.map((r) => r.serverUpdatedAt);
    assert.deepEqual(cursors, [...cursors].sort((a, b) => a - b));
  });
});

describe('createClock', () => {
  it('never repeats a value, even within one millisecond', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(clock());
    assert.equal(seen.size, 500);
  });

  it('resumes above the highest stored value', () => {
    applyChange(db, 'metrics', record('a', 1, 80), 99_000_000_000_000);
    const resumed = createClock(db);
    assert.ok(resumed() > 99_000_000_000_000);
  });
});

describe('pruneTombstones', () => {
  it('drops only tombstones older than the cutoff', () => {
    applyChange(db, 'metrics', record('keep', 100, 80), clock());
    applyChange(db, 'metrics', { id: 'old', updatedAt: 100, deleted: true }, 1000);
    applyChange(db, 'metrics', { id: 'new', updatedAt: 100, deleted: true }, clock());

    pruneTombstones(db, 60_000);
    const ids = changesSince(db, 'metrics', 0, 10).map((r) => r.id);
    assert.ok(ids.includes('keep'));
    assert.ok(ids.includes('new'));
    assert.ok(!ids.includes('old'));
  });
});
