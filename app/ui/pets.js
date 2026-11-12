// The pets of the agents (memos 1241 and 1242): which creature stands for each agent, how it feels, and how a memo
// row draws it. No DOM code, so a test can import it; ui/petview.js draws the creature from these words.
//
// The feeling comes only from signals the server already gives in GET /api/agents (src/agents.js and the counts of
// src/memos.js): the activity, the blocked state, the usage figures of the account, the open memos to and from the
// agent, the helpers, and the replies of the owner to the memos of the agent in the last day. Nothing is guessed.
import { stateWord } from './agentstate.js';
import { FRESH_MS } from './pacing.js';
import { ughReason, daysWaited } from './filter.js';

// The pets, as the quiz of memo 1252 paired them (SYS-72). An agent with no entry gets a small neutral creature, a
// sprout, with the name of the agent. The manner of each pet (how it waits, works, sulks and rests) is in
// ui/petview.js, keyed by the pet name.
export const PETS = {
  main: { pet: 'Peeve', species: 'cat', coat: 'grey', note: 'checks on you after a minute; calm, saves energy; unbothered or a little grumpy under stress; speaks when it matters; now and then very cuddly' },
  second: { pet: 'Darkness', species: 'cat', coat: 'black', note: 'follows you room to room talking; asks louder until it happens; restless, worries out loud; hides under stress; a bit clumsy' },
  gpt: { pet: 'Landon', species: 'dog', note: 'a papillon: at the door when you come home; same signal at the same time; steady, busy in short bursts; silent unless deeply offended; twirls when excited' },
};
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
export const petOf = (name) => PETS[name] || { pet: cap(name), species: 'sprout' };

// The feelings, in the order of priority when several apply: the first that applies wins.
export const FEELINGS = ['upset', 'tired', 'overloaded', 'waiting', 'working', 'happy', 'sleeping'];
export const FEELING_WORDS = { upset: 'Upset', tired: 'Tired', overloaded: 'Overloaded', waiting: 'Waiting on you', working: 'Working', happy: 'Happy', sleeping: 'Sleeping' };
// Tired: a window of the account at this percent or more, or at a spend limit.
export const TIRED_AT = 80;
// Overloaded: this many open memos to the agent, or this many helpers that run.
export const OVERLOADED_MEMOS = 5;
export const OVERLOADED_HELPERS = 3;
// Happy: a reply of the owner with thanks or praise in the last few hours.
export const HAPPY_MS = 4 * 60 * 60 * 1000;
// A short agent (the liaison) counts as working for this long after its last run.
export const SHORT_RUN_MS = 10 * 60 * 1000;
// The words of thanks or praise, whole words in any case, with a few signs.
export const THANKS = /\b(?:thanks?|thank you|thx|ty|great|perfect|nice|love(?:ly|d)?|wonderful|excellent|awesome|brilliant|well done|good job|nice work|good work|amazing|fantastic|yay|bravo|kudos)\b|🙏|❤️|💜|👍|🎉|😍/iu;

const ms = (now) => (now instanceof Date ? now.getTime() : Number(now));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The most used window of the account, when the figures are fresh (from the last 20 minutes) and its reset has not
// passed: { name, percent }, or null. Both shapes: the Claude figures (session, week, models with a name) and the
// OpenAI figures of the desktop worker (windows with a label). A reading with no percent gives nothing.
export function mostUsed(usage, now = new Date()) {
  if (!usage || typeof usage !== 'object') return null;
  const at = Date.parse(usage.at ?? '');
  if (Number.isNaN(at) || ms(now) - at > FRESH_MS) return null;
  const rows = [['session', usage.session], ['week', usage.week],
    ...(Array.isArray(usage.models) ? usage.models.map((m) => [String(m.name || 'model'), m]) : []),
    ...(Array.isArray(usage.windows) ? usage.windows.map((w) => [String(w.label || w.key || 'window'), w]) : [])];
  let best = null;
  for (const [name, w] of rows) {
    const percent = w && Number.isFinite(Number(w.percent)) ? Number(w.percent) : null;
    if (percent === null) continue;
    const reset = Date.parse(w.resets_at ?? '');
    if (!Number.isNaN(reset) && reset < ms(now)) continue;
    if (!best || percent > best.percent) best = { name, percent: Math.round(percent) };
  }
  return best;
}
// At a spend limit: the desktop worker's credits say it has none (hasCredits false and not unlimited). The Claude
// figures have no spend data, so this is only a hook for them.
export function atSpendLimit(usage) {
  const credits = usage?.credits_by_limit_id;
  if (!credits || typeof credits !== 'object') return false;
  return Object.values(credits).some((c) => c && c.hasCredits === false && c.unlimited !== true);
}

// The thanks of the owner: among the replies to the memos of the agent (agent.replies, the last day), the newest
// in the last HAPPY_MS whose text has a word of THANKS. { id, text } or null.
export function recentThanks(agent, now = new Date()) {
  const list = Array.isArray(agent?.replies) ? agent.replies : [];
  for (const r of list) {
    const t = Date.parse(r?.closed ?? '');
    if (Number.isNaN(t) || ms(now) - t > HAPPY_MS || ms(now) - t < 0) continue;
    if (THANKS.test(String(r.reply || ''))) return { id: r.id, text: String(r.reply) };
  }
  return null;
}

// How an agent feels, from the signals of GET /api/agents. { key, label, reason, title }: the key is one of
// FEELINGS, the label is its word ("Tired", or "Napping" for a sleeping agent whose session is away), the reason is
// a few words for the tooltip, and the title puts the two together: "Tired: account at 86 percent".
export function feelingOf(agent, { now = new Date() } = {}) {
  const a = agent || {};
  const word = stateWord(a);
  const helpers = Array.isArray(a.helpers) ? a.helpers : [];
  const running = helpers.filter((h) => h.running);
  const openTo = Number(a.open_to) || 0;
  const openFrom = Number(a.open_from) || 0;
  const made = (key, reason, label = FEELING_WORDS[key]) => ({ key, label, reason, title: `${label}: ${reason}` });

  // Upset: blocked on a permission question or a sign-in, a wakeup that was not confirmed, or a failed helper
  // (a hook: the server marks none as failed yet).
  if (a.blocked || word === 'Blocked') {
    const why = a.blocked?.reason === 'sign-in' ? 'it needs a sign-in' : a.blocked?.reason === 'permission' ? 'a permission question waits for you' : 'it is blocked';
    return made('upset', why);
  }
  if (a.dispatch?.state === 'uncertain') return made('upset', 'its wakeup was not confirmed');
  const failed = helpers.find((h) => h.failed);
  if (failed) return made('upset', `a helper failed: ${failed.label}`);

  // Tired: the account above TIRED_AT percent in a window, or at a spend limit.
  if (atSpendLimit(a.usage)) return made('tired', 'at a spend limit');
  const used = mostUsed(a.usage, now);
  if (used && used.percent >= TIRED_AT) return made('tired', used.percent >= 95 ? `account at its limit, ${used.name} at ${used.percent} percent` : `account at ${used.percent} percent (${used.name})`);

  // Overloaded: many open memos to it, or several helpers at once.
  if (openTo >= OVERLOADED_MEMOS) return made('overloaded', `${openTo} memos wait on it`);
  if (running.length >= OVERLOADED_HELPERS) return made('overloaded', `${running.length} helpers run at once`);

  // Waiting on you: idle while memos it sent wait on the owner.
  if (word === 'Idle' && openFrom >= 1) return made('waiting', `${plural(openFrom, 'memo')} from it ${openFrom === 1 ? 'waits' : 'wait'} on you`);

  // Working: in a turn, or wrapping up; a short agent for a few minutes after a run.
  if (word === 'Working') return made('working', String(a.status || '').trim() || 'in a turn');
  if (word === 'Stopping') return made('working', 'wrapping up with a recap');
  if (a.kind === 'short') {
    const last = Date.parse(a.updated ?? '');
    if (!Number.isNaN(last) && ms(now) - last < SHORT_RUN_MS) return made('working', 'a run a moment ago');
  }

  // Happy: the owner thanked or praised it in the last few hours.
  const thanks = recentThanks(a, now);
  if (thanks) return made('happy', `your thanks on memo ${thanks.id}`);

  // Sleeping: the session is away (napping), or idle with nothing open to it.
  if (a.kind === 'short') return made('sleeping', 'between runs', 'Napping');
  if (word === 'Offline') return made('sleeping', a.runtime === 'codex-desktop' ? 'no recent contact, a memo wakes it' : 'offline', 'Napping');
  if (word !== 'Idle') return made('sleeping', 'its session is stopped', 'Napping');
  if (openTo) return made('sleeping', `idle, ${plural(openTo, 'memo')} to it not started`, 'Dozing');
  return made('sleeping', 'idle, nothing open to it');
}

// A memo row draws the pet of its sender (memo 1241): the size is the impact, 1 small to 5 big, and how bothered it
// looks is the effort, calm for micro up to very bothered for a day. The words go in a label a screen reader hears
// with the real numbers: "Landon, big and calm: impact 4, effort micro".
export const SIZE_WORDS = ['tiny', 'small', 'medium', 'big', 'huge'];
export const UPSET_LEVEL = { micro: 0, short: 1, hour: 2, 'half-day': 3, day: 4 };
export const UPSET_WORDS = ['calm', 'a bit bothered', 'bothered', 'quite bothered', 'very bothered'];
// The size as a level 1 to 5; 3 when the impact is not a number.
const isNumber = (x) => x !== null && x !== undefined && x !== '' && Number.isFinite(Number(x));
export function sizeOf(impact) {
  return isNumber(impact) ? Math.min(5, Math.max(1, Math.round(Number(impact)))) : 3;
}
// How bothered, 0 (calm) to 4 (very bothered); an effort that is not in the list counts as short, as the energy tabs do.
export function upsetOf(effort) {
  const level = UPSET_LEVEL[String(effort || '').toLowerCase()];
  return level === undefined ? 1 : level;
}
// Excited (SYS-72): a quick big win, an impact of 4 or 5 with the effort micro or short. Landon twirls; each pet has
// its own excited pose (ui/petview.js).
export const EXCITED_IMPACT = 4;
export const EXCITED_EFFORTS = ['micro', 'short'];
export function excitedOf(impact, effort) {
  return isNumber(impact) && Number(impact) >= EXCITED_IMPACT && EXCITED_EFFORTS.includes(String(effort || '').toLowerCase());
}
// The label of the creature in a row. null for a memo with no impact (a memo from the owner keeps its plain numbers).
// An excited pet says so: "Landon, big and calm, excited: impact 4, effort micro".
export function rowLabel(sender, impact, effort) {
  if (!isNumber(impact) || !effort) return null;
  const size = sizeOf(impact);
  return `${petOf(sender).pet}, ${SIZE_WORDS[size - 1]} and ${UPSET_WORDS[upsetOf(effort)]}${excitedOf(impact, effort) ? ', excited' : ''}: impact ${Number(impact)}, effort ${effort}`;
}

// The mood of the pet in a row, from the memo alone, so a list shows a mix of faces and the same memo shows the same
// face on every device: { key, label, reason, title }, the key one of FEELINGS. The first rule that applies wins.
// An answered memo: happy when her reply has a word of thanks, asleep otherwise. An open memo: upset when overdue,
// tired when put off (Ugh: waited more than 5 days, or postponed and back), overloaded for an effort of half a day or
// more, happy for a quick big win, working when new or updated (not seen yet), asleep for a low impact, and waiting
// for the rest. today: the date of the owner as YYYY-MM-DD, for the due date; with none, no memo is overdue.
export const HEAVY_EFFORTS = ['half-day', 'day'];
export const ROW_LOW_IMPACT = 2;
export function rowFeeling(memo, { now = new Date(), today = '' } = {}) {
  const m = memo || {};
  const made = (key, reason) => ({ key, label: FEELING_WORDS[key], reason, title: `${FEELING_WORDS[key]}: ${reason}` });
  if (m.state && m.state !== 'open') return THANKS.test(String(m.reply || '')) ? made('happy', 'you thanked it') : made('sleeping', 'answered');
  if (m.due && today && m.due < today) return made('upset', `overdue since ${m.due}`);
  const ugh = ughReason(m, ms(now));
  if (ugh === 'back') return made('tired', 'postponed and back');
  if (ugh === 'waited') return made('tired', `has waited ${daysWaited(m, ms(now))} days`);
  const effort = String(m.effort || '').toLowerCase();
  if (HEAVY_EFFORTS.includes(effort)) return made('overloaded', `a big ask, effort ${effort}`);
  if (excitedOf(m.impact, m.effort)) return made('happy', 'a quick big win');
  if (m.seen === 0) return made('working', 'new, not seen yet');
  if (m.seen === 2) return made('working', 'updated since you saw it');
  if (isNumber(m.impact) && Number(m.impact) <= ROW_LOW_IMPACT) return made('sleeping', 'low impact, no hurry');
  return made('waiting', 'waits on you');
}

// Peeve's cuddly moment (SYS-72): now and then, while idle or happy, the cat curls up as a little spoon. Not every
// time: one window of CUDDLE_EVERY_MS in CUDDLE_ONE_IN, by the clock, so every device shows the same and a test can
// pick a time. With the default 5 minutes in 4, about a quarter of the time, in stretches of 5 minutes.
export const CUDDLE_EVERY_MS = 5 * 60 * 1000;
export const CUDDLE_ONE_IN = 4;
export function cuddleMoment(now = new Date(), { every = CUDDLE_EVERY_MS, oneIn = CUDDLE_ONE_IN } = {}) {
  return Math.floor(ms(now) / every) % oneIn === 0;
}

// How long Darkness has waited (SYS-72): a level 1 to 4 from the age of the oldest open memo from the agent to the
// owner (memos_from, each with its created time): under an hour 1, under 6 hours 2, under a day 3, longer 4. The
// speech bubbles grow with it. 1 with no memo or no times (an older server gives none).
export const WAIT_LEVEL_MS = [60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
export function waitLevel(agent, now = new Date()) {
  const list = Array.isArray(agent?.memos_from) ? agent.memos_from : [];
  const ages = list.map((m) => ms(now) - Date.parse(m?.created ?? '')).filter((a) => Number.isFinite(a) && a >= 0);
  if (!ages.length) return 1;
  const oldest = Math.max(...ages);
  return 1 + WAIT_LEVEL_MS.filter((limit) => oldest >= limit).length;
}

// The address of a picture of the pet, when the owner put one in the pets folder (README.md, "Pictures of the pets").
// art: the agent's `art` from GET /api/agents, { any, feelings } or null. feeling: one of FEELINGS (an agent card, or
// a memo row with rowFeeling), or 'any' for the plain picture alone. null when the pet is drawn in code: no picture for this feeling and no plain one.
export function artUrl(name, feeling, art) {
  if (!art || typeof art !== 'object' || !/^[a-z][a-z0-9-]*$/.test(String(name))) return null;
  const key = FEELINGS.includes(feeling) ? feeling : 'any';
  if (!(art.any || (Array.isArray(art.feelings) && art.feelings.includes(key)))) return null;
  return `/ui/pet/${name}/${key}`;
}

// The picture of the pet for a feeling, with what the page must know to show it: { src, animated, still }, or null
// when the pet is drawn in code (as artUrl). animated: the file moves by itself (a .webp or a .gif), so the page adds
// no movement of its own. still: the address of the still file of the same stem, for a reader who asked for reduced
// motion, or null when the folder has none (the animated file shows then). art.animated and art.still name the keys,
// "any" or a feeling; a feeling with no file of its own shows the plain picture, so it reads the key "any".
export function artPicture(name, feeling, art) {
  const src = artUrl(name, feeling, art);
  if (!src) return null;
  const has = (list, key) => Array.isArray(list) && list.includes(key);
  const key = FEELINGS.includes(feeling) && has(art.feelings, feeling) ? feeling : 'any';
  const animated = has(art.animated, key);
  return { src, animated, still: animated && has(art.still, key) ? `${src}?still=1` : null };
}
