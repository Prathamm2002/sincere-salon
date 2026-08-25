/**
 * GET  /api/admin      dashboard data (stats, bookings, reviews, messages)
 * POST /api/admin      { action, id, ... } state changes
 *
 * Read and write share one function deliberately. Vercel's Hobby plan caps a
 * non-framework deployment at 12 functions; folding the admin actions together
 * keeps the whole project at 8 and leaves room to grow.
 */

import { ENV, requireEnv } from '../../lib/config.js';
import { query } from '../../lib/db.js';
import { verifyToken, SESSION_COOKIE, hasCsrfHeader } from '../../lib/auth.js';
import { ok, fail, readJson, parseCookies, serverError } from '../../lib/http.js';

/** Returns the session payload, or null after having sent a 401. */
function requireAuth(req, res) {
  const missing = requireEnv('sessionSecret');
  if (missing) { fail(res, missing, {}, 500); return null; }

  const token = parseCookies(req)[SESSION_COOKIE];
  const session = verifyToken(token, ENV.sessionSecret);

  if (!session) {
    fail(res, 'Please sign in again.', {}, 401);
    return null;
  }
  return session;
}

export default async function handler(req, res) {
  try {
    const session = requireAuth(req, res);
    if (!session) return;

    if (req.method === 'GET') return await dashboard(res);
    if (req.method === 'POST') return await act(req, res);
    return fail(res, 'Method not allowed.', {}, 405);
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}

async function dashboard(res) {
  /*
   * Five headline numbers in one round trip. Separate queries would each pay
   * the full latency to the database region; a single statement pays it once.
   */
  const [stats] = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM bookings
        WHERE booking_date = CURRENT_DATE AND status <> 'cancelled')          AS today,
      (SELECT COUNT(*)::int FROM bookings WHERE status = 'pending')           AS pending,
      (SELECT COALESCE(SUM(total_amount),0)::float8 FROM bookings
        WHERE status = 'completed'
          AND booking_date >= CURRENT_DATE - INTERVAL '30 days')              AS revenue,
      (SELECT COUNT(*)::int FROM reviews WHERE is_approved = FALSE)           AS to_review,
      (SELECT COUNT(*)::int FROM contact_messages WHERE is_read = FALSE)      AS unread`);

  // Line items rolled into one string so the listing stays a single query
  // rather than one per booking.
  const bookings = await query(`
    SELECT b.id, b.reference, b.customer_name, b.phone,
           b.booking_date::text AS booking_date,
           to_char(b.booking_time,'HH24:MI') AS booking_time,
           b.total_amount::float8 AS total_amount, b.status,
           string_agg(i.service_name, ', ' ORDER BY i.id) AS services
      FROM bookings b
 LEFT JOIN booking_items i ON i.booking_id = b.id
     WHERE b.booking_date >= CURRENT_DATE - INTERVAL '2 days'
  GROUP BY b.id
  ORDER BY b.booking_date ASC, b.booking_time ASC
     LIMIT 100`);

  const reviews = await query(`
    SELECT id, author_name, rating, body, source, is_approved, is_featured,
           reviewed_on::text AS reviewed_on
      FROM reviews
  ORDER BY is_approved ASC, created_at DESC
     LIMIT 100`);

  const messages = await query(`
    SELECT id, name, phone, email, message, is_read,
           to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'DD Mon, HH12:MI AM') AS received
      FROM contact_messages
  ORDER BY is_read ASC, created_at DESC
     LIMIT 100`);

  ok(res, { stats, bookings, reviews, messages });
}

async function act(req, res) {
  // Second, independent CSRF condition on top of the SameSite=Strict cookie.
  if (!hasCsrfHeader(req)) {
    return fail(res, 'Invalid request.', {}, 403);
  }

  const body = await readJson(req);
  const action = String(body.action || '');
  const id = parseInt(body.id, 10);

  if (!Number.isInteger(id) || id < 1) {
    return fail(res, 'Invalid record.', {}, 422);
  }

  switch (action) {
    case 'booking_status': {
      const status = String(body.status || '');
      // Whitelist — never let request input reach a CHECK-constrained column
      // unvalidated, or a typo becomes a 500 instead of a 422.
      if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
        return fail(res, 'Unknown status.', {}, 422);
      }
      await query('UPDATE bookings SET status = $1 WHERE id = $2', [status, id]);
      break;
    }
    case 'review_approve':
      await query('UPDATE reviews SET is_approved = TRUE WHERE id = $1', [id]);
      break;

    case 'review_feature':
      // Toggle rather than set, so one button does both jobs.
      await query('UPDATE reviews SET is_featured = NOT is_featured WHERE id = $1', [id]);
      break;

    case 'review_delete':
      await query('DELETE FROM reviews WHERE id = $1', [id]);
      break;

    case 'message_read':
      await query('UPDATE contact_messages SET is_read = TRUE WHERE id = $1', [id]);
      break;

    default:
      return fail(res, 'Unknown action.', {}, 422);
  }

  ok(res, {}, 'Saved.');
}
