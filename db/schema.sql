-- =============================================================================
--  Sincere Men's Salon — PostgreSQL schema
--  Shop No. 6, 75 Saraswati Road, Santacruz (West), Mumbai 400054
--
--  Target : PostgreSQL 14+ (developed against Neon / PG 16)
--  Run    : npm run db:setup     (or paste into the Neon SQL editor)
--
--  Ported from the original MySQL schema. Notable differences:
--    • AUTO_INCREMENT      -> GENERATED ALWAYS AS IDENTITY
--    • TINYINT(1)          -> BOOLEAN
--    • DECIMAL             -> NUMERIC
--    • ENUM(...)           -> TEXT + CHECK  (portable, and alterable later
--                             without the ALTER TYPE dance a real enum needs)
--    • ON UPDATE CURRENT_TIMESTAMP -> trigger (Postgres has no such clause)
--    • Indexes are separate statements rather than inline KEY declarations.
--
--  Safe to re-run: everything is dropped first.
-- =============================================================================

DROP TRIGGER  IF EXISTS trg_bookings_updated  ON bookings;
DROP FUNCTION IF EXISTS set_updated_at();
DROP TABLE    IF EXISTS booking_items, bookings, reviews, contact_messages,
                        services, service_categories CASCADE;


-- -----------------------------------------------------------------------------
--  service_categories — grouping shown as tabs on the Services section
-- -----------------------------------------------------------------------------
CREATE TABLE service_categories (
  id          SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug        VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(80)  NOT NULL,
  icon        VARCHAR(50)  NOT NULL DEFAULT 'scissors',
  sort_order  SMALLINT     NOT NULL DEFAULT 0
);

COMMENT ON COLUMN service_categories.slug IS 'URL/JS-safe key, e.g. "hair"';


-- -----------------------------------------------------------------------------
--  services — the price menu.
--  price is NUMERIC, never a float: binary floats cannot hold currency exactly.
-- -----------------------------------------------------------------------------
CREATE TABLE services (
  id            SMALLINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id   SMALLINT      NOT NULL
                REFERENCES service_categories (id) ON DELETE CASCADE,
  name          VARCHAR(120)  NOT NULL,
  description   VARCHAR(255)  NOT NULL DEFAULT '',
  price         NUMERIC(8,2)  NOT NULL CHECK (price >= 0),
  duration_min  SMALLINT      NOT NULL DEFAULT 30 CHECK (duration_min > 0),
  is_signature  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE,
  sort_order    SMALLINT      NOT NULL DEFAULT 0
);

COMMENT ON COLUMN services.price     IS 'Indian Rupees';
COMMENT ON COLUMN services.is_active IS 'FALSE hides it from the menu; rows are never deleted';

CREATE INDEX idx_service_category    ON services (category_id);
-- The public menu filters on is_active then orders by sort_order; one composite
-- index satisfies both halves without a sort step.
CREATE INDEX idx_service_active_sort ON services (is_active, sort_order);


-- -----------------------------------------------------------------------------
--  bookings — one row per appointment request
--
--  `reference` is the customer-facing code (e.g. "SMS-8F3K2A"). It is generated
--  in application code rather than derived from the identity column, so booking
--  volume is not leaked to customers.
-- -----------------------------------------------------------------------------
CREATE TABLE bookings (
  id              INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reference       CHAR(10)      NOT NULL UNIQUE,
  customer_name   VARCHAR(120)  NOT NULL,
  phone           VARCHAR(20)   NOT NULL,
  email           VARCHAR(190),
  booking_date    DATE          NOT NULL,
  booking_time    TIME          NOT NULL,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  total_duration  SMALLINT      NOT NULL DEFAULT 0,
  notes           VARCHAR(500)  NOT NULL DEFAULT '',
  status          TEXT          NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','confirmed','completed','cancelled')),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN bookings.phone        IS 'Stored normalised: 10 digits, no country code';
COMMENT ON COLUMN bookings.total_amount IS 'Snapshot of the price at booking time';

-- Slot-availability lookups hit (date, time) together on every booking attempt.
CREATE INDEX idx_booking_slot   ON bookings (booking_date, booking_time);
CREATE INDEX idx_booking_status ON bookings (status);
-- Supports both the rate-limit check and repeat-customer lookup.
CREATE INDEX idx_booking_phone  ON bookings (phone);


-- -----------------------------------------------------------------------------
--  booking_items — a booking may include several services
--
--  service_name and price_at_booking are denormalised deliberately: if the salon
--  raises prices next month, historical bookings must still show what the
--  customer was actually quoted.
-- -----------------------------------------------------------------------------
CREATE TABLE booking_items (
  id                INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id        INTEGER       NOT NULL
                    REFERENCES bookings (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: deleting a service must never silently rewrite
  -- booking history.
  service_id        SMALLINT      NOT NULL
                    REFERENCES services (id) ON DELETE RESTRICT,
  service_name      VARCHAR(120)  NOT NULL,
  price_at_booking  NUMERIC(8,2)  NOT NULL
);

COMMENT ON COLUMN booking_items.service_name IS 'Snapshot — survives later renames';

CREATE INDEX idx_item_booking ON booking_items (booking_id);
CREATE INDEX idx_item_service ON booking_items (service_id);


-- -----------------------------------------------------------------------------
--  reviews — testimonials.
--  Visitor submissions arrive with is_approved = FALSE and are published only
--  after a manager approves them in the admin panel.
-- -----------------------------------------------------------------------------
CREATE TABLE reviews (
  id           INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_name  VARCHAR(120)  NOT NULL,
  rating       SMALLINT      NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body         TEXT          NOT NULL,
  source       TEXT          NOT NULL DEFAULT 'website'
               CHECK (source IN ('google','website')),
  is_approved  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_featured  BOOLEAN       NOT NULL DEFAULT FALSE,
  reviewed_on  DATE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_review_visible ON reviews (is_approved, is_featured);


-- -----------------------------------------------------------------------------
--  contact_messages — enquiry form submissions
-- -----------------------------------------------------------------------------
CREATE TABLE contact_messages (
  id          INTEGER       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        VARCHAR(120)  NOT NULL,
  phone       VARCHAR(20)   NOT NULL,
  email       VARCHAR(190),
  message     TEXT          NOT NULL,
  is_read     BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_message_unread ON contact_messages (is_read, created_at);


-- -----------------------------------------------------------------------------
--  updated_at maintenance
--  Postgres has no ON UPDATE CURRENT_TIMESTAMP, so a trigger does the job.
-- -----------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_bookings_updated
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================================
--  NOTE ON ADMIN ACCOUNTS
--  There is deliberately no admin_users table. Vercel functions are stateless
--  with a read-only filesystem, so the original PHP session login could not
--  work. Admin credentials now live in environment variables
--  (ADMIN_USERNAME / ADMIN_PASSWORD_HASH) and the session is a signed cookie.
--  This also keeps every secret out of the git repository.
--  Generate a hash with:  npm run hash-password
-- =============================================================================
