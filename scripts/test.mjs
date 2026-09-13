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

const entries = globSync('src/**/__tests__/*.test.ts', { cwd: ROOT }).map((f) => resolve(ROOT, f));
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
  alias: { '@': resolve(ROOT, 'src') },
  logLevel: 'warning',
});

const built = globSync('*.test.js', { cwd: OUT }).map((f) => resolve(OUT, f));
const result = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' });
process.exit(result.status ?? 1);
