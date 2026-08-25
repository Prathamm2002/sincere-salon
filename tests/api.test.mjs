/** End-to-end API tests against the real handlers + real Postgres. */
import { start } from './server.mjs';

const BASE = 'http://127.0.0.1:8878';
let pass = 0, fail = 0;

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`FAIL  ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`);
}
function truthy(label, v) { v ? pass++ : (fail++, console.log(`FAIL  ${label} (falsy: ${JSON.stringify(v)})`)); }

const call = async (path, opts = {}) => {
  const res = await fetch(BASE + path, opts);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

const server = await start(8878);

/* ---- info ---------------------------------------------------------------- */
let r = await call('/api/info');
check('info 200', r.status, 200);
check('info name', r.body.data.name, "Sincere Men's Salon");
truthy('info today is salon date', /^\d{4}-\d{2}-\d{2}$/.test(r.body.data.today));
check('info hours rows', r.body.data.hours.length, 7);
truthy('info nextChange present', r.body.data.nextChange);

/* ---- services ------------------------------------------------------------ */
r = await call('/api/services');
check('services 200', r.status, 200);
check('services categories', r.body.data.categories.length, 4);
const all = r.body.data.categories.flatMap(c => c.services);
check('services count', all.length, 18);
check('price is a number', typeof all[0].price, 'number');
check('signature is boolean', typeof all[0].signature, 'boolean');
const sig = all.filter(s => s.signature);
check('signature count', sig.length, 3);

/* ---- the frontend's offline fallback must agree with the database --------
   The fallback list in main.js hardcodes service ids. If the seed ever assigns
   ids in a different order, a visitor browsing in fallback mode would submit
   ids that mean different services on the server. This pins the two together. */
{
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../public/assets/js/main.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('FALLBACK_SERVICES'), src.indexOf('let categories'));
  const fallback = [...block.matchAll(/id:\s*(\d+),\s*name:\s*'([^']+)'/g)]
    .map(m => ({ id: Number(m[1]), name: m[2].replace(/\\'/g, "'") }));

  check('fallback list size matches DB', fallback.length, all.length);
  const live = new Map(all.map(s => [s.id, s.name]));
  const mismatches = fallback.filter(f => live.get(f.id) !== f.name);
  check('every fallback id maps to the same service in the DB',
        mismatches.map(m => `${m.id}:${m.name} != ${live.get(m.id)}`), []);
}

/* ---- slots --------------------------------------------------------------- */
const today = (await call('/api/info')).body.data.today;
const future = new Date(Date.parse(today + 'T00:00:00Z') + 30*86400000).toISOString().slice(0,10);

r = await call(`/api/slots?date=${future}&duration=30`);
check('slots 200', r.status, 200);
truthy('slots returned', r.body.data.slots.length > 0);
check('slot shape', Object.keys(r.body.data.slots[0]).sort(), ['available','label','time']);

r = await call('/api/slots?date=not-a-date');
check('slots reject bad date', r.status, 400);
r = await call('/api/slots?date=2020-01-01');
check('slots reject past', r.status, 400);
r = await call(`/api/slots?date=${new Date(Date.parse(today+'T00:00:00Z')+200*86400000).toISOString().slice(0,10)}`);
check('slots reject too far ahead', r.status, 400);

// Long service must not be bookable right up against closing time.
const s30 = (await call(`/api/slots?date=${future}&duration=30`)).body.data.slots;
const s90 = (await call(`/api/slots?date=${future}&duration=90`)).body.data.slots;
truthy('90m yields fewer slots than 30m', s90.length < s30.length);

/* ---- booking: validation -------------------------------------------------- */
r = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({}) });
check('book empty -> 422', r.status, 422);
truthy('book flags name', r.body.errors.name);
truthy('book flags phone', r.body.errors.phone);
truthy('book flags services', r.body.errors.services);

r = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'Test', phone:'5555555555', date:future, time:'10:00', services:[1] }) });
check('book bad phone -> 422', r.status, 422);

/* ---- booking: the price cannot be dictated by the client ------------------ */
const slot = s30.find(s => s.available).time;
r = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'Pratham Test', phone:'9869075367', date:future, time:slot,
                         services:[1,3], price: 1, total_amount: 1 }) });
check('book 200', r.status, 200);
const booking = r.body.data;
truthy('reference format', /^SMS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(booking.reference));
check('total from DB, not request', booking.total, 430);
check('duration from DB', booking.duration, 70);
check('services echoed', booking.services.length, 2);

/* ---- booking: capacity ---------------------------------------------------- */
// 4 chairs; one is taken. Fill the rest, then expect a 409.
for (let i = 0; i < 3; i++) {
  const res = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name:`Filler ${i}`, phone:`98690753${60+i}`, date:future, time:slot, services:[2] }) });
  if (res.status !== 200) console.log('  filler failed:', res.status, res.body.message);
}
r = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'Overflow', phone:'9869075399', date:future, time:slot, services:[2] }) });
check('5th booking on full slot -> 409', r.status, 409);

// And the slot now reports itself unavailable.
const after = (await call(`/api/slots?date=${future}&duration=30`)).body.data.slots.find(s => s.time === slot);
check('full slot marked unavailable', after.available, false);

/* ---- rate limiting -------------------------------------------------------- */
const otherSlot = s30.filter(s => s.available && s.time !== slot);
let limited = false;
for (let i = 0; i < 6 && i < otherSlot.length; i++) {
  const res = await call('/api/book', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name:'Spammer', phone:'9812345678', date:future, time:otherSlot[i].time, services:[2] }) });
  if (res.status === 429) { limited = true; break; }
}
truthy('rate limit trips for one phone', limited);

/* ---- reviews -------------------------------------------------------------- */
r = await call('/api/reviews?limit=6');
check('reviews 200', r.status, 200);
check('approved reviews', r.body.data.reviews.length, 5);
check('rating summary', r.body.data.summary.rating, 4.2);
r = await call('/api/reviews?featured=1');
check('featured subset smaller', r.body.data.reviews.length, 4);

r = await call('/api/reviews', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ author:'Tester', rating:5, body:'Really good haircut, thanks.' }) });
check('review submit 200', r.status, 200);
r = await call('/api/reviews?limit=50');
check('submitted review NOT auto-published', r.body.data.reviews.length, 5);

r = await call('/api/reviews', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ author:'X', rating:9, body:'hi' }) });
check('review bad input -> 422', r.status, 422);

/* ---- contact + honeypot --------------------------------------------------- */
r = await call('/api/contact', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'Enquirer', phone:'9869075367', message:'Do you do kids cuts?' }) });
check('contact 200', r.status, 200);
r = await call('/api/contact', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ name:'Bot', phone:'9869075367', message:'spam', website:'http://spam' }) });
check('honeypot returns success', r.status, 200);

/* ---- admin auth ----------------------------------------------------------- */
r = await call('/api/admin');
check('admin unauthenticated -> 401', r.status, 401);

r = await call('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ username:'admin', password:'wrong' }) });
check('admin wrong password -> 401', r.status, 401);

const loginRes = await fetch(BASE + '/api/admin/login', { method:'POST',
  headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ username:'admin', password:'test-admin-password' }) });
check('admin login 200', loginRes.status, 200);
const cookie = loginRes.headers.getSetCookie()[0].split(';')[0];
truthy('session cookie issued', cookie.startsWith('salon_admin='));
truthy('cookie is HttpOnly', loginRes.headers.getSetCookie()[0].includes('HttpOnly'));
truthy('cookie is SameSite=Strict', loginRes.headers.getSetCookie()[0].includes('SameSite=Strict'));

r = await call('/api/admin', { headers: { Cookie: cookie } });
check('admin data 200', r.status, 200);
truthy('stats present', r.body.data.stats);
truthy('bookings listed', r.body.data.bookings.length > 0);
truthy('pending review visible to admin', r.body.data.reviews.some(x => !x.is_approved));
truthy('message listed', r.body.data.messages.length > 0);
check('booking date is a string', typeof r.body.data.bookings[0].booking_date, 'string');
truthy('booking time is HH:MM', /^\d{2}:\d{2}$/.test(r.body.data.bookings[0].booking_time));

/* ---- admin CSRF ----------------------------------------------------------- */
r = await call('/api/admin', { method:'POST', headers:{ Cookie: cookie, 'Content-Type':'application/json' },
  body: JSON.stringify({ action:'review_approve', id:1 }) });
check('POST without CSRF header -> 403', r.status, 403);

const pendingId = (await call('/api/admin', { headers:{Cookie:cookie} }))
  .body.data.reviews.find(x => !x.is_approved).id;
r = await call('/api/admin', { method:'POST',
  headers:{ Cookie: cookie, 'Content-Type':'application/json', 'X-Requested-With':'salon-admin' },
  body: JSON.stringify({ action:'review_approve', id: pendingId }) });
check('approve with CSRF header 200', r.status, 200);
r = await call('/api/reviews?limit=50');
check('approved review now public', r.body.data.reviews.length, 6);

r = await call('/api/admin', { method:'POST',
  headers:{ Cookie: cookie, 'Content-Type':'application/json', 'X-Requested-With':'salon-admin' },
  body: JSON.stringify({ action:'booking_status', id: 1, status:'DROP TABLE' }) });
check('invalid status rejected', r.status, 422);

r = await call('/api/admin', { method:'POST',
  headers:{ Cookie: cookie, 'Content-Type':'application/json', 'X-Requested-With':'salon-admin' },
  body: JSON.stringify({ action:'nonsense', id: 1 }) });
check('unknown action rejected', r.status, 422);

/* ---- forged cookie -------------------------------------------------------- */
r = await call('/api/admin', { headers:{ Cookie: 'salon_admin=eyJ1IjoiYWRtaW4ifQ.forged' } });
check('forged token -> 401', r.status, 401);

server.close();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
