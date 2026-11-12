// The export of the event log (the events table, src/db.js; README.md, "The event log"): the events of one day of the
// owner as one JSONL file, <dir>/YYYY-MM-DD.jsonl, one event in each line, in the order of the log. The nightly run is
// scripts/export-events.js. This module only reads the database.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// The keys of a payload that hold text a person or an agent wrote in a memo: the body of a memo, a reply, a close
// text, a note, the two texts of an edit or a compact, the next step of a brief. They can hold personal data, so the
// export leaves them out unless withText, and gives the length of each in <key>_length. The title of a memo stays.
// A new payload key that holds memo text must go in this list (src/memos.js record).
export const TEXT_KEYS = ['text', 'old_text', 'new_text', 'next', 'old_next', 'new_next'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayFormat = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
// The date (YYYY-MM-DD) of an instant in a time zone.
export function dayOf(date, timeZone) {
  const p = Object.fromEntries(dayFormat(timeZone).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// The day before a date YYYY-MM-DD, or the day after it (step 1).
export function shiftDay(day, step) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + step)).toISOString().slice(0, 10);
}
// The instant (ISO, UTC) at which the date YYYY-MM-DD starts in the time zone: the first minute whose date there is
// that day. A search by the minute, so a day of 23 or 25 hours and a zone with a half hour are right.
export function dayStart(day, timeZone) {
  const [y, m, d] = day.split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  let lo = noon - 38 * 3600000; // the day before, in every zone
  let hi = noon;                // the day itself, or the next day in a zone far east: still not before its start
  while (dayOf(new Date(hi), timeZone) > day) hi -= 12 * 3600000;
  while (hi - lo > 60000) {
    const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
    if (dayOf(new Date(mid), timeZone) < day) lo = mid; else hi = mid;
  }
  return new Date(hi).toISOString();
}

// One event as it goes into the file. Without withText, the body texts go and their lengths stay.
export function exportEvent(row, { withText = false } = {}) {
  let payload;
  try { payload = JSON.parse(row.payload); } catch { payload = {}; }
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!TEXT_KEYS.includes(key)) { out[key] = value; continue; }
    if (withText) out[key] = value;
    out[`${key}_length`] = typeof value === 'string' ? value.length : null;
  }
  return { id: row.id, at: row.at, kind: row.kind, memo_id: row.memo_id, actor: row.actor, payload: out };
}

// Writes the events of one day. day: YYYY-MM-DD; with none, the day before today in the time zone. The file is
// written whole and then renamed, so a reader never sees half of it, and a second run for the same day replaces the
// file with the same lines. A day with no events gives an empty file: the run happened.
export function exportDay({ db, dir, day, timeZone = 'UTC', withText = false, now = () => new Date() }) {
  const which = day ?? shiftDay(dayOf(now(), timeZone), -1);
  if (!DAY.test(which) || shiftDay(which, 0) !== which) throw new Error('The day must be a date in the form YYYY-MM-DD.');
  const from = dayStart(which, timeZone);
  const to = dayStart(shiftDay(which, 1), timeZone);
  const rows = db.prepare('SELECT id, at, kind, memo_id, actor, payload FROM events WHERE at >= ? AND at < ? ORDER BY id').all(from, to);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${which}.jsonl`);
  const part = `${path}.part`;
  writeFileSync(part, rows.map((r) => `${JSON.stringify(exportEvent(r, { withText }))}\n`).join(''));
  renameSync(part, path);
  return { day: which, path, count: rows.length, from, to, timeZone, withText };
}
