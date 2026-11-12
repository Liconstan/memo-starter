// The System page: the sync state of the vault and of the Memo code, a dashboard of the vault, the system map,
// and the files the owner can read and edit in the browser (the charters, the shared lessons, the agent skills).
// Every path here comes from a fixed list that this module builds. A request names a file by its id; the id
// goes through lookup(), never into a path.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { MemoError } from './memos.js';
// The names the pages show for the agents (memo 1408): the title of a charter is text of the System page.
import { displayName } from '../ui/agentstate.js';
// The old versions of a skill and the ratings of the owner (memo 1420).
import { snapshot, listVersions, readVersion, readRatings, ratingsOf, makeRating, appendRating, ratingsFile, versionId, hash8 } from './skilllog.js';

const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/; // a skill folder name. No dot, so no "..".
const MAX_TEXT = 400_000;
const STALE_DAYS = 30;
const DEBOUNCE_MS = 10_000;
const CHECK_MS = 5 * 60_000;
const GIT_TIMEOUT = 60_000;
const BUILD_TIMEOUT = 90_000;
const MAP_FILE = join('summaries', 'system-map.html');
// The command that makes the map, run in the vault. A vault with no such script has no map, and nothing is run.
const DEFAULT_BUILD = { cmd: 'python3', args: [join('scripts', 'system-map', 'build.py')] };
const sha = (text) => createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Runs one command with a time limit. The error of a failed command carries its stderr.
function run(cmd, args, { cwd, timeout = GIT_TIMEOUT } = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  // A missing key or an unknown host must fail, not wait for an answer in a terminal that nobody sees.
  if (!env.GIT_SSH_COMMAND) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes';
  return new Promise((done, fail) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 16e6, env }, (error, stdout, stderr) => {
      if (!error) return done(stdout);
      const text = error.killed ? `${cmd} ${args[0]} took more than ${Math.round(timeout / 1000)} s and was stopped` : (stderr || stdout || error.message).trim();
      fail(new Error(text));
    });
  });
}

// A git command in a directory. A stale index.lock means another agent commits there: wait, then try again.
async function git(cwd, args, options = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await run('git', args, { cwd, ...options }); } catch (error) {
      if (attempt < 5 && /index\.lock/.test(error.message)) { await sleep(2000); continue; }
      throw error;
    }
  }
}

// "2\t1" from git rev-list --left-right --count HEAD...@{upstream}: 2 commits ahead, 1 behind.
export function parseCounts(text) {
  const m = String(text).trim().match(/^(\d+)\s+(\d+)$/);
  if (!m) throw new Error(`git gave no counts: ${String(text).trim() || 'nothing'}`);
  return { ahead: Number(m[1]), behind: Number(m[2]) };
}

// The paths in the output of git status --porcelain.
export function statusPaths(text) {
  return String(text).split('\n').filter((l) => l.length > 3).map((l) => l.slice(3).replace(/^"(.*)"$/, '$1').split(' -> ').pop());
}

// One line for the owner, and its level: ok (green), warn (amber), bad (red).
export function syncLine({ ahead = null, behind = null, uncommitted = null, error = null } = {}) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  if (error) return { level: 'bad', text: `Could not check: ${error}` };
  if (ahead === null) return { level: 'bad', text: 'Not checked yet.' };
  const parts = [];
  if (ahead > 0) parts.push(`${n(ahead, 'commit', 'commits')} not pushed`);
  if (behind > 0) parts.push(`${n(behind, 'commit', 'commits')} on GitHub not pulled`);
  if (uncommitted > 0) parts.push(`${n(uncommitted, 'file', 'files')} changed and not committed`);
  if (!parts.length) return { level: 'ok', text: 'In sync with GitHub.' };
  return { level: 'warn', text: `Out of sync: ${parts.join(', ')}.` };
}

// The frontmatter of a markdown file as an object, and the text after it.
export function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].trim();
  }
  return { data, body: text.slice(m[0].length) };
}

// The frontmatter of a new agent skill, when skills/README.md of the vault gives none: the schema of that file.
const SKILL_KEYS = ['name', 'description', 'purpose', 'helper_model', 'model_why', 'created_by', 'created', 'last_used', 'source'];
const SKILL_HINTS = {
  purpose: '<one sentence: the outcome this skill exists to produce>',
  helper_model: '<haiku | sonnet | opus | fable> <low | medium | high>',
  model_why: '<one clause>',
};
// The text of a new agent skill, in the schema of skills/README.md of the vault ("Schema for an agent skill"): the
// keys of its frontmatter block in their order, with the name, the description, the dates and the source filled in,
// and the hints of the README for the rest; then the body sections in their order. readme: the text of that file,
// or '' (then the keys above). category: a workstream code, for the optional key `category` (src/registry.js).
export function skillTemplate({ name, description = '', category = '', source = 'the System page', today, readme = '' }) {
  const block = readme.match(/## Schema for an agent skill[\s\S]*?```\n---\n([\s\S]*?)\n---\n```/);
  const hints = { ...SKILL_HINTS };
  let keys = SKILL_KEYS;
  if (block) {
    const rows = block[1].split('\n').map((l) => l.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean);
    if (rows.some((r) => r[1] === 'name') && rows.some((r) => r[1] === 'description')) {
      keys = rows.map((r) => r[1]);
      for (const r of rows) hints[r[1]] = r[2];
    }
  }
  const one = (v) => String(v).replace(/\s+/g, ' ').trim();
  const values = { name, description: one(description) || 'Use when <trigger>. <one clause of what it covers>.', created_by: 'the owner, from a suggestion on the System page', created: today, last_used: '', source: one(source) };
  const lines = [];
  for (const key of keys) {
    lines.push(`${key}: ${Object.hasOwn(values, key) ? values[key] : hints[key] ?? ''}`.trimEnd());
    if (key === 'description' && category) lines.push(`category: ${category}`);
  }
  const title = name.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
  return `---\n${lines.join('\n')}\n---\n\n# ${title}\n\n## Goal\n\n<One or two sentences: why it matters.>\n\n## When to use\n\n- <the kind of task>\n\n## When not to use\n\n- <the nearby task that another skill covers>\n\n`
    + '## Steps\n\n1. <the first step, concrete>\n\n## Done when\n\n- <a criterion that can be checked>\n\n## Pitfalls\n\n- <only real ones, each with its memo number>\n';
}

const list = (dir) => { try { return readdirSync(dir).sort(); } catch { return []; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const mtime = (p) => { try { return statSync(p).mtime.toISOString(); } catch { return null; } };
const daysAgo = (date, now) => (date ? Math.floor((now - Date.parse(date)) / 86_400_000) : null);

// The agent skills (skills/agent/<name>/SKILL.md) or the hand-made skills (skills/<name>/SKILL.md), with their
// frontmatter. A folder whose name is not plain, or that is a link, is not a skill.
export function readSkills(dir, now = new Date()) {
  const out = [];
  if (!isDir(dir)) return out;
  for (const name of list(dir)) {
    if (!NAME.test(name) || name === 'agent') continue;
    const folder = join(dir, name);
    let info;
    try { info = lstatSync(folder); } catch { continue; }
    if (!info.isDirectory()) continue;
    const file = join(folder, 'SKILL.md');
    if (!isFile(file)) continue;
    const { data } = frontmatter(readText(file));
    const age = daysAgo(data.last_used, now);
    out.push({ name, file, description: data.description || '', last_used: data.last_used || null, stale: age === null || age > STALE_DAYS, size: statSync(file).size, mtime: mtime(file) });
  }
  return out;
}

// The counts of the vault. Files that start with "_" are indexes and templates, not entries.
export function countVault(vault, now = new Date()) {
  const entries = (dir) => list(join(vault, dir)).filter((n) => n.endsWith('.md') && !n.startsWith('_') && isFile(join(vault, dir, n))).length;
  const workstreams = (dir) => list(join(vault, dir)).filter((n) => !n.startsWith('.') && (isDir(join(vault, dir, n)) || n.endsWith('.md'))).length;
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // The projects: each folder of projects/ is a group (an organisation, an area) whose entries are the projects; a
  // Markdown file directly in projects/ counts as one project.
  const projectCount = () => list(join(vault, 'projects')).filter((n) => !n.startsWith('.') && !n.startsWith('_'))
    .reduce((sum, n) => sum + (isDir(join(vault, 'projects', n)) ? workstreams(join('projects', n)) : n.endsWith('.md') ? 1 : 0), 0);
  const asanaText = readText(join(vault, 'asana', 'tasks.md'));
  const asanaHead = asanaText.match(/^(\d+) open tasks listed(?::\s*([^;:\n]+?) (\d+);)?/m);
  const asana = asanaHead ? { open: Number(asanaHead[1]), who: asanaHead[2] || null, mine: asanaHead[3] ? Number(asanaHead[3]) : null, updated: frontmatter(asanaText).data.updated || null } : null;
  const logText = readText(join(vault, 'scripts', 'sync-log.md'));
  const logHead = logText.match(/^## (.+)$/m);
  let sync = null;
  if (logHead) {
    const entry = logText.slice(logHead.index + logHead[0].length).split(/\n## /)[0];
    const failures = entry.match(/failures:\s*([^|\n]+)/);
    sync = { title: logHead[1].trim(), failures: failures ? failures[1].trim().replace(/\.$/, '') : null };
  }
  const lessonsText = readText(join(vault, 'scripts', 'lessons.md'));
  const max = lessonsText.match(/At most (\d+) entries/);
  const skills = readSkills(join(vault, 'skills', 'agent'), now);
  return {
    people: entries('people'),
    funders: entries('funders'),
    projects: projectCount(),
    meetingsThisMonth: list(join(vault, 'meetings')).filter((n) => n.startsWith(month)).length,
    month,
    asana,
    sync,
    lessons: { count: (lessonsText.match(/^\d+\. /gm) || []).length, max: max ? Number(max[1]) : 40 },
    skills: { count: skills.length, stale: skills.filter((s) => s.stale).length, staleDays: STALE_DAYS },
    handSkills: readSkills(join(vault, 'skills'), now).length,
  };
}

// vault: the vault of notes (MEMO_VAULT). local: the local/ directory of Memo (the live charters). memoRoot: this repository,
// whose branch codeBranch is backed up to codeRemoteBranch of codeRemote. build: the command that makes the map.
export function createSystem({
  vault, local, memoRoot,
  codeRemote = 'origin', codeBranch = 'main', codeRemoteBranch = codeBranch, commitName = 'the owner',
  build = DEFAULT_BUILD,
  now = () => new Date(), log = (...a) => console.error('[system]', ...a),
} = {}) {
  const chartersDir = join(local, 'charters');
  const mirrorDir = join(vault, 'scripts', 'charters');
  const agentSkills = join(vault, 'skills', 'agent');
  const handSkills = join(vault, 'skills');
  // The old texts of the live charters: local/charters/.history/<name>-<time>.md, the time as 2026-11-04T12-00-00-000Z.
  const historyDir = join(chartersDir, '.history');
  const HISTORY_TIME = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.md$/;
  // The kept texts of one charter, the newest first: [{ name, file, at }]. The name of a charter has no dot, and the
  // time has a fixed form, so the files of the charter main are never those of a charter main-two.
  function historyOf(name) {
    return list(historyDir).map((n) => {
      const m = n.match(HISTORY_TIME);
      if (!m || n.slice(0, m.index) !== name) return null;
      return { name: n, file: join(historyDir, n), at: `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` };
    }).filter(Boolean).reverse();
  }
  function keepCharter(file, text) {
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(join(historyDir, `${basename(file, '.md')}-${now().toISOString().replace(/[:.]/g, '-')}.md`), text);
  }
  let version = 1;
  const bump = () => { version += 1; };
  const state = {
    vault: { ahead: null, behind: null, uncommitted: null, changed: [], mapUncommitted: false, fetchedAt: null, checkedAt: null, error: null },
    code: { ahead: null, behind: null, uncommitted: null, changed: [], remoteHead: null, checkedAt: null, error: null, unknownRemote: false },
    build: { error: null, at: null, running: false },
  };
  let dashboard = null;
  let dashboardAt = 0;

  // ---------- the files ----------
  const fileInfo = (file) => ({ size: isFile(file) ? statSync(file).size : 0, mtime: mtime(file), exists: isFile(file) });
  const vaultPath = (file) => relative(vault, file);
  // The long agents from local/agents.json: their names and the shared charter each one names ("charter": "team"
  // for charters/team.md, memo 892), or null. Without a readable agents.json, main and second, as before.
  const AGENT_NAME = /^[a-z][a-z0-9-]*$/;
  function agentList() {
    const fallback = [{ name: 'main', charter: null }, { name: 'second', charter: null }];
    try {
      const list = JSON.parse(readFileSync(join(local, 'agents.json'), 'utf8'));
      if (!Array.isArray(list)) return fallback;
      const long = list.filter((a) => a && a.kind === 'long' && typeof a.name === 'string' && AGENT_NAME.test(a.name));
      if (!long.length) return fallback;
      return long.map((a) => ({ name: a.name, charter: typeof a.charter === 'string' && AGENT_NAME.test(a.charter) && a.charter !== a.name ? a.charter : null }));
    } catch { return fallback; }
  }
  function docs() {
    const out = [];
    // The charters. A shared charter (one file for all the agents that name it in agents.json) is on the page when
    // the file exists, or when an agent names it and the file is missing. An agent on a shared charter that exists
    // reads only that file, so its own charter is not on the page; while the shared file is missing, the agent
    // reads its own charter again (src/agents.js), and that one is on the page.
    const agents = agentList();
    const sharedExists = (a) => a.charter && isFile(join(chartersDir, `${a.charter}.md`));
    for (const name of [...new Set(['team', ...agents.map((a) => a.charter).filter(Boolean)])]) {
      const file = join(chartersDir, `${name}.md`);
      if (!isFile(file) && !agents.some((a) => a.charter === name)) continue;
      out.push({ id: `charter:${name}`, group: 'charters', title: name === 'team' ? 'Team charter, all agents' : `Shared charter ${name}`, path: join('local', 'charters', `${name}.md`), where: 'local', editable: true, file, mirror: join(mirrorDir, `${name}.md`), note: `The agents with "charter": "${name}" in agents.json use the new charter from their next start.`, ...fileInfo(file) });
    }
    for (const a of agents) {
      if (sharedExists(a)) continue;
      const file = join(chartersDir, `${a.name}.md`);
      out.push({ id: `charter:${a.name}`, group: 'charters', title: `Charter of the agent ${displayName(a.name)}`, path: join('local', 'charters', `${a.name}.md`), where: 'local', editable: true, file, mirror: join(mirrorDir, `${a.name}.md`), note: 'Agents use the new charter from their next start.', ...fileInfo(file) });
    }
    const cloud = join(vault, 'scripts', 'cloud-agent.md');
    // Optional: a vault with no such file has no cloud agent, and the page shows no entry for it.
    if (existsSync(cloud)) out.push({ id: 'charter:cloud', group: 'charters', title: 'Charter of the hourly cloud agent', path: vaultPath(cloud), where: 'vault', editable: true, file: cloud, ...fileInfo(cloud) });
    const lessons = join(vault, 'scripts', 'lessons.md');
    out.push({ id: 'lessons', group: 'lessons', title: 'Shared lessons', path: vaultPath(lessons), where: 'vault', editable: true, file: lessons, ...fileInfo(lessons) });
    for (const s of readSkills(agentSkills, now())) {
      out.push({ id: `skill:${s.name}`, group: 'skills', title: s.name, path: vaultPath(s.file), where: 'vault', editable: true, file: s.file, description: s.description, last_used: s.last_used, stale: s.stale, size: s.size, mtime: s.mtime, exists: true });
    }
    for (const s of readSkills(handSkills, now())) {
      out.push({ id: `hand:${s.name}`, group: 'hand', title: s.name, path: vaultPath(s.file), where: 'vault', editable: false, file: s.file, description: s.description, size: s.size, mtime: s.mtime, exists: true, note: 'Pinned copy of your Claude skill. Change it in your Claude account, then ask an agent to copy it.' });
    }
    return out;
  }
  const inside = (file, dir) => {
    try { return realpathSync(file).startsWith(realpathSync(dir) + sep); } catch { return false; }
  };
  // The file for an id. The id must be in the list; a skill must sit inside its folder (no link that points out).
  // create: an agent skill that is not there yet counts too, as a new file (the save and the draft; memo 1418).
  function lookup(id, { create = false } = {}) {
    if (typeof id !== 'string' || id.length > 80) throw new MemoError(400, 'The file id is missing.');
    const m = id.match(/^(skill|hand):(.*)$/);
    if (m && !NAME.test(m[2])) throw new MemoError(404, 'No such file on the System page.');
    const all = docs();
    const doc = all.find((d) => d.id === id);
    // An agent skill that is not there yet: a new one, from a suggestion. The save makes its folder.
    if (!doc && create && m && m[1] === 'skill') return newSkill(m[2], all);
    if (!doc) throw new MemoError(404, 'No such file on the System page.');
    if (m && !inside(doc.file, m[1] === 'skill' ? agentSkills : handSkills)) throw new MemoError(404, 'No such file on the System page.');
    return doc;
  }
  // The place of a new agent skill: skills/agent/<name>/SKILL.md. The name is plain (NAME, checked by lookup), the
  // folder of the agent skills is a real folder, nothing that is not a plain folder has the name, and no hand-made
  // skill has it: those are pinned, and two skills of one name would be one skill to an agent.
  function newSkill(name, all) {
    if (name === 'agent' || name === 'synced') throw new MemoError(400, `A skill cannot have the name ${name}.`);
    if (all.some((d) => d.id === `hand:${name}`)) throw new MemoError(409, `A hand-made skill has the name ${name}. Hand-made skills are pinned: pick a different name.`);
    if (!isDir(agentSkills)) throw new MemoError(404, 'The folder of the agent skills is not there.');
    const folder = join(agentSkills, name);
    let info = null;
    try { info = lstatSync(folder); } catch { /* not there: the usual case */ }
    if (info && (!info.isDirectory() || !inside(folder, agentSkills))) throw new MemoError(404, 'No such file on the System page.');
    const file = join(folder, 'SKILL.md');
    return { id: `skill:${name}`, group: 'skills', title: name, path: vaultPath(file), where: 'vault', editable: true, file, isNew: true, exists: false, size: 0, mtime: null };
  }
  // A new skill must be a skill: frontmatter with its own name and a description that says the trigger.
  function checkNewSkill(doc, text) {
    const name = doc.id.slice('skill:'.length);
    const { data } = frontmatter(text);
    const plain = (v) => String(v ?? '').trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim();
    if (plain(data.name) !== name) throw new MemoError(400, `Nothing was saved. The text must start with frontmatter (a line ---, the keys, a line ---) whose name is ${name}.`);
    if (!/^Use when\b/i.test(plain(data.description))) throw new MemoError(400, 'Nothing was saved. The description of a skill must start with "Use when": it is the only part an agent reads before it picks the skill.');
  }
  // The draft of a new agent skill for the editor: the template with the name and the description, and the hash
  // of "no file yet", which the save checks as for any file. A skill of that name that exists gives exists: true
  // and no text: the page opens that skill instead.
  function draft({ name, description, category, memo } = {}) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new MemoError(400, 'The name of a skill is small letters, digits and hyphens, for example daily-review.');
    const doc = lookup(`skill:${name}`, { create: true });
    if (!doc.isNew) return { ...strip(doc), exists: true };
    const day = now();
    const today = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const code = typeof category === 'string' && /^[A-Z][A-Z0-9]{1,7}$/.test(category) ? category : '';
    const source = /^\d{1,7}$/.test(String(memo ?? '')) ? `memo ${memo}` : 'the System page';
    const text = skillTemplate({ name, description: typeof description === 'string' ? description.slice(0, 300) : '', category: code, source, today, readme: readText(join(handSkills, 'README.md')) });
    return { ...strip(doc), text, hash: sha('') };
  }
  const strip = ({ file, mirror, ...rest }) => rest;
  const files = () => docs().map(strip);
  function read(id) {
    const doc = lookup(id);
    if (!doc.exists) throw new MemoError(404, `The file ${doc.path} is not there.`);
    const text = readFileSync(doc.file, 'utf8');
    return { ...strip(doc), text, hash: sha(text) };
  }

  // ---------- saving ----------
  let chain = Promise.resolve(); // one git operation at a time
  const serial = (fn) => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };
  const writeAtomic = (file, text) => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  };
  const stale = () => new MemoError(409, 'The file changed since you opened it, maybe another agent edited it. Nothing was saved. Load the new version, check your text against it, then save again.');
  async function pull() {
    try { await git(vault, ['pull', '--rebase', '--autostash', '--quiet']); } catch (error) {
      // A rebase that stopped on a conflict must not stay half done.
      if (existsSync(join(vault, '.git', 'rebase-merge')) || existsSync(join(vault, '.git', 'rebase-apply'))) {
        try { await git(vault, ['rebase', '--abort']); } catch (e) { log('rebase --abort', e.message); }
      }
      throw new Error(`git pull failed in the vault: ${error.message}`);
    }
  }
  // Writes one vault file, commits it alone, and pushes. The result says whether the push worked.
  // more: files that are written already and go into the same commit (the old version of a skill, src/skilllog.js).
  async function commitVault(file, text, message, more = []) {
    writeAtomic(file, text);
    return commitPaths([file, ...more], message);
  }
  // Commits the given vault files, and only those, and pushes.
  async function commitPaths(files, message) {
    const rel = files.map(vaultPath);
    await git(vault, ['add', '--', ...rel]);
    const changed = (await git(vault, ['status', '--porcelain', '--', ...rel])).trim() !== '';
    if (changed) await git(vault, ['commit', '--quiet', '-m', message, '--', ...rel]);
    try { await git(vault, ['push', '--quiet']); return { committed: changed, pushed: true, error: null }; } catch (error) {
      return { committed: changed, pushed: false, error: `Saved and committed on the Mac, but the push to GitHub failed: ${error.message}` };
    }
  }
  async function save(id, text, base) {
    if (typeof text !== 'string') throw new MemoError(400, 'The text is missing.');
    if (text.length > MAX_TEXT) throw new MemoError(400, 'The text is too long.');
    if (typeof base !== 'string' || !base) throw new MemoError(400, 'The hash of the version you started from is missing.');
    const doc = lookup(id, { create: true });
    if (!doc.editable) throw new MemoError(403, `${doc.title} is view-only. ${doc.note || ''}`.trim());
    if (doc.isNew) checkNewSkill(doc, text);
    const message = `${doc.isNew ? 'Add' : 'Edit'} ${doc.path} from the System page (${commitName})`;
    return serial(async () => {
      const current = isFile(doc.file) ? readFileSync(doc.file, 'utf8') : '';
      if (sha(current) !== base) throw stale();
      let result;
      if (doc.where === 'local') {
        // The live charter first (the agents read it), with a copy of the old text next to it.
        if (doc.exists) keepCharter(doc.file, current);
        writeAtomic(doc.file, text);
        seen.set(doc.file, text); // this change has its old text kept: the watch of the charters keeps no second copy
        result = { ok: true, hash: sha(text), note: doc.note, committed: false, pushed: false, error: null };
        try {
          await pull();
          Object.assign(result, await commitVault(doc.mirror, text, message));
        } catch (error) {
          result.error = `The charter is saved on the Mac, but its backup copy in the vault was not committed. ${error.message}`;
        }
      } else {
        try { await pull(); } catch (error) { throw new MemoError(502, `Nothing was saved. ${error.message}`); }
        // The pull can bring a newer version of this file. Then her text must not go over it.
        if (sha(isFile(doc.file) ? readFileSync(doc.file, 'utf8') : '') !== base) throw stale();
        // A skill keeps its old text (memo 1420): before the new text goes over it, the old one is copied to
        // skills/.versions/<name>/ and goes into the same commit. Text files cost nothing, so they stay.
        const kept = [];
        if (doc.group === 'skills' && current && current !== text) {
          const old = snapshot({ vault, name: doc.title, text: current, at: now() });
          if (old.written) kept.push(old.file);
        }
        result = { ok: true, hash: sha(text), note: doc.note || null, ...(await commitVault(doc.file, text, message, kept)), kept: kept.map(vaultPath) };
      }
      bump();
      trigger();
      checkSync().catch(() => {});
      return result;
    });
  }

  // ---------- the text before the latest change (memo 1513) ----------
  // An agent changes a live charter in its file, with no save of this page, and local/ is in no repository: the old
  // text would be gone. So the server remembers the text of each live charter from its start, and when the file
  // changes it keeps the text that was there in local/charters/.history, as a save of the page does. A change while
  // the server is off is not seen. Nothing here writes a charter.
  const seen = new Map(); // the file of a live charter -> its text when the server last looked
  function noteCharters() {
    for (const doc of docs()) {
      if (doc.where !== 'local' || !isFile(doc.file)) continue;
      let text;
      try { text = readFileSync(doc.file, 'utf8'); } catch { continue; }
      const before = seen.get(doc.file);
      seen.set(doc.file, text);
      if (!before || before === text) continue;
      try {
        const newest = historyOf(basename(doc.file, '.md'))[0];
        if (!newest || readText(newest.file) !== before) keepCharter(doc.file, before);
      } catch (error) { log('charter history', error.message); }
    }
  }
  // The newest text of a vault file in its git history that is not `text`: { text, at, source, label, change }.
  // at: the time of the commit that replaced it, or null when the change is not committed yet. change: the message
  // of that commit. null with no repository, no history, or no other text in the last 20 commits of the file.
  async function gitPrevious(file, text) {
    const rel = vaultPath(file);
    let lines;
    try { lines = (await git(vault, ['log', '-n', '20', '--format=%H%x09%cI%x09%s', '--', rel], { timeout: 15_000 })).split('\n').filter(Boolean); } catch { return null; }
    let newer = null; // the commit after the one in hand: it made the text that the file has now
    for (const line of lines) {
      const [hash, at, ...subject] = line.split('\t');
      let old = null;
      try { old = await git(vault, ['show', `${hash}:${rel}`], { timeout: 15_000 }); } catch { /* the file is not in this commit */ }
      if (old !== null && old !== text) return { text: old, at: newer ? newer.at : null, source: 'git', label: `commit ${hash.slice(0, 8)}`, change: newer ? newer.subject : null };
      newer = { at, subject: subject.join('\t') };
    }
    return null;
  }
  // The text a file had before its latest change, for the dialog of the Inbox to show what changed: a live charter
  // from local/charters/.history (else from the git history of its backup in the vault); a vault file from its git
  // history, and a skill also from skills/.versions (src/skilllog.js), whichever change is the newer. previous is
  // null when no earlier text is kept anywhere.
  async function previous(id) {
    const doc = lookup(id);
    if (!doc.exists) throw new MemoError(404, `The file ${doc.path} is not there.`);
    const text = readFileSync(doc.file, 'utf8');
    let found = null;
    if (doc.where === 'local') {
      for (const h of historyOf(basename(doc.file, '.md'))) {
        const old = readText(h.file);
        if (old && old !== text) { found = { text: old, at: h.at, source: 'history', label: join('local', 'charters', '.history', h.name), change: null }; break; }
      }
      if (!found) found = await gitPrevious(doc.mirror, text);
    } else {
      found = await gitPrevious(doc.file, text);
      if (doc.group === 'skills' || doc.group === 'hand') {
        for (const v of listVersions(vault, doc.title)) {
          const old = readVersion(vault, doc.title, v.file);
          if (!old || old === text) continue;
          const at = new Date(`${v.day}T${v.at.slice(11)}:00`).toISOString(); // the time in the name is that of the computer
          // A change that is not committed (at: null) is newer than any kept version.
          if (!found || (found.at !== null && found.at < at)) found = { text: old, at, source: 'versions', label: v.rel, change: null };
          break;
        }
      }
    }
    return { id: doc.id, title: doc.title, path: doc.path, hash: sha(text), previous: found };
  }

  // ---------- the ratings and the old versions of a skill (memo 1420) ----------
  // The file of a skill by its name: an agent skill, or the pinned copy of a hand-made one.
  function skillDoc(name) {
    if (typeof name !== 'string' || !NAME.test(name)) throw new MemoError(400, 'The name of the skill is missing.');
    const all = docs();
    const doc = all.find((d) => d.id === `skill:${name}`) || all.find((d) => d.id === `hand:${name}`);
    if (!doc || !inside(doc.file, doc.group === 'skills' ? agentSkills : handSkills)) throw new MemoError(404, `No skill ${name} with a file in the vault. A hand-made skill needs its pinned copy first.`);
    return doc;
  }
  const changedOf = (file) => { try { return statSync(file).mtime; } catch { return now(); } };
  // Her rating of the text a skill has now: a line at the end of skills/ratings.jsonl, committed alone and pushed.
  // A pull that fails does not stop it: her words are written and committed on the Mac, and the result says so.
  function rate({ name, score, notes, memo } = {}) {
    const doc = skillDoc(name);
    return serial(async () => {
      let pulled = null;
      try { await pull(); } catch (error) { pulled = error.message; }
      const text = readFileSync(doc.file, 'utf8');
      let rating;
      try {
        rating = makeRating({ skill: name, kind: doc.group === 'hand' ? 'hand' : 'agent', text, changed: changedOf(doc.file), score, notes, memo, at: now() });
      } catch (error) { throw new MemoError(400, `Nothing was saved. ${error.message}`); }
      appendRating(vault, rating);
      let done;
      try { done = await commitPaths([ratingsFile(vault)], `Rating of the skill ${name}: ${rating.score} of 5 (${commitName})`); } catch (error) {
        done = { committed: false, pushed: false, error: `The rating is in skills/ratings.jsonl on the Mac, but it was not committed: ${error.message}` };
      }
      if (pulled && !done.error) done.error = `The rating is saved on the Mac. ${pulled}`;
      bump();
      checkSync().catch(() => {});
      return { ok: true, rating, ...done };
    });
  }
  // The log of one skill: the text it has now (its version, and whether she rated it), its old versions, the newest
  // first, each with its ratings, and every rating. No text of a skill.
  function skillLog(name) {
    const doc = skillDoc(name);
    const text = readFileSync(doc.file, 'utf8');
    const ratings = ratingsOf(readRatings(vault), name, sha(text));
    const of = (h) => ratings.filter((r) => r.hash.slice(0, 8) === h);
    const current = { version: versionId(text, changedOf(doc.file)), hash8: hash8(text), changed: mtime(doc.file), ratings: of(hash8(text)) };
    return {
      name, id: doc.id, kind: doc.group === 'hand' ? 'hand' : 'agent', editable: doc.editable, path: doc.path,
      current: { ...current, rated: current.ratings.length > 0 },
      versions: listVersions(vault, name).filter((v) => v.hash8 !== current.hash8).map((v) => ({ ...v, ratings: of(v.hash8) })),
      ratings,
    };
  }
  // The text of one old version of a skill, by its file name of the log.
  function skillVersion(name, file) {
    skillDoc(name);
    const text = readVersion(vault, name, file);
    if (text === null) throw new MemoError(404, 'No such old version of this skill.');
    return { name, file, text };
  }

  // ---------- sync ----------
  async function checkVault() {
    const s = { ...state.vault, checkedAt: now().toISOString(), error: null };
    // In the line of the saves: a fetch at the same time as the pull of a save writes FETCH_HEAD twice, and that pull
    // then fails ("Cannot rebase onto multiple branches"). A save and a rating come one after the other (memo 1420).
    try { await serial(() => git(vault, ['fetch', '--quiet'])); } catch (error) { s.error = `fetch: ${error.message}`; }
    try {
      Object.assign(s, parseCounts(await git(vault, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])));
      const paths = statusPaths(await git(vault, ['status', '--porcelain']));
      s.mapUncommitted = paths.includes(MAP_FILE);
      const rest = paths.filter((p) => p !== MAP_FILE);
      s.uncommitted = rest.length;
      s.changed = rest.slice(0, 8);
    } catch (error) { s.error = s.error ? `${s.error}; ${error.message}` : error.message; }
    s.fetchedAt = mtime(join(vault, '.git', 'FETCH_HEAD'));
    state.vault = s;
  }
  async function checkCode() {
    const s = { ...state.code, checkedAt: now().toISOString(), error: null, unknownRemote: false };
    try {
      const head = (await git(memoRoot, ['rev-parse', '--verify', codeBranch])).trim();
      const remote = (await git(memoRoot, ['ls-remote', codeRemote, `refs/heads/${codeRemoteBranch}`])).split(/\s/)[0] || null;
      s.remoteHead = remote;
      if (!remote) { s.ahead = Number(await git(memoRoot, ['rev-list', '--count', codeBranch])); s.behind = 0; } else if (remote === head) { s.ahead = 0; s.behind = 0; } else {
        try {
          s.ahead = Number((await git(memoRoot, ['rev-list', '--count', `${remote}..${codeBranch}`])).trim());
          s.behind = Number((await git(memoRoot, ['rev-list', '--count', `${codeBranch}..${remote}`])).trim());
        } catch {
          // GitHub has a commit that this computer never saw.
          s.unknownRemote = true;
          s.ahead = null;
          s.behind = 1;
        }
      }
      const paths = statusPaths(await git(memoRoot, ['status', '--porcelain']));
      s.uncommitted = paths.length;
      s.changed = paths.slice(0, 8);
    } catch (error) { s.error = error.message; }
    state.code = s;
  }
  let checking = null;
  function checkSync() {
    if (!checking) checking = Promise.all([checkVault(), checkCode()]).then(() => { refreshDashboard(); bump(); }).finally(() => { checking = null; });
    return checking;
  }

  // ---------- dashboard and map ----------
  function refreshDashboard() {
    try { dashboard = countVault(vault, now()); } catch (error) { dashboard = { error: error.message }; }
    dashboardAt = Date.now();
  }
  const getDashboard = () => { if (!dashboard || Date.now() - dashboardAt > 60_000) refreshDashboard(); return dashboard; };
  const mapFile = join(vault, MAP_FILE);
  function mapInfo() {
    const text = readText(mapFile);
    const built = text.match(/Built ([^<]+?) from the files/);
    return { exists: text !== '', size: text.length, builtAt: mtime(mapFile), builtText: built ? built[1].trim() : null, build: { ...state.build }, url: mapUrl(), file: MAP_FILE, available: canBuild() };
  }
  function mapUrl() {
    const m = readText(join(vault, 'scripts', 'sync-state.md')).match(/system_map_url:\s*(https:\/\/\S+)/);
    return m ? m[1].replace(/[),.]+$/, '') : null;
  }
  let building = null;
  let buildAgain = false;
  const canBuild = () => build !== DEFAULT_BUILD || existsSync(join(vault, DEFAULT_BUILD.args[0]));
  function rebuild() {
    if (!canBuild()) return Promise.resolve();
    if (building) { buildAgain = true; return building; }
    state.build.running = true;
    building = run(build.cmd, build.args, { cwd: vault, timeout: BUILD_TIMEOUT })
      .then(() => { state.build.error = null; }, (error) => { state.build.error = error.message; log('map build', error.message); })
      .finally(() => {
        state.build.at = now().toISOString();
        state.build.running = false;
        building = null;
        refreshDashboard();
        bump();
        if (buildAgain) { buildAgain = false; rebuild(); }
      });
    return building;
  }

  // ---------- the watch ----------
  const SOURCES = /^(lessons\.md|cloud-agent\.md|nightly-sync\.md|daily-review\.md|system-map[\\/]config\.md)$/;
  const watchers = [];
  let timer = null;
  let interval = null;
  function trigger() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; rebuild(); }, DEBOUNCE_MS);
    timer.unref?.();
  }
  let charterTimer = null;
  function onChange(dir, name) {
    // A live charter changed, maybe by the hand of an agent: its old text is kept (noteCharters), a moment later, so
    // a file that is half written is not read.
    if (dir === chartersDir && !/\.tmp$|^\.history/.test(name || '')) {
      if (charterTimer) clearTimeout(charterTimer);
      charterTimer = setTimeout(() => { charterTimer = null; noteCharters(); }, 1500);
      charterTimer.unref?.();
    }
    if (dir === join(vault, 'scripts') && !SOURCES.test(name || '')) return;
    if (name && /\.tmp$|^\.history/.test(name)) return;
    // The log of the skills (old versions, ratings) changes no rule of an agent: new data for the page, no new map.
    if (dir === handSkills && /^(\.versions([\\/]|$)|ratings\.jsonl$)/.test(name || '')) { bump(); return; }
    bump();
    trigger();
  }
  function start() {
    noteCharters(); // the texts of the live charters as they are now
    for (const [dir, recursive] of [[chartersDir, false], [join(vault, 'scripts'), true], [handSkills, true]]) {
      try {
        const w = watch(dir, { recursive, persistent: false }, (event, name) => onChange(dir, name));
        w.on('error', (error) => log('watch', dir, error.message));
        watchers.push(w);
      } catch (error) { log('cannot watch', dir, error.message); }
    }
    setTimeout(() => checkSync().catch((e) => log('check', e.message)), 3000).unref?.();
    interval = setInterval(() => checkSync().catch((e) => log('check', e.message)), CHECK_MS);
    interval.unref?.();
  }
  function stop() {
    for (const w of watchers) w.close();
    watchers.length = 0;
    if (timer) clearTimeout(timer);
    if (charterTimer) clearTimeout(charterTimer);
    if (interval) clearInterval(interval);
  }

  const summary = () => ({
    version,
    vault: { path: vault, ...state.vault, line: syncLine(state.vault) },
    code: { path: memoRoot, branch: codeBranch, remoteBranch: codeRemoteBranch, ...state.code, line: syncLine(state.code) },
    dashboard: getDashboard(),
    map: mapInfo(),
    files: files(),
  });
  const mapHtml = () => ({ html: readText(mapFile), ...mapInfo() });
  return { files, read, save, draft, lookup, previous, noteCharters, rate, skillLog, skillVersion, summary, mapHtml, rebuild, checkSync, start, stop, version: () => ({ version, buildAt: state.build.at, checkedAt: state.vault.checkedAt }) };
}
