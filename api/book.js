/**
 * POST /api/book
 * Body: { name, phone, email?, date, time, services: [id], notes? }
 *
 * The important property of this endpoint is that prices and durations are read
 * from the database, never from the request. A client posting { price: 1 }
 * changes nothing.
 */

import crypto from 'node:crypto';
import { RULES, BIZ, ENV } from '../lib/config.js';
import { query, withTransaction } from '../lib/db.js';
import { ok, fail, methodIs, readJson, serverError } from '../lib/http.js';
import {
  isValidDate, isValidTime, generateSlots, salonToday, formatTime12, weekdayOf,
} from '../lib/time.js';
import {
  cleanText, normalisePhone, normaliseEmail, generateReference,
} from '../lib/validate.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;

  try {
    const body = await readJson(req);
    const errors = {};

    /* -- 1. Customer details ---------------------------------------------- */
    const name = cleanText(body.name, 120);
    if (name.length < 2) errors.name = 'Please tell us your name.';

    const phone = normalisePhone(body.phone);
    if (!phone) errors.phone = 'Enter a valid 10-digit Indian mobile number.';

    const email = normaliseEmail(body.email);
    if (email === false) errors.email = 'That email address does not look right.';

    const notes = cleanText(body.notes, 500);

    /* -- 2. Requested slot ------------------------------------------------- */
    const date = cleanText(body.date, 10);
    const time = cleanText(body.time, 5);

    if (!isValidDate(date)) errors.date = 'Choose a date.';
    else if (date < salonToday()) errors.date = 'That date has already passed.';

    if (!isValidTime(time)) errors.time = 'Choose a time.';

    /* -- 3. Selected services ---------------------------------------------- */
    const serviceIds = [...new Set(
      (Array.isArray(body.services) ? body.services : [])
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isInteger(n) && n > 0)
    )];

    if (serviceIds.length === 0) errors.services = 'Pick at least one service.';
    else if (serviceIds.length > RULES.maxServices) {
      errors.services = `Please book up to ${RULES.maxServices} services.`;
    }

    if (Object.keys(errors).length) {
      return fail(res, 'Please check the highlighted fields.', errors, 422);
    }

    /*
     * Fetch the real rows. `= ANY($1)` takes the id list as a single array
     * parameter, so the statement stays fully parameterised regardless of how
     * many services were selected.
     */
    const services = await query(`
      SELECT id, name, price::float8 AS price, duration_min
        FROM services
       WHERE is_active = TRUE AND id = ANY($1::int[])`, [`{${serviceIds.join(',')}}`]);

    if (services.length !== serviceIds.length) {
      return fail(res, 'One of those services is no longer available. Please refresh and try again.',
        { services: 'Unavailable service selected.' }, 422);
    }

    const totalAmount = services.reduce((sum, s) => sum + s.price, 0);
    const totalDuration = services.reduce((sum, s) => sum + s.duration_min, 0);

    /* -- 4. Re-check the slot server-side ---------------------------------- */
    // The slot must still exist once the FULL duration is accounted for. This
    // is the check that stops a 90-minute colour being squeezed in before close.
    if (!generateSlots(date, totalDuration).includes(time)) {
      return fail(res, 'That time no longer works for the services you picked.',
        { time: 'Please choose another slot.' }, 409);
    }

    /* -- 5. Rate limiting -------------------------------------------------- */
    const recent = await query(`
      SELECT COUNT(*)::int AS n FROM bookings
       WHERE phone = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [phone]);

    if (recent[0].n >= RULES.rateLimitPerHour) {
      return fail(res,
        `You have made several bookings just now. Please call us on ${BIZ.phoneUi} instead.`,
        {}, 429);
    }

    /* -- 6. Write it, atomically ------------------------------------------- */
    let conflict = false;

    const result = await withTransaction(async (client) => {
      /*
       * Serialise everyone competing for this exact slot. Without the lock,
       * two requests could each read "3 of 4 chairs taken" and both insert,
       * overbooking the slot. A transaction-scoped advisory lock is released
       * automatically at COMMIT or ROLLBACK.
       *
       * (A plain SELECT COUNT(*) ... FOR UPDATE cannot serve here — Postgres
       * rejects FOR UPDATE alongside an aggregate.)
       */
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`${date} ${time}`]);

      const taken = await client.query(`
        SELECT COUNT(*)::int AS n FROM bookings
         WHERE booking_date = $1 AND booking_time = $2
           AND status IN ('pending','confirmed')`, [date, time]);

      if (taken.rows[0].n >= RULES.maxChairs) {
        conflict = true;
        return null;
      }

      // Retry on the astronomically unlikely reference collision.
      let reference = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateReference((max) => crypto.randomInt(max));
        const clash = await client.query('SELECT 1 FROM bookings WHERE reference = $1', [candidate]);
        if (clash.rows.length === 0) { reference = candidate; break; }
      }
      if (!reference) throw new Error('Could not allocate a booking reference.');

      const inserted = await client.query(`
        INSERT INTO bookings
          (reference, customer_name, phone, email, booking_date, booking_time,
           total_amount, total_duration, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id`,
        [reference, name, phone, email, date, time, totalAmount, totalDuration, notes]);

      const bookingId = inserted.rows[0].id;

      for (const s of services) {
        await client.query(`
          INSERT INTO booking_items (booking_id, service_id, service_name, price_at_booking)
          VALUES ($1,$2,$3,$4)`, [bookingId, s.id, s.name, s.price]);
      }

      return { reference };
    });

    if (conflict) {
      return fail(res, 'That slot filled up a moment ago. Please pick another time.',
        { time: 'Slot full.' }, 409);
    }

    /* -- 7. Confirm --------------------------------------------------------- */
    const [y, m, d] = date.split('-');
    const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1];

    ok(res, {
      reference: result.reference,
      name,
      date,
      dateLabel: `${weekdayOf(date)}, ${Number(d)} ${monthName} ${y}`,
      time,
      timeLabel: formatTime12(time),
      total: totalAmount,
      duration: totalDuration,
      services: services.map((s) => s.name),
      phone: BIZ.phoneUi,
    }, 'Booking received.');
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
