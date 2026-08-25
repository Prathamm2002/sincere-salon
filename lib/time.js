/**
 * ---------------------------------------------------------------------------
 *  Salon-local time
 * ---------------------------------------------------------------------------
 *  Everything about opening hours and slots must be reasoned about in the
 *  salon's timezone, never the server's. Vercel functions run in UTC, so
 *  `new Date().getHours()` would be 5.5 hours behind Mumbai and would happily
 *  offer slots the salon has already closed for.
 *
 *  Dates are passed around as plain 'YYYY-MM-DD' strings and times as 'HH:MM'.
 *  Calendar arithmetic is done on those strings via UTC anchors, which keeps it
 *  free of any timezone at all — the only place a timezone is consulted is
 *  `salonNow()`, where it genuinely matters.
 * ---------------------------------------------------------------------------
 */

import { TIMEZONE, HOURS, RULES } from './config.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/*
 * hourCycle 'h23' is set explicitly: with `hour12: false` alone, some ICU
 * builds render midnight as hour "24", which then parses to the wrong day.
 */
const PARTS_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * The current date and time as the salon experiences it.
 * @param {Date} [at] Instant to convert; defaults to now.
 * @returns {{date: string, time: string, minutes: number, weekday: string}}
 */
export function salonNow(at = new Date()) {
  const p = Object.fromEntries(
    PARTS_FMT.formatToParts(at).map((x) => [x.type, x.value])
  );

  const hour = p.hour === '24' ? '00' : p.hour;   // Defensive, see note above
  const date = `${p.year}-${p.month}-${p.day}`;

  return {
    date,
    time: `${hour}:${p.minute}`,
    minutes: Number(hour) * 60 + Number(p.minute),
    weekday: weekdayOf(date),
  };
}

/** Today's date in the salon's timezone, as 'YYYY-MM-DD'. */
export function salonToday(at = new Date()) {
  return salonNow(at).date;
}

/**
 * Three-letter weekday for a date string.
 * Anchored at UTC midnight so the result depends only on the calendar date,
 * never on where the code is running.
 */
export function weekdayOf(isoDate) {
  return WEEKDAYS[new Date(`${isoDate}T00:00:00Z`).getUTCDay()];
}

/** Shift a date string by whole days. Pure calendar arithmetic. */
export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Is this a real calendar date in 'YYYY-MM-DD' form? Rejects 2026-02-31. */
export function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Is this a valid 24h 'HH:MM'? */
export function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** 'HH:MM' -> minutes since midnight. */
export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes since midnight -> 'HH:MM'. */
export const toHHMM = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/** '18:30' -> '6:30 PM' */
export function formatTime12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

/** Opening hours for a date, or null when the salon is closed that day. */
export function hoursFor(isoDate) {
  return HOURS[weekdayOf(isoDate)] ?? null;
}

/**
 * Every bookable start time on a date, as 'HH:MM' strings.
 *
 * A slot is offered only if the *whole* appointment still finishes before
 * closing, so the duration is subtracted from the closing time rather than
 * ignored — that is what stops the site selling a 90-minute colour at 9:15 pm.
 * On the current day, slots inside the lead-time window are dropped.
 *
 * @param {string} isoDate
 * @param {number} durationMin Total length of the appointment.
 * @param {Date}   [at]        Reference instant, for testing.
 */
export function generateSlots(isoDate, durationMin = RULES.slotIntervalMin, at = new Date()) {
  const hours = hoursFor(isoDate);
  if (!hours) return [];

  const open = toMinutes(hours[0]);
  const close = toMinutes(hours[1]);
  const lastStart = close - durationMin;

  const now = salonNow(at);
  const isToday = isoDate === now.date;
  const earliest = now.minutes + RULES.leadTimeMin;

  const slots = [];
  for (let t = open; t <= lastStart; t += RULES.slotIntervalMin) {
    if (isToday && t < earliest) continue;
    slots.push(toHHMM(t));
  }
  return slots;
}

/** Is the salon open at this instant? Drives the live Open/Closed pill. */
export function isOpenNow(at = new Date()) {
  const now = salonNow(at);
  const hours = hoursFor(now.date);
  if (!hours) return false;
  return now.minutes >= toMinutes(hours[0]) && now.minutes <= toMinutes(hours[1]);
}

/**
 * Human phrasing for the next change of state, e.g. "Opens 9:00 AM" or
 * "Closes 9:30 PM". Looks ahead up to a week when closed for the day.
 */
export function nextChange(at = new Date()) {
  const now = salonNow(at);
  const today = hoursFor(now.date);

  if (today) {
    const open = toMinutes(today[0]);
    const close = toMinutes(today[1]);
    if (now.minutes < open) return `Opens ${formatTime12(today[0])}`;
    if (now.minutes <= close) return `Closes ${formatTime12(today[1])}`;
  }

  for (let i = 1; i <= 7; i++) {
    const date = addDays(now.date, i);
    const hours = hoursFor(date);
    if (hours) {
      const when = i === 1 ? ' tomorrow' : ` ${weekdayOf(date)}`;
      return `Opens ${formatTime12(hours[0])}${when}`;
    }
  }
  return null;
}
