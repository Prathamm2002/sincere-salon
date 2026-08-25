#!/usr/bin/env node
/**
 * Create the schema and load the seed data.
 *
 *   npm run db:setup                    schema + seed
 *   npm run db:setup -- --schema-only   schema only
 *
 * Reads DATABASE_URL from the environment, or from a local .env file.
 * Re-running is safe: the schema drops its objects first, and the seed
 * truncates before inserting.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env reader, so this needs no dotenv dependency.
const envPath = path.join(dir, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const { Pool } = await import('@neondatabase/serverless');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const files = process.argv.includes('--schema-only')
  ? ['schema.sql']
  : ['schema.sql', 'seed.sql'];

try {
  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, '..', 'db', file), 'utf8');
    process.stdout.write(`-> ${file} ... `);
    await pool.query(sql);
    console.log('done');
  }

  const { rows } = await pool.query(
    'SELECT (SELECT COUNT(*)::int FROM services) AS services,' +
    '       (SELECT COUNT(*)::int FROM reviews)  AS reviews'
  );

  console.log(`\nDatabase ready: ${rows[0].services} services, ${rows[0].reviews} reviews.`);
} catch (err) {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
} finally {
  await pool.end();
}
