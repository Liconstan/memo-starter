import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshot, listVersions, readVersion, readRatings, makeRating, appendRating, ratingsOf, ratingsFile, lastNamed, usedDay, isOld, versionId, stamp, sha, hash8, OLD_WORDS } from '../src/skilllog.js';
import { buildRegistry, createRegistry, predictSkill, syncedSkills } from '../src/registry.js';
import { createSystem } from '../src/system.js';
import { syncSkills } from '../scripts/skills-sync.js';
import { skillCard, RATE_WORDS, OLD_WORDS as OLD_UI } from '../ui/skills.js';
import { modalTarget, ratingLine, ratedWords, versionLine, changeWords, timeWords } from '../ui/skillmodal.js';
import { hasPet } from '../ui/petview.js';
import { makeApp, call, LIAISON_TOKEN, WORKSTREAMS, ROOT } from './helpers.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (dir, rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const skill = (name, more = '', body = 'Body one.') => `---\nname: ${name}\ndescription: Use when ${name}.\n${more}---\n\n# ${name}\n\n${body}\n`;

// A vault with two agent skills and two hand-made ones, as a git repository with a bare "GitHub" next to it.
function makeVault({ withGit = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'memo-skilllog-'));
  const vault = join(base, 'vault');
  const local = join(base, 'local');
  mkdirSync(join(local, 'charters'), { recursive: true });
  write(vault, 'skills/README.md', '# Skills');
  write(vault, 'skills/agent/email-reply-drafts/SKILL.md', skill('email-reply-drafts', 'last_used: 2026-11-04\n'));
  write(vault, 'skills/agent/pledges-tab/SKILL.md', skill('pledges-tab', 'last_used: 2026-09-01\n'));
  write(vault, 'skills/agent/never-used/SKILL.md', skill('never-used'));
  write(vault, 'skills/botec/SKILL.md', skill('botec'));
  write(vault, 'skills/slack-post/SKILL.md', skill('slack-post'));
  write(vault, 'skills/course-dry-run/SKILL.md', skill('course-dry-run', 'last_used: 2026-11-09\n'));
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
const systemOf = (v) => createSystem({ vault: v.vault, local: v.local, memoRoot: v.base, now: () => NOW, log: () => {}, build: { cmd: 'true', args: [] } });

// ---------- the version log ----------
test('a snapshot keeps the old text under skills/.versions, once for each text, and the list is the newest first', () => {
  const { vault } = makeVault({ withGit: false });
  const at = new Date(2026, 10, 11, 9, 5);
  assert.equal(stamp(at), '2026-11-11-0905');
  const one = snapshot({ vault, name: 'botec', text: 'first text', at });
  assert.equal(one.rel, join('skills', '.versions', 'botec', `2026-11-11-0905-${hash8('first text')}.md`));
  assert.equal(one.written, true);
  assert.equal(read(vault, one.rel), 'first text');
  // The same text again, later: no second file.
  const again = snapshot({ vault, name: 'botec', text: 'first text', at: new Date(2026, 10, 12, 10, 0) });
  assert.deepEqual([again.written, again.rel], [false, one.rel]);
  snapshot({ vault, name: 'botec', text: 'second text', at: new Date(2026, 10, 12, 10, 0) });
  // A file that is not a version (a note someone left) is not in the list.
  write(vault, 'skills/.versions/botec/notes.txt', 'x');
  const list = listVersions(vault, 'botec');
  assert.deepEqual(list.map((v) => [v.at, v.hash8]), [['2026-11-12 10:00', hash8('second text')], ['2026-11-11 09:05', hash8('first text')]]);
  assert.equal(list[1].size, 10);
  assert.equal(readVersion(vault, 'botec', list[1].file), 'first text');
  // Only a version file of that skill can be read: no path, no other file.
  for (const file of ['../../botec/SKILL.md', 'notes.txt', '', null, '2026-11-11-0905-zzzzzzzz.md']) assert.equal(readVersion(vault, 'botec', file), null, String(file));
  assert.equal(readVersion(vault, '../botec', list[0].file), null);
  assert.deepEqual(listVersions(vault, 'no-such-skill'), []);
  assert.throws(() => snapshot({ vault, name: '../x', text: 'a' }), /Not the name of a skill/);
  assert.throws(() => snapshot({ vault, name: 'botec', text: '' }), /no text/);
  // The folder of the versions starts with a dot: it is no skill of the vault.
  const r = buildRegistry({ vault, local: join(vault, 'none'), home: join(vault, 'none'), workstreams: WORKSTREAMS, now: NOW });
  assert.ok(!r.skills.some((s) => s.name.includes('versions')));
});

// ---------- the ratings store ----------
test('a rating is one checked line of skills/ratings.jsonl, and the file only ever grows', () => {
  const { vault } = makeVault({ withGit: false });
  const text = read(vault, 'skills/botec/SKILL.md');
  const changed = new Date(2026, 10, 10, 8, 0);
  const r = makeRating({ skill: 'botec', kind: 'hand', text, changed, score: 4, notes: '  Shorter steps.\r\nName the sheet. ', memo: '1420', at: NOW });
  assert.deepEqual(r, { at: NOW.toISOString(), skill: 'botec', kind: 'hand', version: `2026-11-10-${hash8(text)}`, hash: sha(text), score: 4, notes: 'Shorter steps.\nName the sheet.', memo: 1420 });
  assert.equal(versionId(text, changed), r.version);
  for (const [bad, why] of [[{ score: 0 }, /1 to 5/], [{ score: 6 }, /1 to 5/], [{ score: 2.5 }, /1 to 5/], [{ score: 'x' }, /1 to 5/], [{ skill: 'Bad Name' }, /name of the skill/],
    [{ memo: 'abc' }, /memo/], [{ notes: 'x'.repeat(4001) }, /too long/]]) {
    assert.throws(() => makeRating({ skill: 'botec', text, score: 3, ...bad }), why);
  }
  assert.equal(makeRating({ skill: 'botec', text, score: '5' }).memo, null, 'a rating that is not from a memo');
  // The file: a line that was there stays as it is, a missing last line break is repaired, a broken line is skipped.
  const file = ratingsFile(vault);
  writeFileSync(file, `${JSON.stringify({ at: '2026-11-01T00:00:00.000Z', skill: 'botec', kind: 'hand', version: 'v', hash: 'h', score: 2, notes: 'old', memo: null })}\nnot json`);
  const before = readFileSync(file, 'utf8');
  appendRating(vault, r);
  appendRating(vault, makeRating({ skill: 'pledges-tab', text: 'x', score: 5, at: NOW }));
  const after = readFileSync(file, 'utf8');
  assert.ok(after.startsWith(`${before}\n`), 'the old lines are untouched');
  assert.ok(after.endsWith('\n'));
  const all = readRatings(vault);
  assert.deepEqual(all.map((x) => [x.skill, x.score]), [['botec', 2], ['botec', 4], ['pledges-tab', 5]]);
  // The ratings of one skill, the newest first, with the mark of the text it has now.
  assert.deepEqual(ratingsOf(all, 'botec', sha(text)).map((x) => [x.score, x.current]), [[4, true], [2, false]]);
  assert.deepEqual(readRatings(join(vault, 'none')), []);
});

// ---------- the old mark ----------
test('the day a skill was last used: its own key, or for a hand-made skill the newest memo or rating that names it', () => {
  assert.equal(usedDay({ kind: 'agent', lastUsed: '2026-11-04' }), '2026-11-04');
  assert.equal(usedDay({ kind: 'agent', lastUsed: null, named: '2026-11-10T00:00:00Z', rated: '2026-11-10T00:00:00Z' }), null, 'an agent skill says it itself, or not at all');
  assert.equal(usedDay({ kind: 'hand', lastUsed: '2026-10-01', named: '2026-11-10T00:00:00Z' }), '2026-10-01', 'the key of the skill wins');
  assert.equal(usedDay({ kind: 'hand', named: '2026-11-02T09:00:00Z', rated: '2026-11-08T09:00:00Z' }), '2026-11-08');
  assert.equal(usedDay({ kind: 'hand', named: '2026-11-02T09:00:00Z' }), '2026-11-02');
  assert.equal(usedDay({ kind: 'hand', lastUsed: 'soon' }), null);
  // Old: over 30 days, or never.
  assert.deepEqual([isOld('2026-10-12', NOW), isOld('2026-10-11', NOW), isOld(null, NOW), isOld('2026-11-11', NOW)], [false, true, true, false]);
  assert.equal(OLD_WORDS, 'Old · may change');
  // Named: the name as a word of its own, in a closed memo; the newest one counts.
  const named = lastNamed(['botec', 'slack-post', 'course-dry-run'], [
    { closed: '2026-11-01T10:00:00Z', text: 'the botec for the rfp is done' },
    { closed: '2026-10-01T10:00:00Z', text: 'botec again' },
    { closed: '2026-11-05T10:00:00Z', text: 'ten botecs and my-slack-post-2, neither is a name' },
    { closed: null, text: 'slack-post in a memo with no close time' },
    { closed: '2026-11-03T10:00:00Z', text: 'used `slack-post`.' },
  ]);
  assert.deepEqual([...named], [['botec', '2026-11-01T10:00:00Z'], ['slack-post', '2026-11-03T10:00:00Z']]);
});

test('the registry marks a skill old, and says whether she rated the text it has now', () => {
  const { vault, local, base } = makeVault({ withGit: false });
  const home = join(base, 'home');
  const of = (mentions) => Object.fromEntries(buildRegistry({ vault, local, home, workstreams: WORKSTREAMS, now: NOW, mentions }).skills.map((s) => [s.name, s]));
  let by = of(null);
  // Agent skills: by their key. Hand-made: by their key, else old, with no memo and no rating that names them.
  assert.deepEqual([by['email-reply-drafts'].old, by['pledges-tab'].old, by['never-used'].old], [false, true, true]);
  assert.deepEqual([by['email-reply-drafts'].used, by['never-used'].used], ['2026-11-04', null]);
  assert.deepEqual([by.botec.old, by['slack-post'].old, by['course-dry-run'].old, by['course-dry-run'].used], [true, true, false, '2026-11-09']);
  assert.ok(Object.values(by).every((s) => s.rated === false && s.ratings === 0 && s.lastScore === null && /^[0-9a-f]{8}$/.test(s.version)));
  assert.ok(Object.values(by).every((s) => s.lastRated === undefined && s.lastUsedKey === undefined), 'the working fields stay inside');
  // A closed memo names botec; a memo of 40 days ago names slack-post, which is still old.
  by = of(() => [{ closed: '2026-11-08T10:00:00Z', text: 'ran botec' }, { closed: '2026-10-01T10:00:00Z', text: 'slack-post' }]);
  assert.deepEqual([by.botec.old, by.botec.used, by['slack-post'].old, by['slack-post'].used], [false, '2026-11-08', true, '2026-10-01']);
  // A list of memos that cannot be read changes nothing.
  assert.equal(of(() => { throw new Error('no database'); }).botec.old, true);
  // A rating of the text of now: rated, and a use of a hand-made skill. A rating does not make an agent skill new.
  appendRating(vault, makeRating({ skill: 'slack-post', kind: 'hand', text: read(vault, 'skills/slack-post/SKILL.md'), score: 3, at: new Date('2026-11-10T12:00:00Z') }));
  appendRating(vault, makeRating({ skill: 'pledges-tab', text: 'a text it had before', score: 2, at: new Date('2026-11-10T12:00:00Z') }));
  by = of(null);
  assert.deepEqual([by['slack-post'].rated, by['slack-post'].ratings, by['slack-post'].lastScore, by['slack-post'].old, by['slack-post'].used], [true, 1, 3, false, '2026-11-10']);
  assert.deepEqual([by['pledges-tab'].rated, by['pledges-tab'].ratings, by['pledges-tab'].lastScore, by['pledges-tab'].old], [false, 1, 2, true], 'a rating of an older text is not a rating of this one');
  // The prediction of a memo carries the marks for the card.
  const r = buildRegistry({ vault, local, home, workstreams: WORKSTREAMS, now: NOW });
  const p = predictSkill({ title: 'Pledges tab: one new pledge', text: 'The pledges tab has a new row.', ws: 'OPS' }, r);
  assert.deepEqual([p.skill, p.rated, p.old, p.ratable], ['pledges-tab', false, true, true]);
  // The registry of the server takes the closed memos of the app.
  const live = createRegistry({ vault, local, home, workstreams: WORKSTREAMS, now: () => NOW });
  assert.equal(live.get().skills.find((s) => s.name === 'botec').old, true);
  live.setMentions(() => [{ closed: '2026-11-09T10:00:00Z', text: 'botec' }]);
  assert.equal(live.get().skills.find((s) => s.name === 'botec').old, false);
});

// ---------- the save keeps the old text, and the rating is committed ----------
test('a save of a skill keeps the old text as a version in the same commit; a new skill and a save with no change keep nothing', async () => {
  const v = makeVault();
  const system = systemOf(v);
  const id = 'skill:email-reply-drafts';
  const first = system.read(id);
  const next = first.text.replace('Body one.', 'Body two.');
  const saved = await system.save(id, next, first.hash);
  assert.equal(saved.pushed, true);
  const kept = join('skills', '.versions', 'email-reply-drafts', `${stamp(NOW)}-${hash8(first.text)}.md`);
  assert.deepEqual(saved.kept, [kept]);
  assert.equal(read(v.vault, kept), first.text);
  // One commit with the skill and its old version, on GitHub too.
  assert.deepEqual(git(v.vault, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), [kept, 'skills/agent/email-reply-drafts/SKILL.md'].sort());
  assert.equal(git(v.bare, 'rev-parse', 'main'), git(v.vault, 'rev-parse', 'HEAD'));
  assert.equal(git(v.vault, 'status', '--porcelain'), '');
  // Back to the first text: the second text is kept; the first is in the log already, and is not written again.
  const back = await system.save(id, first.text, saved.hash);
  assert.equal(back.kept.length, 1);
  await system.save(id, next, back.hash);
  assert.deepEqual(listVersions(v.vault, 'email-reply-drafts').map((x) => x.hash8).sort(), [hash8(first.text), hash8(next)].sort());
  // The same text again: nothing to keep. A new skill: nothing to keep.
  assert.deepEqual((await system.save(id, next, sha(next))).kept, []);
  const draft = system.draft({ name: 'daily-review', description: 'Use when you prepare the daily review.' });
  assert.deepEqual((await system.save('skill:daily-review', draft.text, draft.hash)).kept, []);
  assert.ok(!existsSync(join(v.vault, 'skills', '.versions', 'daily-review')));
  // A stale save keeps nothing and writes nothing.
  await assert.rejects(system.save('skill:pledges-tab', 'x', sha('not the text')), /changed since you opened it/);
  assert.ok(!existsSync(join(v.vault, 'skills', '.versions', 'pledges-tab')));
});

test('a rating is appended, committed alone and pushed; the log of a skill has its versions with their ratings', async () => {
  const v = makeVault();
  const system = systemOf(v);
  const id = 'skill:email-reply-drafts';
  const first = system.read(id);
  const one = await system.rate({ name: 'email-reply-drafts', score: 2, notes: 'Too long.', memo: 7 });
  assert.deepEqual([one.ok, one.committed, one.pushed, one.error], [true, true, true, null]);
  assert.deepEqual([one.rating.skill, one.rating.kind, one.rating.score, one.rating.notes, one.rating.memo, one.rating.hash], ['email-reply-drafts', 'agent', 2, 'Too long.', 7, first.hash]);
  assert.deepEqual(git(v.vault, 'show', '--name-only', '--format=%s', 'HEAD').split('\n').filter(Boolean), ['Rating of the skill email-reply-drafts: 2 of 5 (the owner)', 'skills/ratings.jsonl']);
  assert.equal(git(v.bare, 'rev-parse', 'main'), git(v.vault, 'rev-parse', 'HEAD'));
  // A new text, then a rating of it; a hand-made skill can be rated too, though its text is view only.
  const next = first.text.replace('Body one.', 'Body two.');
  await system.save(id, next, first.hash);
  await system.rate({ name: 'email-reply-drafts', score: 5, notes: '' });
  const hand = await system.rate({ name: 'botec', score: 3, notes: 'Name the sheet.' });
  assert.equal(hand.rating.kind, 'hand');
  await assert.rejects(system.save('hand:botec', 'x', system.read('hand:botec').hash), /view-only/);
  assert.equal(readFileSync(ratingsFile(v.vault), 'utf8').trim().split('\n').length, 3);
  const log = system.skillLog('email-reply-drafts');
  assert.deepEqual([log.name, log.id, log.kind, log.editable], ['email-reply-drafts', id, 'agent', true]);
  assert.deepEqual([log.current.hash8, log.current.rated, log.current.ratings.map((r) => r.score)], [hash8(next), true, [5]]);
  assert.deepEqual(log.versions.map((x) => [x.hash8, x.ratings.map((r) => [r.score, r.notes, r.memo])]), [[hash8(first.text), [[2, 'Too long.', 7]]]]);
  assert.deepEqual(log.ratings.map((r) => [r.score, r.current]), [[5, true], [2, false]]);
  assert.ok(!JSON.stringify(log).includes('Body'), 'the log has no text of a skill');
  assert.equal(system.skillVersion('email-reply-drafts', log.versions[0].file).text, first.text);
  assert.throws(() => system.skillVersion('email-reply-drafts', '../../../README.md'), /No such old version/);
  assert.deepEqual([system.skillLog('botec').kind, system.skillLog('botec').editable, system.skillLog('botec').current.rated], ['hand', false, true]);
  // What is refused: a wrong score, a skill that is not there, an odd name. Nothing is written then.
  await assert.rejects(system.rate({ name: 'botec', score: 9 }), /Nothing was saved.*1 to 5/);
  assert.throws(() => system.rate({ name: 'no-such-skill', score: 3 }), /No skill no-such-skill/);
  assert.throws(() => system.rate({ name: '../x', score: 3 }), /name of the skill/);
  assert.throws(() => system.skillLog('agent'), /No skill agent/);
  assert.equal(readFileSync(ratingsFile(v.vault), 'utf8').trim().split('\n').length, 3);
  assert.equal(git(v.vault, 'status', '--porcelain'), '');
});

test('a rating is never lost: with no GitHub it is written and committed on the Mac, and the result says so', async () => {
  const v = makeVault();
  const system = systemOf(v);
  git(v.vault, 'remote', 'set-url', 'origin', join(v.base, 'gone.git'));
  const r = await system.rate({ name: 'botec', score: 1, notes: 'Wrong numbers.' });
  assert.deepEqual([r.ok, r.committed, r.pushed], [true, true, false]);
  assert.match(r.error, /push to GitHub failed|saved on the Mac/);
  assert.equal(readRatings(v.vault).length, 1);
  assert.equal(git(v.vault, 'status', '--porcelain'), '');
});

// ---------- the routes ----------
test('the rating route: the owner only; words send one memo to the agent, in SYS, that asks for the new version', async () => {
  const v = makeVault();
  const system = systemOf(v);
  const registry = createRegistry({ vault: v.vault, local: v.local, home: join(v.base, 'home'), workstreams: WORKSTREAMS, now: () => NOW });
  const { app, store } = makeApp({ system, registry });
  const from = store.send({ from: 'main', to: 'cam', text: '**The pledges tab has one new row.**', title: 'Pledges tab: one new pledge', impact: 3, effort: 'short' }).memo;
  // A rating with words: the line in the vault, and one memo from her to main.
  const rated = await call(app, '/api/skills/rate', { name: 'pledges-tab', score: 2, notes: 'Ask me before a new column.\nKeep the legal name.', memo: from.id });
  assert.equal(rated.status, 200);
  assert.deepEqual([rated.data.rating.score, rated.data.rating.memo, rated.data.pushed], [2, from.id, true]);
  const sent = store.get(rated.data.memo.id);
  assert.deepEqual([sent.sender, sent.recipient, sent.title, sent.ws, rated.data.memo.to], ['cam', 'main', 'Skill feedback: pledges-tab', 'SYS', 'main']);
  for (const part of ['rated the skill `pledges-tab` 2 of 5', `She rated it from memo ${from.id}.`, '> Ask me before a new column.\n> Keep the legal name.', `version ${rated.data.rating.version}`,
    'scripts/skill-version pledges-tab', 'skills/agent/pledges-tab/SKILL.md', 'skills/ratings.jsonl']) assert.ok(sent.text.includes(part), part);
  assert.deepEqual(sent.re, [from.id], 'the feedback is in the thread of the memo she rated from');
  // A rating with no words: the line, and no memo. A hand-made skill: the memo names its pinned copy.
  const count = () => store.list('main').length;
  const before = count();
  const quiet = await call(app, '/api/skills/rate', { name: 'pledges-tab', score: 5, notes: '   ' });
  assert.deepEqual([quiet.status, quiet.data.memo, count()], [200, null, before]);
  const hand = await call(app, '/api/skills/rate', { name: 'botec', score: 3, notes: 'Name the sheet.' });
  assert.ok(store.get(hand.data.memo.id).text.includes('skills/botec/SKILL.md') && store.get(hand.data.memo.id).text.includes('hand-made skill'));
  assert.equal(count(), before + 1);
  assert.equal(readRatings(v.vault).length, 3);
  // The registry reads the files again: the card of the Inbox stops asking for a rating, and the skill is in use.
  const list = (await call(app, '/api/skills')).data.skills;
  assert.deepEqual([list.find((s) => s.name === 'pledges-tab').rated, list.find((s) => s.name === 'botec').rated, list.find((s) => s.name === 'botec').old], [true, true, false]);
  const p = (await call(app, '/api/skills/predictions')).data.predictions[from.id];
  assert.deepEqual([p.skill, p.rated, p.ratable], ['pledges-tab', true, true]);
  // The log and one old version.
  const log = await call(app, '/api/skills/log?name=pledges-tab');
  assert.deepEqual([log.status, log.data.current.rated, log.data.ratings.length, log.data.versions.length], [200, true, 2, 0]);
  assert.equal((await call(app, '/api/skills/version?name=pledges-tab&file=2026-11-11-0900-aaaaaaaa.md')).status, 404);
  // What is refused.
  assert.equal((await call(app, '/api/skills/rate', { name: 'pledges-tab', score: 7 })).status, 400);
  assert.equal((await call(app, '/api/skills/rate', { name: 'nope', score: 3 })).status, 404);
  assert.equal((await call(app, '/api/skills/log?name=../x')).status, 400);
  for (const [path, body] of [['/api/skills/rate', { name: 'botec', score: 3 }], ['/api/skills/log?name=botec'], ['/api/skills/version?name=botec&file=x']]) {
    assert.equal((await call(app, path, body, LIAISON_TOKEN)).status, 403, path);
    assert.equal((await call(app, path, body, '')).status, 401, path);
    assert.equal((await call(makeApp().app, path, body)).status, 503, path);
  }
  assert.equal(readRatings(v.vault).length, 3);
  // Nothing of the ratings goes to the GitHub copy of the Inbox, and the dialog is a file of the pages.
  assert.ok(!readFileSync(join(ROOT, 'src', 'ledger.js'), 'utf8').includes('/api/skills'));
  assert.equal((await app.request('/ui/skillmodal.js')).status, 200);
  // A closed memo that names a hand-made skill makes it a skill in use.
  assert.equal(list.find((s) => s.name === 'slack-post').old, true);
  const m = store.send({ from: 'main', to: 'cam', text: 'Posted with slack-post.', title: 'Slack post', impact: 2, effort: 'micro' }).memo;
  store.close(m.id);
  registry.refresh();
  assert.equal((await call(app, '/api/skills')).data.skills.find((s) => s.name === 'slack-post').old, false);
});

// ---------- the nightly sync of the hand-made skills ----------
function makeAccounts() {
  const v = makeVault({ withGit: false });
  const home = join(v.base, 'home');
  const first = join(home, '.claude', 'skills');
  const bucket = join(first, 'synced', 'bucket');
  const day = (iso) => new Date(iso);
  const put = (dir, rel, text, at) => { write(dir, rel, text); utimesSync(join(dir, rel), day(at), day(at)); };
  // The vault: botec (same text as the account), slack-post (an agent changed it later), course-dry-run (old).
  put(v.vault, 'skills/botec/SKILL.md', skill('botec'), '2026-09-24T00:00:00Z');
  put(v.vault, 'skills/slack-post/SKILL.md', skill('slack-post', '', 'The agent added a line.'), '2026-11-03T00:00:00Z');
  put(v.vault, 'skills/slack-post/references/guide.md', 'guide', '2026-09-24T00:00:00Z');
  put(v.vault, 'skills/course-dry-run/SKILL.md', skill('course-dry-run', '', 'Old course text.'), '2026-09-24T00:00:00Z');
  put(v.vault, 'skills/course-dry-run/references/old.md', 'gone in the new one', '2026-09-24T00:00:00Z');
  // The first account, synced by claude.ai today: every file has the time of the download.
  for (const [name, body] of [['botec', 'Body one.'], ['slack-post', 'Body one.'], ['course-dry-run', 'She changed the course skill.'], ['finance-copilot', 'Only in her account.'], ['docx', 'Comes with Claude.']]) {
    put(bucket, `${name}/SKILL.md`, skill(name, '', body), '2026-11-11T09:00:00Z');
  }
  put(bucket, 'slack-post/references/guide.md', 'guide', '2026-11-11T09:00:00Z');
  put(bucket, 'finance-copilot/references/close.md', 'checklist', '2026-11-11T09:00:00Z');
  put(bucket, 'finance-copilot/.DS_Store', 'junk', '2026-11-11T09:00:00Z');
  write(bucket, 'manifest.json', JSON.stringify({ skills: [
    { name: 'botec', source: 'plugin', updatedAt: '2026-03-02T00:00:00Z' }, { name: 'slack-post', source: 'plugin', updatedAt: '2026-09-21T00:00:00Z' },
    { name: 'course-dry-run', source: 'plugin', updatedAt: '2026-11-10T00:00:00Z' }, { name: 'finance-copilot', source: 'plugin', updatedAt: '2026-11-04T00:00:00Z' },
    { name: 'docx', source: 'anthropic', updatedAt: '2026-11-06T00:00:00Z' },
  ] }));
  write(bucket, '.last-complete-round', 'x');
  // A skill folder of her own next to the synced ones, and a skill that has the name of an agent skill.
  put(first, 'merge-helper/SKILL.md', skill('merge-helper'), '2026-07-07T00:00:00Z');
  put(first, 'pledges-tab/SKILL.md', skill('pledges-tab', '', 'A stray copy.'), '2026-11-10T00:00:00Z');
  // The second account: only what comes with Claude, in its own synced folder.
  write(join(home, '.claude-second', 'skills', 'synced', 'bucket'), 'docx/SKILL.md', skill('docx'));
  write(join(home, '.claude-second', 'skills', 'synced', 'bucket'), 'manifest.json', JSON.stringify({ skills: [{ name: 'docx', source: 'anthropic' }] }));
  return { ...v, home, bucket, second: join(home, '.claude-second', 'skills') };
}
// The files of a folder, as paths inside it.
const tree = (dir, sub = '') => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort().flatMap((n) => {
  const rel = sub ? join(sub, n) : n;
  return statSync(join(dir, rel)).isDirectory() ? tree(dir, rel) : [rel];
}) : []);

test('the skills sync takes the newest copy of each hand-made skill to the vault and the personal skills of both accounts', () => {
  const a = makeAccounts();
  const first = join(a.home, '.claude', 'skills');
  const before = tree(join(first, 'synced'));
  const synced = syncedSkills(join(a.home, '.claude'));
  assert.deepEqual([...synced.keys()], ['botec', 'course-dry-run', 'finance-copilot', 'slack-post']);
  assert.equal(synced.get('botec').updatedAt, '2026-03-02T00:00:00Z');
  // A dry run says what it would do, and writes nothing.
  const dry = syncSkills({ vault: a.vault, home: a.home, dryRun: true, now: NOW });
  assert.equal(dry.line, 'skills-sync (dry run): 5 hand-made | vault updated 3 | first account updated 4 | second account updated 5 | old versions kept 1 | claude.ai copy behind 1 (slack-post)');
  assert.deepEqual(readdirSync(first).sort(), ['merge-helper', 'pledges-tab', 'synced'], 'a dry run adds no personal skill');
  assert.ok(!existsSync(a.second.replace(/skills$/, join('skills', 'botec'))));
  assert.ok(!existsSync(join(a.vault, 'skills', '.versions')));
  assert.equal(read(a.vault, 'skills/course-dry-run/SKILL.md'), skill('course-dry-run', '', 'Old course text.'));
  // The run.
  const run = syncSkills({ vault: a.vault, home: a.home, now: NOW });
  assert.equal(run.line, 'skills-sync: 5 hand-made | vault updated 3 | first account updated 4 | second account updated 5 | old versions kept 1 | claude.ai copy behind 1 (slack-post)');
  const by = Object.fromEntries(run.skills.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(by), ['botec', 'course-dry-run', 'finance-copilot', 'merge-helper', 'slack-post'], 'no skill that comes with Claude, and no name of an agent skill');
  // The same text in both places: the vault is the copy that counts, and both accounts get it as a personal skill.
  assert.deepEqual([by.botec.from, by.botec.wrote, by.botec.behind], ['vault', ['local', 'second'], false]);
  assert.equal(read(first, 'botec/SKILL.md'), skill('botec'));
  // The vault copy is the newer one (an agent changed it after her last change in the account): it wins, and the
  // copy of claude.ai is behind. The time of the download of the synced files does not count. The first account
  // gets the vault text as a personal skill, next to the older synced one, which stays as it was.
  assert.deepEqual([by['slack-post'].from, by['slack-post'].wrote, by['slack-post'].behind], ['vault', ['local', 'second'], true]);
  assert.equal(read(first, 'slack-post/SKILL.md'), skill('slack-post', '', 'The agent added a line.'));
  assert.equal(read(first, 'slack-post/references/guide.md'), 'guide');
  assert.equal(read(a.bucket, 'slack-post/SKILL.md'), skill('slack-post', '', 'Body one.'));
  assert.equal(read(a.second, 'slack-post/SKILL.md'), skill('slack-post', '', 'The agent added a line.'));
  assert.equal(read(a.second, 'slack-post/references/guide.md'), 'guide');
  // She changed the skill in her account after the vault copy: the synced copy wins, and the old vault text is kept.
  assert.deepEqual([by['course-dry-run'].from, by['course-dry-run'].wrote], ['synced', ['vault', 'local', 'second']]);
  assert.equal(read(a.vault, 'skills/course-dry-run/SKILL.md'), skill('course-dry-run', '', 'She changed the course skill.'));
  const old = skill('course-dry-run', '', 'Old course text.');
  assert.deepEqual(by['course-dry-run'].kept, [join('skills', '.versions', 'course-dry-run', `${stamp(NOW)}-${hash8(old)}.md`)]);
  assert.equal(read(a.vault, by['course-dry-run'].kept[0]), old);
  // A file of the old folder that the new one does not have goes, after a copy of it is kept next to the version.
  assert.ok(!existsSync(join(a.vault, 'skills', 'course-dry-run', 'references', 'old.md')));
  assert.equal(read(a.vault, join('skills', '.versions', 'course-dry-run', `${stamp(NOW)}-${hash8(old)}.files`, 'references', 'old.md')), 'gone in the new one');
  // A skill that is only in her account is pinned in the vault, with its other files and without the dot files.
  assert.deepEqual([by['finance-copilot'].from, by['finance-copilot'].wrote], ['synced', ['vault', 'local', 'second']]);
  assert.deepEqual(tree(join(first, 'finance-copilot')), ['SKILL.md', join('references', 'close.md')]);
  assert.deepEqual(tree(join(a.vault, 'skills', 'finance-copilot')), ['SKILL.md', join('references', 'close.md')]);
  assert.deepEqual([by['merge-helper'].from, by['merge-helper'].wrote], ['local', ['vault', 'second']]);
  assert.deepEqual(readdirSync(a.second).sort(), ['botec', 'course-dry-run', 'finance-copilot', 'merge-helper', 'slack-post', 'synced']);
  // The first account has every hand-made skill as a personal skill; the stray copy of an agent skill is untouched.
  assert.deepEqual(readdirSync(first).sort(), ['botec', 'course-dry-run', 'finance-copilot', 'merge-helper', 'pledges-tab', 'slack-post', 'synced']);
  assert.equal(read(first, 'pledges-tab/SKILL.md'), skill('pledges-tab', '', 'A stray copy.'));
  // The synced folders of both accounts are as they were.
  assert.deepEqual(tree(join(first, 'synced')), before);
  assert.deepEqual(readdirSync(join(a.second, 'synced', 'bucket')), ['docx', 'manifest.json']);
  assert.equal(read(a.vault, 'skills/agent/pledges-tab/SKILL.md'), skill('pledges-tab', 'last_used: 2026-09-01\n'));
  // The registry now finds every hand-made skill in all agents.
  write(a.local, 'agents.json', JSON.stringify([{ name: 'main', kind: 'long', dir: '~/memo-work' }, { name: 'second', kind: 'long', dir: '~/memo-work', env: { CLAUDE_CONFIG_DIR: '~/.claude-second' } }]));
  const r = buildRegistry({ vault: a.vault, local: a.local, home: a.home, workstreams: WORKSTREAMS, now: NOW });
  assert.deepEqual(r.skills.filter((s) => s.kind === 'hand').map((s) => [s.name, s.access, s.pinned]), ['botec', 'course-dry-run', 'finance-copilot', 'merge-helper', 'slack-post'].map((n) => [n, 'all', true]));

  // A second run right after: nothing to do.
  const again = syncSkills({ vault: a.vault, home: a.home, now: NOW });
  assert.equal(again.line, 'skills-sync: 5 hand-made | vault updated 0 | first account updated 0 | second account updated 0 | old versions kept 0 | claude.ai copy behind 1 (slack-post)');
  // claude.ai downloads its copies again (new file times, the same text): still nothing, the vault text stays.
  const later = new Date('2026-11-12T09:00:00Z');
  utimesSync(join(a.bucket, 'slack-post', 'SKILL.md'), later, later);
  assert.equal(syncSkills({ vault: a.vault, home: a.home, now: NOW }).skills.find((s) => s.name === 'slack-post').wrote.length, 0);
  // The second agent edits its copy: that copy is the one that changed, so it goes to the vault, whose text is kept.
  const edited = skill('botec', '', 'Darkness fixed a step.');
  writeFileSync(join(a.second, 'botec', 'SKILL.md'), edited);
  utimesSync(join(a.second, 'botec', 'SKILL.md'), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
  const third = syncSkills({ vault: a.vault, home: a.home, now: NOW });
  assert.deepEqual([third.skills.find((s) => s.name === 'botec').from, third.skills.find((s) => s.name === 'botec').wrote], ['second', ['vault', 'local']]);
  assert.equal(read(a.vault, 'skills/botec/SKILL.md'), edited);
  assert.equal(read(first, 'botec/SKILL.md'), edited);
  assert.deepEqual(listVersions(a.vault, 'botec').map((x) => x.hash8), [hash8(skill('botec'))]);
  // Both the vault and the second copy change: the later change wins, and on the same time the vault.
  const inVault = skill('botec', '', 'Edited in the editor.');
  const inSecond = skill('botec', '', 'Edited by Darkness.');
  const same = new Date('2026-11-12T10:00:00Z');
  writeFileSync(join(a.vault, 'skills', 'botec', 'SKILL.md'), inVault);
  writeFileSync(join(a.second, 'botec', 'SKILL.md'), inSecond);
  for (const f of [join(a.vault, 'skills', 'botec', 'SKILL.md'), join(a.second, 'botec', 'SKILL.md')]) utimesSync(f, same, same);
  const fourth = syncSkills({ vault: a.vault, home: a.home, now: NOW });
  assert.deepEqual([fourth.skills.find((s) => s.name === 'botec').from, fourth.skills.find((s) => s.name === 'botec').wrote], ['vault', ['local', 'second']]);
  assert.equal(read(a.second, 'botec/SKILL.md'), inVault);
  assert.equal(read(first, 'botec/SKILL.md'), inVault);
  // Main edits its personal copy: that copy goes to the vault and the second account, and the vault text is kept.
  const inFirst = skill('botec', '', 'Peeve fixed a step.');
  writeFileSync(join(first, 'botec', 'SKILL.md'), inFirst);
  const fifth = syncSkills({ vault: a.vault, home: a.home, now: NOW }).skills.find((s) => s.name === 'botec');
  assert.deepEqual([fifth.from, fifth.wrote, fifth.behind], ['local', ['vault', 'second'], true]);
  assert.equal(read(a.vault, 'skills/botec/SKILL.md'), inFirst);
  assert.ok(listVersions(a.vault, 'botec').some((x) => x.hash8 === hash8(inVault)));
  assert.deepEqual(tree(join(first, 'synced')), before, 'no run ever writes into a synced folder');
  assert.ok(listVersions(a.vault, 'botec').some((x) => x.hash8 === hash8(inSecond)), 'the text of the second account that lost is kept');
});

test('the commands: skills-sync prints its count on the last line, and skill-version keeps the text of a skill', () => {
  const a = makeAccounts();
  const env = { ...process.env, HOME: a.home, MEMO_VAULT: a.vault };
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'skills-sync.js'), '--dry-run'], { env, encoding: 'utf8' }).trim().split('\n');
  assert.equal(out.length, 6);
  assert.match(out[0], /^botec: newest is the vault copy \(of vault, synced\); would copy to first and second$/);
  assert.match(out.at(-1), /^skills-sync \(dry run\): 5 hand-made \| vault updated 3 \| first account updated 4 \| second account updated 5 \|/);
  assert.equal(execFileSync(process.execPath, [join(ROOT, 'scripts', 'skills-sync.js'), '--quiet'], { env, encoding: 'utf8' }).trim().split('\n').length, 1);
  assert.throws(() => execFileSync(process.execPath, [join(ROOT, 'scripts', 'skills-sync.js'), '--force'], { env, encoding: 'utf8', stdio: 'pipe' }), /Usage/);
  // skill-version: an agent skill, then a hand-made one, then the same again.
  const keep = (...args) => execFileSync(join(ROOT, 'scripts', 'skill-version'), args, { env, encoding: 'utf8', stdio: 'pipe' }).trim();
  const first = keep('pledges-tab');
  assert.match(first, /^Kept: skills\/\.versions\/pledges-tab\/\d{4}-\d\d-\d\d-\d{4}-[0-9a-f]{8}\.md$/);
  assert.equal(read(a.vault, first.slice('Kept: '.length)), read(a.vault, 'skills/agent/pledges-tab/SKILL.md'));
  assert.match(keep('botec', '--vault', a.vault), /^Kept: skills\/\.versions\/botec\//);
  assert.match(keep('pledges-tab'), /^Already kept: /);
  assert.throws(() => keep('no-such-skill'), /No skill no-such-skill/);
  assert.throws(() => keep('../x'), /Usage/);
  assert.throws(() => keep(), /Usage/);
});

// ---------- the pages ----------
function el(tag, props = {}, ...children) {
  return { tag, ...props, attrs: {}, children: children.filter((c) => c !== ''), setAttribute(k, v) { this.attrs[k] = v; }, append(...more) { this.children.push(...more.filter((c) => c !== '')); } };
}
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
const find = (node, ok) => (typeof node === 'string' ? [] : [...(ok(node) ? [node] : []), ...node.children.flatMap((c) => find(c, ok))]);

test('the card asks for a rating of a version she did not rate, marks an old skill, and its pencil opens a dialog', () => {
  const p = { kind: 'match', skill: 'botec', skillKind: 'hand', id: 'hand:botec', editable: false, category: 'SPEC', confidence: 'medium', description: 'Botec', reason: 'The memo mentions botec.',
    access: { has: true, line: 'Peeve has this skill.', next: 'Proceed with Peeve.' }, ratable: true, rated: false, old: true };
  const card = skillCard(p, el, 1420);
  const links = find(card, (n) => n.tag === 'a');
  assert.deepEqual(links.map((a) => [a.className, a.href, a.attrs['aria-haspopup'], a.attrs['data-memo'], a.attrs['data-focus']]),
    [['skill-edit', '/system#file=hand:botec', 'dialog', '1420', undefined], ['skill-edit skill-rate', '/system#file=hand:botec', 'dialog', '1420', 'rate']]);
  assert.deepEqual([textOf(links[1]), RATE_WORDS], ['Rate this skill', 'Rate this skill']);
  assert.ok(textOf(card).includes(OLD_UI) && OLD_UI === OLD_WORDS);
  // Rated, and in use: no prompt and no mark. A skill with no file in the vault cannot be rated here.
  const calm = skillCard({ ...p, rated: true, old: false }, el, 1420);
  assert.equal(find(calm, (n) => n.tag === 'a').length, 1);
  assert.ok(!textOf(calm).includes('Old'));
  assert.equal(find(skillCard({ ...p, id: null, ratable: false }, el, 1420), (n) => n.tag === 'a').length, 0);
  // The dialog takes only an address of a skill on the System page.
  assert.deepEqual(modalTarget('/system#file=skill:email-reply-drafts&edit=1'), { file: 'skill:email-reply-drafts', edit: true });
  assert.deepEqual(modalTarget('/system#file=hand:botec&edit=1'), { file: 'hand:botec', edit: false }, 'a hand-made skill is view only in the dialog too');
  assert.deepEqual(modalTarget('/system#new=daily-review&category=ME&memo=1417'), { draft: { name: 'daily-review', description: '', category: 'ME', memo: '1417' } });
  // Memo 1513: a charter and the lessons open in the dialog too; nothing else of the System page does.
  assert.deepEqual(modalTarget('/system#file=charter:main&edit=1'), { file: 'charter:main', edit: true });
  assert.deepEqual(modalTarget('/system#file=lessons'), { file: 'lessons', edit: false });
  for (const href of ['/system#file=map', '/system#h-skills', '/inbox#file=skill:x', '//evil.test/system#file=skill:x', '', null]) assert.equal(modalTarget(href), null, String(href));
  // The words of the dialog.
  const r = { at: '2026-11-11T12:00:00.000Z', score: 4, notes: 'Shorter steps.', memo: 1420 };
  assert.equal(ratingLine(r), '4 of 5 (good), Nov 11, from memo 1420: Shorter steps.');
  assert.equal(ratingLine({ ...r, notes: '', memo: null }), '4 of 5 (good), Nov 11');
  assert.equal(ratedWords({ pushed: true, rating: r, memo: { id: 9, code: 'SYS-12', to: 'main' } }), 'Rating saved, committed and pushed to GitHub. Memo SYS-12 asks Peeve to revise the skill from your notes.');
  assert.equal(ratedWords({ pushed: true, rating: { ...r, notes: '' }, memo: null }), 'Rating saved, committed and pushed to GitHub. No memo was sent: a rating with no words asks for no change.');
  assert.equal(ratedWords({ pushed: false, error: 'Saved and committed on the Mac, but the push to GitHub failed: offline', rating: r, memo: null }), 'Saved and committed on the Mac, but the push to GitHub failed: offline');
  assert.equal(versionLine({ at: '2026-11-10 09:15', hash8: '1a2b3c4d', size: 3140 }), '2026-11-10 09:15 · 1a2b3c4d · 3.1 kB');
});

test('the pages open the skill dialog in place, keep the links of the System page, and show the pet of the sender in an open memo', () => {
  const inbox = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  const system = readFileSync(join(ROOT, 'ui', 'system.html'), 'utf8');
  const modal = readFileSync(join(ROOT, 'ui', 'skillmodal.js'), 'utf8');
  // A page must work with a server from before ui/skillmodal.js: it loads the file by itself and goes on without it.
  for (const page of [inbox, system]) {
    assert.ok(!/^import [^\n]*\/ui\/skillmodal\.js/m.test(page));
    assert.match(page, /^import\('\/ui\/skillmodal\.js'\)\.then\(\(m\) => m\.installSkillModal\(\{ api, el, markdown, onChange: [^\n]*\)\)\.catch\(\(\) => \{\}\);$/m);
  }
  // The dialog: a modal <dialog> with a label, Escape and a click outside go through the check of unsaved text, and
  // the focus goes back to the pencil. A click with a modifier key is left to the link.
  for (const part of ["el('dialog', { className: 'skill-modal' }", 'dialog.showModal()', "setAttribute('aria-labelledby', 'skill-modal-title')", "addEventListener('cancel'", 'if (e.target === dialog) leave()',
    'opener?.isConnected ? opener', 'back?.focus()', 'event.metaKey || event.ctrlKey || event.shiftKey', "closest?.('a.skill-edit, a.doc-link')", "api('/api/system/save'", "api('/api/skills/rate'", '/api/skills/log?name=',
    '/api/skills/draft?', "type: 'radio'", "el('fieldset'", "el('legend'", 'Load the new version']) assert.ok(modal.includes(part), part);
  // The System page: the pencil of each skill, the old mark, and the address of one file as before.
  for (const part of ["className: 'skill-edit', href: `/system#file=${doc.id}${doc.editable ? '&edit=1' : ''}`", "pencil.setAttribute('aria-haspopup', 'dialog')", 'skillUi.OLD_WORDS', 's.rated ? `Rated ${s.lastScore} of 5`',
    'm.parseSkillHash(location.hash)', "addEventListener('hashchange'"]) assert.ok(system.includes(part), part);
  // The open memo, the answered memo and a memo of a thread: the pet of the sender, or the circle.
  assert.match(inbox, /^import \{ headPet \} from '\/ui\/petview\.js';$/m);
  assert.ok(inbox.includes("const pet = memo.sender === '__OWNER__' ? null : headPet(memo, el, { art: artOf(memo.sender), today: todayIn(zone) });\n  return pet || avatar(displayName(memo.sender));"));
  assert.equal(inbox.split('senderMark(').length - 1, 4, 'the function and its three uses');
  assert.ok(!inbox.includes("el('div', { className: 'memo-head' }, avatar("));
  // Every agent with a pet: the three of the quiz, and an agent with pictures. The liaison keeps the circle.
  assert.deepEqual([hasPet('main'), hasPet('second'), hasPet('gpt'), hasPet('liaison'), hasPet('discord'), hasPet('toString')], [true, true, true, false, false, false]);
  assert.deepEqual([hasPet('helper', { any: true, feelings: [] }), hasPet('helper', { any: false, feelings: ['happy'] }), hasPet('helper', { any: false, feelings: [] })], [true, true, false]);
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  assert.ok(view.includes("if (!memo || !hasPet(memo.sender, art)) return null;") && view.includes("node.setAttribute('aria-hidden', 'true');"));
  // The new rules use only the color variables.
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const rules = css.slice(css.indexOf('/* Memo 1420.'), css.indexOf('.doc summary .ws { margin-right: 0; }'));
  for (const part of ['.skill-modal ', '.skill-modal::backdrop', '.skill-old', '.skill-rate', '.skill-scores label:has(input:focus-visible)', '.memo-head .pet.head']) assert.ok(rules.includes(part), part);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(rules));
});

// ---------- memo 1513: every rule document opens in the dialog, with its latest change ----------
test('a link in a memo opens a charter, the lessons or a skill in the dialog, which starts with the latest change', () => {
  // The ids are those of the System page (src/system.js docs): charter:<name>, lessons, skill:<name>, hand:<name>.
  assert.deepEqual(modalTarget('/system#file=charter:team&edit=1'), { file: 'charter:team', edit: true });
  assert.deepEqual(modalTarget('/system#file=charter:cloud'), { file: 'charter:cloud', edit: false });
  assert.deepEqual(modalTarget('/system#file=lessons&edit=1'), { file: 'lessons', edit: true });
  assert.deepEqual(modalTarget('/system#file=skill:daily-review&edit=1'), { file: 'skill:daily-review', edit: true });
  assert.deepEqual(modalTarget('/system#file=hand:botec&edit=1'), { file: 'hand:botec', edit: false }, 'a view-only document stays view only');
  for (const href of ['/system#file=charter:', '/system#file=charter:../x', '/system#file=notes', 'https://example.org/system#file=lessons', '/agents#file=lessons']) assert.equal(modalTarget(href), null, href);
  // The line over the change.
  const at = '2026-11-11T12:00:00.000Z';
  assert.equal(timeWords(at), new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
  assert.match(timeWords(at), /^Nov 11, \d{1,2}:00 [AP]M$/);
  assert.equal(timeWords('no time'), '');
  assert.equal(changeWords({ at, source: 'history', label: 'local/charters/.history/team-2026-11-11T12-00-00-000Z.md' }), `Changed ${timeWords(at)}. Compared with the text before, kept in local/charters/.history/team-2026-11-11T12-00-00-000Z.md.`);
  assert.equal(changeWords({ at, source: 'git', label: 'commit 1a2b3c4d', change: 'Lesson 6: spell out every step' }), `Changed ${timeWords(at)}, with the commit "Lesson 6: spell out every step". Compared with the text of commit 1a2b3c4d.`);
  assert.equal(changeWords({ at: null, source: 'git', label: 'commit 1a2b3c4d', change: null }), 'Changed on the Mac, and not committed yet. Compared with the text of commit 1a2b3c4d.');
  assert.equal(changeWords({ at, source: 'versions', label: 'skills/.versions/botec/2026-11-11-0700-1a2b3c4d.md' }), `Changed ${timeWords(at)}. Compared with the old version skills/.versions/botec/2026-11-11-0700-1a2b3c4d.md.`);
  // No earlier text: the page says so, in words.
  assert.match(changeWords(null), /^No earlier version of this text is kept/);
  assert.match(changeWords(null, { local: true }), /^No earlier text of this charter is kept yet.*local\/charters\/\.history/);
  // The dialog: the change first, from the route of the server, drawn by the diff of ui/markdown.js; the same safe save
  // for every document; the rating and the old versions only for a skill; a server from before the route says so.
  const modal = readFileSync(join(ROOT, 'ui', 'skillmodal.js'), 'utf8');
  for (const part of ["import { diffLines, diffHunks, diffView, docLinkOf } from './markdown.js';", '/api/system/previous?id=', "el('h3', { id: 'skill-modal-change' }, 'Latest change')",
    "setAttribute('aria-labelledby', 'skill-modal-change')", 'diffView(rows, el)', 'diffHunks(diffLines(found.previous.text, state.text))', "api('/api/system/save', { id, text: area.value, base: state.hash })",
    'body.replaceChildren(change, textBox, ...(isSkill ? [rateBox, versions] : []))', 'Start the server again to get it.', "a.classList.contains('doc-link') ? 'change' : ''"]) assert.ok(modal.includes(part), part);
  // The styles: the two tints and the words, with the color variables of the two themes only.
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  assert.match(css, /\.diff-part\.del \{ background: var\(--hi-bg\); border-left-color: var\(--hi-ink\); \}/);
  assert.match(css, /\.diff-part\.add \{ background: var\(--good-bg\); border-left-color: var\(--good\); \}/);
  const rules = css.slice(css.indexOf('/* Memo 1513. A change as removed'), css.indexOf('/* The pet of the sender in the head'));
  assert.ok(rules.length > 500 && !/#[0-9a-f]{3,8}\b|rgb\(/i.test(rules), 'no color of its own');
  for (const name of ['--hi-bg', '--hi-ink', '--good-bg', '--good-ink', '--good', '--lo-bg', '--lo-ink']) {
    assert.ok(css.split(`${name}:`).length - 1 >= 4, `${name} has a value in the light and the dark theme`);
  }
});

test('a whole address of a rule document opens the dialog too: this server, Memo on this computer, or a computer of the tailnet (memo 1523)', () => {
  const want = { file: 'charter:team', edit: true };
  assert.deepEqual(modalTarget('https://mac.tail.ts.net:8443/system#file=charter:team&edit=1'), want);
  assert.deepEqual(modalTarget('http://127.0.0.1:3280/system#file=charter:team&edit=1'), want);
  assert.deepEqual(modalTarget('http://localhost:3280/system#file=lessons'), { file: 'lessons', edit: false });
  assert.deepEqual(modalTarget('https://memo.example.org/system#file=skill:daily-review&edit=1', 'https://memo.example.org'), { file: 'skill:daily-review', edit: true }, 'the server of the page itself');
  assert.deepEqual(modalTarget('/system#file=charter:team&edit=1'), want, 'an address with no host works as before');
  for (const href of ['https://example.org/system#file=charter:team&edit=1', 'http://mac.tail.ts.net/system#file=lessons', 'https://mac.tail.ts.net.evil.test/system#file=lessons',
    'https://evil.test/?x=https://mac.tail.ts.net/system#file=lessons', 'https://mac.tail.ts.net:8443/inbox#file=lessons', 'https://mac.tail.ts.net:8443/system#h-skills',
    'https://mac.tail.ts.net:8443/system#new=daily-review', 'https://user@127.0.0.1.evil.test/system#file=lessons']) assert.equal(modalTarget(href, 'https://memo.example.org'), null, href);
});
