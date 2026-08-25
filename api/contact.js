/**
 * POST /api/contact
 * Body: { name, phone, email?, message, website? }
 *
 * Stores an enquiry for the team to read in the admin panel.
 */

import { ENV } from '../lib/config.js';
import { query } from '../lib/db.js';
import { ok, fail, methodIs, readJson, serverError } from '../lib/http.js';
import { cleanText, normalisePhone, normaliseEmail } from '../lib/validate.js';

export default async function handler(req, res) {
  if (!methodIs(req, res, 'POST')) return;

  try {
    const body = await readJson(req);

    /*
     * Honeypot. The form renders a "website" field that CSS hides from people.
     * Bots fill every input they find, so anything arriving with it set is
     * discarded — silently, and with a success response, so the bot never
     * learns it was caught.
     */
    if (cleanText(body.website, 100) !== '') {
      return ok(res, {}, 'Thanks — we will be in touch.');
    }

    const errors = {};

    const name = cleanText(body.name, 120);
    if (name.length < 2) errors.name = 'Please tell us your name.';

    const phone = normalisePhone(body.phone);
    if (!phone) errors.phone = 'Enter a valid 10-digit Indian mobile number.';

    const email = normaliseEmail(body.email);
    if (email === false) errors.email = 'That email address does not look right.';

    const message = cleanText(body.message, 1000);
    if (message.length < 5) errors.message = 'What can we help you with?';

    if (Object.keys(errors).length) {
      return fail(res, 'Please check the highlighted fields.', errors, 422);
    }

    await query(`
      INSERT INTO contact_messages (name, phone, email, message)
      VALUES ($1, $2, $3, $4)`, [name, phone, email, message]);

    ok(res, {}, 'Thanks — we will call you back shortly.');
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
