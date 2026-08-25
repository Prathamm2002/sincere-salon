/**
 * ---------------------------------------------------------------------------
 *  Admin authentication — stateless, for a serverless runtime
 * ---------------------------------------------------------------------------
 *  The original PHP build used $_SESSION, which cannot work here: Vercel
 *  functions have a read-only filesystem and every request may land on a
 *  different instance, so there is nowhere to keep a session file.
 *
 *  Instead the session IS the cookie: a JSON payload with an expiry, signed
 *  with HMAC-SHA256. The server keeps no state; it only checks the signature.
 *  Nothing is stored that a forged cookie could exploit, because the signature
 *  cannot be produced without SESSION_SECRET.
 *
 *  Passwords use scrypt from Node's own crypto module — deliberately no bcrypt
 *  dependency, which needs native compilation and would slow cold starts.
 * ---------------------------------------------------------------------------
 */

import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ==========================================================================
   Passwords
   ========================================================================== */

/**
 * Hash a password for storage in ADMIN_PASSWORD_HASH.
 * Format: scrypt$<salt-hex>$<key-hex>
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

/**
 * Constant-time password check.
 * Returns false for a malformed stored value rather than throwing, so a
 * misconfigured env var reads as "wrong password" instead of a 500.
 */
export function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, keyHex] = String(stored).split('$');
    if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

    const expected = Buffer.from(keyHex, 'hex');
    const actual = crypto.scryptSync(
      password, Buffer.from(saltHex, 'hex'), expected.length, SCRYPT
    );

    // timingSafeEqual throws on length mismatch, hence the guard.
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ==========================================================================
   Signed session tokens
   ========================================================================== */

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Sign a payload into a `<body>.<signature>` token.
 * @param {object} payload
 * @param {string} secret
 * @param {number} ttlSeconds
 */
export function signToken(payload, secret, ttlSeconds = 60 * 60 * 8) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = b64url(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verify a token and return its payload, or null if it is missing, tampered
 * with, or expired.
 */
export function verifyToken(token, secret) {
  if (typeof token !== 'string' || !secret) return null;

  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');

  // Compare as fixed-length buffers, in constant time.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'salon_admin';

/**
 * Extra CSRF guard for state-changing admin calls.
 *
 * SameSite=Strict already stops the browser attaching the session cookie to
 * cross-site requests. This adds a second, independent condition: a custom
 * header that a plain cross-origin HTML form cannot set without triggering a
 * CORS preflight the server will refuse.
 */
export function hasCsrfHeader(req) {
  return req.headers?.['x-requested-with'] === 'salon-admin';
}
