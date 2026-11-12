import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { createHandover, PINNED } from '../src/handover.js';
import { WORKSTREAMS } from './helpers.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// The handover job of memo 982: an agent at the limit of its account hands the memos it never got to the other agent.
const NAMES = ['cam', 'discord', 'main', 'second', 'liaison'];
function setup({ main = { session: 96, week: 40 }, second = { session: 10, week: 30 }, mainActivity = 'working', secondActivity = 'idle' } = {}) {
  let t = Date.parse('2026-11-06T12:00:00Z');
  const now = () => new Date(t);
  const db = openDb();
  const store = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'], now, workstreams: WORKSTREAMS, timeZone: 'America/Los_Angeles' });
  const figures = { main, second, at: new Date(t - 60000).toISOString() };
  const usage = (name) => {
    const f = figures[name];
    if (!f) return null;
    return { at: figures.at, error: null,
      session: { percent: f.session, resets_at: '2026-11-06T15:00:00Z' }, week: { percent: f.week, resets_at: '2026-11-10T18:00:00Z' }, models: [] };
  };
  const activities = { main: mainActivity, second: secondActivity };
  const agents = () => [
    { name: 'main', kind: 'long', activity: activities.main, usage: usage('main') },
    { name: 'second', kind: 'long', activity: activities.second, usage: usage('second') },
    { name: 'liaison', kind: 'short', activity: null, usage: null },
  ];
  const nudged = [];
  const lines = [];
  const job = createHandover({ db, store, owner: 'cam', agents, arrived: (n) => nudged.push(n), now, log: (l) => lines.push(l) });
  const later = (ms) => { t += ms; figures.at = new Date(t - 60000).toISOString(); }; // the server polls the usage each 5 minutes
  return { db, store, job, figures, activities, nudged, lines, later };
}
const toMain = (store, text, extra = {}) => store.send({ from: 'cam', to: 'main', text, ...extra }).memo;

test('a memo that the agent never got moves to the other agent when the agent is at its limit', () => {
  const { store, job, nudged, lines } = setup();
  const m = toMain(store, 'Pay the Gusto invoice.', { ws: 'OPS', title: 'Gusto invoice' });
  const batches = job.run();
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].memos.map((x) => x.id), [m.id]);
  assert.equal(store.get(m.id).recipient, 'second');
  // memo wait of second gets it with its next request: news holds it.
  assert.deepEqual(store.news('second').to_you.map((x) => x.id), [m.id]);
  assert.deepEqual(store.news('main').to_you, []);
  assert.deepEqual(nudged, ['second'], 'an idle second at its prompt gets a nudge');
  assert.match(lines[0], /^handover: OPS-1 moved from main to second, session at 96 percent\.$/);
});

test('the owner gets one short memo per batch, with the codes, the titles and the reason, and no parentheses', () => {
  const { store, job } = setup();
  toMain(store, 'Pay the Gusto invoice.', { ws: 'OPS', title: 'Gusto invoice' });
  const two = toMain(store, 'Draft the thank-you email to the donor.\nMore lines.');
  job.run();
  const told = store.list('cam');
  assert.equal(told.length, 1, 'one memo for the batch of two');
  const memo = told[0];
  assert.equal(memo.sender, 'second');
  assert.equal(memo.impact, 1);
  assert.equal(memo.effort, 'micro');
  assert.equal(memo.ws, 'SYS');
  assert.equal(memo.title, 'Handover from main to second');
  assert.match(memo.text, /^main reached its session limit\. It is at 96 percent until Fri 7:00 AM\./);
  assert.match(memo.text, /So 2 memos you sent main went to second\. main had not started them, and second is below its limit\./);
  assert.match(memo.text, /- OPS-1: Gusto invoice/);
  assert.match(memo.text, new RegExp(`- Memo ${two.id}: Draft the thank-you email to the donor\\.`));
  assert.doesNotMatch(memo.text, /[()]/);
});

test('a memo that the agent got with memo list or memo wait stays, also one it holds', () => {
  const { store, job } = setup();
  const listed = toMain(store, 'Listed task.');
  store.list('main'); // memo list --to main
  const waited = toMain(store, 'Waited task.');
  store.news('main'); // memo wait --as main, also with --hold: the server shows the memo and the client hides it
  const fresh = toMain(store, 'Fresh task.');
  job.run();
  assert.equal(store.get(listed.id).recipient, 'main');
  assert.equal(store.get(waited.id).recipient, 'main');
  assert.equal(store.get(fresh.id).recipient, 'second');
  assert.ok(store.get(listed.id).delivered, 'the marker is set');
  assert.equal(store.move(listed.id, 'main', 'second'), false, 'the store refuses to move a memo the agent got');
});

test('only memos from the owner move; memos from agents, to the owner, to the liaison and the scheduled memos stay', () => {
  const { store, job } = setup();
  const fromSecond = store.send({ from: 'second', to: 'main', text: 'Please review my change.' }).memo;
  const toLiaison = store.send({ from: 'cam', to: 'liaison', text: 'Post this.' }).memo;
  const toCam = store.send({ from: 'main', to: 'cam', text: 'Approve?', impact: 3, effort: 'micro' }).memo;
  const sync = toMain(store, 'Nightly vault sync. Follow scripts/nightly-sync.md in ~/memo-vault.');
  const review = toMain(store, 'Daily review. Follow scripts/daily-review.md in ~/memo-vault.');
  assert.equal(job.run().length, 0);
  for (const m of [fromSecond, toLiaison, toCam, sync, review]) assert.equal(store.get(m.id).recipient, m.recipient);
  assert.ok(PINNED.every((p) => p instanceof RegExp));
});

test('the scheduled memos to second stay with second when second is at its limit', () => {
  const { store, job } = setup({ main: { session: 10, week: 20 }, second: { session: 97, week: 40 }, mainActivity: 'idle', secondActivity: 'working' });
  const review = store.send({ from: 'cam', to: 'second', text: 'Daily review. Follow scripts/daily-review.md in ~/memo-vault.' }).memo;
  const task = store.send({ from: 'cam', to: 'second', text: 'Book the venue.' }).memo;
  job.run();
  assert.equal(store.get(review.id).recipient, 'second');
  assert.equal(store.get(task.id).recipient, 'main');
});

test('nothing moves when the other agent is at its limit too, stopped, blocked, or has old figures', () => {
  const both = setup({ second: { session: 10, week: 95 } });
  const a = toMain(both.store, 'Task.');
  assert.equal(both.job.run().length, 0);
  assert.equal(both.store.get(a.id).recipient, 'main');
  for (const state of ['stopped', 'blocked', 'stopping']) {
    const s = setup({ secondActivity: state });
    const m = toMain(s.store, 'Task.');
    s.job.run();
    assert.equal(s.store.get(m.id).recipient, 'main', `second is ${state}`);
  }
  const old = setup();
  const m = toMain(old.store, 'Task.');
  old.figures.at = new Date(Date.parse('2026-11-06T12:00:00Z') - 31 * 60000).toISOString(); // the last good figures are from 31 minutes ago
  old.job.run();
  assert.equal(old.store.get(m.id).recipient, 'main');
});

test('nothing moves when the limit resets within 15 minutes: the agent is about to get its window back (memo 1047)', () => {
  // The session of main resets at 15:00. At 14:50 the job waits; at 14:44 it moves the memo.
  const soon = setup();
  const m = toMain(soon.store, 'Task.');
  soon.later(2 * 60 * 60 * 1000 + 50 * 60000);
  assert.equal(soon.job.run().length, 0);
  assert.equal(soon.store.get(m.id).recipient, 'main');
  const before = setup();
  const n = toMain(before.store, 'Task.');
  before.later(2 * 60 * 60 * 1000 + 44 * 60000);
  assert.equal(before.job.run().length, 1);
  assert.equal(before.store.get(n.id).recipient, 'second');
});

test('nothing moves when the agent is below its limit', () => {
  const { store, job } = setup({ main: { session: 94, week: 94 } });
  const m = toMain(store, 'Task.');
  assert.equal(job.run().length, 0);
  assert.equal(store.get(m.id).recipient, 'main');
});

test('a moved memo does not go back before the reset of the limit that moved it, and the move is logged', () => {
  const { db, store, job, figures, later } = setup();
  const m = toMain(store, 'Task.');
  job.run();
  assert.equal(store.get(m.id).recipient, 'second');
  const row = db.prepare('SELECT * FROM handovers WHERE memo_id = ?').get(m.id);
  assert.equal(row.from_agent, 'main');
  assert.equal(row.to_agent, 'second');
  assert.equal(row.reason, 'session at 96 percent');
  assert.equal(row.hold_until, '2026-11-06T15:00:00.000Z', 'the reset of the session of main');
  // Now second is at its limit and main is free again, before the reset of main.
  figures.main = { session: 10, week: 40 };
  figures.second = { session: 99, week: 40 };
  later(60 * 60 * 1000);
  job.run();
  assert.equal(store.get(m.id).recipient, 'second', 'no ping-pong within the window');
  // After the reset of main the memo may move again.
  later(3 * 60 * 60 * 1000);
  job.run();
  assert.equal(store.get(m.id).recipient, 'main');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM handovers WHERE memo_id = ?').get(m.id).n, 2);
});

test('a second run moves nothing new and sends no second memo', () => {
  const { store, job } = setup();
  toMain(store, 'Task.');
  job.run();
  assert.equal(job.run().length, 0);
  assert.equal(store.list('cam').length, 1);
});

test('an old database counts its memos as delivered, so the job never moves them', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'memo-handover-')), 'memo.db');
  const db = openDb(path);
  db.exec("INSERT INTO memos (sender, recipient, text, created) VALUES ('cam', 'main', 'Old task', '2026-11-01T00:00:00Z')");
  db.exec('ALTER TABLE memos DROP COLUMN delivered');
  db.close();
  const again = openDb(path);
  assert.equal(again.prepare('SELECT delivered FROM memos').get().delivered, '2026-11-01T00:00:00Z');
  const store = createStore(again, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'] });
  assert.deepEqual(store.undelivered('main'), []);
  again.close();
});
