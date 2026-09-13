import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Seeded catalogue rows derive their id from their name so that two devices
 * seeding independently produce the same ids and merge into one catalogue.
 * That only holds while no two names slugify to the same string — a collision
 * would silently drop one of them, so it is checked here.
 */
const source = readFileSync(resolve(process.cwd(), 'src/db/seed.ts'), 'utf8');

function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function namesMatching(pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((m) => m[1]);
}

const CATALOGUES: Array<[string, RegExp, number]> = [
  ['compounds', /\{ name: '([^']+)', category:/g, 20],
  ['exercises', /EX\('([^']+)'/g, 40],
  ['foods', /F\('([^']+)'/g, 25],
];

describe('seed catalogues', () => {
  for (const [label, pattern, minimum] of CATALOGUES) {
    it(`${label}: every name produces a distinct id`, () => {
      const names = namesMatching(pattern);
      assert.ok(
        names.length >= minimum,
        `expected at least ${minimum} ${label}, found ${names.length}`,
      );

      const byId = new Map<string, string>();
      for (const name of names) {
        const id = slug(name);
        const existing = byId.get(id);
        assert.equal(
          existing,
          undefined,
          `"${name}" and "${existing}" both slugify to "${id}" — one would be lost`,
        );
        byId.set(id, name);
      }
      assert.equal(byId.size, names.length);
    });

    it(`${label}: no name slugifies to an empty id`, () => {
      for (const name of namesMatching(pattern)) {
        assert.notEqual(slug(name), '', `"${name}" produces an empty id`);
      }
    });
  }
});
