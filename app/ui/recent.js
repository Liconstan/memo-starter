// The memos tied to what the owner fired off last (memo 1236): the one her latest action touched gets a green mark,
// the next few a gold one. No DOM code, so a test can import it.
//
// The server gives `fired` (GET /api/queue, src/memos.js fired): by memo id, the time of the owner's latest action
// tied to that memo. Her actions: a note on the memo; a send, a reply, a close or a note on one of the memos it
// came from (its origins: the memos its re names, and the memos its text names). A memo with no such action is
// not in `fired`.

// Green plus gold cover about this share of the memos in the view, at least one.
export const RECENT_SHARE = 0.12;

// How many memos get a mark in a view of n memos: round(12% of n), at least 1 (for n > 0).
export const markCount = (n, share = RECENT_SHARE) => (n > 0 ? Math.max(1, Math.round(n * share)) : 0);

// The marks for the memos of a view: a Map from memo id to 'latest' (green, the one her latest action touched) or
// 'recent' (gold, the next most recent). memos: the memos in the view, in any order; fired: the map of the server.
// Only memos with a time get a mark, so the Map can be smaller than markCount, or empty. On an equal time, the
// higher id (the newer memo) goes first.
export function recentMarks(memos, fired, share = RECENT_SHARE) {
  const marks = new Map();
  if (!Array.isArray(memos) || !memos.length || !fired || typeof fired !== 'object') return marks;
  const timed = memos.filter((m) => typeof fired[m.id] === 'string' && fired[m.id]).map((m) => ({ id: m.id, at: fired[m.id] }));
  timed.sort((a, b) => (a.at === b.at ? b.id - a.id : a.at < b.at ? 1 : -1));
  const n = Math.min(markCount(memos.length, share), timed.length);
  for (let i = 0; i < n; i += 1) marks.set(timed[i].id, i === 0 ? 'latest' : 'recent');
  return marks;
}

// The visible word of a mark, and the longer words a screen reader hears and the tooltip shows.
export const MARK_WORDS = {
  latest: { label: 'Latest', title: 'Tied to the last thing you fired off' },
  recent: { label: 'Recent', title: 'Tied to something you fired off recently' },
};
