/**
 * GET  /api/reviews?featured=1&limit=6   approved reviews for the carousel
 * POST /api/reviews                      submit one, queued for moderation
 *
 * Submissions are never published straight to the page: they land with
 * is_approved = FALSE and appear only after a manager approves them.
 */

import { BIZ, ENV } from '../lib/config.js';
import { query } from '../lib/db.js';
import { ok, fail, readJson, queryParams, serverError } from '../lib/http.js';
import { cleanText } from '../lib/validate.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return await list(req, res);
    if (req.method === 'POST') return await submit(req, res);
    return fail(res, 'Method not allowed.', {}, 405);
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}

async function list(req, res) {
  const params = queryParams(req);
  const featuredOnly = params.featured === '1';
  const limit = Math.max(1, Math.min(50, Number(params.limit) || 12));

  // limit is bound as a parameter rather than interpolated, even though it has
  // already been clamped to a number — no string ever reaches the SQL text.
  const rows = await query(`
    SELECT id, author_name, rating, body, source,
           reviewed_on::text AS reviewed_on
      FROM reviews
     WHERE is_approved = TRUE
       AND ($1::boolean = FALSE OR is_featured = TRUE)
  ORDER BY is_featured DESC, reviewed_on DESC NULLS LAST, id DESC
     LIMIT $2`, [featuredOnly, limit]);

  ok(res, {
    reviews: rows.map((r) => ({
      id: r.id,
      author: r.author_name,
      rating: r.rating,
      body: r.body,
      source: r.source,
      date: r.reviewed_on,
    })),
    // The headline figures come from the salon's Google listing, not this
    // table — the table holds a curated subset, not all 412 ratings.
    summary: { rating: BIZ.rating, count: BIZ.ratingCount, url: BIZ.mapsUrl },
  });
}

async function submit(req, res) {
  const body = await readJson(req);
  const errors = {};

  const author = cleanText(body.author, 120);
  if (author.length < 2) errors.author = 'Please tell us your name.';

  const rating = parseInt(body.rating, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = 'Pick a rating from 1 to 5 stars.';
  }

  const text = cleanText(body.body, 1000);
  if (text.length < 10) errors.body = 'Tell us a little more — at least 10 characters.';

  if (Object.keys(errors).length) {
    return fail(res, 'Please check the highlighted fields.', errors, 422);
  }

  // Light spam guard: the same name cannot post twice within an hour.
  const recent = await query(`
    SELECT COUNT(*)::int AS n FROM reviews
     WHERE author_name = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [author]);

  if (recent[0].n >= 2) {
    return fail(res, 'Thanks — we already have your recent feedback.', {}, 429);
  }

  await query(`
    INSERT INTO reviews (author_name, rating, body, source, is_approved, reviewed_on)
    VALUES ($1, $2, $3, 'website', FALSE, CURRENT_DATE)`, [author, rating, text]);

  ok(res, {}, 'Thank you! Your review will appear once our team has reviewed it.');
}
