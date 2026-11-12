import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createAgents, nudgeMessage, turnInProgress } from '../src/agents.js';
import { makeApp, call } from './helpers.js';

// The server nudges the session of a long agent when news arrives for it and the session sits idle at its prompt:
// no `memo wait` request (/api/news) in the last 60 seconds. At most one nudge in 2 minutes.
const NUDGE = ['memo-main', nudgeMessage('main')];
const MEMO = { from: 'cam', to: 'main', text: 'Update the README.' };

// An app with a clock that the test moves, and with the long agent main running (started through the fake tmux).
function running() {
  let clock = new Date('2026-10-23T09:00:00Z');
  const made = makeApp({ now: () => clock });
  made.agents.start('main');
  const advance = (seconds) => { clock = new Date(clock.getTime() + seconds * 1000); };
  return { ...made, advance };
}

test('the nudge names the agent in both commands', () => {
  assert.equal(nudgeMessage('main'), 'A memo arrived. Run `memo list --to main`, then do the work. If nothing is open, run `memo wait --as main`.');
});

test('a send to a running agent that sits idle nudges its session once', async () => {
  const { app, sends } = running();
  assert.equal((await call(app, '/api/send', MEMO)).status, 200);
  assert.deepEqual(sends, [NUDGE]);
});

test('a send while memo wait polled in the last minute does not nudge', async () => {
  const { app, sends, advance } = running();
  assert.equal((await call(app, '/api/news?for=main')).status, 200);
  advance(30);
  await call(app, '/api/send', MEMO);
  assert.deepEqual(sends, []);
  // A minute with no poll: the session is not waiting, so the next memo nudges.
  advance(31);
  await call(app, '/api/send', MEMO);
  assert.deepEqual(sends, [NUDGE]);
});

test('two sends within 2 minutes nudge once; a send after that nudges again', async () => {
  const { app, sends, advance } = running();
  await call(app, '/api/send', MEMO);
  advance(100);
  await call(app, '/api/send', MEMO);
  assert.deepEqual(sends, [NUDGE]);
  advance(21);
  await call(app, '/api/send', MEMO);
  assert.deepEqual(sends, [NUDGE, NUDGE]);
});

test('a stopped agent is not nudged', async () => {
  const { app, sends } = makeApp();
  await call(app, '/api/send', MEMO);
  assert.deepEqual(sends, []);
});

test('an agent that is stopping is not nudged: it got "do nothing more"', async () => {
  const { app, agents, sends } = running();
  agents.stop('main');
  const before = sends.length; // the stop message
  await call(app, '/api/send', MEMO);
  assert.equal(sends.length, before);
});

test('a memo to the owner or to a short agent nudges nobody', async () => {
  const { app, sends } = running();
  await call(app, '/api/send', { from: 'main', to: 'cam', text: 'Done?', impact: 2, effort: 'micro' });
  await call(app, '/api/send', { from: 'cam', to: 'liaison', text: 'Read the mail.' });
  assert.deepEqual(sends, []);
});

test('a reply, a close and a note of the owner nudge the sender of the memo', async () => {
  const { app, sends, advance } = running();
  const memo = () => call(app, '/api/send', { from: 'main', to: 'cam', text: 'Approve?', impact: 2, effort: 'micro' }).then((r) => r.data.memo.id);
  await call(app, '/api/reply', { id: await memo(), text: 'Yes.' });
  assert.deepEqual(sends, [NUDGE]);
  advance(121);
  await call(app, '/api/close', { id: await memo(), text: 'Not needed.' });
  assert.deepEqual(sends, [NUDGE, NUDGE]);
  advance(121);
  const id = await memo();
  // The agent's own note is not news for the agent.
  await call(app, '/api/note', { id, from: 'main', text: 'Price is $5.' });
  assert.deepEqual(sends, [NUDGE, NUDGE]);
  await call(app, '/api/note', { id, from: 'cam', text: 'Add the vendor.' });
  assert.deepEqual(sends, [NUDGE, NUDGE, NUDGE]);
});

test('a forward of a Discord message nudges the agent that gets it', async () => {
  const { app, store, sends } = running();
  const { memo } = store.send({ from: 'discord', to: 'cam', text: 'Fix the site.', impact: 3, effort: 'short', trusted: true });
  assert.equal((await call(app, '/api/forward', { id: memo.id })).status, 200);
  assert.deepEqual(sends, [NUDGE]);
});

test('the nudge records the time of the last news request in the database', async () => {
  const { app, db, advance } = running();
  assert.equal(db.prepare('SELECT news_at FROM status WHERE agent = ?').get('main').news_at, null);
  await call(app, '/api/news?for=main');
  assert.equal(db.prepare('SELECT news_at FROM status WHERE agent = ?').get('main').news_at, '2026-10-23T09:00:00.000Z');
  advance(5);
  await call(app, '/api/news?for=main');
  assert.equal(db.prepare('SELECT news_at FROM status WHERE agent = ?').get('main').news_at, '2026-10-23T09:00:05.000Z');
});

test('a database from before the nudge gets the news_at column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-nudge-db-'));
  const old = openDb(join(dir, 'memo.db'));
  old.exec('DROP TABLE status; CREATE TABLE status (agent TEXT PRIMARY KEY, text TEXT NOT NULL DEFAULT \'\', updated TEXT NOT NULL DEFAULT \'\', wanted INTEGER NOT NULL DEFAULT 0, recap TEXT, recap_at TEXT, stopping_since TEXT, last_stop TEXT)');
  old.close();
  const again = openDb(join(dir, 'memo.db'));
  assert.ok(again.prepare('PRAGMA table_info(status)').all().some((c) => c.name === 'news_at'));
});

// The screen check: with a tmux that can capture the screen, a session in the middle of a turn or waiting on a dialog
// is not idle, so it gets no nudge. A nudge sends Escape first, which would cut the turn short or close the dialog.
const IDLE = '╭───╮\n│ > │\n╰───╯\n  ? for shortcuts';
const WORKING = '● Reading the file…\n✻ Thinking… (esc to interrupt)';
const DIALOG = 'Do you want to run this command?\n ❯ 1. Yes\n   2. No';

function withScreen() {
  const root = mkdtempSync(join(tmpdir(), 'memo-nudge-'));
  mkdirSync(join(root, 'charters'));
  writeFileSync(join(root, 'charters', 'main.md'), '# Charter: main\n');
  const screen = { text: IDLE };
  const sends = [];
  const tmux = { has: () => true, start() {}, kill() {}, send: (s, text) => sends.push([s, text]), capture: () => screen.text, key() {} };
  const config = [{ name: 'main', kind: 'long', dir: '~/p', model: 'm' }];
  const agents = createAgents({ db: openDb(), config, root, owner: 'cam', tmux, now: () => new Date('2026-10-23T09:00:00Z') });
  return { agents, screen, sends };
}

test('turnInProgress reads the spinner line at the bottom of the screen only', () => {
  assert.equal(turnInProgress(WORKING), true);
  assert.equal(turnInProgress(IDLE), false);
  assert.equal(turnInProgress('(esc to interrupt)\n' + Array(30).fill('old transcript line').join('\n')), false);
});

test('arrived nudges an idle screen, and not a turn in progress or a permission dialog', () => {
  const { agents, screen, sends } = withScreen();
  screen.text = WORKING;
  assert.equal(agents.arrived('main'), false);
  screen.text = DIALOG;
  assert.equal(agents.arrived('main'), false);
  assert.deepEqual(sends, []);
  screen.text = IDLE;
  assert.equal(agents.arrived('main'), true);
  assert.deepEqual(sends, [NUDGE]);
  // A skipped nudge did not start the 2 minutes: the first real nudge came through at once.
});

test('nudge types the message into the session of a long agent only', () => {
  const { agents, sends } = withScreen();
  agents.nudge('main');
  assert.deepEqual(sends, [NUDGE]);
  assert.throws(() => agents.nudge('nobody'), /No agent has the name nobody/);
});
