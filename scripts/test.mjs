// Bundles the TypeScript test files with esbuild and runs them on node's
// built-in test runner. Keeps the toolchain to dependencies we already have.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '.test-build');

const entries = [
  ...globSync('src/**/__tests__/*.test.ts', { cwd: ROOT }),
  ...globSync('server/__tests__/*.test.mjs', { cwd: ROOT }),
].map((f) => resolve(ROOT, f));
if (entries.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: entries,
  outdir: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  external: ['node:*'],
  // node:sqlite is resolved at runtime, not bundled.
  alias: { '@': resolve(ROOT, 'src') },
  logLevel: 'warning',
});

// esbuild nests output under the common ancestor of the entry points, so the
// glob must recurse.
const built = globSync('**/*.test.{js,mjs}', { cwd: OUT }).map((f) => resolve(OUT, f));
if (built.length === 0) {
  console.error('No compiled tests found in', OUT);
  process.exit(1);
}
const result = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' });
process.exit(result.status ?? 1);
