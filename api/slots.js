/**
 * GET /api/slots?date=YYYY-MM-DD&duration=40
 *
 * Bookable times for a date. Slots already at chair capacity are returned
 * marked unavailable rather than omitted, so the visitor can see that 6:00 pm
 * exists and is simply full.
 */

import { RULES, ENV } from '../lib/config.js';
import { query } from '../lib/db.js';
import { ok, fail, methodIs, queryParams, serverError } from '../lib/http.js';
import {
  isValidDate, generateSlots, hoursFor, salonToday, addDays, formatTime12,
} from '../lib/time.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'GET')) return;

  try {
    const params = queryParams(req);
    const date = String(params.date || '');

    // Clamp the duration: it comes from the client and only ever narrows the
    // slot list, but an absurd value should not reach the maths.
    const duration = Math.max(
      RULES.slotIntervalMin,
      Math.min(240, Number(params.duration) || RULES.slotIntervalMin)
    );

    if (!isValidDate(date)) {
      return fail(res, 'Please choose a valid date.', { date: 'Invalid date format.' });
    }

    const today = salonToday();
    if (date < today) {
      return fail(res, 'That date has already passed.', { date: 'Pick today or a future date.' });
    }
    if (date > addDays(today, RULES.maxAdvanceDays)) {
      return fail(res, `We only take bookings ${RULES.maxAdvanceDays} days ahead.`,
        { date: 'Too far in the future.' });
    }

    const allSlots = generateSlots(date, duration);

    if (allSlots.length === 0) {
      return ok(res, {
        date,
        open: false,
        slots: [],
        note: hoursFor(date) === null
          ? 'The salon is closed on this day.'
          : 'No slots left for this day — try tomorrow.',
      });
    }

    /*
     * One grouped query for the whole day beats one per slot. Cancelled
     * bookings free their chair, so they are excluded from the count.
     * booking_time is formatted in SQL to guarantee an 'HH:MM' string.
     */
    const counts = await query(`
      SELECT to_char(booking_time, 'HH24:MI') AS slot, COUNT(*)::int AS taken
        FROM bookings
       WHERE booking_date = $1
         AND status IN ('pending', 'confirmed')
    GROUP BY booking_time`, [date]);

    const taken = new Map(counts.map((r) => [r.slot, r.taken]));

    ok(res, {
      date,
      open: true,
      slots: allSlots.map((time) => ({
        time,
        label: formatTime12(time),
        available: (taken.get(time) ?? 0) < RULES.maxChairs,
      })),
    });
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
