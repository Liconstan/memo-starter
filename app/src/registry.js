// The skill registry and the first stage of skill prediction (memo 1418; docs/command-center-plan.md, sections 2.5
// and 3.1). A trial. Everything here is a rule on files and words: no model, no key, no network.
//
// The registry is built on request from the places where skills live:
//   - the agent skills of the vault, skills/agent/<name>/SKILL.md, written by the agents;
//   - the pinned copies of the hand-made skills of the owner, skills/<name>/SKILL.md, view only;
//   - for each long agent of local/agents.json, the skills its Claude account has: <config>/skills/<name> and the
//     newest folder of <config>/skills/synced/, where manifest.json says which ones are hers ("plugin") and which
//     come with Claude (a source that starts with "anthropic": not in the registry);
//   - the skills folder of the work folder of the agent, <dir>/.claude/skills, the link through which both Claude
//     agents load the agent skills.
// A skill of the registry has its name, its description, its kind, the agents that have it, and a category: one of
// the workstream codes. The text of a skill never leaves this module: only the frontmatter is read into the result.
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { frontmatter, readSkills } from './system.js';
// The ratings of the owner and the day a skill was last named (memo 1420).
import { readRatings, lastNamed, usedDay, isOld, sha, hash8 } from './skilllog.js';
// The names the pages show for the agents (memo 1408): the access line is text of the Inbox.
import { displayName } from '../ui/agentstate.js';

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const CACHE_MS = 30_000;
const list = (dir) => { try { return readdirSync(dir).sort(); } catch { return []; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const mtimeMs = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const real = (p) => { try { return realpathSync(p); } catch { return null; } };

// A frontmatter value without its quotes: "Use when x" and 'Use when x' are Use when x.
export function unquote(value) {
  const v = String(value ?? '').trim();
  const m = v.match(/^"([\s\S]*)"$/) || v.match(/^'([\s\S]*)'$/);
  return m ? m[1].replace(/\\"/g, '"').replace(/''/g, "'").trim() : v;
}
// The optional key `triggers` of a skill, on one line: a, b, c or [a, "b c"]. Short phrases, in small letters.
export function parseTriggers(value) {
  const v = String(value ?? '').trim().replace(/^\[([\s\S]*)\]$/, '$1');
  return [...new Set(v.split(',').map((t) => unquote(t).toLowerCase().replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 3 && t.length <= 60))].slice(0, 12);
}

// ---------- the words ----------
// Words that say nothing about the kind of a task. Add the name of the owner and of the organisation here: they are
// in almost every skill.
const STOP = new Set(`a about after again all also an and any are as ask asks asked at back be been before below both but by can come comes could did do does done each
 else especially even every for from get gets give gives go goes had has have her here hers herself him his how i if in into is it its just keep keeps kept know left like look
 made make makes may me more most my need needs new next no not now of off on one only onto or other our out over own per put read ready reply-me same say says see send sends
 sent she should since so some still such take than that the their them then there these they thing things this those through to today too two under until up us use used uses
 using very want wants was way we were what when whenever where whether which while who whose why will with without would yes yet you your yours
 claude agent agents memo memos skill skills user someone anything something covers cover full first last short right step steps task tasks work
 please thanks question done note notes link links`.split(/\s+/));
// One word without its plural s: "replies" is reply, "drafts" is draft, "class" and "status" stay.
export function singular(word) {
  const w = String(word).toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 2 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
// One word in its plain form, for a match: singular, and without -ed or -ing. "matched" and "matching" are match.
export function stem(word) {
  const w = singular(word);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  return w;
}
// The words of a text, in order: letters and digits, with a hyphen inside a word kept ("follow-up"). No web
// addresses, no possessive 's.
function rawWords(text) {
  return String(text ?? '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').replace(/[’']s\b/g, '').match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
}
// The plain words of a text: the parts of a hyphenated word count one by one.
const plainWords = (text) => rawWords(text).flatMap((w) => w.split('-')).map(stem);
const useful = (w, min) => w.length >= min && !STOP.has(w) && !/^\d+$/.test(w);

// ---------- the categories ----------
// The words that point at a workstream of the owner (workstreams.json, the example codes of the kit). A category that a
// skill names itself (the key `category`) always wins; this table is only the guess.
const CATEGORY_WORDS = {
  REL: ['partner', 'partnership', 'contact', 'outreach', 'introduction', 'relationship', 'stakeholder'],
  SPEC: ['benchmark', 'dataset', 'research', 'botec', 'rfp', 'experiment', 'pilot', 'prototype', 'estimate', 'cost-effectiveness'],
  FUND: ['fundraising', 'grant', 'donor', 'pledge', 'gift', 'funder', 'sponsor', 'donation', 'revenue', 'client'],
  OPS: ['finance', 'bookkeeping', 'accounting', 'compliance', 'board', 'hiring', 'agreement', 'sign', 'esignature', 'policy', 'tax', 'operation', 'gmail', 'email', 'inbox',
    'teammate', 'internal', 'nonprofit', 'payroll', 'invoice'],
  PROG: ['program', 'event', 'residency', 'summit', 'workshop', 'course', 'syllabus', 'curriculum', 'newsletter', 'announcement', 'fellowship', 'cohort', 'facilitator', 'applicant', 'website', 'learner', 'job'],
  COMM: ['community', 'party', 'guest', 'attendee', 'networking', 'meetup'],
  SYS: ['audit', 'model', 'helper', 'git', 'github', 'merge', 'browser', 'extension', 'chrome', 'script', 'trial', 'fable', 'check'],
  ME: ['health', 'personal', 'voice', 'herself', 'himself', 'myself'],
};
// The category of a skill from its name and its description, for a skill that names none. The code with the most
// distinct words wins; a word in the name counts double; on a tie, the first code of workstreams.json. With no word
// at all the answer is null: the caller decides (the registry puts such a skill under its fallback code).
export function guessCategory(name, description, workstreams) {
  const codes = Object.keys(workstreams || {});
  const inName = new Set(plainWords(name));
  const all = new Set([...inName, ...plainWords(description)]);
  const joined = ` ${rawWords(`${name} ${description}`).join(' ')} `;
  let best = null;
  for (const code of codes) {
    const table = (CATEGORY_WORDS[code] || []).map((w) => [w, 2]);
    // The words of the description of the workstream count too, at half the weight: a code this table does not know
    // still gets a guess.
    const about = [...new Set(plainWords(workstreams[code]).filter((w) => useful(w, 5)))].filter((w) => !table.some(([t]) => stem(t) === w)).map((w) => [w, 1]);
    let score = 0;
    const words = [];
    for (const [word, weight] of [...table, ...about]) {
      const hit = word.includes('-') ? joined.includes(` ${word} `) || joined.includes(` ${word}s `) : all.has(stem(word));
      if (!hit) continue;
      score += weight * (inName.has(stem(word)) ? 2 : 1);
      words.push(word);
    }
    if (score > 0 && (!best || score > best.score)) best = { code, score, words };
  }
  return best;
}

// ---------- the agents and their skill folders ----------
const expand = (p, home) => (typeof p === 'string' && (p === '~' || p.startsWith('~/')) ? join(home, p.slice(1)) : p);
// The long agents of local/agents.json with the folder of their Claude account and their work folder. Without a
// file that reads: main on ~/.claude and second on ~/.claude-second, both in ~/memo-work, as the starter kit sets them up.
export function agentAccounts({ local, home = homedir() } = {}) {
  const fallback = [
    { name: 'main', config: join(home, '.claude'), dir: join(home, 'memo-work') },
    { name: 'second', config: join(home, '.claude-second'), dir: join(home, 'memo-work') },
  ];
  try {
    const rows = JSON.parse(readFileSync(join(local, 'agents.json'), 'utf8'));
    const long = Array.isArray(rows) ? rows.filter((a) => a && a.kind === 'long' && typeof a.name === 'string' && /^[a-z][a-z0-9-]*$/.test(a.name)) : [];
    if (!long.length) return fallback;
    return long.map((a) => ({
      name: a.name,
      config: expand(typeof a.env?.CLAUDE_CONFIG_DIR === 'string' ? a.env.CLAUDE_CONFIG_DIR : join(home, '.claude'), home),
      dir: expand(typeof a.dir === 'string' ? a.dir : home, home),
    }));
  } catch { return fallback; }
}
// The skill folders of a directory: name -> the path of its SKILL.md.
function skillFiles(dir) {
  const out = new Map();
  for (const name of list(dir)) {
    if (!NAME.test(name)) continue;
    const file = join(dir, name, 'SKILL.md');
    if (isFile(file)) out.set(name, file);
  }
  return out;
}
// The skills of one Claude account that are the owner's own: the folders of <config>/skills (its personal skills,
// which the nightly skills sync keeps at the newest text for both accounts, memo 1426), and those of the newest
// folder of <config>/skills/synced that manifest.json does not mark as coming with Claude. An account can keep the
// folder of an older sign-in next to the current one; the newest finished round is the current one. A skill in
// both places counts once, as the personal one: Claude Code lists it by its bare name, and the synced one with a
// prefix.
export function accountSkills(config) {
  const out = new Map();
  for (const [name, s] of syncedSkills(config)) out.set(name, { file: s.file, source: s.source });
  for (const [name, file] of skillFiles(join(config, 'skills'))) if (name !== 'synced') out.set(name, { file, source: 'local' });
  return out;
}
// The owner's own skills in the newest finished round of <config>/skills/synced, which claude.ai writes and nothing
// here ever changes: name -> { file, source, updatedAt }. updatedAt: when she last changed the skill in her Claude
// account, from manifest.json, or null. The files themselves carry the time of the download, which says nothing.
export function syncedSkills(config) {
  const out = new Map();
  const synced = join(config, 'skills', 'synced');
  const buckets = list(synced).filter((n) => !n.startsWith('.') && isDir(join(synced, n)))
    .map((n) => ({ dir: join(synced, n), at: Math.max(mtimeMs(join(synced, n, '.last-complete-round')), mtimeMs(join(synced, n, 'manifest.json'))) || mtimeMs(join(synced, n)) }))
    .sort((a, b) => b.at - a.at || (a.dir < b.dir ? -1 : 1));
  const bucket = buckets[0]?.dir;
  if (!bucket) return out;
  const sources = new Map();
  const times = new Map();
  try {
    for (const s of JSON.parse(readFileSync(join(bucket, 'manifest.json'), 'utf8')).skills || []) {
      if (!s || typeof s.name !== 'string') continue;
      sources.set(s.name, String(s.source || ''));
      if (typeof s.updatedAt === 'string' && !Number.isNaN(Date.parse(s.updatedAt))) times.set(s.name, s.updatedAt);
    }
  } catch { /* no manifest: every folder counts as hers */ }
  for (const [name, file] of skillFiles(bucket)) {
    const source = sources.get(name) ?? 'unknown';
    if (/^anthropic/.test(source)) continue;
    out.set(name, { file, source, updatedAt: times.get(name) ?? null });
  }
  return out;
}

// ---------- the registry ----------
// vault: the vault of notes. local: the local/ directory of Memo (agents.json). workstreams: the codes of the owner,
// { OPS: '...' }. home: the home folder (a test gives its own). fallback: the category of a skill with no word of
// any workstream. The result:
//   { skills: [{ name, kind: 'agent' | 'hand', description, category, categoryGuessed, categoryWords, triggers,
//                agents: ['main'], missing: ['second'], access: 'all' | 'spread', cloud?: true, pinned, id,
//                last_used?, stale?, version, rated, ratings, lastScore, used, old }],
//     agents: [{ name, display, count }], categories: { OPS: '...' } }
// id is the file id of the System page editor (skill:<name>, hand:<name>), or null for a hand-made skill that has no
// pinned copy in the vault. cloud is there only where the files can tell: an agent skill reaches the cloud agent
// when the vault's own .claude/skills is the link to skills/agent.
// Memo 1420: version is the start of the hash of the text the skill has now; rated says whether the owner rated that
// text (skills/ratings.jsonl), ratings how many ratings the skill has, lastScore her newest score. used is the day
// the skill was last used and old the mark "Old · may change" (src/skilllog.js usedDay, isOld): over 30 days, or
// never. mentions: the closed memos, [{ closed, text }], for the day a hand-made skill was last named; or nothing.
export function buildRegistry({ vault, local, workstreams = {}, home = homedir(), now = new Date(), fallback = 'SYS', mentions = null } = {}) {
  const agentDir = join(vault, 'skills', 'agent');
  const agents = agentAccounts({ local, home });
  const reach = agents.map((a) => ({ name: a.name, account: accountSkills(a.config), project: skillFiles(join(a.dir, '.claude', 'skills')) }));
  const cloudLink = real(join(vault, '.claude', 'skills'));
  const cloud = cloudLink !== null && cloudLink === real(agentDir);
  const codes = Object.keys(workstreams);
  const skills = new Map();
  const ratings = readRatings(vault);
  const add = (name, kind, file, more) => {
    const text = readText(file);
    const { data } = frontmatter(text);
    const mine = ratings.filter((r) => r.skill === name);
    const log = { version: hash8(text), rated: mine.some((r) => r.hash === sha(text)), ratings: mine.length, lastScore: mine.at(-1)?.score ?? null,
      lastRated: mine.at(-1)?.at ?? null, lastUsedKey: unquote(data.last_used) || null };
    const description = unquote(data.description).replace(/\s+/g, ' ').slice(0, 600);
    const own = unquote(data.category).toUpperCase();
    const guess = codes.includes(own) ? null : guessCategory(name, description, workstreams);
    const category = codes.includes(own) ? own : guess?.code ?? (codes.includes(fallback) ? fallback : codes[0] ?? null);
    skills.set(name, { name, kind, description, category, categoryGuessed: !codes.includes(own), categoryWords: guess?.words ?? [], triggers: parseTriggers(data.triggers), ...more, ...log });
  };
  for (const s of readSkills(agentDir, now)) add(s.name, 'agent', s.file, { pinned: false, id: `skill:${s.name}`, last_used: s.last_used, stale: s.stale });
  for (const s of readSkills(join(vault, 'skills'), now)) if (!skills.has(s.name)) add(s.name, 'hand', s.file, { pinned: true, id: `hand:${s.name}` });
  // A skill of an account with no copy in the vault: hand-made, not pinned. Its description comes from the account.
  for (const r of reach) for (const [name, { file }] of r.account) if (!skills.has(name)) add(name, 'hand', file, { pinned: false, id: null });
  let texts = [];
  try { texts = (typeof mentions === 'function' ? mentions() : mentions) || []; } catch { /* no memos to read: the keys and the ratings decide */ }
  const named = lastNamed([...skills.values()].filter((s) => s.kind === 'hand').map((s) => s.name), texts);
  const out = [...skills.values()].map(({ lastRated, lastUsedKey, ...s }) => {
    const used = usedDay({ kind: s.kind, lastUsed: lastUsedKey, named: named.get(s.name) ?? null, rated: lastRated });
    s = { ...s, used, old: isOld(used, now) };
    const has = reach.filter((r) => r.project.has(s.name) || r.account.has(s.name)).map((r) => r.name);
    const missing = reach.map((r) => r.name).filter((n) => !has.includes(n));
    return { ...s, agents: has, missing, access: missing.length ? 'spread' : 'all', ...(s.kind === 'agent' && cloud ? { cloud: true } : {}) };
  }).sort((a, b) => (a.kind === b.kind ? (a.name < b.name ? -1 : 1) : a.kind === 'agent' ? -1 : 1));
  return {
    skills: out,
    agents: reach.map((r) => ({ name: r.name, display: displayName(r.name), count: out.filter((s) => s.agents.includes(r.name)).length })),
    categories: { ...workstreams },
  };
}

// The words about who has a skill, for the System page: "In all agents", or "Needs spreading: missing on Darkness".
export function spreadLine(skill) {
  if (!skill.missing.length) return 'In all agents';
  if (!skill.agents.length) return 'In no agent yet';
  return `Needs spreading: missing on ${skill.missing.map(displayName).join(' and ')}`;
}

// Whether one agent has a skill, in the words of the card of the Inbox. An agent that is not a Claude agent of the
// registry (gpt) loads no skill by itself: has is null.
export function accessFor(skill, agent, registry) {
  const display = displayName(agent);
  if (!registry.agents.some((a) => a.name === agent)) {
    return { agent, display, has: null, line: `${display} does not load Claude skills.`, next: 'It reads the skill file only when the task names it.' };
  }
  if (skill.agents.includes(agent)) return { agent, display, has: true, line: `${display} has this skill.`, next: `Proceed with ${display}.` };
  const others = skill.agents.map(displayName);
  const who = others.length ? `${others.join(' and ')} ${others.length === 1 ? 'has' : 'have'} it. ` : '';
  const fix = skill.kind === 'hand' ? `The nightly skills sync adds it for ${display}${others.length ? `, or send the task to ${others[0]}` : ''}.` : `Check the skills link in the work folder of ${display}.`;
  return { agent, display, has: false, line: `${display} lacks this skill. Sync needed.`, next: `${who}${fix}` };
}

// ---------- stage one of the prediction ----------
// The memo has a head (its title and its first paragraph, which says what the memo is about) and a body (the next
// 1,500 characters; a long digest names many things further down, and those say little about the task).
// A skill is a candidate for a memo in one of three cases:
//   - the memo has one of its trigger phrases (the optional key `triggers`);
//   - two different words of its name are in the memo, one of them in the head;
//   - its name has one useful word only (botec), and the head has that word and a word of its description.
// The score of a candidate: a word of the name weighs 3 (one and a half times that in the head), a word of the
// description weighs 1 and counts only in the head, a trigger phrase 6; a word that many skills share weighs less
// (idf); the workstream of the memo equal to the category of the skill adds 1. The best candidate wins, and only
// with a score at the bar or over it.
export const BAR = 4.5;
const NAME_WEIGHT = 3;
const DESC_WEIGHT = 1;
const TRIGGER_WEIGHT = 6;
const HEAD_TIMES = 1.5;
const WS_BONUS = 1;
const DESC_MOST = 5; // a long description does not win by its length: its 5 best words count
const HEAD_CHARS = 600;
const BODY_CHARS = 1500;
// "Reply yes or no", "Reply add": an instruction to the owner at the end of a memo, not a word about the task.
const REPLY_ASK = /\breply\s+(?:with|yes|no|ok|go|add|me|here|to this|[a-z]+ or [a-z]+)\b/gi;
const termCache = new WeakMap();
// For each skill, its words with their weights, and how they read in the skill (for the reason line).
function termsOf(registry) {
  if (termCache.has(registry)) return termCache.get(registry);
  const rows = registry.skills.map((s) => {
    const words = new Map(); // stem -> { weight, show, name }
    const put = (raw, weight, min, name) => {
      const w = stem(raw);
      if (!useful(w, min)) return;
      const have = words.get(w);
      if (!have || weight > have.weight) words.set(w, { weight, show: have?.show ?? raw, name: name || Boolean(have?.name) });
    };
    for (const raw of rawWords(s.description).flatMap((w) => w.split('-'))) put(raw, DESC_WEIGHT, 4, false);
    for (const raw of s.name.split(/[-_]/)) put(raw, NAME_WEIGHT, 3, true);
    return { skill: s, words, nameWords: [...words.values()].filter((t) => t.name).length };
  });
  const n = rows.length || 1;
  const df = new Map();
  for (const r of rows) for (const w of r.words.keys()) df.set(w, (df.get(w) || 0) + 1);
  for (const r of rows) for (const [w, t] of r.words) t.idf = Math.log(1 + n / df.get(w)) / Math.log(1 + n);
  termCache.set(registry, rows);
  return rows;
}
const and = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
// The title and the first paragraph of a memo (the head), and the text after it (the body), as sets of plain words
// and as one line of text for the trigger phrases.
function memoWords(memo) {
  const text = String(memo.text ?? '').replace(REPLY_ASK, ' ');
  const cut = text.search(/\n\s*\n/);
  const first = (cut === -1 ? text : text.slice(0, cut)).slice(0, HEAD_CHARS);
  const head = `${memo.title ?? ''}\n${first}`;
  const body = text.slice(first.length, first.length + BODY_CHARS);
  return { head: new Set(plainWords(head)), body: new Set(plainWords(body)), line: ` ${rawWords(`${head} ${body}`).join(' ')} ` };
}
// The score of each candidate skill for one memo, best first. Each row: { skill, score, words, triggers, ws }.
export function scoreSkills(memo, registry) {
  const m = memoWords(memo);
  const rows = [];
  for (const { skill, words, nameWords } of termsOf(registry)) {
    const hits = [];
    for (const [w, t] of words) {
      const head = m.head.has(w);
      // A word of the description counts only in the head.
      const times = head ? HEAD_TIMES : t.name && m.body.has(w) ? 1 : 0;
      if (times) hits.push({ show: t.show, name: t.name, head, points: t.weight * t.idf * times });
    }
    hits.sort((a, b) => b.points - a.points || (a.show < b.show ? -1 : 1));
    const named = hits.filter((h) => h.name);
    const described = hits.filter((h) => !h.name).slice(0, DESC_MOST);
    const triggers = skill.triggers.filter((t) => m.line.includes(` ${t} `));
    const byName = named.some((h) => h.head) && (named.length >= 2 || (nameWords === 1 && described.length >= 1));
    if (!byName && !triggers.length) continue;
    const counted = [...named, ...described].sort((a, b) => b.points - a.points || (a.show < b.show ? -1 : 1));
    const ws = Boolean(memo.ws) && memo.ws === skill.category;
    const score = counted.reduce((sum, h) => sum + h.points, 0) + triggers.length * TRIGGER_WEIGHT + (ws ? WS_BONUS : 0);
    rows.push({ skill, score: Math.round(score * 100) / 100, words: counted.map((h) => h.show), triggers, ws });
  }
  return rows.sort((a, b) => b.score - a.score || (a.skill.name < b.skill.name ? -1 : 1));
}
// The one skill that a memo most likely needs, or null when none is over the bar. The reason names the words that
// matched. agent: the agent that works on the memo (the sender of a memo in the Inbox), for the access line.
export function predictSkill(memo, registry, { bar = BAR, agent = 'main' } = {}) {
  const best = scoreSkills(memo, registry).find((r) => r.score >= bar);
  if (!best) return null;
  const { skill } = best;
  const parts = [];
  if (best.triggers.length) parts.push(`has the trigger ${and(best.triggers.map((t) => `"${t}"`))}`);
  if (best.words.length) parts.push(`mentions ${and(best.words.slice(0, 4))}`);
  const reason = `The memo ${parts.join(' and ')}${best.ws ? `, and its workstream ${memo.ws} is the category of the skill` : ''}.`;
  return {
    kind: 'match', skill: skill.name, skillKind: skill.kind, description: skill.description, category: skill.category, categoryGuessed: skill.categoryGuessed,
    rated: Boolean(skill.rated), old: Boolean(skill.old), ratable: Boolean(skill.id),
    id: skill.id, editable: skill.kind === 'agent', reason, score: best.score, confidence: best.score >= bar * 2 ? 'high' : 'medium', access: accessFor(skill, agent, registry),
  };
}

// ---------- the other suggestions of a memo ----------
// The skills next in line after the predicted one, for the Skill Suggestion card of the Inbox (memo 1421): first the
// other candidates of scoreSkills, best first, whatever their score; then, to fill the list, the skills of the
// workstream of the memo (or of the predicted skill). At most `limit`. Each: { skill, skillKind, description,
// category, id, editable, why, access }, as a prediction has them.
export function otherSkills(memo, registry, { agent = 'main', skip = null, category = null, limit = 3 } = {}) {
  const out = [];
  const add = (skill, why) => {
    if (out.length >= limit || skill.name === skip || out.some((o) => o.skill === skill.name)) return;
    out.push({ skill: skill.name, skillKind: skill.kind, description: skill.description, category: skill.category, id: skill.id, editable: skill.kind === 'agent', why, access: accessFor(skill, agent, registry) });
  };
  for (const r of scoreSkills(memo, registry)) add(r.skill, r.words.length ? `The memo also mentions ${and(r.words.slice(0, 3))}.` : 'The memo also matches this skill.');
  const code = memo.ws || category;
  if (code) for (const s of registry.skills) if (s.category === code) add(s, `A skill of the workstream ${code}.`);
  return out;
}
// By memo id, for the memos that have any: the other suggestions next to the prediction of predictAll.
export function othersAll(memos, registry, { agentOf = () => 'main', bar = BAR, limit = 3 } = {}) {
  const out = {};
  for (const memo of memos) {
    const top = predictSkill(memo, registry, { bar, agent: agentOf(memo) });
    const list = otherSkills(memo, registry, { agent: agentOf(memo), skip: top?.skill ?? null, category: top?.category ?? null, limit });
    if (list.length) out[memo.id] = list;
  }
  return out;
}

// ---------- a suggestion for a skill that is not there ----------
// The rule: a memo with a workstream and a title, that no skill matches, whose title starts like the titles of
// other memos of the same workstream. "Starts like": the words before the first colon or comma (the whole title
// with none), without dates, numbers and filler: the first two (a hyphenated word counts as its parts). Three such memos or more, on two
// different days or more, make recurring work of a known kind.
export const SUGGEST_MIN = 3;
const DATE_WORDS = new Set(`monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun january february march april june july august september
 october november december jan feb mar apr jun jul aug sep sept oct nov dec am pm updated update today tomorrow yesterday tonight night morning`.split(/\s+/));
export function titleKey(title) {
  const head = String(title ?? '').split(/[:,;]| [–—-] /)[0];
  const words = rawWords(head).map((w) => w.split('-').map(singular).join('-')).filter((w) => !DATE_WORDS.has(w) && w.split('-').some((p) => useful(p, 3)) && !/^\d/.test(w)).slice(0, 2);
  const parts = words.flatMap((w) => w.split('-'));
  return parts.length >= 2 ? { key: words.join('-'), phrase: head.replace(/\s+/g, ' ').trim() } : null;
}
// history: the memos to the owner, [{ id, ws, title, created }]. The memo itself may be in it; it counts once.
export function suggestSkill(memo, history, registry) {
  if (!memo.ws || !memo.title) return null;
  const mine = titleKey(memo.title);
  if (!mine || !NAME.test(mine.key) || registry.skills.some((s) => s.name === mine.key)) return null;
  const like = [...new Map([...history, memo].filter((h) => h.ws === memo.ws && titleKey(h.title)?.key === mine.key).map((h) => [h.id, h])).values()];
  const days = new Set(like.map((h) => String(h.created || '').slice(0, 10)));
  if (like.length < SUGGEST_MIN || days.size < 2) return null;
  const since = [...days].filter(Boolean).sort()[0];
  // The phrase without a date at its end: "Daily review", not "Daily review Wednesday November 11".
  const phrase = mine.phrase.split(' ').filter((w) => !DATE_WORDS.has(singular(w.toLowerCase().replace(/[^a-z]/g, ''))) && !/^\d+$/.test(w)).join(' ') || mine.phrase;
  return {
    kind: 'suggest', name: mine.key, category: memo.ws, count: like.length,
    description: `Use when you prepare a "${phrase}" memo in the workstream ${memo.ws}. Covers the steps that repeat each time.`,
    reason: `No skill matches, and ${like.length} memos of ${memo.ws} start with "${phrase}"${since ? ` since ${since}` : ''}. Work that repeats is worth a skill.`,
  };
}

// For each memo of the Inbox: its predicted skill, or a suggestion for a new one, or nothing. By memo id.
// agentOf: the agent that works on a memo (its sender when that is an agent; else the default agent).
export function predictAll(memos, history, registry, { agentOf = () => 'main', bar = BAR } = {}) {
  const out = {};
  for (const memo of memos) {
    const found = predictSkill(memo, registry, { bar, agent: agentOf(memo) }) || suggestSkill(memo, history, registry);
    if (found) out[memo.id] = found;
  }
  return out;
}

// The registry of one installation, built again at most each 30 seconds: the Inbox asks every load.
// mentions: gives the closed memos (src/memos.js closedTexts), or nothing. The app sets it (setMentions): the
// registry is made before the app, and the store of the app has the memos.
export function createRegistry({ vault, local, workstreams = {}, home = homedir(), now = () => new Date(), mentions = null } = {}) {
  let cached = null;
  let at = 0;
  const get = () => {
    if (!cached || Date.now() - at > CACHE_MS) { cached = buildRegistry({ vault, local, workstreams, home, now: now(), mentions }); at = Date.now(); }
    return cached;
  };
  return { get, refresh: () => { cached = null; return get(); }, setMentions: (fn) => { mentions = fn; cached = null; } };
}
