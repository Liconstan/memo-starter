// The drafts of the Inbox: the text of the reply field of each memo that the owner did not send yet. This file has no
// DOM code, so a test can import it.
//
// A draft is { text, updated }: the text, and the time of the last change as the browser gave it. The drafts of a page
// are one object by memo id: { "12": { text, updated } }. The page keeps them in memory and in localStorage (DRAFTS_KEY),
// sends each change to the server (POST /api/draft) after a short pause in the typing, and gets the drafts of the
// server with each load of the queue and with the drafts poll (DRAFT_POLL_MS). The server and the page follow one
// rule: the newer time wins. So a draft that came from the phone an hour ago never replaces what the owner typed on
// the computer a minute ago, and the other way round. The clocks of two devices can differ, so a change here gets a
// time after the time of the draft it replaces (nextStamp): what she types now always wins over what the page has
// seen. A sent draft leaves an empty text with the time of the send: the page keeps this mark a day, so a copy of
// the old draft that comes later from the server does not bring the text back.

export const DRAFTS_KEY = 'memo-drafts';
// The pause in the typing after which the page sends the draft. On the GitHub copy each save is a commit, so the
// pause is longer there; a collapse, a change of page, or the Mac going to sleep sends the draft at once.
export const SAVE_AFTER_MS = 1500;
export const SAVE_AFTER_LEDGER_MS = 4000;
// The page asks the server for the drafts this often while a memo is open, also while she types (the list itself
// loads only when she does not type in it). On the GitHub copy each ask is two reads of the repository, so it is
// the same 15 seconds as the list.
export const DRAFT_POLL_MS = 5000;
export const DRAFT_POLL_LEDGER_MS = 15000;
// A reply field with a keystroke in the last seconds keeps its text: a draft from the other device waits for the
// next poll. So a newer draft from there never replaces what she types now, only what she left for a while.
export const TYPING_MS = 3000;
const TOMB_KEEP_MS = 24 * 60 * 60 * 1000;
const DRAFT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const valid = (d) => Boolean(d) && typeof d === 'object' && typeof d.text === 'string' && typeof d.updated === 'string' && !Number.isNaN(Date.parse(d.updated));

// True when a is a draft and is newer than b (or b is not a draft).
export const newer = (a, b) => valid(a) && (!valid(b) || Date.parse(a.updated) > Date.parse(b.updated));

// The time of a change made now to the draft `current`: the clock of this device, or one millisecond after the draft
// when the clock is behind it (the draft came from a device with a clock ahead of this one). So the change wins
// over the draft it replaces, on the server and on the other device, whatever the clocks say.
export const nextStamp = (current, now = Date.now()) => new Date(Math.max(now, valid(current) ? Date.parse(current.updated) + 1 : 0)).toISOString();

// The drafts of a text from localStorage: only the entries that are drafts. Anything else gives an empty object.
export function parseDrafts(text) {
  let data;
  try { data = JSON.parse(text || '{}'); } catch { return {}; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const out = {};
  for (const [id, d] of Object.entries(data)) if (/^(t-[A-Za-z0-9-]+|\d+)$/.test(id) && valid(d)) out[id] = { text: d.text, updated: d.updated };
  return out;
}

// The drafts of the page after the drafts of the server came: for each memo, the newer one. Gives the new object and
// the ids whose local draft is newer than what the server has (the page sends those), and the ids whose text changed
// on the page (the page puts the new text into an open reply field). hold(id): true for a memo whose reply field she
// types in now; its local draft stays as it is, and it goes neither to send nor to changed. The next merge sees it.
export function mergeDrafts(local, remote, hold = () => false) {
  const merged = { ...local };
  const send = [];
  const changed = [];
  const ids = new Set([...Object.keys(local), ...Object.keys(remote || {})]);
  for (const id of ids) {
    const mine = local[id];
    const theirs = remote?.[id];
    if (hold(id)) continue;
    if (newer(theirs, mine)) {
      merged[id] = { text: theirs.text, updated: theirs.updated };
      if ((mine?.text || '') !== theirs.text) changed.push(id);
    } else if (valid(mine) && mine.text && !(valid(theirs) && theirs.text === mine.text && theirs.updated === mine.updated)) {
      // A text the server does not have, or has in an older form: it must go there. A cleared draft needs no send:
      // the reply, the note, or the close removed it on the server.
      send.push(id);
    }
  }
  return { merged, send, changed };
}

// The drafts without the old ones: a sent draft (empty text) after a day, and a draft older than a week whose memo is
// not in the Inbox and not on the server (its memo is answered or closed). openIds: the memos in the Inbox now.
export function pruneDrafts(drafts, openIds, remote = {}, now = Date.now()) {
  const open = new Set([...openIds].map(String));
  const out = {};
  for (const [id, d] of Object.entries(drafts)) {
    if (!valid(d)) continue;
    const age = now - Date.parse(d.updated);
    if (!d.text && age > TOMB_KEEP_MS) continue;
    if (d.text && !open.has(id) && !(id in remote) && age > DRAFT_KEEP_MS) continue;
    out[id] = d;
  }
  return out;
}

// The text of the reply field of a memo: its draft, or nothing.
export const draftText = (drafts, id) => drafts[id]?.text || '';

// Where the cursor goes when the page puts a new text into a reply field she has the focus in: at the same place
// when the other device only added text after it (the common case), else at the end.
export const caretAfter = (oldText, newText, caret) => (newText.startsWith(oldText.slice(0, caret)) ? caret : newText.length);
