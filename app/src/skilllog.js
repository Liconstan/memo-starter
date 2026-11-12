// The log of the skills (memo 1420): the old versions of a skill, the ratings of the owner, and the day a skill was
// last named. Files of the vault only: no model, no key, no network, no git (the callers commit).
//
//   skills/.versions/<name>/<YYYY-MM-DD-HHMM>-<hash8>.md   the text of a skill as it was before a change. Text files
//       cost nothing, so they stay; nothing here deletes one. The folder starts with a dot, so it is no skill.
//   skills/.versions/<name>/<YYYY-MM-DD-HHMM>-<hash8>.files/   the other files of a skill folder that a sync replaced.
//   skills/ratings.jsonl   one line of JSON for each rating of the owner, the oldest first. Append only, kept for
//       ever: her notes for a later look at what makes a skill good.
//       { at, skill, kind, version, hash, score, notes, memo }
//       version: the day the rated text last changed and the first 8 characters of its hash, "2026-11-10-1a2b3c4d".
//       hash: the whole SHA-256 of the rated text. memo: the memo she rated it from, or null.
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const OLD_DAYS = 30;
export const MAX_NOTES = 4000;
const VERSION_FILE = /^(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})-([0-9a-f]{8})\.md$/;
const list = (dir) => { try { return readdirSync(dir).sort(); } catch { return []; } };
const two = (n) => String(n).padStart(2, '0');

export const sha = (text) => createHash('sha256').update(text).digest('hex');
export const hash8 = (text) => sha(text).slice(0, 8);
// The day of a time, in the zone of the computer: 2026-11-11.
export const dayOf = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
// The time of a version in its file name, in the zone of the computer: 2026-11-11-0915.
export const stamp = (date) => `${dayOf(date)}-${two(date.getHours())}${two(date.getMinutes())}`;
// The id of a version of a skill: the day its text last changed, and the start of its hash.
export const versionId = (text, changed) => `${dayOf(changed)}-${hash8(text)}`;

// ---------- the old versions ----------
export const versionsDir = (vault, name) => join(vault, 'skills', '.versions', name);
// Keeps one text of a skill as an old version. A text that is in the log already (the same hash) is not written
// again. The result: { file, rel, written }; rel is the path inside the vault.
export function snapshot({ vault, name, text, at = new Date() }) {
  if (!NAME.test(String(name))) throw new Error(`Not the name of a skill: ${name}`);
  if (typeof text !== 'string' || !text) throw new Error('There is no text to keep.');
  const dir = versionsDir(vault, name);
  const end = `-${hash8(text)}.md`;
  const have = list(dir).find((n) => VERSION_FILE.test(n) && n.endsWith(end));
  const file = have || `${stamp(at)}${end}`;
  if (!have) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return { file: join(dir, file), rel: join('skills', '.versions', name, file), written: !have };
}
// The old versions of a skill, the newest first: [{ file, rel, day, at, hash8, size }]. at: "2026-11-11 09:15".
export function listVersions(vault, name) {
  if (!NAME.test(String(name))) return [];
  const dir = versionsDir(vault, name);
  return list(dir).map((file) => {
    const m = file.match(VERSION_FILE);
    if (!m) return null;
    let size = 0;
    try { size = statSync(join(dir, file)).size; } catch { return null; }
    return { file, rel: join('skills', '.versions', name, file), day: m[1], at: `${m[1]} ${m[2]}:${m[3]}`, hash8: m[4], size };
  }).filter(Boolean).reverse();
}
// The text of one old version, by its file name. null for a name that is not a version file, or that is not there.
export function readVersion(vault, name, file) {
  if (!NAME.test(String(name)) || !VERSION_FILE.test(String(file))) return null;
  try { return readFileSync(join(versionsDir(vault, name), file), 'utf8'); } catch { return null; }
}

// ---------- the ratings ----------
export const ratingsFile = (vault) => join(vault, 'skills', 'ratings.jsonl');
// Every rating of the file, the oldest first. A line that does not read is left out, never an error: the file is a
// log that people and agents append to.
export function readRatings(vault) {
  let text = '';
  try { text = readFileSync(ratingsFile(vault), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.skill === 'string' && NAME.test(r.skill) && Number.isInteger(r.score) && r.score >= 1 && r.score <= 5) out.push(r);
    } catch { /* a broken line */ }
  }
  return out;
}
// One rating, checked. text: the text of the skill that she rated. changed: when that text last changed.
// The errors are sentences for the owner.
export function makeRating({ skill, kind = 'agent', text, changed = new Date(), score, notes = '', memo = null, at = new Date() }) {
  if (!NAME.test(String(skill))) throw new Error('The name of the skill is missing.');
  const n = Number(score);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error('The rating is a whole number from 1 to 5.');
  const words = String(notes ?? '').replace(/\r\n?/g, '\n').trim();
  if (words.length > MAX_NOTES) throw new Error(`The notes are too long: at most ${MAX_NOTES} characters.`);
  const id = memo === null || memo === undefined || memo === '' ? null : Number(memo);
  if (id !== null && (!Number.isInteger(id) || id < 1)) throw new Error('The memo of a rating is its number.');
  return { at: at.toISOString(), skill, kind: kind === 'hand' ? 'hand' : 'agent', version: versionId(text, changed), hash: sha(text), score: n, notes: words, memo: id };
}
// Adds one rating at the end of the file. Never rewrites a line that is there.
export function appendRating(vault, rating) {
  const file = ratingsFile(vault);
  mkdirSync(dirname(file), { recursive: true });
  let lead = '';
  try { const have = readFileSync(file, 'utf8'); if (have && !have.endsWith('\n')) lead = '\n'; } catch { /* a new file */ }
  appendFileSync(file, `${lead}${JSON.stringify(rating)}\n`);
  return file;
}
// The ratings of one skill, the newest first, each with `current`: it is about the text the skill has now.
export function ratingsOf(ratings, skill, hash = null) {
  return ratings.filter((r) => r.skill === skill).map((r) => ({ ...r, current: hash !== null && r.hash === hash })).reverse();
}

// ---------- the day a skill was last named ----------
// texts: the closed memos, [{ closed, text }], the text in small letters. The result: name -> the newest `closed` of a
// memo that names the skill as a word of its own ("botec", not "botecs"; "sf-slack-post", not "my-sf-slack-post").
export function lastNamed(names, texts) {
  const out = new Map();
  const tests = names.filter((n) => NAME.test(n)).map((n) => [n, new RegExp(`(^|[^a-z0-9_-])${n}([^a-z0-9_-]|$)`)]);
  for (const t of texts || []) {
    if (!t || !t.closed || typeof t.text !== 'string') continue;
    for (const [name, re] of tests) {
      if ((out.get(name) || '') >= t.closed) continue;
      if (t.text.includes(name) && re.test(t.text)) out.set(name, t.closed);
    }
  }
  return out;
}
// The day a skill was last used, "2026-11-04", or null. An agent skill says it itself (the key `last_used`, which
// the agent sets). A hand-made skill has the key seldom: then the newest day it was named in a closed memo or rated.
export function usedDay({ kind, lastUsed = null, named = null, rated = null }) {
  const day = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10))) ? v.slice(0, 10) : null);
  if (day(lastUsed)) return day(lastUsed);
  if (kind !== 'hand') return null;
  return [day(named), day(rated)].filter(Boolean).sort().at(-1) ?? null;
}
// Old: not used in the last 30 days, or never. Such a skill gets the mark "Old · may change".
export function isOld(day, now = new Date()) {
  if (!day) return true;
  return Math.floor((now - Date.parse(day)) / 86_400_000) > OLD_DAYS;
}
export const OLD_WORDS = 'Old · may change';
