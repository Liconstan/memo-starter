import { parseCalendar, eventsOn, validZone } from './ical.js';

// The meeting follow-up trigger (memo 1323). About 30 minutes after a meeting of the owner ends, the agent main gets
// one memo "Follow-up: <event title>" with the time of the meeting, the other people, and the request to draft the
// follow-ups. The server only sends the trigger: the agent does the work (scripts/meeting-followups.md in the vault).
//
// A meeting is an event of a work calendar of the owner with one other person or more. The calendars are those of the
// Today card: the secret iCal addresses of MEMO_CALENDAR_ICS and the ones added on the Inbox page (data/calendars.json).
// Only a calendar whose owner (the id in its address, calendarOwner in src/app.js) is on the work domain counts
// (MEMO_FOLLOWUP_DOMAIN, see followupDomain below), so a personal calendar never gives a memo. The job leaves these events alone: an all-day event, a cancelled event, an
// event that the owner declined or has not answered (src/ical.js leaves the three out or marks them), an event with
// no other person (a room is not a person), and the holds of the owner, whose title starts with Focus, Hold or Block.
//
// Only an event that ended in the last 24 hours counts, so a server that was off for a week does not send the
// meetings of that week. One memo per occurrence: the followups_sent table keeps the UID of the event with the start
// of the occurrence, so a restart of the server, a second calendar with the same event, and a later pass send nothing
// more. The job follows src/handover.js and src/fable-spare.js: one pass each minute, the memo through the store, and
// a nudge for an agent that sits idle at its prompt.
export const FOLLOWUPS_EVERY_MS = 60000;
export const FOLLOWUP_DELAY_MIN = 30;
export const FOLLOWUP_WINDOW_MS = 24 * 60 * 60 * 1000;
// The job reads the list of the calendars and each calendar again after this time. The pass itself is each minute.
const CALENDAR_CACHE_MS = 5 * 60 * 1000;
// The work domain when MEMO_FOLLOWUP_DOMAIN is not set and no calendar gives one: a name that no calendar has, so no calendar counts.
export const FOLLOWUP_DOMAIN = 'not-set.invalid';
// The mail services for a personal address. A calendar of one of these is never the work calendar by default.
const PERSONAL_MAIL = new Set(['gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'fastmail.com', 'hey.com']);
// The holds of the owner: "Focus time", "Hold for travel", "Block: writing". Whole words: "Blockchain call" is a meeting.
export const HOLD = /^\s*(focus|hold|block)\b/i;
export const FOLLOWUP_REQUEST = 'Meeting ended. Draft the follow-ups: per scripts/meeting-followups.md in the vault.';
const MAX_TITLE = 60; // as in src/memos.js

// MEMO_FOLLOWUPS: on by default; 0, false, off or no turns the job off.
export const followupsOn = (value) => !['0', 'false', 'off', 'no'].includes(String(value ?? '').trim().toLowerCase());
// MEMO_FOLLOWUP_DELAY_MIN: minutes after the end of the event, 0 or more. Anything else gives the default, 30.
export function followupDelay(value) {
  const n = Number(value);
  return value !== undefined && String(value).trim() !== '' && Number.isFinite(n) && n >= 0 ? n : FOLLOWUP_DELAY_MIN;
}

// The domain of a mail address, in small letters: '' for no address.
const domainOf = (address) => { const s = String(address ?? ''); return s.includes('@') ? s.slice(s.lastIndexOf('@') + 1).trim().toLowerCase() : ''; };
// The work domain. MEMO_FOLLOWUP_DOMAIN when it is set ("example.com"; "@example.com" reads the same). Or else the
// domain of the work calendar of the owner: the first calendar, those of .env before those of the page, whose owner is
// not at a personal mail service (gmail.com and the like). Or else FOLLOWUP_DOMAIN, which no calendar is on. owners: the owner of each calendar.
export function followupDomain(value, owners = []) {
  const set = String(value ?? '').trim().toLowerCase().replace(/^@/, '');
  if (set) return set;
  return owners.map(domainOf).find((d) => d && !PERSONAL_MAIL.has(d)) || FOLLOWUP_DOMAIN;
}

// The date (YYYY-MM-DD) of an instant in a zone.
const dateIn = (ms, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
// Some versions of Node put a narrow no-break space before AM and PM. A plain space reads the same everywhere.
const plain = (s) => s.replace(/[  ]/g, ' ');

// The start and the end of an event in the zone of the owner: "Tue, Nov 10, 10:00 AM to 10:30 AM PST". An event that
// ends on a different day gives the day of the end too.
export function followupWhen(start, end, zone) {
  const full = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(end)).find((p) => p.type === 'timeZoneName')?.value || zone;
  const [s, e] = [Date.parse(start), Date.parse(end)];
  const sameDay = dateIn(s, zone) === dateIn(e, zone);
  return plain(`${full.format(new Date(s))} to ${(sameDay ? time : full).format(new Date(e))} ${name}`);
}

// The other people of an event, one for each address: the attendees, and the organizer when the list does not have
// them. Each is { name, email, status }.
function peopleOf(event) {
  const people = [...event.attendees];
  if (event.organizer && !people.some((p) => p.email === event.organizer.email)) people.unshift({ ...event.organizer, status: '' });
  const seen = new Set();
  return people.filter((p) => !seen.has(p.email) && seen.add(p.email));
}

// The text of the memo. Plain lines with no parentheses: the owner uses a screen reader, and she may read the memo.
export function followupText(event, zone) {
  return [
    FOLLOWUP_REQUEST,
    '',
    `Event: ${event.title}`,
    `Time: ${followupWhen(event.start, event.end, zone)}`,
    'Attendees:',
    ...peopleOf(event).map((p) => `- ${[p.name, p.email, p.status === 'declined' ? 'declined' : ''].filter(Boolean).join(', ')}`),
  ].join('\n');
}

// store: src/memos.js. urls: the secret iCal addresses, a list, or a function that gives the list as it is now (the
// server gives those of MEMO_CALENDAR_ICS and then those of data/calendars.json); the job asks again each 5 minutes,
// so a calendar that the owner adds on the Inbox page counts with no restart. With an empty list the job does nothing.
// getCalendar(url): the text of a calendar. selfOf(url): the address of the owner of a calendar, from its address.
// domain: the work domain, a name or a function of the owners of the calendars that gives it (followupDomain). Only a
// calendar whose owner is on it is read; a calendar with no owner (a group calendar) is not. With no domain, each
// calendar counts. on: false turns the job off (MEMO_FOLLOWUPS=0). delayMin: the minutes after the end of the event. to: the agent
// that gets the memo. arrived(name): the nudge of src/agents.js. timeZone: the zone of the owner, a name or a
// function that gives it. log(line): the log of the server; no line ever has a calendar address.
export function createFollowups({ db, store, owner, urls = [], getCalendar, selfOf = () => '', domain, on = true, delayMin = FOLLOWUP_DELAY_MIN, to = 'main',
  arrived = () => {}, now = () => new Date(), log = console.log, timeZone = store.timeZone }) {
  const listNow = typeof urls === 'function' ? urls : () => urls;
  // With a function the list can grow later, so the job runs with an empty list too.
  const active = Boolean(on && getCalendar && (typeof urls === 'function' || urls.length));
  const delayMs = delayMin * 60000;
  const zoneNow = () => {
    const z = typeof timeZone === 'function' ? timeZone() : timeZone;
    return validZone(z) ? z : store.timeZone;
  };
  const cache = new Map(); // url -> { at, cal }
  const failed = new Set(); // the calendars that did not load at the last try, so the log says it once
  const refused = new Set(); // the occurrences whose memo the store refused, so the log says it once

  // The calendars of the job as they are now: { total, domain, used: [{ url, place, self }] }. place is the place of
  // the calendar in the whole list, from 1, as the Inbox page names it ("Calendar 2").
  function sources() {
    let list = [];
    try { list = [...new Set((listNow() || []).filter((u) => typeof u === 'string' && u))]; } catch { list = []; }
    const all = list.map((url, i) => ({ url, place: i + 1, self: selfOf(url) || '' }));
    const name = typeof domain === 'function' ? domain(all.map((s) => s.self)) : domain;
    const work = String(name ?? '').trim().toLowerCase().replace(/^@/, '');
    return { total: all.length, domain: work, used: work ? all.filter((s) => domainOf(s.self) === work) : all };
  }
  // The counts for the log of the server: { total, used, domain }. Never an address.
  const watching = () => { const s = sources(); return { total: s.total, used: s.used.length, domain: s.domain }; };
  let listed = null; // { at, used, total }: the list, kept 5 minutes like each calendar

  // The calendars, each read again after 5 minutes. A calendar that does not load is left out of this pass; the
  // next pass tries again. The message has the place of the calendar in the list and never its address.
  async function calendars() {
    if (!listed || now().getTime() - listed.at >= CALENDAR_CACHE_MS) {
      const s = sources();
      // The log says it when the number of calendars changes after the start, for example a calendar added on the page.
      if (listed && (listed.used.length !== s.used.length || listed.total !== s.total)) {
        log(`followups: ${s.used.length} of ${s.total} calendars ${s.domain ? `on the work domain ${s.domain}` : 'in use'} now.`);
      }
      listed = { at: now().getTime(), used: s.used, total: s.total };
      const keep = new Set(s.used.map((u) => u.url));
      for (const set of [cache, failed]) for (const url of [...set.keys()]) if (!keep.has(url)) set.delete(url);
    }
    const out = [];
    for (const { url, place, self } of listed.used) {
      const hit = cache.get(url);
      if (hit && now().getTime() - hit.at < CALENDAR_CACHE_MS) { out.push(hit); continue; }
      try {
        const text = await getCalendar(url);
        if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not a calendar');
        const entry = { at: now().getTime(), cal: parseCalendar(text), self };
        cache.set(url, entry);
        failed.delete(url);
        out.push(entry);
      } catch {
        cache.delete(url);
        if (!failed.has(url)) log(`followups: calendar ${place} did not load. The next pass tries again.`);
        failed.add(url);
      }
    }
    return out;
  }

  // The meetings that ended in the window, from the delay ago back to 24 hours ago, oldest end first, one for each key.
  function ended(cals) {
    const zone = zoneNow();
    const t = now().getTime();
    const [from, until] = [t - FOLLOWUP_WINDOW_MS, t - delayMs];
    // The days of the zone that the window touches. An event is on the day of its end, or on the day before when it
    // ends at midnight.
    const dates = new Set();
    for (let ms = from - 6 * 3600000; ms <= t; ms += 6 * 3600000) dates.add(dateIn(ms, zone));
    dates.add(dateIn(t, zone));
    const byKey = new Map();
    for (const { cal, self } of cals) {
      for (const date of dates) {
        for (const e of eventsOn(cal, date, zone, { self, uid: true })) {
          if (e.allDay) continue;
          const end = Date.parse(e.end);
          if (!(end >= from && end <= until)) continue;
          if (HOLD.test(e.title)) continue;
          // hasOthers counts the addresses that are not the owner; attendees leaves out a room. Both must say yes.
          if (!e.hasOthers || !e.attendees.length) continue;
          const key = `${e.uid || `no-uid:${e.title}`}|${e.start}`;
          if (!byKey.has(key)) byKey.set(key, { ...e, key });
        }
      }
    }
    return { zone, events: [...byKey.values()].sort((a, b) => a.end.localeCompare(b.end) || a.start.localeCompare(b.start)) };
  }

  let busy = false;
  // One pass: gives the memos it sent, [{ key, title, memo }].
  async function run() {
    if (!active || busy) return [];
    busy = true;
    try {
      const { zone, events } = ended(await calendars());
      const out = [];
      for (const e of events) {
        // The row goes in first: an occurrence that has its row never gets a second memo, whatever comes after.
        const claim = db.prepare('INSERT OR IGNORE INTO followups_sent (event_key, title, ends, at) VALUES (?, ?, ?, ?)').run(e.key, e.title, e.end, now().toISOString());
        if (!claim.changes) continue;
        const ws = store.workstreams && Object.hasOwn(store.workstreams, 'PROG') ? 'PROG' : undefined;
        let memo;
        try {
          // The store keeps an impact and an effort only for a memo to the owner; for a memo to an agent it drops the two.
          memo = store.send({ from: owner, to, ws, impact: 3, effort: 'short', title: `Follow-up: ${e.title}`.replace(/\s+/g, ' ').slice(0, MAX_TITLE).trim(), text: followupText(e, zone) }).memo;
        } catch (err) {
          // No memo went, so the row goes too, and a later pass can send it.
          db.prepare('DELETE FROM followups_sent WHERE event_key = ?').run(e.key);
          if (!refused.has(e.key)) log(`followups memo: ${err.message}`);
          refused.add(e.key);
          continue;
        }
        db.prepare('UPDATE followups_sent SET memo_id = ? WHERE event_key = ?').run(memo.id, e.key);
        log(`followups: memo ${memo.id} to ${to} for the meeting that ended at ${e.end}.`);
        // memo wait of the agent gets the memo with its next request, in 30 seconds or less. An agent that sits idle
        // at its prompt gets a nudge.
        arrived(to);
        out.push({ key: e.key, title: e.title, memo });
      }
      return out;
    } finally { busy = false; }
  }

  let timer = null;
  function start(everyMs = FOLLOWUPS_EVERY_MS) {
    if (!active) return;
    const pass = () => { run().catch((err) => log(`followups: ${err.message}`)); };
    timer = setInterval(pass, everyMs);
    timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  return { run, start, stop, active, watching };
}
