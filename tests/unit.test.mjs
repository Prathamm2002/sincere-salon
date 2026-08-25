/** Unit tests for the pure logic in lib/ — no database, no network. */
import crypto from 'node:crypto';
import * as t from '../lib/time.js';
import * as v from '../lib/validate.js';
import * as a from '../lib/auth.js';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, console.log(`FAIL  ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`));
};

/* -- phone normalisation --------------------------------------------------- */
check('phone plain',        v.normalisePhone('9869075367'),      '9869075367');
check('phone +91 spaced',   v.normalisePhone('+91 98690 75367'), '9869075367');
check('phone 0-prefixed',   v.normalisePhone('09869075367'),     '9869075367');
check('phone punctuation',  v.normalisePhone('(986)907-5367'),   '9869075367');
check('phone 91 no plus',   v.normalisePhone('919869075367'),    '9869075367');
check('phone lead 5 -> null', v.normalisePhone('5869075367'),    null);
check('phone short -> null',  v.normalisePhone('98690753'),      null);
check('phone letters -> null', v.normalisePhone('abcdefghij'),   null);
check('phone empty -> null',   v.normalisePhone(''),             null);

/* -- email ----------------------------------------------------------------- */
check('email valid',  v.normaliseEmail('a@b.com'), 'a@b.com');
check('email blank',  v.normaliseEmail('   '),     null);
check('email bad',    v.normaliseEmail('nope'),    false);

/* -- text cleaning --------------------------------------------------------- */
check('clean collapses ws', v.cleanText('a   \n\t b '), 'a b');
check('clean truncates',    v.cleanText('abcdefghij', 4), 'abcd');
check('clean object -> ""', v.cleanText({x:1}), '');
check('clean devanagari',   v.cleanText('सिन्सियर'), 'सिन्सियर');
check('escape script tag',  v.escapeHtml('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');

/* -- dates ----------------------------------------------------------------- */
check('date real',        t.isValidDate('2026-08-16'), true);
check('date Feb 31',      t.isValidDate('2026-02-31'), false);
check('date month 13',    t.isValidDate('2026-13-01'), false);
check('date wrong fmt',   t.isValidDate('16-08-2026'), false);
check('date leap 2024',   t.isValidDate('2024-02-29'), true);
check('date non-leap 26', t.isValidDate('2026-02-29'), false);
check('time valid',       t.isValidTime('09:30'), true);
check('time 24:00',       t.isValidTime('24:00'), false);
check('time 9:30',        t.isValidTime('9:30'),  false);

/* -- calendar arithmetic (must not depend on the host timezone) ------------ */
check('addDays simple',        t.addDays('2026-08-16', 1),  '2026-08-17');
check('addDays month bound',   t.addDays('2026-08-31', 1),  '2026-09-01');
check('addDays year bound',    t.addDays('2026-12-31', 1),  '2027-01-01');
check('addDays leap',          t.addDays('2024-02-28', 1),  '2024-02-29');
check('addDays backwards',     t.addDays('2026-01-01', -1), '2025-12-31');
check('weekday Mon',           t.weekdayOf('2026-08-17'), 'Mon');
check('weekday Sun',           t.weekdayOf('2026-08-16'), 'Sun');

/* -- opening hours / slots -------------------------------------------------- */
check('hours Monday',   t.hoursFor('2026-08-17'), ['09:00','21:30']);
check('hours Saturday', t.hoursFor('2026-08-22'), ['08:00','22:00']);

// A fixed far-future reference instant keeps these independent of "now".
const REF = new Date('2026-12-01T00:00:00Z');
const mon30 = t.generateSlots('2026-12-14', 30, REF);
check('slots open at 09:00',       mon30[0], '09:00');
check('slots last start 30m',      mon30.at(-1), '21:00');
check('slot count 30m',            mon30.length, 25);
check('slots last start 90m',      t.generateSlots('2026-12-14', 90, REF).at(-1), '20:00');
check('Saturday opens 08:00',      t.generateSlots('2026-12-19', 30, REF)[0], '08:00');
check('impossible duration empty', t.generateSlots('2026-12-14', 900, REF), []);

// Lead time: on the current day, slots inside the next 45 minutes are dropped.
{
  const at = new Date('2026-12-14T05:00:00Z');      // 10:30 IST
  const todaySlots = t.generateSlots('2026-12-14', 30, at);
  check('lead time drops 11:00', todaySlots.includes('11:00'), false);
  check('lead time keeps 11:30', todaySlots.includes('11:30'), true);
}

/* -- time formatting -------------------------------------------------------- */
check('12h midnight', t.formatTime12('00:00'), '12:00 AM');
check('12h noon',     t.formatTime12('12:00'), '12:00 PM');
check('12h evening',  t.formatTime12('18:30'), '6:30 PM');
check('12h 09:05',    t.formatTime12('09:05'), '9:05 AM');

/* -- open/closed ------------------------------------------------------------ */
check('open at 14:00 IST',  t.isOpenNow(new Date('2026-12-14T08:30:00Z')), true);
check('closed at 06:00 IST', t.isOpenNow(new Date('2026-12-14T00:30:00Z')), false);
check('closed at 23:00 IST', t.isOpenNow(new Date('2026-12-14T17:30:00Z')), false);

/* -- booking reference ------------------------------------------------------ */
const ref = v.generateReference((n) => crypto.randomInt(n));
check('ref length', ref.length, 10);
check('ref prefix', ref.slice(0,4), 'SMS-');
check('ref alphabet excludes 0/O/1/I',
  /^SMS-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(ref), true);
{
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(v.generateReference((n) => crypto.randomInt(n)));
  check('3000 refs are near-unique', seen.size > 2980, true);
}

/* -- auth ------------------------------------------------------------------- */
{
  const hash = a.hashPassword('correct horse battery');
  check('password verifies',        a.verifyPassword('correct horse battery', hash), true);
  check('wrong password rejected',  a.verifyPassword('wrong', hash), false);
  check('malformed hash rejected',  a.verifyPassword('x', 'garbage'), false);
  check('empty stored rejected',    a.verifyPassword('x', ''), false);

  const token = a.signToken({ u: 'admin' }, 'sekret', 60);
  check('token round-trips',    a.verifyToken(token, 'sekret').u, 'admin');
  check('wrong secret -> null', a.verifyToken(token, 'other'), null);
  check('tampered -> null',     a.verifyToken(token.slice(0,-2) + 'xx', 'sekret'), null);
  check('expired -> null',      a.verifyToken(a.signToken({u:'a'},'sekret',-10), 'sekret'), null);
  check('garbage -> null',      a.verifyToken('not.a.token', 'sekret'), null);
  check('empty secret -> null', a.verifyToken(token, ''), null);
}

console.log(`\n=== unit: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
