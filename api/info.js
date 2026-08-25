/**
 * GET /api/info
 *
 * Business details plus live open/closed state. The frontend calls this once on
 * load so the address, phone and hours live in exactly one place (lib/config.js)
 * rather than being duplicated in the HTML.
 *
 * Touches no database, so it stays up even if Neon is unreachable.
 */

import { BIZ, HOURS, RULES, ENV } from '../lib/config.js';
import { salonNow, isOpenNow, nextChange, formatTime12 } from '../lib/time.js';
import { ok, methodIs, serverError } from '../lib/http.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  try {
    const now = salonNow();

    const hours = Object.entries(HOURS).map(([day, span]) => ({
      day,
      closed: !span,
      label: span ? `${formatTime12(span[0])} – ${formatTime12(span[1])}` : 'Closed',
      isToday: day === now.weekday,
    }));

    ok(res, {
      name: BIZ.name,
      nameHindi: BIZ.nameHindi,
      phone: BIZ.phone,
      phoneUi: BIZ.phoneUi,
      address: BIZ.address,
      mapsUrl: BIZ.mapsUrl,
      coords: { lat: BIZ.lat, lng: BIZ.lng },
      rating: BIZ.rating,
      ratingCount: BIZ.ratingCount,
      isOpenNow: isOpenNow(),
      nextChange: nextChange(),
      hours,
      maxAdvanceDays: RULES.maxAdvanceDays,
      // Today's date *in the salon's timezone*. The browser's clock cannot be
      // trusted for this: a visitor abroad would otherwise be offered a "Today"
      // the server has already moved past, and every slot request would fail.
      today: now.date,
    });
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
