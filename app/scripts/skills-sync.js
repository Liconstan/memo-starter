// The nightly newest-version sync of the hand-made skills (memos 1420, 1426). For every hand-made skill of the
// owner, it compares the copies in four places, takes the newest, and copies it to the vault and to the personal
// skills of both Claude accounts, so the vault is the source for every agent:
//   - synced: the newest finished round of ~/.claude/skills/synced (claude.ai writes it; read only, never written);
//   - local:  ~/.claude/skills/<name>, the personal skills of the first account;
//   - second: <second>/skills/<name>, the personal skills of the second account (MEMO_SECOND_CONFIG_DIR, in the
//     environment or in app/.env; the default is ~/.claude-second);
//   - vault:  skills/<name> of the vault, where an edit through an agent lands and what the cloud agent reads.
// Claude Code lists a synced skill with a prefix (anthropic-skills:<name>) and a personal one by its bare name, so
// the first account has both: the agent uses the personal one, which this sync keeps at the newest text.
//
//   node scripts/skills-sync.js [--dry-run] [--quiet]
//
// The newest: a copy that changed since the last run wins over one that did not (skills/.versions/.sync-state.json
// has the hash of each copy at the end of a run), because a download of claude.ai gives old text a new file time.
// Among the copies that changed, or on a first run, the latest change wins: for the synced copy the time claude.ai
// gives in manifest.json, else the newest file time of the folder. On the same time the order is vault, second,
// local, synced. A copy that would be replaced is kept first in skills/.versions/<name>/ (src/skilllog.js).
// "claude.ai copy behind" counts the skills whose synced copy is older than the newest text. No agent needs it:
// it tells the owner which skills her own claude.ai chats still have in an old text.
// The script commits nothing: the nightly sync commits the vault. The last line of the output is the count.
import { cpSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { syncedSkills } from '../src/registry.js';
import { snapshot, stamp, hash8, versionsDir, NAME } from '../src/skilllog.js';
// A setting of app/.env, for a run from launchd or a playbook that has no environment of its own.
const fileSetting = (name) => { try { return readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim() || ''; } catch { return ''; } };
const tilde = (p) => (p ? p.replace(/^~(?=\/|$)/, homedir()) : p);

const ORDER = ['vault', 'second', 'local', 'synced'];
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const list = (dir) => { try { return readdirSync(dir).sort(); } catch { return []; } };
// The files of a skill folder, as paths inside it. No dot file (.DS_Store) and no link.
function filesOf(dir, sub = '') {
  const out = [];
  for (const name of list(join(dir, sub))) {
    if (name.startsWith('.')) continue;
    const rel = sub ? join(sub, name) : name;
    if (isDir(join(dir, rel))) out.push(...filesOf(dir, rel)); else if (isFile(join(dir, rel))) out.push(rel);
  }
  return out;
}
// One copy of a skill: its folder, the hash of all its files, and the time of its last change.
function copyOf(dir, time = null) {
  if (!isFile(join(dir, 'SKILL.md'))) return null;
  const files = filesOf(dir);
  const h = createHash('sha256');
  let newest = 0;
  for (const rel of files) {
    h.update(rel.split(sep).join('/')).update('\0').update(readFileSync(join(dir, rel))).update('\0');
    newest = Math.max(newest, statSync(join(dir, rel)).mtimeMs);
  }
  return { dir, files, digest: h.digest('hex'), time: time ?? newest };
}
// The folders of a directory that hold a skill: name -> folder.
function skillDirs(dir, skip = []) {
  const out = new Map();
  for (const name of list(dir)) if (NAME.test(name) && !skip.includes(name) && isFile(join(dir, name, 'SKILL.md'))) out.set(name, join(dir, name));
  return out;
}

// vault: the vault of notes. home: the home folder. first, second: the folders of the two Claude accounts.
// The result: { skills: [{ name, from, copies, wrote: ['vault', 'local', 'second'], kept: [...], behind: bool }], line }.
// behind: the claude.ai copy (synced) has an older text than the newest.
export function syncSkills({ vault, home = homedir(), first = join(home, '.claude'), second = join(home, '.claude-second'), dryRun = false, now = new Date() } = {}) {
  const statePath = join(vault, 'skills', '.versions', '.sync-state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, 'utf8')) || {}; } catch { /* a first run */ }
  const agent = [...skillDirs(join(vault, 'skills', 'agent')).keys()];
  const places = {
    vault: skillDirs(join(vault, 'skills'), ['agent']),
    second: skillDirs(join(second, 'skills'), ['synced']),
    local: skillDirs(join(first, 'skills'), ['synced']),
    synced: new Map([...syncedSkills(first)].map(([name, s]) => [name, { dir: dirname(s.file), time: s.updatedAt ? Date.parse(s.updatedAt) : null }])),
  };
  // A name that an agent skill has is that agent skill: it is not synced as a hand-made one.
  const names = [...new Set(ORDER.flatMap((p) => [...places[p].keys()]))].filter((n) => !agent.includes(n)).sort();
  const targets = { vault: (name) => join(vault, 'skills', name), local: (name) => join(first, 'skills', name), second: (name) => join(second, 'skills', name) };
  const next = {};
  const skills = [];
  for (const name of names) {
    const copies = {};
    for (const p of ORDER) {
      const at = places[p].get(name);
      const copy = at ? (typeof at === 'string' ? copyOf(at) : copyOf(at.dir, at.time)) : null;
      if (copy) copies[p] = copy;
    }
    const have = ORDER.filter((p) => copies[p]);
    if (!have.length) continue;
    const seen = state[name] || {};
    const changed = have.filter((p) => copies[p].digest !== seen[p]);
    const pool = changed.length ? changed : have;
    // The latest change wins; on the same time, the first of the order (the vault).
    const from = pool.reduce((best, p) => (copies[p].time > copies[best].time ? p : best), pool[0]);
    const winner = copies[from];
    const row = { name, from, copies: have, wrote: [], kept: [], behind: false };
    for (const t of ['vault', 'local', 'second']) {
      const dir = targets[t](name);
      if (dir.split(sep).includes('synced')) throw new Error(`A synced folder is never written: ${dir}`);
      const old = copies[t];
      if (old && old.digest === winner.digest) continue;
      if (old) {
        // Keep what goes away: the old SKILL.md as a version, and the other files that change next to it.
        const text = readFileSync(join(old.dir, 'SKILL.md'), 'utf8');
        const others = old.files.filter((rel) => rel !== 'SKILL.md' && !(winner.files.includes(rel) && readFileSync(join(winner.dir, rel)).equals(readFileSync(join(old.dir, rel)))));
        if (!dryRun) {
          const kept = snapshot({ vault, name, text, at: now });
          if (kept.written) row.kept.push(kept.rel);
          const side = join(versionsDir(vault, name), `${stamp(now)}-${hash8(text)}.files`);
          for (const rel of others) { mkdirSync(dirname(join(side, rel)), { recursive: true }); cpSync(join(old.dir, rel), join(side, rel), { preserveTimestamps: true }); }
          for (const rel of old.files) if (!winner.files.includes(rel)) unlinkSync(join(old.dir, rel));
        } else row.kept.push(`skills/.versions/${name}/ (the ${t} copy)`);
      }
      if (!dryRun) for (const rel of winner.files) { mkdirSync(dirname(join(dir, rel)), { recursive: true }); cpSync(join(winner.dir, rel), join(dir, rel), { preserveTimestamps: true }); }
      row.wrote.push(t);
    }
    // The copy of claude.ai is hers to change, in her Claude account. The agents do not depend on it.
    row.behind = Boolean(copies.synced) && copies.synced.digest !== winner.digest;
    next[name] = { vault: winner.digest, second: winner.digest, local: winner.digest, ...(copies.synced ? { synced: copies.synced.digest } : {}) };
    skills.push(row);
  }
  if (!dryRun && (skills.some((s) => s.wrote.length) || JSON.stringify(next) !== JSON.stringify(state))) {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(next, null, 1)}\n`);
  }
  const count = (t) => skills.filter((s) => s.wrote.includes(t)).length;
  const behind = skills.filter((s) => s.behind).map((s) => s.name);
  const line = `skills-sync${dryRun ? ' (dry run)' : ''}: ${skills.length} hand-made | vault updated ${count('vault')} | first account updated ${count('local')} | second account updated ${count('second')} | old versions kept ${skills.reduce((n, s) => n + s.kept.length, 0)}`
    + ` | claude.ai copy behind ${behind.length}${behind.length ? ` (${behind.join(', ')})` : ''}`;
  return { skills, line };
}

// Run as a command (not when a test imports the file).
if (process.argv[1] && import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--dry-run', '--quiet'].includes(a));
  if (unknown.length) { console.error('Usage: node scripts/skills-sync.js [--dry-run] [--quiet]'); process.exit(1); }
  const vault = tilde(process.env.MEMO_VAULT || fileSetting('MEMO_VAULT')) || join(homedir(), 'memo-vault');
  const home = homedir();
  const second = tilde(process.env.MEMO_SECOND_CONFIG_DIR || fileSetting('MEMO_SECOND_CONFIG_DIR')) || undefined;
  const result = syncSkills({ vault, home, second, dryRun: args.includes('--dry-run') });
  if (!args.includes('--quiet')) {
    for (const s of result.skills) {
      const to = s.wrote.map((t) => (t === 'local' ? 'first' : t));
      const did = to.length ? `${args.includes('--dry-run') ? 'would copy' : 'copied'} to ${to.length > 1 ? `${to.slice(0, -1).join(', ')} and ${to.at(-1)}` : to[0]}` : 'no change';
      console.log(`${s.name}: newest is the ${s.from} copy (of ${s.copies.join(', ')}); ${did}${s.behind ? '; the claude.ai copy has an older text (her own claude.ai chats only)' : ''}`);
    }
  }
  console.log(result.line);
}
