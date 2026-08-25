/**
 * ---------------------------------------------------------------------------
 *  Database access
 * ---------------------------------------------------------------------------
 *  Uses @neondatabase/serverless, whose Pool is API-compatible with node-postgres
 *  but connects over a WebSocket. That matters in a serverless runtime: a normal
 *  TCP pool would leak a connection per invocation and exhaust the database's
 *  connection limit under any real traffic.
 *
 *  A note on types. Drivers disagree about how to hand back NUMERIC, DATE and
 *  TIME, and the disagreements are quiet ones — a DATE arriving as a JS Date
 *  gets silently reinterpreted in the server's timezone. Rather than depend on
 *  driver behaviour, every query in this project casts those columns in SQL
 *  (`booking_date::text`, `price::float8`, `to_char(booking_time,'HH24:MI')`).
 *  What comes back is then the same shape no matter what is underneath.
 * ---------------------------------------------------------------------------
 */

import { ENV } from './config.js';

let pool = null;
let injected = null;   // Test seam, see __setClient below

/**
 * Swap in a different pg-compatible client. Used by the local test harness to
 * run these same handlers against a plain Postgres instance; never called in
 * production code.
 */
export function __setClient(client) {
  injected = client;
}

async function getPool() {
  if (injected) return injected;

  if (!pool) {
    if (!ENV.databaseUrl) {
      throw new Error('DATABASE_URL is not set.');
    }
    // Imported lazily so that endpoints which never touch the database
    // (and the test harness) do not pay for loading the driver.
    const { Pool } = await import('@neondatabase/serverless');
    pool = new Pool({ connectionString: ENV.databaseUrl });
  }
  return pool;
}

/** Run a parameterised statement and return the rows. */
export async function query(text, params = []) {
  const p = await getPool();
  const result = await p.query(text, params);
  return result.rows;
}

/** First row, or null. */
export async function one(text, params = []) {
  const rows = await query(text, params);
  return rows.length ? rows[0] : null;
}

/** First column of the first row — for COUNT(*) and similar. */
export async function scalar(text, params = []) {
  const row = await one(text, params);
  return row ? Object.values(row)[0] : null;
}

/**
 * Run a callback inside a transaction, committing on return and rolling back
 * on throw. The callback receives a client; every statement it issues must go
 * through that client to be part of the transaction.
 */
export async function withTransaction(fn) {
  const p = await getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
