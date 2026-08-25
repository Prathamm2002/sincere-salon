/**
 * ---------------------------------------------------------------------------
 *  HTTP plumbing shared by every endpoint
 * ---------------------------------------------------------------------------
 *  Deliberately written against the bare Node request/response objects rather
 *  than Vercel's convenience helpers (res.json, req.body, …). The handlers then
 *  run unchanged under a plain `http.createServer`, which is what makes them
 *  testable locally without deploying.
 * ---------------------------------------------------------------------------
 */

/** Send a JSON payload and end the response. */
export function json(res, payload, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(payload));
}

export const ok = (res, data = {}, message = '') =>
  json(res, { success: true, message, data });

/**
 * Emit a failure. `errors` is a field → message map that the frontend paints
 * onto the matching inputs.
 */
export const fail = (res, message, errors = {}, status = 400) =>
  json(res, { success: false, message, errors }, status);

/**
 * Convert an unexpected exception into the same envelope shape. Details are
 * withheld outside development so stack traces and connection strings never
 * reach a visitor.
 */
export function serverError(res, err, isProduction) {
  console.error('[api]', err?.message, err?.stack);

  const looksLikeDb = /connect|ECONNREFUSED|password|database|relation .* does not exist/i
    .test(err?.message || '');

  json(
    res,
    {
      success: false,
      message: looksLikeDb
        ? 'Cannot reach the database right now. Please try again shortly.'
        : 'Something went wrong on our end. Please try again.',
      debug: isProduction ? null : { error: err?.message },
    },
    500
  );
}

/** Reject anything other than the expected verb. Returns false if it did. */
export function methodIs(req, res, method) {
  if (req.method === method) return true;
  fail(res, 'Method not allowed.', {}, 405);
  return false;
}

/**
 * Read and parse a JSON request body.
 * Uses `req.body` when the platform already parsed it (Vercel does), otherwise
 * drains the stream. Caps the size so a huge upload cannot exhaust memory.
 */
export async function readJson(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/** Query-string parameters as a plain object. */
export function queryParams(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const url = new URL(req.url, 'http://localhost');
  return Object.fromEntries(url.searchParams);
}

/** Parse the Cookie header into an object. */
export function parseCookies(req) {
  const header = req.headers?.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Set a cookie.
 * HttpOnly keeps it away from JavaScript; SameSite=Strict means the browser
 * will not attach it to cross-site requests, which is the main CSRF defence.
 */
export function setCookie(res, name, value, { maxAge = 0, secure = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');

  const existing = res.getHeader('Set-Cookie');
  const list = existing ? [].concat(existing) : [];
  list.push(parts.join('; '));
  res.setHeader('Set-Cookie', list);
}
