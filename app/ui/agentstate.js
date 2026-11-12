// The state of an agent and its open memos, as the Inbox and the Agents page show them. No DOM code, so a test can
// import it. The server gives `activity` (src/agents.js): 'idle' when the agent sits in `memo wait` or at its prompt,
// 'working' when it runs a turn, 'stopped' or 'offline' when its session is not there, 'stopping', or 'blocked'.
import { summary } from './markdown.js';
import { pickSpecialist, taskCapability } from './specialists.js';
import { WINDOW_MS, SPARE_ABOVE, LIMIT_LEFT, pointsLeft, headroom, bindingHeadroom, nextReset, usageKnown, dayPeriodWords, resetWithin } from './pacing.js';

// The names the pages show for the agents (memo 1408): main is Peeve, second is Darkness, gpt is Landon, the names of
// their pets (PETS in ui/pets.js). This is the one map of them, and it changes only what a page shows: the ids of
// the agents (agents.json, the memo command, the database, the routes, the tmux sessions, the files of the pets) stay
// main, second and gpt. To undo it, empty the map; to add an agent, add a line. A name with no entry shows as it is.
export const DISPLAY_NAMES = { main: 'Peeve', second: 'Darkness', gpt: 'Landon' };
export const displayName = (name) => (Object.hasOwn(DISPLAY_NAMES, String(name)) ? DISPLAY_NAMES[name] : String(name ?? ''));

// The word for the state of an agent. An older server gives no activity: then a session that runs shows as Working.
export function stateWord(agent) {
  if (agent.kind === 'short') return '';
  if (agent.kind === 'remote' && !agent.online) return 'Offline';
  if (agent.kind === 'long' && !agent.running) return agent.last_stop === 'no_recap' ? 'Stopped with no recap' : 'Stopped';
  if (agent.stopping_since || agent.activity === 'stopping') return 'Stopping';
  if (agent.activity === 'blocked' || agent.blocked) return 'Blocked';
  if (agent.activity === 'idle') return 'Idle';
  return 'Working';
}

// The title of a memo in a list: its brief title, or the first line of its text, or its number.
export const memoTitle = (m) => m.title || summary(m.line || m.text || '') || `Memo ${m.id}`;

// The status line of an agent and how long ago it set it, as the Agents page and the Inbox show it (memo 1190):
// { text: 'SYS-62, review of my last 50 drafts', when: '6 min ago' }, or null for a short agent or one with
// no status line. age: the words for a time (ui/common.js). The pages put the two in one line, "<text>, <when>".
export function statusLine(agent, age) {
  if (!agent || agent.kind === 'short') return null;
  const text = String(agent.status || '').trim();
  if (!text) return null;
  return { text, when: age(agent.updated) };
}

// The helpers of an agent in two groups (memo 1190): the ones that run, shown by default, and the finished ones,
// which the pages put inside a closed <details> with the words of finishedWords: "3 finished helpers".
export function helperGroups(helpers) {
  const list = Array.isArray(helpers) ? helpers : [];
  return { running: list.filter((h) => h.running), done: list.filter((h) => !h.running) };
}
export const finishedWords = (n) => `${n} finished ${n === 1 ? 'helper' : 'helpers'}`;

// The two lists of open memos of an agent, with their labels: the memos that wait on the agent, and the memos from
// the agent that wait on the owner. Each item has the id, the title, and whether the memo is postponed.
// An older server gives only the counts: then each list has no items and the count stays.
export function waitingLists(agent, owner = 'me') {
  const items = (list) => (Array.isArray(list) ? list.map((m) => ({ id: m.id, title: memoTitle(m), postponed: Boolean(m.until) })) : null);
  return [
    { key: 'to', label: `Memos waiting on ${displayName(agent.name)}`, count: agent.open_to ?? 0, items: items(agent.memos_to) },
    { key: 'from', label: `Memos waiting on ${owner}`, count: agent.open_from ?? 0, items: items(agent.memos_from) },
  ];
}

// An account is at its limit when its session or its week is at 95 percent or more: 5 points or fewer left. The
// handover job of the server (src/handover.js) moves the unstarted memos of such an agent to the other agent, and the
// capture form puts the agent last (the floor of bestAgent).
export const LIMIT_AT = 100 - LIMIT_LEFT;
const percentOf = (w) => (w && Number.isFinite(Number(w.percent)) ? Number(w.percent) : null);
export function atLimit(usage) {
  return (percentOf(usage?.session) ?? 0) >= LIMIT_AT || (percentOf(usage?.week) ?? 0) >= LIMIT_AT;
}
// The weekly Fable figure of an account: the entry of usage.models named Fable, or null.
export const fableOf = (usage) => (Array.isArray(usage?.models) ? usage.models.find((m) => /^fable\b/i.test(String(m.name || ''))) : null) || null;

// A task that needs Fable (memos 764, 982 and 1047) goes to the account with the most Fable headroom. The capture
// form has no workstream field and no box: the text says so. A task counts in three cases. It names the code OPS,
// FUND or SPEC in capitals, for example "OPS: pay the invoice" or "see FUND-3" (finance, operations and compliance go
// to a Fable helper). Or it says in plain words that it is deep work or code: "deep work", "needs Fable", "use Fable",
// "a Fable helper", "hard reasoning", "deep reasoning", "coding", "codebase", or the word "code" on its own. A code
// that is a number or a label is not code: "zip code", "promo code", "the memo code", "code 1234", "the code OPS".
// Or it names the work that goes to Fable (memo 764): strategy, board (a board meeting, a board deck, a board
// pre-read, or the word alone), funder, grant proposal, grant application, grant report, donor letter, budget,
// bookkeeping, 990, tax, audit, payroll, policy, contract, compliance, "in my voice", "as me". Whole words, in any
// case, with their plurals: "onboarding" is not board, "syntax" is not tax, and "1990" is not 990.
export const CODE_WORDS = /(?<!\b(?:zip|postal|promo|discount|coupon|gift|memo|workstream|area|error|status|qr|pin|access|dress|tax|country|dial|security|verification|confirmation|one-time|source)\s)\bcode\b(?!\s*(?:\d|OPS\b|FUND\b|SYS\b))/i;
const FABLE_WORDS = /\b(?:deep work|needs? (?:a )?fable|use fable|with fable|fable helper|hard reasoning|deep reasoning|coding|codebase)\b/i;
export const WORK_WORDS = /\b(?:strategy|board|funders?|grant (?:proposals?|applications?|reports?)|donor letters?|budgets?|bookkeeping|990|tax(?:es)?|audits?|payroll|polic(?:y|ies)|contracts?|compliance|in my voice|as me)\b/i;
export const fableTask = (text) => { const t = String(text || ''); return /(?<![\w-])(OPS|FUND|SPEC)(?![A-Za-z0-9_])/.test(t) || FABLE_WORDS.test(t) || CODE_WORDS.test(t) || WORK_WORDS.test(t); };

// The floor of the pick: 5 points or fewer left in the session or the week drops an agent, unless that reset is
// within 15 minutes; for a Fable task, 10 points or fewer of Fable left drops it too.
export const RESET_SOON_MS = 15 * 60 * 1000;
export const FABLE_FLOOR_LEFT = 10;
// The ties: a gap under 10 points of Fable headroom, or under 15 points of binding headroom, is a tie.
export const FABLE_TIE = 10;
export const TIE = 15;

// The agent that gets a new task of the capture form when the owner has not picked one by hand (memos 980, 982 and
// 1047). The numbered rule:
// 1. The long agents that wait or work come first. Stopped, stopping and blocked go last.
// 2. Figures older than 20 minutes, or from before a reset that passed, count as unknown. Unknown goes after known.
// 3. The floor. An agent with 5 points or fewer left in its session or its week is dropped, unless that reset is
//    within 15 minutes. For a Fable task, one with 10 Fable points or fewer left is dropped too.
// 4. When the floor drops every agent, the one whose reset comes first wins, and the hint says so.
// 5. For a Fable task, the higher Fable headroom. A gap under 10 points is a tie. A known Fable figure before none.
// 6. The higher binding headroom, the lower of the session and the week. A gap under 15 points is a tie. When both
//    have spare room, above plus 15, the one whose reset comes first wins instead: its points expire sooner.
// 7. On a tie, idle before working; then, when both have spare room, the one that resets first; then main, the
//    first of the list.
// Only the long agents are candidates. task: the text of the task, for rules 3 and 5. now: the time, for a test.
// pickAgent gives { name, hint }: the name, or '' when there is no long agent, and the hint for the select.
// bestAgent gives the name alone.
const STATE_RANK = { Idle: 0, Working: 1 };
export function pickAgent(agents, { task = '', now = new Date() } = {}) {
  const capability = taskCapability(task);
  const specialist = pickSpecialist(agents, capability, now);
  if (specialist) return specialist;
  if (capability === 'computer-use') return { name: '', hint: 'GPT browser worker unavailable. Restore its verified desktop connection or wait for allowance to reset; you can also explicitly choose an agent.' };
  const long = (agents || []).filter((a) => a.kind === 'long');
  const fable = fableTask(task);
  const facts = long.map((a, i) => {
    const word = stateWord(a);
    const known = usageKnown(a.usage, now);
    const u = known ? a.usage : null;
    const fableW = fableOf(u);
    const floorHit = (w) => { const l = pointsLeft(w); return l !== null && l <= LIMIT_LEFT && !resetWithin(w, RESET_SOON_MS, now); };
    const fableLeft = pointsLeft(fableW);
    const binding = bindingHeadroom(u, now);
    return {
      a, i, word,
      active: word === 'Idle' || word === 'Working',
      known,
      floored: known && (floorHit(u.session) || floorHit(u.week) || (fable && fableLeft !== null && fableLeft <= FABLE_FLOOR_LEFT)),
      fableH: fableW ? headroom(fableW, WINDOW_MS.week, now) : null,
      binding,
      spare: binding !== null && binding > SPARE_ABOVE,
      reset: nextReset(u) ?? Infinity,
    };
  });
  const by = (x, y, f) => f(x) - f(y);
  // decide(x, y): the sign that sorts x before y, and the rule that decided in a few words, for the pick line of the
  // capture form (memo 1090); the words name y as the one that lost. The sort uses the sign alone.
  const lower = (f) => f.word.toLowerCase();
  const decide = (x, y) => {
    let d = by(x, y, (f) => (f.active ? 0 : 1));
    if (d) return { d, why: `${displayName(y.a.name)} is ${lower(y)}` };
    d = by(x, y, (f) => (f.known ? 0 : 1));
    if (d) return { d, why: `${displayName(y.a.name)} has no fresh figures` };
    d = by(x, y, (f) => (f.floored ? 1 : 0));
    if (d) return { d, why: `${displayName(y.a.name)} is at its limit` };
    if (x.floored && y.floored) return { d: by(x, y, (f) => f.reset) || x.i - y.i, why: 'every agent is at its limit, it resets first' };
    if (fable && (x.fableH !== null || y.fableH !== null)) {
      if (x.fableH === null || y.fableH === null) return { d: x.fableH === null ? 1 : -1, why: `${displayName(y.a.name)} has no Fable figure` };
      if (Math.abs(x.fableH - y.fableH) >= FABLE_TIE) return { d: y.fableH - x.fableH, why: 'more Fable room' };
    }
    if (x.binding !== null && y.binding !== null && Math.abs(x.binding - y.binding) >= TIE) {
      return x.spare && y.spare ? { d: by(x, y, (f) => f.reset), why: 'both have room, it resets first' } : { d: y.binding - x.binding, why: 'more room' };
    }
    d = by(x, y, (f) => STATE_RANK[f.word] ?? 2);
    if (d) return { d, why: 'idle' };
    if (x.spare && y.spare) d = by(x, y, (f) => f.reset);
    return { d: d || x.i - y.i, why: d ? 'both have room, it resets first' : 'a tie, the first of the list' };
  };
  const ranked = [...facts].sort((x, y) => decide(x, y).d);
  const first = ranked[0];
  if (!first) return { name: '', hint: PICK_HINT };
  const everyFloored = facts.every((f) => f.floored);
  const when = everyFloored && first.reset !== Infinity ? dayPeriodWords(new Date(first.reset).toISOString(), { now }) : '';
  const hint = everyFloored ? `Every agent is at its limit: ${displayName(first.a.name)} resets first${when ? `, ${when}` : ''}` : PICK_HINT;
  // why: the rule that put the first before the second, in a few words; '' with one candidate. Two that the rules
  // cannot tell apart keep the order of the list, and the words say so.
  const top = ranked.length > 1 ? decide(first, ranked[1]) : null;
  const why = !top ? '' : top.d ? top.why : 'a tie, the first of the list';
  return { name: first.a.name, hint, why };
}
export const bestAgent = (agents, options) => pickAgent(agents, options).name;

// The hint on the agent select of the capture form: the rule of pickAgent in one short sentence.
export const PICK_HINT = 'Picked for you: an agent that waits or works, with fresh figures and room left, then the most Fable headroom for a Fable task, then the most headroom, and the earlier reset when both have room';

// The line that the capture form adds to a Fable task when Fable is short on every account with known figures:
// 10 Fable points or fewer left (memo 1047). '' otherwise. The day is that of the earliest Fable reset.
export function fableShortNote(agents, { task = '', now = new Date(), timeZone } = {}) {
  if (!fableTask(task)) return '';
  const rows = (agents || []).filter((a) => a.kind === 'long' && usageKnown(a.usage, now)).map((a) => fableOf(a.usage)).filter(Boolean);
  if (!rows.length || !rows.every((w) => pointsLeft(w) <= FABLE_FLOOR_LEFT)) return '';
  const soonest = rows.map((w) => Date.parse(w.resets_at ?? '')).filter((t) => !Number.isNaN(t)).sort((p, q) => p - q)[0];
  const until = soonest === undefined ? '' : ` until ${dayPeriodWords(new Date(soonest).toISOString(), { now, timeZone })}`;
  return `Fable is short on ${rows.length > 1 ? 'both accounts' : 'the account'}${until}. Use an Opus helper or hold the deep part.`;
}

// The line under the capture field (memo 1090): the automatic pick and the rule that decided it, in a few words,
// "Auto: second · more Fable room". The title of the select is a tooltip, and a phone has none, so this line shows on
// every screen size. '' when there is no pick.
export function pickWords(agents, options = {}) {
  const picked = pickAgent(agents, options);
  if (!picked.name) return '';
  return `Auto: ${displayName(picked.name)}${picked.why ? ` · ${picked.why}` : ''}`;
}

// The memo that a helper works on, from its label (memo 1092): "Vault sync, memo 906" or "#906", or the code of a
// memo, "SYS-42" or "sys42", in any case. Only a memo of the list counts, so the Inbox makes no dead link: null for a
// label that names none, or one that the list does not have.
export function helperMemoId(label, memos) {
  const text = String(label || '');
  const list = Array.isArray(memos) ? memos : [];
  const m = /(?:\bmemo\s+|#)(\d{1,7})\b/i.exec(text);
  if (m && list.some((x) => x.id === Number(m[1]))) return Number(m[1]);
  const codes = new Map(list.filter((x) => x.code).map((x) => [String(x.code).toUpperCase(), x.id]));
  if (!codes.size) return null;
  for (const c of text.matchAll(/\b([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,7})\b|\b([A-Za-z]{2,8})(\d{1,7})\b/g)) {
    const id = codes.get(`${(c[1] || c[3]).toUpperCase()}-${Number(c[2] || c[4])}`);
    if (id !== undefined) return id;
  }
  return null;
}
