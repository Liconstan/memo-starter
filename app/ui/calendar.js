// The day grid of the Today card in the Inbox: the place of each event and its text. The page shows the times in the
// time zone of the browser, so the grid follows the owner when she travels. No DOM here, so the tests can run it.

// The hours that the grid shows at least. Events outside make it larger.
export const FIRST_HOUR = 7;
export const LAST_HOUR = 22;

function parts(iso, zone) {
  const p = {};
  const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  for (const { type, value } of f.formatToParts(new Date(iso))) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (+p.hour % 24) * 60 + +p.minute };
}

// The minute of the day (0 to 1440) at which an instant is on the given date in the zone. Before the day: 0. After: 1440.
export function minuteOf(iso, date, zone) {
  const p = parts(iso, zone);
  if (p.date < date) return 0;
  if (p.date > date) return 1440;
  return p.minutes;
}

// "1:00 PM", or with withPeriod false "1:00".
function clock(iso, zone, withPeriod = true) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso));
  const time = p.filter((x) => x.type === 'hour' || x.type === 'minute' || (x.type === 'literal' && x.value === ':')).map((x) => x.value).join('');
  const period = p.find((x) => x.type === 'dayPeriod')?.value || '';
  return { time, period, text: withPeriod && period ? `${time} ${period}` : time };
}

// "1:00 to 1:30 PM", "11:30 AM to 12:30 PM".
export function timeRange(start, end, zone) {
  const a = clock(start, zone);
  const b = clock(end, zone);
  if (start === end) return a.text;
  return a.period === b.period && parts(start, zone).date === parts(end, zone).date ? `${a.time} to ${b.text}` : `${a.text} to ${b.text}`;
}

// The text for a screen reader, and the title of a block: "1:00 to 1:30 PM, Sam and Andrea".
export function eventLabel(event, zone) {
  const when = event.allDay ? 'All day' : timeRange(event.start, event.end, zone);
  return [when, event.title, event.location].filter(Boolean).join(', ');
}

// The words for the answer of an attendee, in the detail of an event.
const ANSWER = { accepted: 'accepted', declined: 'declined', tentative: 'maybe', 'needs-action': 'no answer' };

// One attendee in the detail of an event: "Sam Lee (accepted)", "sam@example.com (no answer)", "Sam Lee".
export function attendeeLabel(a) {
  const who = a.name || a.email;
  const answer = ANSWER[a.status] || '';
  return answer ? `${who} (${answer})` : who;
}

// The host of a web address, as the text of a link: "meet.google.com".
export function linkHost(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

// The rows of the detail that opens on a click on an event in the Today card: the day and time, the place, the video
// link, the organizer, and the other people with their answers (the server leaves the owner out). A row is
// { label, text } with an optional href, or { label, items } for the list of people. The event can come from an older
// copy with no attendees, organizer or link.
export function eventDetails(event, date, zone) {
  const rows = [];
  if (event.allDay) {
    const last = new Date(Date.parse(event.end) - 86_400_000).toISOString().slice(0, 10);
    rows.push({ label: 'When', text: last > event.start ? `All day, ${dayLabel(event.start)} to ${dayLabel(last)}` : `All day, ${dayLabel(date)}` });
  } else rows.push({ label: 'When', text: `${dayLabel(date)}, ${timeRange(event.start, event.end, zone)}` });
  const isWeb = (v) => /^https?:\/\//i.test(v || '');
  if (event.location) rows.push(isWeb(event.location) ? { label: 'Where', text: linkHost(event.location), href: event.location } : { label: 'Where', text: event.location });
  if (event.link && event.link !== event.location) rows.push({ label: 'Link', text: `Join on ${linkHost(event.link)}`, href: event.link });
  const organizer = event.organizer;
  if (organizer?.email) rows.push({ label: 'Organizer', text: organizer.name || organizer.email });
  const people = event.attendees || [];
  if (people.length) rows.push({ label: 'With', items: people.map(attendeeLabel) });
  return rows;
}

export const hourLabel = (h) => (h % 24 === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`);

// "Wednesday, October 21" for YYYY-MM-DD.
export function dayLabel(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
}

// "America/New York (EDT)".
export function zoneLabel(zone, now = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(now).find((x) => x.type === 'timeZoneName')?.value;
  const name = zone.replaceAll('_', ' ');
  return short && short !== zone ? `${name} (${short})` : name;
}

// The blocks of the timed events of the day: from and to (minutes in the day), and the column of each block. Events
// that overlap sit side by side; a group of events that overlap shares its width.
export function layout(events, date, zone) {
  const items = events.filter((e) => !e.allDay).map((event) => {
    const from = minuteOf(event.start, date, zone);
    // A block has room for at least its title: 15 minutes.
    const to = Math.max(minuteOf(event.end, date, zone), Math.min(from + 15, 1440));
    return { event, from, to, col: 0, cols: 1 };
  }).filter((x) => x.to > x.from || x.from < 1440)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  let group = [];
  let groupEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...group.map((x) => x.col + 1));
    for (const x of group) x.cols = cols;
  };
  for (const item of items) {
    if (item.from >= groupEnd) { close(); group = []; }
    // The first column whose last block ends before this block starts.
    const used = group.filter((x) => x.to > item.from).map((x) => x.col);
    let col = 0;
    while (used.includes(col)) col++;
    item.col = col;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.to);
  }
  close();
  return items;
}

// The hours of the grid: 7 AM to 10 PM, larger if an event is outside.
export function hourRange(items) {
  let first = FIRST_HOUR;
  let last = LAST_HOUR;
  for (const x of items) {
    first = Math.min(first, Math.floor(x.from / 60));
    last = Math.max(last, Math.ceil(x.to / 60));
  }
  return { first: Math.max(0, first), last: Math.min(24, last) };
}
