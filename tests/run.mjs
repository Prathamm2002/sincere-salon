/** Runs every test suite in sequence. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;

for (const suite of ['unit.test.mjs', 'api.test.mjs']) {
  console.log(`\n--- ${suite} ---`);
  const r = spawnSync(process.execPath, [path.join(dir, suite)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

process.exit(failed ? 1 : 0);
