# Sincere Men's Salon

Booking website for **Sincere Men's Salon** (सिन्सियर मेन्स सलून) — Shop No. 6,
75 Saraswati Road, Santacruz (West), Mumbai 400054.
Rated 4.2★ from 412 Google reviews · [+91 98690 75367](tel:+919869075367)

3D WebGL hero, a three-step booking flow backed by a real database, and an
admin dashboard for the salon to manage bookings, reviews and enquiries.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Hosting | Vercel (Hobby) | Free, deploys on every push to `main` |
| Frontend | HTML5 · Bootstrap 5 grid · vanilla ES modules | No build step, no framework |
| 3D | Three.js r160 | Hero scene, lazily imported and self-pausing |
| API | Node 20 serverless functions | Vercel's native runtime |
| Database | Neon Postgres | Free, serverless, scales to zero |

**Zero build step and one runtime dependency** (`@neondatabase/serverless`).
Password hashing and session signing use Node's own `crypto`, so there is
nothing to compile and cold starts stay fast.

---

## Deploy it (about 15 minutes, all free)

### 1. Push to GitHub

```bash
git remote add origin https://github.com/<your-username>/sincere-mens-salon.git
git branch -M main
git push -u origin main
```

### 2. Create the database

1. Sign up at [neon.com](https://neon.com) and create a project (region:
   **Singapore** or **Mumbai** — closest to the salon's customers).
2. From **Connection Details**, copy the **Pooled connection** string. It has
   `-pooler` in the hostname. Serverless functions need the pooled one; the
   direct string will exhaust connections under load.

### 3. Set up local config

```bash
cp .env.example .env
```

Fill in `.env`:

```bash
# The pooled Neon string from step 2
DATABASE_URL="postgresql://...-pooler...neon.tech/neondb?sslmode=require"

# Generate the admin password hash
npm run hash-password -- "a-strong-password-you-choose"

# Generate the cookie signing secret
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then create the tables and load the menu:

```bash
npm install
npm run db:setup
```

You should see `Database ready: 18 services, 5 reviews.`

### 4. Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the GitHub repo.
2. Framework preset: **Other**. Leave the build settings alone — `vercel.json`
   already points the static root at `public/`.
3. Under **Environment Variables**, add all four from your `.env`:
   `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`.
4. Deploy.

The site is live at `https://<project>.vercel.app`, the dashboard at
`/admin`. Every push to `main` redeploys automatically.

> **If the site loads but shows the sample menu**, the API cannot reach the
> database. Check `DATABASE_URL` in Vercel's settings, and that you used the
> **pooled** connection string.

---

## Local development

```bash
npm install
npx vercel dev          # runs functions + static files together
```

Or run the test server, which routes to the same handler modules:

```bash
node tests/server.mjs 8877
```

---

## Tests

```bash
npm test
```

- **`tests/unit.test.mjs`** (64 checks) — phone/email/date validation, slot
  generation, IST timezone maths, password hashing, token signing. No I/O.
- **`tests/api.test.mjs`** (61 checks) — every endpoint end-to-end against a
  real Postgres: booking flow, chair capacity, rate limiting, review
  moderation, admin auth, CSRF, forged cookies.

`tests/pg-client.mjs` is a small Postgres wire-protocol client used only by the
test harness, so the suite can run against a local database without the Neon
driver. It is never imported by application code.

---

## Project layout

```
├── public/                  Static site (Vercel serves this)
│   ├── index.html
│   ├── admin/index.html     Dashboard shell
│   └── assets/{css,js,img}
│
├── api/                     One file = one serverless function (8 total)
│   ├── info.js              GET  business details + live open/closed
│   ├── services.js          GET  price menu by category
│   ├── slots.js             GET  availability for a date
│   ├── book.js              POST create a booking (transactional)
│   ├── reviews.js           GET  approved reviews · POST submit one
│   ├── contact.js           POST enquiry
│   └── admin/
│       ├── login.js         POST sign in · DELETE sign out
│       └── index.js         GET dashboard data · POST actions
│
├── lib/                     Shared, never served
│   ├── config.js            ★ Business details, hours, booking rules
│   ├── db.js                Neon pool, query helpers, transactions
│   ├── time.js              Salon-timezone dates and slot generation
│   ├── validate.js          Input cleaning and validation
│   ├── http.js              JSON envelopes, cookies, body parsing
│   └── auth.js              scrypt passwords, HMAC session tokens
│
├── db/{schema.sql,seed.sql}
├── scripts/{db-setup.js,hash-password.js}
└── tests/
```

---

## How it works

### Configuration lives in one place

Address, phone, opening hours and booking rules are all in `lib/config.js`.
The frontend fetches them from `/api/info` on load, so nothing is duplicated in
the HTML. Change the opening hours once and the footer, the hours table, the
open/closed pill and the slot generator all follow.

### The site works even when the API doesn't

Every network-dependent section has a bundled fallback. If the database is
unreachable the visitor still sees the full menu and reviews, and the contact
form hands off to WhatsApp. `isServerDown()` in `main.js` separates *"the
server is broken"* (degrade quietly) from *"your input was rejected"* (show the
message) — a visitor is never shown a database error.

> The fallback service list hardcodes ids, so `db/seed.sql` pins ids to menu
> order with an explicit `ORDER BY`. A test asserts the two stay in agreement.

### Bookings are validated on the server, always

`api/book.js` re-checks everything the browser checked, and reads **prices and
durations from the database** rather than the request — posting `{price: 1}`
changes nothing. It also confirms the slot still fits the full appointment
length before closing time, and re-counts chair capacity inside the transaction
behind a `pg_advisory_xact_lock`, so two people submitting the same slot at the
same instant cannot both take the last chair.

### Timezone

The salon is in IST; Vercel functions run in UTC. All opening-hours logic goes
through `lib/time.js`, and `/api/info` reports the salon's own current date so
the date picker cannot offer a "today" the server considers past. A visitor
booking from another timezone gets the right days.

### Admin auth without sessions

Serverless functions have a read-only filesystem and no shared memory, so the
original PHP `$_SESSION` login could not be carried over. The session is now
the cookie itself: a JSON payload with an expiry, signed with HMAC-SHA256 and
sent `HttpOnly` + `SameSite=Strict`. The server stores nothing. Credentials
live in environment variables, so no secret is ever committed.

### Security notes

- **SQL injection** — every query is parameterised; no user input is ever
  concatenated into SQL. Service id lists go in as a single array parameter.
- **XSS** — all dynamic HTML is escaped (`esc()` client-side).
- **Passwords** — scrypt with a random salt, compared in constant time.
- **CSRF** — `SameSite=Strict` on the session cookie, plus a required custom
  header on every state-changing admin call that a cross-site form cannot set.
- **Spam** — CSS-hidden honeypot on the contact form; per-phone booking rate
  limit; reviews queued for moderation rather than published on submit.
- **Secrets** — nothing sensitive in the repo. `.env` is gitignored.

---

## Content to replace before launch

- **Gallery images** — `public/assets/img/shot-1.svg` … `shot-6.svg` are
  illustrations. Swap in real photographs of the shop (4:3, ~1200×900).
- **Service prices** — the 18 services reflect the typical Santacruz (W) range
  and should be confirmed against the salon's actual price list. Edit them in
  `db/seed.sql` and re-run `npm run db:setup`, or directly in the database.

---

## Costs

Everything here is on a permanent free tier, not a trial:

| Service | Free tier | This site's usage |
|---|---|---|
| Vercel Hobby | 100 GB bandwidth/month | Nowhere near it |
| Neon | 0.5 GB storage, scales to zero | A few MB |

Neon suspends the database after inactivity and wakes on the next query, which
adds roughly a second to the first request after a quiet spell.
