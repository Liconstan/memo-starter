import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createSystem, countVault, parseCounts, statusPaths, syncLine, frontmatter, readSkills, skillTemplate } from '../src/system.js';
import { makeApp, call, TOKEN, LIAISON_TOKEN } from './helpers.js';

const NOW = new Date('2026-11-04T12:00:00Z');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };
const skill = (name, lastUsed, more = '') => `---\nname: ${name}\ndescription: Use when ${name}.\n${lastUsed ? `last_used: ${lastUsed}\n` : ''}---\n\n# ${name}\n${more}`;

// A vault with the files the dashboard counts, as a git repository with a bare "GitHub" next to it.
function makeVault({ git: withGit = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'memo-system-'));
  const vault = join(base, 'vault');
  const local = join(base, 'local');
  mkdirSync(join(local, 'charters'), { recursive: true });
  for (const name of ['ada', 'bo', 'cy']) write(vault, `people/${name}.md`, `# ${name}`);
  write(vault, 'people/_index.md', 'index');
  write(vault, 'people/_template.md', 'template');
  write(vault, 'people/_merged/old-ada.md', 'merged');
  for (const name of ['fund-a', 'fund-b']) write(vault, `funders/${name}.md`, `# ${name}`);
  write(vault, 'funders/_template.md', 'template');
  write(vault, 'projects/example-org/crm/overview.md', 'crm');
  write(vault, 'projects/example-org/summit/overview.md', 'summit');
  write(vault, 'projects/example-org/.DS_Store', '');
  write(vault, 'projects/side-business/front-desk.md', 'side');
  write(vault, 'projects/side-business/outputs/x.txt', 'out');
  write(vault, 'meetings/2026-11-02-weekly.md', 'm');
  write(vault, 'meetings/2026-11-03-one-to-one.md', 'm');
  write(vault, 'meetings/2026-10-30-old.md', 'm');
  write(vault, 'asana/tasks.md', '---\ntype: snapshot\nupdated: 2026-11-04\n---\n\n# Asana open tasks\n\n689 open tasks listed: Cam Owner 165; Sam Example 140; Unassigned 102.\n');
  write(vault, 'scripts/sync-log.md', '# Sync log\n\n## 2026-11-04 — nightly run (memo 813)\n\n2026-11-04 | meetings 4 | failures: none; one retry | secrets: none new.\n\n## 2026-11-03 — nightly run\n\nfailures: the Docs helper broke.\n');
  write(vault, 'scripts/lessons.md', '# Lessons\n\n- At most 40 entries. Merge first.\n\n## Memos\n\n1. One question per memo.\n2. Read every reply.\n\n## Time\n\n3. Dates with the day of the week.\n');
  write(vault, 'scripts/cloud-agent.md', '# Rules for the hourly cloud agent\n\n- Never send email.\n');
  write(vault, 'scripts/sync-state.md', '# Sync state\n\n- system_map_url: https://claude.ai/artifact/abc123 (published by main)\n');
  write(vault, 'skills/README.md', '# Skills');
  write(vault, 'skills/agent/email-reply-drafts/SKILL.md', skill('email-reply-drafts', '2026-11-01'));
  write(vault, 'skills/agent/old-skill/SKILL.md', skill('old-skill', '2026-09-01'));
  write(vault, 'skills/agent/never-used/SKILL.md', skill('never-used', null));
  write(vault, 'skills/botec/SKILL.md', skill('botec', null));
  write(vault, 'skills/slack-post/SKILL.md', skill('slack-post', null));
  write(vault, 'summaries/system-map.html', '<title>Map</title><p>Built Tuesday November 4, 2026 at 3:35 AM from the files the agents follow.</p>');
  write(local, 'charters/main.md', '# Charter: main\n\nYou do the work.\n');
  write(local, 'charters/second.md', '# Charter: second\n\nYou do the long work.\n');
  let bare = null;
  if (withGit) {
    bare = join(base, 'github.git');
    git(base, 'init', '--bare', '-q', '-b', 'main', bare);
    git(vault, 'init', '-q', '-b', 'main');
    git(vault, 'config', 'user.email', 'test@example.com');
    git(vault, 'config', 'user.name', 'Test');
    git(vault, 'add', '-A');
    git(vault, 'commit', '-q', '-m', 'Start');
    git(vault, 'remote', 'add', 'origin', bare);
    git(vault, 'push', '-q', '-u', 'origin', 'main');
  }
  return { base, vault, local, bare };
}

// A small "Memo code" repository whose branch main is backed up to memo-code of a bare repository.
function makeCode(base) {
  const root = join(base, 'memo');
  const bare = join(base, 'memo-backup.git');
  mkdirSync(root);
  git(base, 'init', '--bare', '-q', '-b', 'main', bare);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  writeFileSync(join(root, 'a.js'), '1');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'One');
  git(root, 'push', '-q', bare, 'main:memo-code');
  return { root, bare };
}

const NO_BUILD = { cmd: 'sh', args: ['-c', 'true'] };
function make(options = {}) {
  const v = makeVault(options);
  const code = makeCode(v.base);
  const system = createSystem({ vault: v.vault, local: v.local, memoRoot: code.root, codeRemote: code.bare, codeBranch: 'main', codeRemoteBranch: 'memo-code', build: NO_BUILD, now: () => NOW, log: () => {}, ...options.system });
  return { ...v, code, system };
}

test('the git sync parser and the line for the owner', () => {
  assert.deepEqual(parseCounts('2\t1\n'), { ahead: 2, behind: 1 });
  assert.deepEqual(parseCounts('0 0'), { ahead: 0, behind: 0 });
  assert.throws(() => parseCounts(''), /no counts/);
  assert.deepEqual(statusPaths(' M scripts/lessons.md\n?? new.md\nR  old.md -> new-name.md\n M "a b.md"\n'), ['scripts/lessons.md', 'new.md', 'new-name.md', 'a b.md']);
  assert.deepEqual(syncLine({ ahead: 0, behind: 0, uncommitted: 0 }), { level: 'ok', text: 'In sync with GitHub.' });
  assert.deepEqual(syncLine({ ahead: 2, behind: 0, uncommitted: 0 }), { level: 'warn', text: 'Out of sync: 2 commits not pushed.' });
  assert.deepEqual(syncLine({ ahead: 1, behind: 1, uncommitted: 3 }), { level: 'warn', text: 'Out of sync: 1 commit not pushed, 1 commit on GitHub not pulled, 3 files changed and not committed.' });
  assert.equal(syncLine({ error: 'fetch: no network' }).level, 'bad');
  assert.equal(syncLine({}).text, 'Not checked yet.');
});

test('the dashboard counts the vault by the rules', () => {
  const { vault } = makeVault({ git: false });
  const d = countVault(vault, NOW);
  assert.equal(d.people, 3, 'files that start with _ and the _merged folder are not people');
  assert.equal(d.funders, 2);
  assert.equal(d.projects, 4, 'two project folders of one group, one file and one folder of the other; no .DS_Store');
  assert.equal(d.meetingsThisMonth, 2);
  assert.equal(d.month, '2026-11');
  assert.deepEqual(d.asana, { open: 689, who: 'Cam Owner', mine: 165, updated: '2026-11-04' });
  assert.deepEqual(d.sync, { title: '2026-11-04 — nightly run (memo 813)', failures: 'none; one retry' });
  assert.deepEqual(d.lessons, { count: 3, max: 40 });
  assert.deepEqual(d.skills, { count: 3, stale: 2, staleDays: 30 });
  assert.equal(d.handSkills, 2, 'the agent folder and README.md are not hand-made skills');
  assert.deepEqual(frontmatter('---\nname: x\nlast_used: 2026-01-02\n---\nBody').data, { name: 'x', last_used: '2026-01-02' });
  assert.equal(frontmatter('no frontmatter').body, 'no frontmatter');
  const skills = readSkills(join(vault, 'skills', 'agent'), NOW);
  assert.deepEqual(skills.map((s) => [s.name, s.stale]), [['email-reply-drafts', false], ['never-used', true], ['old-skill', true]]);
  const empty = countVault(join(vault, 'nowhere'), NOW);
  assert.equal(empty.people, 0);
  assert.equal(empty.asana, null);
});

test('the file list has the charters, the lessons, and the skills, and only those', () => {
  const { system, vault } = make();
  const files = system.files();
  assert.deepEqual(files.map((f) => f.id), ['charter:main', 'charter:second', 'charter:cloud', 'lessons', 'skill:email-reply-drafts', 'skill:never-used', 'skill:old-skill', 'hand:botec', 'hand:slack-post']);
  assert.ok(files.every((f) => f.file === undefined && f.mirror === undefined), 'no absolute path goes to the page');
  assert.equal(files.find((f) => f.id === 'hand:botec').editable, false);
  assert.match(files.find((f) => f.id === 'hand:botec').note, /Pinned copy/);
  assert.equal(files.find((f) => f.id === 'skill:old-skill').stale, true);
  assert.equal(files.find((f) => f.id === 'lessons').path, join('scripts', 'lessons.md'));
  const summary = system.summary();
  assert.equal(summary.map.url, 'https://claude.ai/artifact/abc123');
  assert.equal(summary.map.builtText, 'Tuesday November 4, 2026 at 3:35 AM');
  assert.equal(summary.dashboard.people, 3);
  assert.ok(readFileSync(join(vault, 'skills', 'botec', 'SKILL.md'), 'utf8').includes('botec'));
});

test('the path allowlist refuses traversal, unknown files, odd names, and links that point out', () => {
  const { system, vault, base } = make();
  for (const id of ['../.env', 'lessons/../../.env', 'skill:../../.secrets/key', 'skill:../botec', 'skill:nope', 'skill:Bad Name', 'skill:a.b', 'hand:agent', 'charter:other', 'summaries/system-map.html', '', 42, 'x'.repeat(100)]) {
    assert.throws(() => system.lookup(id), (e) => e.status === 404 || e.status === 400, `id ${JSON.stringify(id)}`);
  }
  // A skill folder that is a link to a place outside skills/agent.
  const outside = join(base, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'SKILL.md'), skill('linked', '2026-11-01'));
  symlinkSync(outside, join(vault, 'skills', 'agent', 'linked'));
  assert.ok(!system.files().some((f) => f.id === 'skill:linked'), 'a linked folder is not listed');
  assert.throws(() => system.lookup('skill:linked'), /No such file/);
  // A SKILL.md that is a link to a file outside.
  mkdirSync(join(vault, 'skills', 'agent', 'sneaky'));
  symlinkSync(join(outside, 'SKILL.md'), join(vault, 'skills', 'agent', 'sneaky', 'SKILL.md'));
  assert.throws(() => system.lookup('skill:sneaky'), /No such file/);
  assert.equal(system.lookup('lessons').editable, true);
  assert.equal(system.lookup('skill:old-skill').editable, true);
  assert.equal(system.read('charter:main').text, '# Charter: main\n\nYou do the work.\n');
});

test('a save refuses a stale hash and a view-only file, and never writes then', async () => {
  const { system, vault } = make();
  const before = readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8');
  await assert.rejects(system.save('lessons', 'new text', sha('something else')), (e) => e.status === 409 && /changed since you opened it/.test(e.message));
  assert.equal(readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8'), before, 'the file did not change');
  await assert.rejects(system.save('lessons', 'new text', ''), (e) => e.status === 400);
  await assert.rejects(system.save('lessons', 42, sha(before)), (e) => e.status === 400);
  await assert.rejects(system.save('hand:botec', 'x', sha('x')), (e) => e.status === 403 && /view-only/.test(e.message));
  await assert.rejects(system.save('skill:../botec', 'x', sha('x')), (e) => e.status === 404);
});

test('a save of a vault file pulls, commits that file alone, and pushes', async () => {
  const { system, vault, bare } = make();
  // Another file is changed and not committed: the save must leave it alone.
  writeFileSync(join(vault, 'people', 'ada.md'), 'changed by an agent');
  const before = readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8');
  const r = await system.save('lessons', `${before}4. New rule.\n`, sha(before));
  assert.equal(r.ok, true);
  assert.equal(r.pushed, true);
  assert.equal(r.hash, sha(`${before}4. New rule.\n`));
  assert.equal(git(vault, 'log', '-1', '--format=%s'), 'Edit scripts/lessons.md from the System page (the owner)');
  assert.equal(git(vault, 'show', '--stat', '--format=', 'HEAD').split('\n').filter((l) => l.includes('|')).length, 1, 'one file in the commit');
  assert.equal(git(bare, 'rev-parse', 'main'), git(vault, 'rev-parse', 'HEAD'), 'the commit is on GitHub');
  assert.equal(readFileSync(join(vault, 'people', 'ada.md'), 'utf8'), 'changed by an agent');
  assert.equal(git(vault, 'status', '--porcelain'), 'M people/ada.md');
  // The same text again: nothing to commit, and no error.
  const again = await system.save('lessons', `${before}4. New rule.\n`, r.hash);
  assert.equal(again.committed, false);
  // A change on GitHub by another agent arrives with the pull. Her stale version is refused after the pull.
  const other = join(vault, '..', 'other');
  git(vault, 'clone', '-q', bare, other);
  git(other, 'config', 'user.email', 'o@example.com');
  git(other, 'config', 'user.name', 'Other');
  writeFileSync(join(other, 'scripts', 'lessons.md'), 'rewritten by an agent\n');
  git(other, 'commit', '-q', '-am', 'Agent edit');
  git(other, 'push', '-q');
  await assert.rejects(system.save('lessons', 'her text', r.hash), (e) => e.status === 409);
  assert.equal(readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8'), 'rewritten by an agent\n', 'the pull brought the agent text, hers did not go over it');
  const fresh = await system.save('lessons', 'her text on top\n', sha('rewritten by an agent\n'));
  assert.equal(fresh.pushed, true);
  assert.equal(git(other, 'pull', '-q') === '' && readFileSync(join(other, 'scripts', 'lessons.md'), 'utf8'), 'her text on top\n');
});

test('a save of a live charter writes it, keeps the old text, and backs it up in the vault', async () => {
  const { system, vault, local, bare } = make();
  const before = readFileSync(join(local, 'charters', 'main.md'), 'utf8');
  const r = await system.save('charter:main', '# Charter: main\n\nNew rules.\n', sha(before));
  assert.equal(r.ok, true);
  assert.equal(r.pushed, true);
  assert.match(r.note, /next start/);
  assert.equal(readFileSync(join(local, 'charters', 'main.md'), 'utf8'), '# Charter: main\n\nNew rules.\n');
  const history = readdirSync(join(local, 'charters', '.history'));
  assert.equal(history.length, 1);
  assert.match(history[0], /^main-2026-11-04T/);
  assert.equal(readFileSync(join(local, 'charters', '.history', history[0]), 'utf8'), before);
  assert.equal(readFileSync(join(vault, 'scripts', 'charters', 'main.md'), 'utf8'), '# Charter: main\n\nNew rules.\n');
  assert.equal(git(vault, 'log', '-1', '--format=%s'), 'Edit local/charters/main.md from the System page (the owner)');
  assert.equal(git(bare, 'rev-parse', 'main'), git(vault, 'rev-parse', 'HEAD'));
  assert.ok(!system.files().some((f) => f.id.includes('history')), 'the history is not a file of the page');
});

test('the team charter is on the page when local/charters/team.md exists, and saves as the other charters', async () => {
  const { system, vault, local } = make();
  assert.ok(!system.files().some((f) => f.id === 'charter:team'), 'no team.md, no entry');
  assert.throws(() => system.read('charter:team'), (e) => e.status === 404);
  write(local, 'charters/team.md', '# Team charter\n\n## main\n\n## second\n');
  const team = system.files().find((f) => f.id === 'charter:team');
  assert.equal(team.title, 'Team charter, all agents');
  assert.equal(team.path, 'local/charters/team.md');
  assert.equal(team.where, 'local');
  assert.equal(team.editable, true);
  assert.match(team.note, /"charter": "team"/);
  assert.equal(system.files().map((f) => f.id).slice(0, 4).join(','), 'charter:team,charter:main,charter:second,charter:cloud');
  const before = system.read('charter:team');
  assert.equal(before.text, '# Team charter\n\n## main\n\n## second\n');
  await assert.rejects(system.save('charter:team', 'x', sha('other')), (e) => e.status === 409);
  const r = await system.save('charter:team', '# Team charter\n\nNew rules.\n', before.hash);
  assert.equal(r.ok, true);
  assert.equal(r.pushed, true);
  assert.equal(readFileSync(join(local, 'charters', 'team.md'), 'utf8'), '# Team charter\n\nNew rules.\n');
  const history = readdirSync(join(local, 'charters', '.history'));
  assert.deepEqual(history.map((h) => h.replace(/-2026.*$/, '')), ['team']);
  assert.equal(readFileSync(join(local, 'charters', '.history', history[0]), 'utf8'), before.text);
  assert.equal(readFileSync(join(vault, 'scripts', 'charters', 'team.md'), 'utf8'), '# Team charter\n\nNew rules.\n');
  assert.equal(git(vault, 'log', '-1', '--format=%s'), 'Edit local/charters/team.md from the System page (the owner)');
});

test('an agent on a shared charter that exists has no charter of its own on the page, and no mirror of it', async () => {
  const { system, vault, local } = make();
  const ids = () => system.files().filter((f) => f.group === 'charters').map((f) => f.id);
  const agents = (list) => write(local, 'agents.json', JSON.stringify(list));
  // Both long agents on the team charter: the team charter once, then the cloud agent. The remote agent has no entry.
  agents([{ name: 'main', kind: 'long', dir: '.', model: 'm', charter: 'team' }, { name: 'second', kind: 'long', dir: '.', model: 'm', charter: 'team' }, { name: 'gpt', kind: 'remote' }]);
  write(local, 'charters/team.md', '# Team charter\n\n## main\n\n## second\n');
  assert.deepEqual(ids(), ['charter:team', 'charter:cloud']);
  assert.throws(() => system.read('charter:main'), (e) => e.status === 404);
  // A save of the old id is refused, so the per-agent copy in the vault is not made again.
  await assert.rejects(system.save('charter:main', 'x\n', sha('')), (e) => e.status === 404);
  assert.ok(!existsSync(join(vault, 'scripts', 'charters', 'main.md')), 'no mirror of main.md');
  // One agent on the team charter, one on its own.
  agents([{ name: 'main', kind: 'long', dir: '.', model: 'm', charter: 'team' }, { name: 'second', kind: 'long', dir: '.', model: 'm' }]);
  assert.deepEqual(ids(), ['charter:team', 'charter:second', 'charter:cloud']);
  // A shared charter that is missing shows as missing, and the agents read their own charters again.
  agents([{ name: 'main', kind: 'long', dir: '.', model: 'm', charter: 'crew' }, { name: 'second', kind: 'long', dir: '.', model: 'm', charter: 'team' }]);
  assert.deepEqual(ids(), ['charter:team', 'charter:crew', 'charter:main', 'charter:cloud']);
  const crew = system.files().find((f) => f.id === 'charter:crew');
  assert.equal(crew.exists, false);
  assert.equal(crew.title, 'Shared charter crew');
  assert.match(crew.note, /"charter": "crew"/);
  assert.equal(system.files().find((f) => f.id === 'charter:main').exists, true);
  // An agents.json that does not parse: main and second, as before.
  write(local, 'agents.json', '{');
  assert.deepEqual(ids(), ['charter:team', 'charter:main', 'charter:second', 'charter:cloud']);
});

test('a failed push keeps the commit, reports the error, and shows as not pushed', async () => {
  const { system, vault, bare } = make();
  writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "GitHub says no" >&2\nexit 1\n');
  chmodSync(join(bare, 'hooks', 'pre-receive'), 0o755);
  const before = readFileSync(join(vault, 'scripts', 'cloud-agent.md'), 'utf8');
  const r = await system.save('charter:cloud', `${before}- Never pay.\n`, sha(before));
  assert.equal(r.ok, true);
  assert.equal(r.committed, true);
  assert.equal(r.pushed, false);
  assert.match(r.error, /push to GitHub failed/);
  assert.match(r.error, /GitHub says no/);
  assert.equal(readFileSync(join(vault, 'scripts', 'cloud-agent.md'), 'utf8'), `${before}- Never pay.\n`);
  assert.equal(git(vault, 'status', '--porcelain').trim(), '', 'no half state: the file is committed');
  await system.checkSync();
  const s = system.summary();
  assert.equal(s.vault.ahead, 1);
  assert.deepEqual(s.vault.line, { level: 'warn', text: 'Out of sync: 1 commit not pushed.' });
});

test('a failed pull saves nothing, and a local charter is still written', async () => {
  const { system, vault, local } = make();
  git(vault, 'remote', 'set-url', 'origin', join(vault, '..', 'gone.git'));
  const before = readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8');
  await assert.rejects(system.save('lessons', 'x', sha(before)), (e) => e.status === 502 && /Nothing was saved/.test(e.message) && /pull/.test(e.message));
  assert.equal(readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8'), before);
  const charter = readFileSync(join(local, 'charters', 'second.md'), 'utf8');
  const r = await system.save('charter:second', 'new charter\n', sha(charter));
  assert.equal(r.ok, true);
  assert.equal(readFileSync(join(local, 'charters', 'second.md'), 'utf8'), 'new charter\n');
  assert.equal(r.pushed, false);
  assert.match(r.error, /saved on the Mac, but its backup copy/);
});

test('the sync check counts the vault and the code backup against their remotes', async () => {
  const { system, vault, code } = make();
  await system.checkSync();
  let s = system.summary();
  assert.deepEqual([s.vault.ahead, s.vault.behind, s.vault.uncommitted, s.vault.error], [0, 0, 0, null]);
  assert.equal(s.vault.line.level, 'ok');
  assert.ok(s.vault.fetchedAt, 'the fetch time comes from FETCH_HEAD');
  assert.deepEqual([s.code.ahead, s.code.behind, s.code.uncommitted], [0, 0, 0]);
  assert.equal(s.code.line.level, 'ok');
  // A commit in the vault that is not pushed, a changed file, and the map that was rebuilt (not counted).
  writeFileSync(join(vault, 'people', 'bo.md'), 'more');
  git(vault, 'commit', '-q', '-am', 'Local');
  writeFileSync(join(vault, 'people', 'cy.md'), 'more');
  writeFileSync(join(vault, 'summaries', 'system-map.html'), 'rebuilt');
  // Two commits in the code that are not backed up, and a file that is not committed.
  writeFileSync(join(code.root, 'a.js'), '2');
  git(code.root, 'commit', '-q', '-am', 'Two');
  writeFileSync(join(code.root, 'a.js'), '3');
  git(code.root, 'commit', '-q', '-am', 'Three');
  writeFileSync(join(code.root, 'b.js'), '1');
  await system.checkSync();
  s = system.summary();
  assert.deepEqual([s.vault.ahead, s.vault.behind, s.vault.uncommitted, s.vault.mapUncommitted], [1, 0, 1, true]);
  assert.deepEqual(s.vault.changed, ['people/cy.md']);
  assert.equal(s.vault.line.text, 'Out of sync: 1 commit not pushed, 1 file changed and not committed.');
  assert.deepEqual([s.code.ahead, s.code.behind, s.code.uncommitted], [2, 0, 1]);
  assert.equal(s.code.line.text, 'Out of sync: 2 commits not pushed, 1 file changed and not committed.');
  // The remote cannot be reached: an error, not a crash, and the last counts stay visible.
  git(vault, 'remote', 'set-url', 'origin', join(vault, '..', 'gone.git'));
  await system.checkSync();
  s = system.summary();
  assert.match(s.vault.error, /fetch/);
  assert.equal(s.vault.line.level, 'bad');
  assert.equal(s.vault.ahead, 1);
});

test('the map rebuild runs the build command, keeps the last good map on a failure, and bumps the version', async () => {
  const { system, vault } = make({ system: { build: { cmd: 'sh', args: ['-c', 'printf "<p>Built now from the files</p>" > summaries/system-map.html'] } } });
  const v1 = system.version().version;
  await system.rebuild();
  assert.equal(system.mapHtml().html, '<p>Built now from the files</p>');
  assert.equal(system.summary().map.builtText, 'now');
  assert.equal(system.summary().map.build.error, null);
  assert.ok(system.version().version > v1);
  const broken = createSystem({ vault, local: join(vault, '..', 'local'), memoRoot: vault, build: { cmd: 'sh', args: ['-c', 'echo boom >&2; exit 3'] }, now: () => NOW, log: () => {} });
  await broken.rebuild();
  assert.match(broken.summary().map.build.error, /boom/);
  assert.equal(broken.mapHtml().html, '<p>Built now from the files</p>', 'the last good map stays');
});

test('the routes: the owner only, and the liaison token gets 403', async () => {
  const { system, vault } = make();
  const { app } = makeApp({ system });
  assert.equal((await call(app, '/api/system', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/system', undefined, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/system/file?id=lessons', undefined, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/system/map', undefined, LIAISON_TOKEN)).status, 403);
  const before = readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8');
  const save = { id: 'lessons', text: 'x', base: sha(before) };
  assert.equal((await call(app, '/api/system/save', save, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/system/save', save, null)).status, 401);
  assert.equal((await call(app, '/api/system/save', save, 'wrong-token-0123456789')).status, 401);
  assert.equal((await call(app, '/api/system/check', {}, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/system/rebuild', {}, LIAISON_TOKEN)).status, 403);
  assert.equal(readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8'), before, 'nothing was written');
  // The owner.
  const summary = await call(app, '/api/system');
  assert.equal(summary.status, 200);
  assert.equal(summary.data.dashboard.people, 3);
  assert.equal(summary.data.files.length, 9);
  const file = await call(app, '/api/system/file?id=charter:main');
  assert.equal(file.status, 200);
  assert.equal(file.data.hash, sha(file.data.text));
  assert.equal((await call(app, '/api/system/file?id=../.env')).status, 404);
  const stale = await call(app, '/api/system/save', { id: 'lessons', text: 'x', base: 'old' });
  assert.equal(stale.status, 409);
  assert.match(stale.data.error, /changed since you opened it/);
  const saved = await call(app, '/api/system/save', save);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.pushed, true);
  assert.equal(readFileSync(join(vault, 'scripts', 'lessons.md'), 'utf8'), 'x');
  const viewOnly = await call(app, '/api/system/save', { id: 'hand:botec', text: 'x', base: sha('x') });
  assert.equal(viewOnly.status, 403);
  assert.equal((await call(app, '/api/system/version')).data.version, (await call(app, '/api/system')).data.version);
  assert.equal((await call(app, '/api/system/map')).data.html.length > 0, true);
  assert.equal((await call(app, '/api/system/check', {})).data.vault.line.level, 'ok');
});

test('without a system the routes say so, and the page is served with the content rule', async () => {
  const { app } = makeApp();
  assert.equal((await call(app, '/api/system')).status, 503);
  const r = await app.request('/system');
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.match(text, /<title>Memo System<\/title>/);
  assert.match(text, /href="\/inbox"/);
  assert.match(text, /href="\/agents"/);
  assert.ok(text.includes('Pinned copy') === false, 'the note comes from the server, with the file');
  assert.match(r.headers.get('content-security-policy') || '', /frame-src 'none'/);
  for (const path of ['/inbox', '/agents']) assert.match(await (await app.request(path)).text(), /href="\/system"/);
});

test('the watch and the timers start and stop without a vault', () => {
  const base = mkdtempSync(join(tmpdir(), 'memo-system-none-'));
  const system = createSystem({ vault: join(base, 'none'), local: join(base, 'local'), memoRoot: base, build: NO_BUILD, log: () => {} });
  system.start();
  system.stop();
  assert.equal(system.summary().dashboard.people, 0);
  assert.equal(system.summary().map.exists, false);
  assert.ok(!existsSync(join(base, 'none')));
});

// ---------- a new agent skill, from a suggestion (memo 1418) ----------
const README = '# Skills\n\n## Schema for an agent skill\n\nFrontmatter:\n\n```\n---\nname: <kebab-case>\ndescription: Use when <trigger>. <one clause of what it covers>.\npurpose: <one sentence>\nhelper_model: <haiku | sonnet | opus | fable> <low | medium | high>\ncreated_by: agent\ncreated: YYYY-MM-DD\nlast_used: YYYY-MM-DD\nsource: memo <n>\n---\n```\n';

test('the template of a new skill follows the schema of skills/README.md, and has a default with no README', () => {
  const text = skillTemplate({ name: 'daily-review', description: 'Use when you prepare a "Daily review" memo.', category: 'ME', source: 'memo 1417', today: '2026-11-04', readme: README });
  const { data, body } = frontmatter(text);
  assert.deepEqual(Object.keys(data), ['name', 'description', 'category', 'purpose', 'helper_model', 'created_by', 'created', 'last_used', 'source'], 'the keys of the README in its order, with the category after the description');
  assert.equal(data.name, 'daily-review');
  assert.equal(data.description, 'Use when you prepare a "Daily review" memo.');
  assert.equal(data.category, 'ME');
  assert.equal(data.purpose, '<one sentence>', 'a key with no value keeps the hint of the README');
  assert.deepEqual([data.created, data.last_used, data.source], ['2026-11-04', '', 'memo 1417']);
  assert.ok(!/^model:/m.test(text), 'never a model key: Claude Code would switch the model of the agent');
  for (const section of ['## Goal', '## When to use', '## When not to use', '## Steps', '## Done when', '## Pitfalls']) assert.ok(body.includes(section), section);
  const bare = frontmatter(skillTemplate({ name: 'x-y', today: '2026-11-04' })).data;
  assert.deepEqual(Object.keys(bare), ['name', 'description', 'purpose', 'helper_model', 'model_why', 'created_by', 'created', 'last_used', 'source']);
  assert.match(bare.description, /^Use when </);
});

test('the draft of a new skill writes nothing, and its save goes through the safe save', async () => {
  const { system, vault, bare } = make();
  writeFileSync(join(vault, 'skills', 'README.md'), README);
  const draft = system.draft({ name: 'daily-review', description: 'Use when you prepare a "Daily review" memo.', category: 'ME', memo: '1417' });
  assert.deepEqual([draft.id, draft.isNew, draft.exists, draft.hash, draft.path], ['skill:daily-review', true, false, sha(''), join('skills', 'agent', 'daily-review', 'SKILL.md')]);
  assert.equal(draft.file, undefined, 'no absolute path goes to the page');
  assert.match(draft.text, /^---\nname: daily-review\ndescription: Use when you prepare a "Daily review" memo\.\ncategory: ME\n/);
  assert.match(draft.text, /\nsource: memo 1417\n/);
  assert.ok(!existsSync(join(vault, 'skills', 'agent', 'daily-review')), 'a draft makes no folder');
  // A draft for a skill that is there gives that skill and no text. Odd names, and a category that is no code, do nothing.
  assert.deepEqual([system.draft({ name: 'old-skill' }).exists, system.draft({ name: 'old-skill' }).text], [true, undefined]);
  for (const name of ['../x', 'Bad Name', 'a.b', '', undefined, 'agent']) assert.throws(() => system.draft({ name }), (e) => e.status === 400, `name ${JSON.stringify(name)}`);
  assert.ok(!system.draft({ name: 'zz', category: 'me; rm' }).text.includes('category:'));
  assert.throws(() => system.draft({ name: 'botec' }), (e) => e.status === 409 && /hand-made skill/.test(e.message), 'the name of a pinned skill is taken');
  // The read of a file that is not there stays a 404: only the draft and the save know a new skill.
  assert.throws(() => system.read('skill:daily-review'), (e) => e.status === 404);

  // The save: the name and the description are checked, the base is the hash of no file, and nothing is written on a refusal.
  await assert.rejects(system.save('skill:daily-review', draft.text.replace('name: daily-review', 'name: other'), draft.hash), (e) => e.status === 400 && /name is daily-review/.test(e.message));
  await assert.rejects(system.save('skill:daily-review', draft.text.replace('description: Use when', 'description: For when'), draft.hash), (e) => e.status === 400 && /Use when/.test(e.message));
  await assert.rejects(system.save('skill:daily-review', 'no frontmatter', draft.hash), (e) => e.status === 400);
  await assert.rejects(system.save('skill:daily-review', draft.text, sha('other')), (e) => e.status === 409);
  await assert.rejects(system.save('skill:botec', draft.text.replace('daily-review', 'botec'), draft.hash), (e) => e.status === 409);
  await assert.rejects(system.save('hand:daily-review', draft.text, draft.hash), (e) => e.status === 404, 'a hand-made skill is never made here');
  assert.ok(!existsSync(join(vault, 'skills', 'agent', 'daily-review')));
  const r = await system.save('skill:daily-review', draft.text, draft.hash);
  assert.deepEqual([r.ok, r.committed, r.pushed, r.error], [true, true, true, null]);
  assert.equal(readFileSync(join(vault, 'skills', 'agent', 'daily-review', 'SKILL.md'), 'utf8'), draft.text);
  assert.equal(git(vault, 'log', '-1', '--format=%s'), `Add ${join('skills', 'agent', 'daily-review', 'SKILL.md')} from the System page (the owner)`);
  assert.equal(git(vault, 'show', '--stat', '--format=', 'HEAD').split('\n').filter((l) => l.includes('|')).length, 1, 'that file alone');
  assert.equal(git(bare, 'rev-parse', 'main'), git(vault, 'rev-parse', 'HEAD'), 'pushed');
  // Now it is a file as any other: listed, readable, and a second save as new is stale.
  assert.ok(system.files().some((f) => f.id === 'skill:daily-review'));
  assert.equal(system.read('skill:daily-review').hash, r.hash);
  await assert.rejects(system.save('skill:daily-review', 'x', draft.hash), (e) => e.status === 409);
  // A name that is a link to a place outside is not a new skill.
  symlinkSync(join(vault, 'people'), join(vault, 'skills', 'agent', 'linked'));
  await assert.rejects(system.save('skill:linked', draft.text.replace('daily-review', 'linked'), draft.hash), (e) => e.status === 404);
  assert.ok(!existsSync(join(vault, 'people', 'SKILL.md')));
});

// ---------- memo 1513: the text before the latest change, for the dialog of the Inbox ----------
test('the text before the latest change of a live charter is the newest kept copy, and the page says when there is none', async () => {
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const { system, local } = make({ system: { now: () => new Date(clock) } });
  const first = readFileSync(join(local, 'charters', 'main.md'), 'utf8');
  // Nothing is kept yet, and the backup in the vault has no history either.
  const none = await system.previous('charter:main');
  assert.deepEqual([none.id, none.path, none.previous, none.hash], ['charter:main', join('local', 'charters', 'main.md'), null, sha(first)]);
  // Two saves: the text before the latest change is that of the first save, not the oldest one.
  const second = '# Charter: main\n\nYou do the work.\nAsk before a payment.\n';
  const third = '# Charter: main\n\nYou do the work.\nAsk before a payment over 50 dollars.\n';
  await system.save('charter:main', second, sha(first));
  clock += 60_000;
  await system.save('charter:main', third, sha(second));
  const found = await system.previous('charter:main');
  assert.equal(found.previous.text, second);
  assert.equal(found.previous.source, 'history');
  assert.equal(found.previous.at, '2026-11-04T12:01:00.000Z');
  assert.equal(found.previous.label, join('local', 'charters', '.history', 'main-2026-11-04T12-01-00-000Z.md'));
  assert.equal(found.hash, sha(third));
  // The kept copies of the charter main are not those of a charter whose name starts the same way.
  write(local, 'charters/.history/main-two-2026-11-05T12-00-00-000Z.md', 'the text of a different charter');
  write(local, 'charters/.history/main-notes.md', 'no kept copy at all');
  assert.equal((await system.previous('charter:main')).previous.text, second);
  // A file that is not on the page has no earlier text either.
  await assert.rejects(system.previous('charter:nobody'), (e) => e.status === 404);
  await assert.rejects(system.previous('../../etc/passwd'), (e) => e.status === 404);
});

test('a charter that an agent changes by hand keeps its old text, once, and a save of the page keeps no second copy', async () => {
  let clock = Date.parse('2026-11-04T12:00:00Z');
  const { system, local } = make({ system: { now: () => new Date(clock) } });
  const file = join(local, 'charters', 'main.md');
  const first = readFileSync(file, 'utf8');
  const kept = () => (existsSync(join(local, 'charters', '.history')) ? readdirSync(join(local, 'charters', '.history')) : []);
  system.noteCharters(); // the start of the server: the texts as they are
  system.noteCharters();
  assert.deepEqual(kept(), [], 'no change, nothing kept');
  // The agent edits the file, with no save of the page.
  clock += 60_000;
  writeFileSync(file, `${first}One more rule.\n`);
  system.noteCharters();
  system.noteCharters();
  assert.deepEqual(kept(), ['main-2026-11-04T12-01-00-000Z.md']);
  assert.equal(readFileSync(join(local, 'charters', '.history', kept()[0]), 'utf8'), first);
  assert.equal(readFileSync(file, 'utf8'), `${first}One more rule.\n`, 'the charter itself is not touched');
  const found = await system.previous('charter:main');
  assert.deepEqual([found.previous.text, found.previous.source], [first, 'history']);
  // A save of the page keeps the old text itself; the watch then finds nothing new.
  clock += 60_000;
  await system.save('charter:main', '# Charter: main\n\nNew.\n', found.hash);
  system.noteCharters();
  assert.equal(kept().length, 2);
});

test('the text before the latest change of a vault file comes from its git history, and of a skill also from its kept versions', async () => {
  const { system, vault } = make();
  const lessons = join(vault, 'scripts', 'lessons.md');
  const first = readFileSync(lessons, 'utf8');
  // One commit only, and the file as committed: no earlier text.
  assert.equal((await system.previous('lessons')).previous, null);
  // A change that is not committed yet: the committed text is the one before.
  const second = `${first}4. Spell out every step.\n`;
  writeFileSync(lessons, second);
  const open = await system.previous('lessons');
  assert.deepEqual([open.previous.text, open.previous.source, open.previous.at, open.previous.change], [first, 'git', null, null]);
  assert.match(open.previous.label, /^commit [0-9a-f]{8}$/);
  // Committed: the text before is that of the commit before, with the message and the time of the change.
  git(vault, 'commit', '-q', '-am', 'Lesson 4: spell out every step (memo 1489)');
  const done = await system.previous('lessons');
  assert.deepEqual([done.previous.text, done.previous.source, done.previous.change], [first, 'git', 'Lesson 4: spell out every step (memo 1489)']);
  assert.ok(!Number.isNaN(Date.parse(done.previous.at)));
  // A commit that does not change the file is not its latest change.
  write(vault, 'people/dee.md', '# dee');
  git(vault, 'add', '-A');
  git(vault, 'commit', '-q', '-m', 'A person');
  assert.equal((await system.previous('lessons')).previous.text, first);
  // A skill: a save of the page keeps the old text as a version and commits; the text before is the old text.
  const skillFile = join(vault, 'skills', 'agent', 'old-skill', 'SKILL.md');
  const old = readFileSync(skillFile, 'utf8');
  await system.save('skill:old-skill', `${old}\n## Steps\n\n1. One.\n`, sha(old));
  const saved = await system.previous('skill:old-skill');
  assert.equal(saved.previous.text, old);
  // A version kept by hand (scripts/skill-version) and an edit that is not committed: git knows the change too.
  const hand = join(vault, 'skills', 'botec', 'SKILL.md');
  const before = readFileSync(hand, 'utf8');
  writeFileSync(hand, `${before}\nA new line.\n`);
  assert.deepEqual([(await system.previous('hand:botec')).previous.text, (await system.previous('hand:botec')).previous.source], [before, 'git']);
});

test('with no git repository a skill still has the text before its change from its kept versions, and a file with none says so', async () => {
  const { system, vault } = make({ git: false });
  assert.equal((await system.previous('lessons')).previous, null);
  const skillFile = join(vault, 'skills', 'agent', 'old-skill', 'SKILL.md');
  const now = readFileSync(skillFile, 'utf8');
  write(vault, 'skills/.versions/old-skill/2026-11-01-0900-aaaaaaaa.md', 'the oldest text');
  write(vault, 'skills/.versions/old-skill/2026-11-03-0915-bbbbbbbb.md', 'the text before');
  write(vault, 'skills/.versions/old-skill/2026-11-04-0800-cccccccc.md', now); // the text of now, kept by a sync
  const found = await system.previous('skill:old-skill');
  assert.deepEqual([found.previous.text, found.previous.source, found.previous.label], ['the text before', 'versions', join('skills', '.versions', 'old-skill', '2026-11-03-0915-bbbbbbbb.md')]);
  assert.equal(found.previous.at, new Date('2026-11-03T09:15:00').toISOString());
});

test('the route of the text before the latest change: the owner only', async () => {
  const { system, vault } = make();
  const { app } = makeApp({ system });
  writeFileSync(join(vault, 'scripts', 'lessons.md'), 'A new text.\n');
  const r = await call(app, '/api/system/previous?id=lessons');
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.id, r.data.title, r.data.previous.source, r.data.hash], ['lessons', 'Shared lessons', 'git', sha('A new text.\n')]);
  assert.match(r.data.previous.text, /One question per memo/);
  assert.ok(!('file' in r.data), 'no path of the disk in the answer');
  assert.equal((await call(app, '/api/system/previous?id=lessons', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/system/previous?id=lessons', undefined, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/system/previous?id=nothing')).status, 404);
  assert.equal((await call(app, '/api/system/previous')).status, 400);
  assert.equal((await call(makeApp().app, '/api/system/previous?id=lessons')).status, 503);
});
