/**
 * POST /api/admin/login    { username, password }   -> sets session cookie
 * DELETE /api/admin/login                            -> clears it
 *
 * Credentials live in environment variables, not the database: there is a
 * single operator, and keeping them in env means no secret is ever committed
 * and the schema needs no admin_users table.
 */

import { ENV, requireEnv } from '../../lib/config.js';
import { verifyPassword, signToken, SESSION_COOKIE } from '../../lib/auth.js';
import { ok, fail, readJson, setCookie, serverError } from '../../lib/http.js';
import { cleanText } from '../../lib/validate.js';

// Deliberately slow to verify (scrypt), which is the throttle. A stateless
// runtime has nowhere to keep a per-IP counter, so lockout state cannot live
// here; the cost of a guess is the defence.
export default async function handler(req, res) {
  try {
    if (req.method === 'DELETE') {
      setCookie(res, SESSION_COOKIE, '', { maxAge: 0, secure: ENV.isProduction });
      return ok(res, {}, 'Signed out.');
    }

    if (req.method !== 'POST') return fail(res, 'Method not allowed.', {}, 405);

    const missing = requireEnv('adminHash', 'sessionSecret');
    if (missing) return fail(res, missing, {}, 500);

    const body = await readJson(req);
    const username = cleanText(body.username, 60);
    const password = String(body.password ?? '');

    // Always run the hash comparison, even when the username is wrong, so a
    // valid username cannot be identified by response timing.
    const passwordOk = verifyPassword(password, ENV.adminHash);
    const userOk = username === ENV.adminUser;

    if (!userOk || !passwordOk) {
      return fail(res, 'Wrong username or password.', {}, 401);
    }

    const token = signToken({ u: username }, ENV.sessionSecret, 60 * 60 * 8);
    setCookie(res, SESSION_COOKIE, token, { maxAge: 60 * 60 * 8, secure: ENV.isProduction });

    ok(res, { user: username }, 'Signed in.');
  } catch (err) {
    serverError(res, err, ENV.isProduction);
  }
}
