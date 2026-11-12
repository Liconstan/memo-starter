// Reads a calendar in iCalendar format (RFC 5545), for example the secret iCal address of a Google Calendar, and gives
// the events of one day. No library: the parts that Google Calendar writes are here (line folding, TZID, UTC and
// all-day times, RRULE with FREQ DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH,
// BYSETPOS, WKST, EXDATE, RECURRENCE-ID and STATUS:CANCELLED). Intl converts a TZID time to UTC. An event that the
// owner declined or has not answered (her ATTENDEE line, matched to the name of the calendar) is left out.

const DAY_MS = 86_400_000;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// A rule with no end stops after this many periods. That is 270 years of days.
const MAX_PERIODS = 100_000;

export function unfold(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
}

function splitOutsideQuotes(text, sep) {
  const out = [];
  let quoted = false, from = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') quoted = !quoted;
    else if (text[i] === sep && !quoted) { out.push(text.slice(from, i)); from = i + 1; }
  }
  out.push(text.slice(from));
  return out;
}

function parseLine(line) {
  let quoted = false, i = 0;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = splitOutsideQuotes(line.slice(0, i), ';');
  const params = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"(.*)"$/, '$1');
  }
  return { name: name.toUpperCase(), params, value: line.slice(i + 1) };
}

const unescapeText = (v) => v.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

// The calendar: its name (Google puts the account address there), its time zone, and the VEVENTs as lists of properties.
export function parseCalendar(text) {
  const cal = { name: '', timeZone: '', events: [] };
  let event = null, depth = 0;
  for (const line of unfold(text).split('\n')) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      if (event) depth++;
      else if (p.value.toUpperCase() === 'VEVENT') event = {};
      else if (p.value.toUpperCase() !== 'VCALENDAR') depth++;
      continue;
    }
    if (p.name === 'END') {
      if (depth) depth--;
      else if (event && p.value.toUpperCase() === 'VEVENT') { cal.events.push(event); event = null; }
      continue;
    }
    if (depth) continue; // VALARM, VTIMEZONE and other parts
    if (event) (event[p.name] ||= []).push(p);
    else if (p.name === 'X-WR-CALNAME') cal.name = unescapeText(p.value);
    else if (p.name === 'X-WR-TIMEZONE') cal.timeZone = p.value;
  }
  return cal;
}

const formats = new Map();
function formatter(zone) {
  let f = formats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formats.set(zone, f);
  }
  return f;
}
export function validZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try { formatter(zone); return true; } catch { return false; }
}
// The difference between the wall clock of the zone and UTC at an instant, in ms.
function offsetMs(zone, ms) {
  const p = {};
  for (const { type, value } of formatter(zone).formatToParts(new Date(ms))) p[type] = value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// A wall-clock time in a zone, to an instant (ms since 1970, UTC). A time in the gap of a change to summer time
// moves forward by the size of the gap; a time that comes twice gives the first.
export function zonedToUtc({ y, mo, d, h = 0, mi = 0, s = 0 }, zone) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (zone === 'UTC') return guess;
  const first = offsetMs(zone, guess);
  let t = guess - first;
  const second = offsetMs(zone, t);
  if (second !== first && offsetMs(zone, guess - second) === second) t = guess - second;
  return t;
}

// Day numbers: days since 1970-01-01. They make the date arithmetic simple.
const dayOf = (y, mo, d) => Date.UTC(y, mo - 1, d) / DAY_MS;
function partsOf(day) {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}
const isoDate = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);
const daysInMonth = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();

// A TZID: an IANA name. Some programs put a path before it (/mozilla.org/.../America/New_York).
function zoneOf(tzid, fallback) {
  if (tzid) {
    if (validZone(tzid)) return tzid;
    const tail = tzid.split('/').slice(-2).join('/');
    if (validZone(tail)) return tail;
  }
  return validZone(fallback) ? fallback : 'UTC';
}

// One value of DTSTART, DTEND, EXDATE, RECURRENCE-ID or UNTIL.
function parseTime(value, params = {}, fallbackZone) {
  const m = String(value).trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const day = dayOf(+y, +mo, +d);
  if (h === undefined || params.VALUE === 'DATE') return { allDay: true, day };
  const fields = { h: +h, mi: +mi, s: +(s || 0) };
  const zone = z ? 'UTC' : zoneOf(params.TZID, fallbackZone);
  return { allDay: false, day, ...fields, zone };
}
const instant = (t, day = t.day) => {
  const p = partsOf(day);
  return zonedToUtc({ y: p.y, mo: p.mo, d: p.d, h: t.h, mi: t.mi, s: t.s }, t.zone);
};
// The key of one occurrence, for EXDATE and RECURRENCE-ID: the instant, or the date of an all-day event.
const keyOf = (t) => (t.allDay ? `d${t.day}` : `t${instant(t)}`);

function parseDuration(v) {
  const m = String(v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w || 0) * 7 + +(d || 0)) * 86400 + +(h || 0) * 3600 + +(mi || 0) * 60 + +(s || 0)) * 1000;
  return sign === '-' ? -ms : ms;
}

export function parseRule(value) {
  const r = { freq: '', interval: 1, count: 0, until: null, byday: [], bymonthday: [], bymonth: [], bysetpos: [], wkst: 1 };
  for (const part of String(value).split(';')) {
    const [k, v = ''] = part.split('=');
    const list = v.split(',').filter(Boolean);
    switch (k.toUpperCase()) {
      case 'FREQ': r.freq = v.toUpperCase(); break;
      case 'INTERVAL': r.interval = Math.max(1, parseInt(v, 10) || 1); break;
      case 'COUNT': r.count = Math.max(0, parseInt(v, 10) || 0); break;
      case 'UNTIL': r.until = v; break;
      case 'BYDAY': r.byday = list.map((x) => {
        const m = x.toUpperCase().match(/^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/);
        return m && { n: m[1] ? parseInt(m[1], 10) : 0, wd: WEEKDAYS.indexOf(m[2]) };
      }).filter(Boolean); break;
      case 'BYMONTHDAY': r.bymonthday = list.map(Number).filter((n) => Number.isInteger(n) && n); break;
      case 'BYMONTH': r.bymonth = list.map(Number).filter((n) => n >= 1 && n <= 12); break;
      case 'BYSETPOS': r.bysetpos = list.map(Number).filter((n) => Number.isInteger(n) && n); break;
      case 'WKST': r.wkst = Math.max(0, WEEKDAYS.indexOf(v.toUpperCase())); break;
      default: break;
    }
  }
  return r;
}

// The days from first to last (day numbers) that match BYDAY, with its ordinals (2TU, -1FR) counted in that span.
function weekdaysIn(first, last, byday) {
  const out = [];
  for (const { n, wd } of byday) {
    const all = [];
    for (let day = first + ((wd - partsOf(first).wd + 7) % 7); day <= last; day += 7) all.push(day);
    if (!n) out.push(...all);
    else { const pick = n > 0 ? all[n - 1] : all[all.length + n]; if (pick !== undefined) out.push(pick); }
  }
  return out;
}
function monthDays(y, mo, rule, defaultDay) {
  const dim = daysInMonth(y, mo);
  const first = dayOf(y, mo, 1);
  if (rule.bymonthday.length) {
    let days = rule.bymonthday.map((md) => (md > 0 ? md : dim + md + 1)).filter((d) => d >= 1 && d <= dim).map((d) => first + d - 1);
    if (rule.byday.length) days = days.filter((day) => rule.byday.some((b) => b.wd === partsOf(day).wd));
    return days;
  }
  if (rule.byday.length) return weekdaysIn(first, first + dim - 1, rule.byday);
  return defaultDay <= dim ? [first + defaultDay - 1] : [];
}

// The candidate days of period k of the rule, sorted, with no repeats.
function periodDays(rule, start, k) {
  const s = partsOf(start);
  const iv = rule.interval;
  let days;
  if (rule.freq === 'DAILY') {
    days = [start + k * iv];
    if (rule.byday.length) days = days.filter((day) => rule.byday.some((b) => b.wd === partsOf(day).wd));
    if (rule.bymonthday.length) days = days.filter((day) => monthDays(partsOf(day).y, partsOf(day).mo, { ...rule, byday: [] }, 0).includes(day));
  } else if (rule.freq === 'WEEKLY') {
    const weekStart = start - ((s.wd - rule.wkst + 7) % 7) + 7 * k * iv;
    const wds = rule.byday.length ? rule.byday.map((b) => b.wd) : [s.wd];
    days = wds.map((wd) => weekStart + ((wd - rule.wkst + 7) % 7));
  } else if (rule.freq === 'MONTHLY') {
    const total = s.y * 12 + (s.mo - 1) + k * iv;
    days = monthDays(Math.floor(total / 12), (total % 12) + 1, rule, s.d);
  } else if (rule.freq === 'YEARLY') {
    const y = s.y + k * iv;
    if (rule.byday.length && !rule.bymonth.length && !rule.bymonthday.length) days = weekdaysIn(dayOf(y, 1, 1), dayOf(y, 12, 31), rule.byday);
    else days = (rule.bymonth.length ? rule.bymonth : [s.mo]).flatMap((mo) => monthDays(y, mo, rule, s.d));
  } else return null;
  if (rule.bymonth.length && rule.freq !== 'YEARLY') days = days.filter((day) => rule.bymonth.includes(partsOf(day).mo));
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bysetpos.length) days = rule.bysetpos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((d) => d !== undefined).sort((a, b) => a - b);
  return days;
}
const PERIOD_DAYS = { DAILY: 1, WEEKLY: 7, MONTHLY: 28, YEARLY: 365 };

// The start days of a recurring event, from its first day, that can touch the days from firstDay to lastDay (a margin
// of a day on each side: the zone of the event can differ from the zone of the window).
// durDays: how many days one occurrence can cover, so an occurrence that starts before the window still counts.
function* recurrenceDays(rule, dtstart, untilOk, firstDay, lastDay, durDays) {
  const start = dtstart.day;
  let k = 0;
  if (!rule.count) {
    // With no COUNT, the periods long before the window cannot matter. Skip them.
    const span = PERIOD_DAYS[rule.freq] * rule.interval;
    k = Math.max(0, Math.floor((firstDay - start - durDays) / span) - 2);
  }
  let n = 0;
  if (k === 0) { yield start; n++; } // DTSTART is always the first occurrence
  for (; k < MAX_PERIODS; k++) {
    const days = periodDays(rule, start, k);
    if (!days) return;
    for (const day of days) {
      if (day <= start) continue;
      if (day > lastDay) return;
      if (!untilOk(day)) return;
      if (rule.count && n >= rule.count) return;
      n++;
      yield day;
    }
    if (rule.count && n >= rule.count) return;
  }
}

const textOf = (ev, name) => (ev[name]?.[0] ? unescapeText(ev[name][0].value) : '');
const emailOf = (v) => String(v).replace(/^mailto:/i, '').trim().toLowerCase();

// The other people of an event, for the detail of the Today card. Each ATTENDEE line gives { name, email, status }: the
// name from CN (or '' when there is none), the address, and the answer (accepted, declined, tentative, needs-action, or
// ''). The owner (self) is left out: the detail does not list her, and her address is part of the secret address of a
// primary calendar, which must not be in an answer. A room or other resource (CUTYPE) is a place, not a person.
function attendeesOf(ev, self) {
  return (ev.ATTENDEE || []).map((a) => ({
    name: a.params.CN || '', email: emailOf(a.value), status: (a.params.PARTSTAT || '').toLowerCase(), cutype: (a.params.CUTYPE || '').toUpperCase(),
  })).filter((a) => a.email && a.email !== self && !['RESOURCE', 'ROOM'].includes(a.cutype)).map(({ cutype, ...a }) => a);
}
// The organizer, { name, email }, or null when there is none or when it is the owner.
function organizerOf(ev, self) {
  const o = ev.ORGANIZER?.[0];
  return o && emailOf(o.value) !== self ? { name: o.params.CN || '', email: emailOf(o.value) } : null;
}
// The video link of an event: X-GOOGLE-CONFERENCE (Google Meet), else URL, else the first web address in the location
// or the description (a Zoom or Teams link usually sits there). '' when there is none.
const WEB = /https?:\/\/[^\s<>"']+/i;
function linkOf(ev) {
  for (const v of [ev['X-GOOGLE-CONFERENCE']?.[0]?.value, ev.URL?.[0]?.value, textOf(ev, 'LOCATION'), textOf(ev, 'DESCRIPTION')]) {
    const m = WEB.exec(v || '');
    if (m) return m[0].replace(/[.,;:!?)]+$/, '');
  }
  return '';
}

// Whether the owner (self: the address of the calendar, lowercase) is not going: her own ATTENDEE line says
// PARTSTAT=DECLINED or NEEDS-ACTION. An event with no line for her (her own holds, an event she organizes with
// no attendees) is hers, and a calendar whose name is not an address cannot tell. Google sometimes lists the
// organizer as an attendee with PARTSTAT=ACCEPTED, which is fine.
function notGoing(ev, self) {
  if (!self) return false;
  const mine = (ev.ATTENDEE || []).find((a) => emailOf(a.value) === self);
  const answer = (mine?.params.PARTSTAT || '').toUpperCase();
  return answer === 'DECLINED' || answer === 'NEEDS-ACTION';
}

// The events of one day. date: YYYY-MM-DD. zone: the time zone in which the day is (the browser of the owner).
// options.self: the address of the owner of the calendar (the id of a primary calendar, from its iCal address). Without
// it, the name of the calendar counts when it is an address; Google names a primary feed by its display name, so the
// server gives self. Gives { title, start, end, allDay, location, hasOthers, attendees, organizer, link }; start and end
// are UTC ISO times, or dates for an all-day event (the end date is the day after the last day, as in iCalendar).
// attendees (the other people), organizer (not the owner) and link are for the detail that opens on a click on an event
// in the Today card. The address of the owner is in no answer.
// options.uid: true adds uid, the UID of the event, for the meeting follow-ups (src/followups.js). The Today card
// does not ask for it.
export function eventsOn(calendar, date, zone, { self: owner = '', uid: withUid = false } = {}) {
  const cal = typeof calendar === 'string' ? parseCalendar(calendar) : calendar;
  const [y, mo, d] = date.split('-').map(Number);
  const day = dayOf(y, mo, d);
  const from = zonedToUtc({ y, mo, d }, zone);
  const nextDay = partsOf(day + 1);
  const to = zonedToUtc({ y: nextDay.y, mo: nextDay.mo, d: nextDay.d }, zone);
  const self = owner.includes('@') ? owner.trim().toLowerCase() : cal.name.includes('@') ? cal.name.toLowerCase() : '';
  const calZone = validZone(cal.timeZone) ? cal.timeZone : 'UTC';

  // RECURRENCE-ID overrides, by UID: they take the place of one occurrence of the main event.
  const overridden = new Map();
  for (const ev of cal.events) {
    const rid = ev['RECURRENCE-ID']?.[0];
    if (!rid) continue;
    const t = parseTime(rid.value, rid.params, calZone);
    if (!t) continue;
    const uid = textOf(ev, 'UID');
    if (!overridden.has(uid)) overridden.set(uid, new Set());
    overridden.get(uid).add(keyOf(t));
  }

  const out = [];
  const add = (ev, startT, startMs, durMs, durDays) => {
    const base = {
      title: textOf(ev, 'SUMMARY') || '(No title)',
      location: textOf(ev, 'LOCATION'),
      hasOthers: (ev.ATTENDEE || []).map((a) => emailOf(a.value)).filter((e) => e && e !== self).length > (self ? 0 : 1),
      attendees: attendeesOf(ev, self),
      organizer: organizerOf(ev, self),
      link: linkOf(ev),
      ...(withUid ? { uid: textOf(ev, 'UID') } : {}),
    };
    if (startT.allDay) {
      const end = startT.day + Math.max(1, durDays);
      if (startT.day <= day && day < end) out.push({ ...base, start: isoDate(startT.day), end: isoDate(end), allDay: true });
      return;
    }
    const endMs = startMs + Math.max(0, durMs);
    const touches = endMs > startMs ? startMs < to && endMs > from : startMs >= from && startMs < to;
    if (touches) out.push({ ...base, start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), allDay: false });
  };

  for (const ev of cal.events) {
    if (textOf(ev, 'STATUS').toUpperCase() === 'CANCELLED') continue;
    // Each VEVENT by its own ATTENDEE list: an override can decline one occurrence of an accepted series. The
    // override is already in `overridden`, so the occurrence of the main event goes too.
    if (notGoing(ev, self)) continue;
    const ds = ev.DTSTART?.[0];
    const dtstart = ds && parseTime(ds.value, ds.params, calZone);
    if (!dtstart) continue;
    const de = ev.DTEND?.[0];
    const dtend = de && parseTime(de.value, de.params, calZone);
    const startMs = dtstart.allDay ? 0 : instant(dtstart);
    let durMs = 0, durDays = 1;
    if (dtstart.allDay) {
      if (dtend) durDays = dtend.day - dtstart.day;
      else if (ev.DURATION) durDays = Math.round((parseDuration(ev.DURATION[0].value) || DAY_MS) / DAY_MS);
    } else if (dtend) durMs = (dtend.allDay ? dtend.day * DAY_MS : instant(dtend)) - startMs;
    else if (ev.DURATION) durMs = parseDuration(ev.DURATION[0].value) || 0;
    if (!dtstart.allDay) durDays = Math.ceil(durMs / DAY_MS) + 1;

    const rruleProp = ev.RRULE?.[0];
    if (ev['RECURRENCE-ID'] || !rruleProp) { add(ev, dtstart, startMs, durMs, durDays); continue; }

    const rule = parseRule(rruleProp.value);
    if (!PERIOD_DAYS[rule.freq]) { add(ev, dtstart, startMs, durMs, durDays); continue; }
    const skip = new Set(overridden.get(textOf(ev, 'UID')) || []);
    for (const ex of ev.EXDATE || []) {
      for (const v of ex.value.split(',')) {
        const t = parseTime(v, { ...ex.params, VALUE: ex.params.VALUE || (dtstart.allDay ? 'DATE' : undefined) }, dtstart.zone || calZone);
        if (t) skip.add(keyOf(t));
      }
    }
    let untilOk = () => true;
    if (rule.until) {
      const u = parseTime(rule.until, {}, dtstart.zone || calZone);
      if (u?.allDay) untilOk = (dd) => dd <= u.day;
      else if (u) { const limit = instant(u); untilOk = (dd) => (dtstart.allDay ? dd * DAY_MS : instant(dtstart, dd)) <= limit; }
    }
    for (const dd of recurrenceDays(rule, dtstart, untilOk, day - 1, day + 2, durDays)) {
      const t = { ...dtstart, day: dd };
      if (skip.has(keyOf(t))) continue;
      add(ev, t, dtstart.allDay ? 0 : instant(t), durMs, durDays);
    }
  }
  return out.sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title));
}
