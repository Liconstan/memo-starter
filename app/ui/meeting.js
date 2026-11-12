// The time block at the top of the Inbox (memo 1422): the clock, the date, the next meeting with the time until it,
// the Meeting brief before a meeting and the Follow-up after it. The rules here are pure: the clock is passed in, and
// there is no DOM code, so the server (src/meeting.js) and a test import the same file.

// The holds of the owner are not meetings: "Focus time", "Hold for travel", "Block: writing" (as src/followups.js HOLD).
export const HOLD = /^\s*(focus|hold|block)\b/i;
// A meeting: an event with a time, with one other person or more, that is not a hold. (An event she declined or did
// not answer is not in the list at all: src/ical.js leaves it out.)
export const isMeeting = (e) => Boolean(e) && !e.allDay && Boolean(e.hasOthers) && (e.attendees || []).length > 0 && !HOLD.test(e.title || '');

// How long a meeting that ended still shows its Follow-up button.
export const LAST_MS = 24 * 60 * 60 * 1000;
// Of a list of events (today and yesterday), at a moment: the meeting that runs now, the next one, and the last one
// that ended in the last 24 hours. Each is an event of the list, or null. now: milliseconds.
export function meetingsAt(events, now) {
  const list = (events || []).filter(isMeeting).map((e) => ({ e, start: Date.parse(e.start), end: Date.parse(e.end) })).filter((x) => Number.isFinite(x.start) && Number.isFinite(x.end));
  const by = (key, dir) => (a, b) => dir * (a[key] - b[key]) || String(a.e.title).localeCompare(String(b.e.title));
  const current = list.filter((x) => x.start <= now && now < x.end).sort(by('start', 1))[0]?.e ?? null;
  const next = list.filter((x) => x.start > now).sort(by('start', 1))[0]?.e ?? null;
  const last = list.filter((x) => x.end <= now && now - x.end <= LAST_MS).sort(by('end', -1))[0]?.e ?? null;
  return { current, next, last };
}

// The time until a moment, in whole minutes, rounded up: "in 1 h 19 m", "in 19 m", "in 2 h", "now" at 0 or less.
export function countdown(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (!(minutes > 0)) return 'now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `in ${[h ? `${h} h` : '', m ? `${m} m` : ''].filter(Boolean).join(' ')}`;
}
// The time since a moment: "12 m ago", "1 h 5 m ago", "just now".
export function since(ms) {
  const minutes = Math.floor(ms / 60000);
  if (!(minutes > 0)) return 'just now';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${[h ? `${h} h` : '', m ? `${m} m` : ''].filter(Boolean).join(' ')} ago`;
}

// Some versions of Node and some browsers put a narrow no-break space before AM and PM. A plain space reads the same.
const plain = (s) => s.replace(/[  ]/g, ' ');
// The clock: "9:41 PM". The date under it, with the day of the week: "Wednesday, Nov 11".
export const clockText = (now, timeZone) => plain(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(now)));
export const dateText = (now, timeZone) => plain(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(now)));
// The time range of a meeting: "10:00 – 10:30 PM", or "11:30 AM – 12:15 PM" across noon.
export function rangeText(start, end, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' });
  const [a, b] = [plain(f.format(new Date(start))), plain(f.format(new Date(end)))];
  const half = (s) => s.slice(-2);
  return `${half(a) === half(b) ? a.slice(0, -3) : a} – ${b}`;
}

// The line of the block about the meetings, in words: { head, detail }.
//   a meeting runs:        head "Now: Robin <> Sam", detail "until 10:30 PM · next in 45 m: Team sync"
//   a meeting comes today: head "Next: in 1 h 19 m",        detail "10:00 – 10:30 PM · Robin <> Sam"
//   none:                  head "",                         detail "No more meetings today."
// state: { current, next } of meetingsAt, where next counts only when it starts on the day of `now` in the zone.
export function nextLine({ current, next }, now, timeZone) {
  const day = (t) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
  const today = next && day(next.start) === day(now) ? next : null;
  if (current) {
    const until = `until ${plain(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(current.end)))}`;
    return { head: `Now: ${current.title}`, detail: today ? `${until} · next ${countdown(Date.parse(today.start) - now)}: ${today.title}` : until };
  }
  if (today) return { head: `Next: ${countdown(Date.parse(today.start) - now)}`, detail: `${rangeText(today.start, today.end, timeZone)} · ${today.title}` };
  return { head: '', detail: 'No more meetings today.' };
}

// ---------- the follow-up draft ----------
// The memo of the agent about a follow-up has the text for the other people under a line "THE DRAFT", up to the next
// line in capital letters ("LEFT OUT", "NOT SURE FROM THE TRANSCRIPT", "YOURS, NOT IN THE DRAFT"), which is for her
// alone. { draft, found }: the text of the draft, or with no such line the whole memo and found false.
const HEADING = /^[A-Z][A-Z0-9 ,.'’:-]{3,}$/;
export function draftOf(text) {
  const lines = String(text ?? '').split('\n');
  const at = lines.findIndex((l) => /^THE DRAFTS?\b/.test(l.trim()) && HEADING.test(l.trim()));
  if (at === -1) return { draft: String(text ?? '').trim(), found: false };
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) if (HEADING.test(lines[i].trim()) && !/^THE DRAFTS?\b/.test(lines[i].trim())) { end = i; break; }
  return { draft: lines.slice(at + 1, end).join('\n').trim(), found: true };
}
// The first line of a memo without its Markdown marks, for the line over the draft: "Follow-ups for ... are drafted".
export const firstLine = (text) => String(text ?? '').split('\n').find((l) => l.trim())?.replace(/\*\*/g, '').trim() || '';

// The first line of the reply that Send makes. It is her explicit go-ahead, in fixed words, so the agent can tell a
// Send of the dashboard from an ordinary reply.
export const SEND_LINE = 'Send this follow-up now, exactly as written below, in the place you drafted it. This is my explicit go-ahead to send. Send only the text below, nothing else from your memo.';
export const sendText = (draft) => `${SEND_LINE}\n\n${String(draft ?? '').trim()}`;
