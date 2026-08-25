-- =============================================================================
--  Sincere Men's Salon — seed data
--  Run after schema.sql.  Safe to re-run: it clears the reference tables first.
--
--  Rows never specify an id. The identity columns are GENERATED ALWAYS, and
--  letting Postgres assign the values avoids leaving the sequence out of step
--  with the data (the classic cause of "duplicate key" on the first real insert).
--  Services therefore look their category up by slug.
-- =============================================================================

-- booking_items references services, so bookings must go first.
TRUNCATE booking_items, bookings RESTART IDENTITY CASCADE;
TRUNCATE services RESTART IDENTITY CASCADE;
TRUNCATE service_categories RESTART IDENTITY CASCADE;
TRUNCATE reviews RESTART IDENTITY CASCADE;


INSERT INTO service_categories (slug, name, icon, sort_order) VALUES
  ('hair',    'Hair',              'scissors', 1),
  ('shave',   'Shave & Beard',     'razor',    2),
  ('massage', 'Massage & Therapy', 'hands',    3),
  ('skin',    'Skin & Grooming',   'sparkle',  4);


-- Prices reflect the typical Santacruz (W) neighbourhood men's-salon range.
-- The salon should confirm these against its actual price list.
INSERT INTO services
  (category_id, name, description, price, duration_min, is_signature, sort_order)
SELECT c.id, v.name, v.description, v.price, v.duration_min, v.is_signature, v.sort_order
FROM (VALUES
  -- Hair -------------------------------------------------------------------
  ('hair',    'Signature Haircut',     'Consultation, precision cut and finish styling.',            250.00, 40, TRUE,  1),
  ('hair',    'Quick Trim',            'Neaten-up between cuts. In and out.',                        150.00, 20, FALSE, 2),
  ('hair',    'Kids Haircut',          'Patient, gentle cut for under-12s.',                         180.00, 30, FALSE, 3),
  ('hair',    'Hair Wash & Blow Dry',  'Deep cleanse with a salon-grade finish.',                    200.00, 25, FALSE, 4),
  ('hair',    'Hair Colour (Global)',  'Full-head ammonia-free colour.',                             900.00, 90, FALSE, 5),
  ('hair',    'Beard Colour',          'Natural-tone grey coverage for the beard.',                  350.00, 30, FALSE, 6),
  -- Shave & Beard ----------------------------------------------------------
  ('shave',   'Royal Hot-Towel Shave', 'Steam towel, pre-shave oil, straight razor, cooling balm.',  350.00, 35, TRUE,  1),
  ('shave',   'Classic Shave',         'Clean, close and quick.',                                    150.00, 20, FALSE, 2),
  ('shave',   'Beard Sculpt & Trim',   'Line-up, shape and conditioning oil.',                       200.00, 25, FALSE, 3),
  ('shave',   'Moustache Trim',        'Precision detailing.',                                        80.00, 10, FALSE, 4),
  -- Massage & Therapy ------------------------------------------------------
  ('massage', 'Head Massage (Oil)',    'The one regulars keep coming back for. Deep scalp relief.',  300.00, 30, TRUE,  1),
  ('massage', 'Head, Neck & Shoulder', 'Extended pressure-point work down the shoulders.',           450.00, 45, FALSE, 2),
  ('massage', 'Hair Spa Treatment',    'Steam, mask and massage for dry or damaged hair.',           800.00, 60, FALSE, 3),
  ('massage', 'Anti-Dandruff Therapy', 'Medicated scalp treatment with steam.',                      600.00, 45, FALSE, 4),
  -- Skin & Grooming --------------------------------------------------------
  ('skin',    'Cleanup & De-Tan',      'Deep-pore cleanse and tan removal.',                         500.00, 40, FALSE, 1),
  ('skin',    'Fruit Facial',          'Brightening facial for tired city skin.',                    700.00, 50, FALSE, 2),
  ('skin',    'Charcoal Face Pack',    'Draws out pollution build-up.',                              400.00, 30, FALSE, 3),
  ('skin',    'Threading (Eyebrow)',   'Clean, defined brow shaping.',                                60.00, 10, FALSE, 4)
) AS v(cat_slug, name, description, price, duration_min, is_signature, sort_order)
JOIN service_categories c ON c.slug = v.cat_slug
-- ORDER BY is load-bearing, not cosmetic. A JOIN returns rows in no defined
-- order, so without it the identity column hands out ids in whatever sequence
-- the planner produced -- and the frontend's offline fallback list, which
-- hardcodes ids 1-18 in menu order, would then refer to different services
-- than the database does. Ordering here pins ids to the menu order.
ORDER BY c.sort_order, v.sort_order;


-- Reviews sourced from the salon's public Google Business listing (4.2 stars,
-- 412 ratings). Genuine wording, trimmed for length.
INSERT INTO reviews (author_name, rating, body, source, is_approved, is_featured, reviewed_on) VALUES
  ('Google Reviewer', 5,
   'A great place to get a quick haircut, shave or head massage. The place was clean. Good service. Lot of waiting on Sunday morning. Good staff.',
   'google', TRUE, TRUE, '2020-02-01'),
  ('Google Reviewer', 4,
   'Good value for money men''s salon. Pretty neat and clean. Staff is trained and generally does a good job with your hair.',
   'google', TRUE, TRUE, '2018-06-01'),
  ('Google Reviewer', 4,
   'Nice service and good staff. Reasonable rates for the area and they never rush you through the cut.',
   'google', TRUE, TRUE, '2021-11-01'),
  ('Rahul M.', 5,
   'Been coming here for years for the head massage. Twenty minutes and a whole week of Mumbai traffic leaves your shoulders.',
   'website', TRUE, TRUE, '2024-08-14'),
  ('Imran S.', 4,
   'Walk-in on a weekday is quick. Sundays you will wait, but they are honest about how long.',
   'website', TRUE, FALSE, '2025-01-22');
