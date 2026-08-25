/**
 * GET /api/services
 *
 * The active price menu, grouped by category and shaped so the frontend can
 * render it without further work.
 */

import { ENV } from '../lib/config.js';
import { query } from '../lib/db.js';
import { ok, methodIs, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  try {
    /*
     * One JOIN rather than an N+1 loop: fetch every active service with its
     * category attached and group in JS. price is cast to float8 so it arrives
     * as a number instead of the string Postgres NUMERIC would otherwise give.
     */
    const rows = await query(`
      SELECT c.slug        AS category_slug,
             c.name        AS category_name,
             c.icon        AS category_icon,
             s.id, s.name, s.description,
             s.price::float8 AS price,
             s.duration_min, s.is_signature
        FROM services s
        JOIN service_categories c ON c.id = s.category_id
       WHERE s.is_active = TRUE
    ORDER BY c.sort_order, s.sort_order`);

    const byCategory = new Map();

    for (const row of rows) {
      if (!byCategory.has(row.category_slug)) {
        byCategory.set(row.category_slug, {
          slug: row.category_slug,
          name: row.category_name,
          icon: row.category_icon,
          services: [],
        });
      }
      byCategory.get(row.category_slug).services.push({
        id: row.id,
        name: row.name,
        description: row.description,
        price: row.price,
        duration: row.duration_min,
        signature: row.is_signature,
      });
    }

    ok(res, { categories: [...byCategory.values()] });
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
