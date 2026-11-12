#!/usr/bin/env node
// The setup of the Memo starter kit: asks for each variable of variables.json, saves the answers, and writes the
// files of this installation from the templates, with each [PLACEHOLDER] filled in. Safe to run again: the templates
// of the kit never change, your answers are kept, and a file that you or an agent changed is never overwritten.
//
//   npm run setup                 asks the questions (Return keeps the value in brackets)
//   npm run setup -- --all        also asks the "fill in later" ones: the settings of the skills and templates
//   npm run setup -- --defaults   asks nothing: the saved answers, then the defaults
//   npm run setup -- --check      checks the kit itself: every placeholder is in variables.json, and VARIABLES.md is current
//   npm run setup -- --docs       writes VARIABLES.md again from variables.json
// Options: --answers <file.json> (answers from a file), --target <folder> (write everything under that folder and
// touch nothing else: a trial run), --strict (exit with an error when a required variable has no value).
//
// What it writes:
//   my-setup/answers.json              your answers (git ignores my-setup/). The token is never in it.
//   app/.env                           from app/.env.example. An existing .env keeps its token and its other lines.
//   app/local/...                      from templates/local/: the agents, the workstreams, the charter, the permissions.
//   <VAULT_PATH>/...                   from vault/ of second-brain-starter: only files that are not there yet, or
//                                      that nobody changed.
// The vault template: --vault-template <folder>, or MEMO_VAULT_TEMPLATE, or ../second-brain-starter/vault next to this
// kit (the README clones the two repositories side by side).
//   my-setup/launchd/*.plist           from templates/launchd/, to copy to ~/Library/LaunchAgents (README, steps 6 and 13).
//   my-setup/README.md                 the README with your names and addresses filled in.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A placeholder: capitals, digits and at least one underscore, in square brackets. [YOUR_NAME], not [x] or [OK].
export const PLACEHOLDER = /\[([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\]/g;
const registry = JSON.parse(readFileSync(join(KIT, 'variables.json'), 'utf8'));
export const VARIABLES = registry.variables;
const byName = new Map(VARIABLES.map((v) => [v.name, v]));

// ---------- arguments ----------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const home = (p) => String(p).replace(/^~(?=\/|$)/, homedir());
const tilde = (p) => (String(p).startsWith(homedir() + sep) ? `~${String(p).slice(homedir().length)}` : String(p));

// ---------- the defaults that come from other answers ----------
const today = () => new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const COMPUTED = {
  YOUR_FIRST_NAME: (v) => (v.YOUR_NAME || '').trim().split(/\s+/)[0] || undefined,
  MEMO_OWNER: (v) => (v.YOUR_FIRST_NAME || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9-]/g, '').replace(/^[^a-z]+/, '') || undefined,
  YOUR_WORK_DOMAIN: (v) => (v.YOUR_EMAIL && v.YOUR_EMAIL.includes('@') ? v.YOUR_EMAIL.split('@').pop().toLowerCase() : undefined),
  YOUR_TIMEZONE: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  MAC_USERNAME: () => userInfo().username,
  MEMO_APP_PATH: () => join(KIT, 'app'),
  FIRST_CLAUDE_ACCOUNT_EMAIL: (v) => v.YOUR_EMAIL,
  VAULT_GITHUB_REPO: (v) => (v.GITHUB_USERNAME ? `${v.GITHUB_USERNAME}/memo-vault` : undefined),
  SYNC_START_DATE: () => iso(new Date(today().getTime() - 30 * 86400000)),
};
const defaultOf = (variable, values) => variable.defaultValue ?? COMPUTED[variable.name]?.(values);

function check(variable, value) {
  if (variable.kind === 'path') return /^(~|\/)/.test(value) ? null : 'Give a full path that starts with / or ~.';
  if (variable.validate === 'timezone') {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return null; } catch { return 'That is not a time zone name such as America/New_York or Europe/Lisbon.'; }
  }
  if (variable.validate && !new RegExp(variable.validate).test(value)) return `That does not have the right form. Example: ${variable.example}`;
  return null;
}
// What is kept for an answer: a path is stored in full, so a launchd file and a settings file get a path that works.
const clean = (variable, value) => (variable.kind === 'path' ? home(value.trim()) : value.trim());

// ---------- the placeholders of a text ----------
export function placeholders(text) { return [...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]); }
const escapes = {
  json: (v) => JSON.stringify(v).slice(1, -1),
  plist: (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
  js: (v) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
};
const kindOf = (path) => (path.endsWith('.json') ? 'json' : path.endsWith('.plist') ? 'plist' : path.endsWith('.js') ? 'js' : 'text');
// The text with each placeholder that has a value filled in. A placeholder with no value stays as it is.
export function render(text, values, kind = 'text') {
  const escape = escapes[kind] || ((v) => v);
  return String(text).replace(PLACEHOLDER, (whole, name) => (values[name] !== undefined && values[name] !== '' ? escape(String(values[name])) : whole));
}

// ---------- the template files of the kit ----------
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === '.DS_Store') continue;
    const path = join(dir, name);
    if (lstatSync(path).isDirectory()) out.push(...walk(path, base)); else out.push(relative(base, path));
  }
  return out;
}
// A template with one of these names is written only when each of its placeholders has a value.
const ONLY_COMPLETE = new Set([join('templates', 'local', 'place.js')]);
// The name of a file in its destination: dot-gitignore becomes .gitignore (a real .gitignore in the template folder
// would change what git tracks in the kit itself).
const destName = (rel) => rel.split(sep).map((part) => (part === 'dot-gitignore' ? '.gitignore' : part)).join(sep);
// Every template: { from (in the kit), to (root name), dest (path under that root), mode }.
//   env: merged into app/.env. managed: written when missing or untouched since setup wrote it.
//   generated: written again on every run (my-setup/).
// The folder of the vault template, or null when it is not there.
export function vaultTemplateDir() {
  const given = option('vault-template') || process.env.MEMO_VAULT_TEMPLATE;
  const places = given ? [resolve(home(given))] : [join(KIT, '..', 'second-brain-starter', 'vault')];
  return places.find((d) => existsSync(join(d, 'CLAUDE.md'))) || null;
}
const NO_VAULT_TEMPLATE = 'The vault template is not there. Clone the repository second-brain-starter next to this folder, so that\n'
  + `${join(KIT, '..', 'second-brain-starter', 'vault')} exists (README, step 4), or give its folder with --vault-template <folder>.`;
export function templates() {
  const out = [{ from: join('app', '.env.example'), root: 'app', dest: '.env', mode: 'env' }];
  for (const rel of walk(join(KIT, 'templates', 'local'))) out.push({ from: join('templates', 'local', rel), root: 'app', dest: join('local', rel), mode: 'managed' });
  const vt = vaultTemplateDir();
  // `from` is relative to the kit, so a vault file is ../second-brain-starter/vault/<file>.
  if (vt) for (const rel of walk(vt)) out.push({ from: relative(KIT, join(vt, rel)), root: 'vault', dest: destName(rel), mode: 'managed' });
  for (const rel of walk(join(KIT, 'templates', 'launchd'))) out.push({ from: join('templates', 'launchd', rel), root: 'out', dest: join('launchd', rel), mode: 'generated' });
  out.push({ from: 'README.md', root: 'out', dest: 'README.md', mode: 'generated' });
  out.push({ from: join('app', 'docs', 'gpt-desktop.md'), root: 'out', dest: 'gpt-desktop.md', mode: 'generated' });
  return out;
}
// The files of the kit that may hold placeholders, for --check and for "Used in" of VARIABLES.md.
function kitFiles() {
  const extra = ['PETS.md', join('app', 'README.md'), ...walk(join(KIT, 'app', 'charters')).map((r) => join('app', 'charters', r))];
  return [...new Set([...templates().map((t) => t.from), ...extra])].filter((f) => existsSync(join(KIT, f)));
}
function usage() {
  const used = new Map(); // name -> the files that hold it
  for (const file of kitFiles()) {
    for (const name of new Set(placeholders(readFileSync(join(KIT, file), 'utf8')))) used.set(name, [...(used.get(name) || []), file]);
  }
  return used;
}

// ---------- VARIABLES.md ----------
export function variablesDoc() {
  const used = usage();
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const lines = [
    '# Variables', '',
    'Every placeholder of the kit and of its vault template (the repository second-brain-starter), in one list. This file is made from `variables.json` by `npm run setup -- --docs`; change that file, not this one.', '',
    '**How to read a placeholder.** A name in capitals in square brackets, for example `[YOUR_NAME]`, stands for a value that only you know. `npm run setup` asks you for each one and fills it in everywhere. You do not edit the files by hand.', '',
    '- **Required**: setup asks until it has a value (most have a default; press Return to take it).',
    '- **Optional**: press Return to skip it. The placeholder then stays in the files in capitals, setup lists it at its end, and an agent that meets it asks you once by memo.',
    '- **Fill in later**: the settings of the skills and the vault templates (a CRM, a program, a channel, a bookkeeping sheet). Setup does not ask them, so the first setup stays short. Fill one in when you start to use its skill: `npm run setup -- --all`, or let the agent ask you by memo when it meets it.',
    '- Run `npm run setup` again at any time to change an answer.', '',
    'A second kind of marker is not a placeholder: words in curly brackets, for example `{Name}` or `{one line}` in the vault templates, are slots that the agents fill in for each person, meeting or project. Setup leaves them alone.', '',
    `Count: ${VARIABLES.length} variables, ${VARIABLES.filter((v) => v.required && v.kind !== 'generated').length} required, ${VARIABLES.filter((v) => !v.required && !v.later).length} optional, ${VARIABLES.filter((v) => v.later).length} fill in later, ${VARIABLES.filter((v) => v.kind === 'generated').length} made by setup.`, '',
  ];
  for (const group of [...new Set(VARIABLES.map((v) => v.group))]) {
    lines.push(`## ${group}`, '', '| Placeholder | What it means | Example | Required | Default | Used in |', '|---|---|---|---|---|---|');
    for (const v of VARIABLES.filter((x) => x.group === group)) {
      const files = used.get(v.name) || [];
      const shown = files.map((f) => (f.startsWith(`..${sep}`) ? f.split(sep).slice(1).join('/') : f));
      lines.push(`| \`[${v.name}]\` | ${cell(v.meaning)} | ${cell(v.example)} | ${v.kind === 'generated' ? 'made by setup' : v.required ? 'required' : v.later ? 'fill in later' : 'optional'} | ${cell(v.defaultValue ?? v.default ?? 'none')} | ${shown.map((f) => `\`${f}\``).join(', ') || 'not used'} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}`;
}

// ---------- the check of the kit itself ----------
function checkKit() {
  const used = usage();
  const problems = [];
  for (const [name, files] of used) if (!byName.has(name)) problems.push(`[${name}] is in ${files.join(', ')} but not in variables.json.`);
  for (const v of VARIABLES) if (!used.has(v.name)) problems.push(`[${v.name}] is in variables.json but no file of the kit uses it.`);
  const names = VARIABLES.map((v) => v.name);
  for (const n of names) if (names.indexOf(n) !== names.lastIndexOf(n)) problems.push(`[${n}] is in variables.json two times.`);
  const doc = join(KIT, 'VARIABLES.md');
  if (!existsSync(doc) || readFileSync(doc, 'utf8') !== variablesDoc()) problems.push('VARIABLES.md is not current. Run: npm run setup -- --docs');
  return { used, problems };
}

// ---------- the questions ----------
async function ask(values, { defaults }) {
  const out = { ...values };
  const toAsk = VARIABLES.filter((v) => v.kind !== 'generated' && (!v.later || flag('all')));
  if (defaults) {
    for (const v of toAsk) {
      if (out[v.name] === undefined || out[v.name] === '') { const d = defaultOf(v, out); if (d !== undefined) out[v.name] = clean(v, String(d)); }
    }
    return out;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  // The lines are read one by one, so answers from a pipe work as answers from a keyboard.
  const queue = []; const waiting = [];
  let closed = false;
  rl.on('line', (line) => { if (waiting.length) waiting.shift()(line); else queue.push(line); });
  rl.on('close', () => { closed = true; while (waiting.length) waiting.shift()(null); });
  const question = (text) => new Promise((done) => { process.stdout.write(text); if (queue.length) done(queue.shift()); else if (closed) done(null); else waiting.push(done); });
  console.log(`\nMemo starter kit setup. ${toAsk.length} questions, in ${new Set(toAsk.map((v) => v.group)).size} groups.`);
  console.log('Press Return to keep the value in brackets. For an optional question with no value, Return skips it.');
  console.log('Type a single hyphen (-) to clear an answer. Press Control-C to stop; run setup again later to go on.\n');
  let group = null; let n = 0;
  for (const v of toAsk) {
    n += 1;
    if (v.group !== group) { group = v.group; console.log(`\n=== ${group} ===`); }
    const current = out[v.name] !== undefined && out[v.name] !== '' ? out[v.name] : defaultOf(v, out);
    console.log(`\n${n} of ${toAsk.length}  [${v.name}]  (${v.required ? 'required' : 'optional'})`);
    console.log(`  ${v.meaning}`);
    console.log(`  Example: ${v.example}`);
    for (;;) {
      const answer = await question(`  > ${current !== undefined ? `[${current}] ` : ''}`);
      if (answer === null) { // the input ended: keep what there is
        if (current !== undefined) out[v.name] = clean(v, String(current));
        break;
      }
      const text = answer.trim();
      if (text === '-') { delete out[v.name]; if (v.required) { console.log('  This one is required. It stays empty for now, and setup lists it at the end.'); } break; }
      const value = text === '' ? current : text;
      if (value === undefined || value === '') {
        if (v.required) { console.log('  This one is required. Type a value.'); continue; }
        delete out[v.name]; break;
      }
      const problem = check(v, String(value));
      if (problem) { console.log(`  ${problem}`); continue; }
      out[v.name] = clean(v, String(value));
      break;
    }
  }
  rl.close();
  return out;
}

// ---------- writing ----------
const sha = (text) => createHash('sha256').update(text).digest('hex');
const read = (path) => { try { return readFileSync(path, 'utf8'); } catch { return null; } };
function write(path, text, mode) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (mode) chmodSync(path, mode);
}

// app/.env from the template. A line that still has a placeholder becomes a comment, so the server never reads a
// placeholder as a value. An existing .env keeps its token and every line that the template does not set.
export function envText(template, values, existing) {
  const oldToken = existing && /^MEMO_TOKEN=(.{16,})$/m.exec(existing)?.[1];
  const token = oldToken && !placeholders(oldToken).length ? oldToken : randomBytes(32).toString('base64url');
  const lines = render(template, { ...values, MEMO_TOKEN: token }).split('\n')
    .map((line) => (!line.startsWith('#') && placeholders(line).length ? `# ${line}` : line));
  if (!existing) return lines.join('\n');
  // Merge: each KEY=value of the template replaces that key in the old file, or is added at the end.
  const old = existing.replace(/\n$/, '').split('\n');
  const added = [];
  for (const line of lines) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!m || m[1] === 'MEMO_TOKEN') continue;
    const at = old.findIndex((l) => l.startsWith(`${m[1]}=`));
    if (at >= 0) old[at] = line; else added.push(line);
  }
  if (!old.some((l) => l.startsWith('MEMO_TOKEN='))) added.push(`MEMO_TOKEN=${token}`);
  return `${[...old, ...(added.length ? ['', '# Added by npm run setup:', ...added] : [])].join('\n')}\n`;
}

function install(values, roots, manifest) {
  const report = { written: [], updated: [], same: [], kept: [], skipped: [], files: [] };
  for (const t of templates()) {
    const source = readFileSync(join(KIT, t.from), 'utf8');
    const dest = join(roots[t.root], t.dest);
    const shown = `${t.root === 'app' ? 'app' : t.root === 'vault' ? tilde(roots.vault) : 'my-setup'}${sep}${t.dest}`;
    const old = read(dest);
    if (t.mode === 'env') {
      const text = envText(source, values, old);
      write(dest, text, 0o600);
      (old === null ? report.written : old === text ? report.same : report.updated).push(shown);
      report.files.push({ dest, shown });
      continue;
    }
    const text = render(source, values, kindOf(t.from));
    if (ONLY_COMPLETE.has(t.from) && placeholders(text).length) { report.skipped.push(`${shown} (needs ${[...new Set(placeholders(text))].map((n) => `[${n}]`).join(', ')})`); continue; }
    report.files.push({ dest, shown });
    if (t.mode === 'generated' || old === null) { write(dest, text); (old === null ? report.written : old === text ? report.same : report.updated).push(shown); manifest[dest] = sha(text); continue; }
    if (old === text) { report.same.push(shown); manifest[dest] = sha(text); continue; }
    // The file is as setup wrote it last time: the new answers go in. Otherwise somebody changed it: it stays.
    if (manifest[dest] && manifest[dest] === sha(old)) { write(dest, text); report.updated.push(shown); manifest[dest] = sha(text); } else report.kept.push(shown);
  }
  return report;
}

// The placeholders that are still in the files of this installation: name -> the files.
function leftovers(files) {
  const left = new Map();
  for (const { dest, shown } of files) {
    const text = read(dest);
    if (text === null) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      // A comment line of .env may name a placeholder on purpose (an option that is off).
      for (const name of new Set(placeholders(line))) left.set(name, [...(left.get(name) || []), `${shown}:${i + 1}`]);
    });
  }
  return left;
}

async function main() {
  if (!vaultTemplateDir()) { console.error(NO_VAULT_TEMPLATE); process.exit(1); }
  if (flag('docs')) { writeFileSync(join(KIT, 'VARIABLES.md'), variablesDoc()); console.log('VARIABLES.md is written.'); return; }
  if (flag('check')) {
    const { used, problems } = checkKit();
    const total = [...used.values()].reduce((sum, files) => sum + files.length, 0);
    console.log(`${VARIABLES.length} variables in variables.json; ${used.size} placeholder names in ${kitFiles().length} files of the kit (${total} name and file pairs).`);
    if (problems.length) { for (const p of problems) console.error(`PROBLEM: ${p}`); process.exit(1); }
    console.log('The kit is consistent: every placeholder is in variables.json, every variable is used, and VARIABLES.md is current.');
    return;
  }
  const target = option('target') ? resolve(option('target')) : null;
  const out = target ? join(target, 'my-setup') : join(KIT, 'my-setup');
  const answersPath = join(out, 'answers.json');
  const manifestPath = join(out, 'manifest.json');
  let saved = {};
  for (const path of [answersPath, option('answers')].filter(Boolean)) {
    const text = read(resolve(path));
    if (text === null) { if (path !== answersPath) { console.error(`The answers file ${path} is not there.`); process.exit(1); } continue; }
    try { saved = { ...saved, ...JSON.parse(text) }; } catch (err) { console.error(`${path} is not valid JSON: ${err.message}`); process.exit(1); }
  }
  for (const name of Object.keys(saved)) {
    const v = byName.get(name);
    if (!v || v.kind === 'generated' || typeof saved[name] !== 'string') { delete saved[name]; continue; }
    const problem = saved[name] === '' ? null : check(v, saved[name]);
    if (problem) { console.error(`The saved answer for [${name}] is not valid and is asked again: ${problem}`); delete saved[name]; } else saved[name] = clean(v, saved[name]);
  }
  const values = await ask(saved, { defaults: flag('defaults') || Boolean(option('answers')) });
  write(answersPath, `${JSON.stringify(values, null, 2)}\n`, 0o600);

  const roots = { app: target ? join(target, 'app') : join(KIT, 'app'), vault: target ? join(target, 'vault') : home(values.VAULT_PATH || '~/memo-vault'), out };
  const manifest = JSON.parse(read(manifestPath) || '{}');
  const report = install(values, roots, manifest);
  write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // The folders of the agents, the link that gives them the skills of the vault, and git in a new vault.
  const notes = [];
  if (!target) {
    for (const name of ['AGENT_WORK_DIR', 'OUTBOX_PATH']) if (values[name]) mkdirSync(home(values[name]), { recursive: true });
    if (values.AGENT_WORK_DIR) {
      const link = join(home(values.AGENT_WORK_DIR), '.claude', 'skills');
      let there = false;
      try { lstatSync(link); there = true; } catch { /* not there */ }
      if (!there) { mkdirSync(dirname(link), { recursive: true }); symlinkSync(join(roots.vault, 'skills', 'agent'), link); notes.push(`Linked ${link} to the agent skills of the vault.`); }
    }
    if (!existsSync(join(roots.vault, '.git'))) {
      try { execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: roots.vault }); notes.push(`Made ${roots.vault} a git repository (branch main). README step 12 connects it to GitHub.`); } catch { notes.push(`git init did not run in ${roots.vault}. Do README step 12 by hand.`); }
    }
  }

  const list = (title, items) => { if (items.length) { console.log(`\n${title} (${items.length}):`); for (const i of items.slice(0, 12)) console.log(`  ${i}`); if (items.length > 12) console.log(`  ... and ${items.length - 12} more`); } };
  console.log('\n----------------------------------------------------------------');
  console.log(`Answers saved in ${tilde(answersPath)}.`);
  list('New files', report.written);
  list('Files updated with your new answers', report.updated);
  list('Files kept as they are, because you or an agent changed them since setup wrote them (delete one and run setup again to get the version of the kit)', report.kept);
  list('Not written', report.skipped);
  console.log(`\n${report.same.length} files were already current.`);
  for (const n of notes) console.log(n);

  // The last step: every placeholder that is still in a file of this installation.
  const left = leftovers(report.files);
  const required = [...left.keys()].filter((n) => byName.get(n)?.required);
  const optional = [...left.keys()].filter((n) => byName.has(n) && !byName.get(n).required && !byName.get(n).later);
  const later = [...left.keys()].filter((n) => byName.has(n) && byName.get(n).later);
  const unknown = [...left.keys()].filter((n) => !byName.has(n));
  const show = (names) => { for (const n of names.sort()) { const where = left.get(n); console.log(`  [${n}]  ${where.slice(0, 3).join(', ')}${where.length > 3 ? `, and ${where.length - 3} more places` : ''}`); } };
  console.log('\nPlaceholders that are still in your files:');
  if (!left.size) console.log('  None. Every placeholder is filled in.');
  if (required.length) { console.log(`\n  REQUIRED, not filled in yet (${required.length}). Run npm run setup again and answer them:`); show(required); }
  if (optional.length) { console.log(`\n  Optional, skipped (${optional.length}). They stay in capitals; an agent that meets one asks you by memo. Run npm run setup again to fill one in:`); show(optional); }
  if (later.length) console.log(`\n  Fill in later (${later.length}): the settings of the skills and templates. Fill one in when you use its skill, with npm run setup -- --all, or answer the agent when it asks: ${later.sort().map((n) => `[${n}]`).join(', ')}`);
  if (unknown.length) { console.log(`\n  Not in variables.json (${unknown.length}). Fill these in by hand in the file:`); show(unknown); }
  console.log(`\nNext: open ${tilde(join(out, 'README.md'))} (the README with your values filled in) and go on with step 6.`);
  if (flag('strict') && required.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((err) => { console.error(err.message); process.exit(1); });
