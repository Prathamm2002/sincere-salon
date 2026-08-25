/**
 * ---------------------------------------------------------------------------
 *  Application configuration
 * ---------------------------------------------------------------------------
 *  Business facts are literals — they belong in version control and the
 *  frontend reads them from /api/info so the address and hours exist in
 *  exactly one place.
 *
 *  Secrets are read from the environment and are never committed. On Vercel
 *  they are set under Project → Settings → Environment Variables; locally they
 *  come from .env (see .env.example).
 * ---------------------------------------------------------------------------
 */

// -- Business details -------------------------------------------------------
export const BIZ = {
  name: "Sincere Men's Salon",
  nameHindi: 'सिन्सियर मेन्स सलून',
  phone: '+919869075367',
  phoneUi: '+91 98690 75367',
  address:
    'Shop No. 6, 75 Saraswati Road, Santacruz (West), Mumbai, Maharashtra 400054',
  mapsUrl: 'https://maps.app.goo.gl/BoHVJzyorGZdLb2Y8',
  lat: 19.0814347,
  lng: 72.8359641,
  rating: 4.2,
  ratingCount: 412,
};

/**
 * Opening hours in the salon's own timezone, 24h.
 * Used for slot generation *and* rendered in the footer, so the two can never
 * drift apart. `null` would mean closed all day.
 */
export const HOURS = {
  Mon: ['09:00', '21:30'],
  Tue: ['09:00', '21:30'],
  Wed: ['09:00', '21:30'],
  Thu: ['09:00', '21:30'],
  Fri: ['09:00', '21:30'],
  Sat: ['08:00', '22:00'],
  Sun: ['08:00', '22:00'],
};

// -- Booking rules ----------------------------------------------------------
export const RULES = {
  slotIntervalMin: 30,   // Booking grid granularity
  maxAdvanceDays: 60,    // How far ahead a customer may book
  maxChairs: 4,          // Concurrent bookings allowed per slot
  rateLimitPerHour: 5,   // Bookings per phone number per hour
  leadTimeMin: 45,       // Nobody may book a slot starting sooner than this
  maxServices: 6,        // Per booking
};

// -- Runtime ----------------------------------------------------------------
export const TIMEZONE = 'Asia/Kolkata';

/** Secrets. Absent values are reported by requireEnv() rather than crashing. */
export const ENV = {
  databaseUrl: process.env.DATABASE_URL || '',
  adminUser: process.env.ADMIN_USERNAME || 'admin',
  adminHash: process.env.ADMIN_PASSWORD_HASH || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  isProduction: process.env.VERCEL_ENV === 'production',
};

/**
 * Assert that the named env vars are present.
 * @returns {string|null} A human-readable message naming what is missing.
 */
export function requireEnv(...keys) {
  const missing = keys.filter((k) => !ENV[k]);
  if (missing.length === 0) return null;

  const names = {
    databaseUrl: 'DATABASE_URL',
    adminHash: 'ADMIN_PASSWORD_HASH',
    sessionSecret: 'SESSION_SECRET',
  };
  return `Server not configured: missing ${missing.map((m) => names[m] || m).join(', ')}.`;
}
