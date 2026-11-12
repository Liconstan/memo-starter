// The rules for the list of the Inbox. This file has no DOM code, so a test can import it.

// Work and Personal (memo 1244): the workstream code decides. Personal is the code ME; every other code is Work
// (SYS and COMM too, and a retired code such as GEN). A memo with no code is Work, so Personal holds only real
// personal items; this covers the old rule, the work code and a number in the text (SUB-6). The tag work makes a
// Work memo whatever its code. The tag personal makes a Personal memo whatever its code (memo 1251: a memo about
// the pets of her agents has a work code and belongs in Personal). A memo with the two tags is Personal: the tags
// keep no order of adding, so the later tag cannot be known, and personal wins.
export const PERSONAL_WS = 'ME';
export function isWork(memo) {
  const tags = memo.tags || [];
  if (tags.includes('personal')) return false;
  if (tags.includes('work')) return true;
  if (memo.ws) return memo.ws !== PERSONAL_WS;
  return true;
}

// Ugh (memo 1244): an open memo that waited more than UGH_DAYS days since it was sent, or that she postponed at
// least once and that came back. The server keeps no history of postpones; `back` is the time a postponed memo
// came back (src/memos.js wake), so a memo with `back` was postponed once at least. `now` is a time in ms.
export const UGH_DAYS = 5;
const DAY_MS = 86400000;
// Whole days since the memo was sent, for the words of the chip.
export const daysWaited = (memo, now = Date.now()) => Math.floor((now - Date.parse(memo.created)) / DAY_MS);
// The reason a memo is an Ugh memo: 'back' (postponed and back), 'waited' (older than UGH_DAYS days), or '' (not Ugh).
export function ughReason(memo, now = Date.now()) {
  if (memo.back) return 'back';
  if (memo.created && now - Date.parse(memo.created) > UGH_DAYS * DAY_MS) return 'waited';
  return '';
}
export const isUgh = (memo, now = Date.now()) => Boolean(ughReason(memo, now));
// The visible word of the chip, and the longer words a screen reader hears and the tooltip shows.
export const UGH_WORDS = {
  label: 'Ugh',
  waited: (memo, now = Date.now()) => `Put off: this memo has waited ${daysWaited(memo, now)} days`,
  back: 'Put off: you postponed this memo and it came back',
};
export const ughTitle = (memo, now = Date.now()) => (ughReason(memo, now) === 'back' ? UGH_WORDS.back : UGH_WORDS.waited(memo, now));

// High energy and Low energy (memo 1244). High: an Ugh memo, whatever its effort; an effort of hour, half-day or
// day; or an impact of 4 or 5. Low: the rest, so the efforts micro and short with an impact of 1 to 3. A memo with
// no effort counts as short, so it is Low unless its impact is 4 or 5. Every memo is in exactly one of the two.
// Two tags go over the effort and the impact (memo 1251: a short memo can take much energy, such as the edits of a
// board pre-read or a reply to a funder). The tag high makes a High memo. The tag low makes a Low memo, but not an
// Ugh memo: an Ugh memo stays High. With the two tags, high wins.
export const HIGH_EFFORTS = ['hour', 'half-day', 'day'];
export const HIGH_IMPACT = 4;
export function isHighEnergy(memo, now = Date.now()) {
  const tags = memo.tags || [];
  if (tags.includes('high') || isUgh(memo, now)) return true;
  if (tags.includes('low')) return false;
  return HIGH_EFFORTS.includes(memo.effort) || (memo.impact || 0) >= HIGH_IMPACT;
}
export const isLowEnergy = (memo, now = Date.now()) => !isHighEnergy(memo, now);

// The tags that the Inbox suggests when the owner adds a tag. The owner can type any other tag. The first four
// move a memo between the tabs: work and personal (isWork), high and low (isHighEnergy).
export const TAB_TAGS = ['work', 'personal', 'high', 'low'];
export const STARTER_TAGS = [...TAB_TAGS, 'admin', 'health', 'money', 'home', 'code', 'social'];

// The note of the Shorten button. The sender then closes the memo and sends a short new memo (memo compact).
export const COMPACT_NOTE = 'Shorten this memo: close it and send a new memo with a short summary, the open items (with check boxes), and the next step. Keep the impact, the effort, and the tags. Use: memo compact <id>';
// The memo has a Shorten note that the sender did not read yet: the button shows "Asked".
export const compactAsked = (memo) => (memo.notes || []).some((n) => n.text === COMPACT_NOTE && !n.read);
// The notes that the Inbox shows. The Shorten note is only a signal to the agent, so the Inbox hides it.
export const shownNotes = (memo) => (memo.notes || []).filter((n) => n.text !== COMPACT_NOTE);

// A memo is unread when the owner did not open it (seen 0) or when its text changed after she saw it (seen 2).
export const isUnread = (memo) => memo.seen !== 1;

// The filters of the top bar: 'all', 'work', 'personal' (not work), 'high', 'low', 'ugh', 'unread', or 'tag:<name>'.
export function matches(memo, filter, now = Date.now()) {
  if (filter === 'work') return isWork(memo);
  if (filter === 'personal') return !isWork(memo);
  if (filter === 'high') return isHighEnergy(memo, now);
  if (filter === 'low') return isLowEnergy(memo, now);
  if (filter === 'ugh') return isUgh(memo, now);
  if (filter === 'unread') return isUnread(memo);
  if (filter.startsWith('tag:')) return (memo.tags || []).includes(filter.slice(4));
  return true;
}

// The memos that the list shows.
export const shownMemos = (memos, filter = 'all', now = Date.now()) => (filter === 'all' ? memos : memos.filter((m) => matches(m, filter, now)));

// The choices of the filter, each [value, label] or [value, label, count]: All, Work, Personal, High energy, Low
// energy, Ugh with its count (only while a memo is Ugh, or while it is on), and each tag in use (not work,
// personal, high and low: each moves a memo to a choice that is there already). A filter that is saved on the device and has no memo now stays in the list, so the choice
// does not jump. Unread comes from the counts line of the Inbox; it is a choice here only while it is on, so the
// tab shows it.
export function filterChoices(memos, current = 'all', now = Date.now()) {
  const tags = new Set(memos.flatMap((m) => m.tags || []));
  for (const t of TAB_TAGS) tags.delete(t);
  if (current.startsWith('tag:')) tags.add(current.slice(4));
  const ugh = memos.filter((m) => isUgh(m, now)).length;
  return [['all', 'All'], ['work', 'Work'], ['personal', 'Personal'], ['high', 'High energy'], ['low', 'Low energy'],
    ...(ugh || current === 'ugh' ? [['ugh', UGH_WORDS.label, ugh]] : []),
    ...(current === 'unread' ? [['unread', 'Unread']] : []),
    ...[...tags].sort().map((t) => [`tag:${t}`, `#${t}`])];
}

// The tooltip of a tab of the filter.
export const TAB_TITLES = {
  all: 'Show all memos', work: 'Show the work memos: every workstream but ME, and memos with the tag work',
  personal: 'Show the personal memos: the workstream ME, and memos with the tag personal',
  high: 'Show the memos that take a focused stretch: an hour or more, an impact of 4 or 5, put off, or the tag high',
  low: 'Show the quick memos: micro or short with an impact of 1 to 3, or the tag low', ugh: 'Show the memos you have put off: waited more than 5 days, or postponed and back',
  unread: 'Show the memos you did not open yet, and the memos that changed since you saw them',
};
export const tabTitle = (value, label) => TAB_TITLES[value] || `Show the memos with the tag ${label}`;

// The tags to suggest for a memo: the starter tags and the tags in use, without the tags that the memo has.
export function tagSuggestions(memos, memo) {
  const all = new Set([...STARTER_TAGS, ...memos.flatMap((m) => m.tags || [])]);
  return [...all].filter((t) => !(memo.tags || []).includes(t)).sort();
}

// The id that the j key (step 1) or the k key (step -1) selects. The selection stops at the two ends. If the
// selected memo is not in the list, the first memo is the start.
export function step(memos, selected, by) {
  if (!memos.length) return null;
  const index = memos.findIndex((c) => c.id === selected);
  return memos[Math.min(memos.length - 1, Math.max(0, (index < 0 ? 0 : index + by)))].id;
}

// The text of the counter.
export function countText(shown, all, filtered) {
  const memos = (n) => (n === 1 ? '1 memo' : `${n} memos`);
  return filtered ? `${shown} of ${memos(all)}` : memos(all);
}

// Dates for the postpone picker, as YYYY-MM-DD in the owner's time zone.
export function todayIn(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// The next Monday after the date. On a Monday, that is 7 days later.
export function nextMonday(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 Sunday ... 6 Saturday
  return addDays(date, ((8 - day) % 7) || 7);
}
// The warning for the picker: the memo is due before it comes back.
export const dueWarning = (memo, date) => (memo.due && date && memo.due < date ? `This memo is due ${memo.due}, before it comes back.` : '');
