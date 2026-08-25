/**
 * ---------------------------------------------------------------------------
 *  Input validation
 * ---------------------------------------------------------------------------
 *  Every rule enforced in the browser is enforced again here. The API is
 *  reachable without the page, so client-side checks are a convenience for the
 *  visitor and nothing more.
 * ---------------------------------------------------------------------------
 */

/** Trim, collapse runs of whitespace, and cap length. */
export function cleanText(value, maxLength = 255) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).trim().replace(/\s+/gu, ' ').slice(0, maxLength);
}

/** Escape for safe interpolation into HTML. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/**
 * Normalise an Indian mobile number to its 10 digits.
 * "+91 98690 75367", "098690-75367", "9869075367" all become "9869075367".
 * @returns {string|null} null when it is not a valid Indian mobile (6-9 lead).
 */
export function normalisePhone(value) {
  let digits = String(value ?? '').replace(/\D+/g, '');

  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/**
 * Validate an optional email.
 * @returns {string|null|false} null when blank, false when present but invalid.
 */
export function normaliseEmail(value) {
  const email = cleanText(value, 190);
  if (email === '') return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : false;
}

/**
 * Customer-facing booking reference, e.g. "SMS-7QK4X2".
 * Ambiguous characters (0/O, 1/I) are excluded so it can be read aloud over
 * the phone without confusion.
 */
export function generateReference(randomInt) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += alphabet[randomInt(alphabet.length)];
  }
  return `SMS-${code}`;
}
