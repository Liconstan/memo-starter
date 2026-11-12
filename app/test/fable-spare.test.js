import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { createFableSpare, fableSpareText, RESET_WITHIN_MS } from '../src/fable-spare.js';
import { WORKSTREAMS } from './helpers.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

// The Fable to spare memo: an agent whose Fable week will end with points unused gets one memo per window.
// Now is 12:00 UTC on Fri Nov 6. The Fable week of main resets at 18:00 UTC, 10:00 AM Pacific, 6 hours away. With
// 20 percent used, 80 points are left against 3.6 points of pace: the headroom is 76.
const NAMES = ['cam', 'discord', 'main', 'second', 'liaison'];
const RESET = '2026-11-06T18:00:00Z';
const HOUR = 60 * 60 * 1000;
function setup({ fable = 20, resets_at = RESET, path } = {}) {
  let t = Date.parse('2026-11-06T12:00:00Z');
  const now = () => new Date(t);
  const db = openDb(path);
  const store = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'], now, workstreams: WORKSTREAMS, timeZone: 'America/Los_Angeles' });
  const figures = { main: { fable, resets_at }, second: null, at: new Date(t - 60000).toISOString() };
  const usage = (name) => {
    const f = figures[name];
    if (!f) return null;
    return { at: figures.at, error: null,
      session: { percent: 10, resets_at: '2026-11-06T15:00:00Z' }, week: { percent: 30, resets_at: '2026-11-10T18:00:00Z' },
      models: f.fable === null ? [] : [{ name: 'Fable', percent: f.fable, resets_at: f.resets_at, rate: 0.5 }] };
  };
  const agents = () => [
    { name: 'main', kind: 'long', activity: 'idle', usage: usage('main') },
    { name: 'second', kind: 'long', activity: 'idle', usage: usage('second') },
    { name: 'liaison', kind: 'short', activity: null, usage: null },
  ];
  const nudged = [];
  const lines = [];
  const job = createFableSpare({ db, store, owner: 'cam', agents, arrived: (n) => nudged.push(n), now, log: (l) => lines.push(l) });
  const later = (ms) => { t += ms; figures.at = new Date(t - 60000).toISOString(); }; // the server polls the usage each 5 minutes
  return { db, store, job, figures, nudged, lines, later };
}

test('the agent gets one Fable to spare memo, with the code SYS, the points and the local reset time, and a nudge', () => {
  const { db, store, job, nudged, lines } = setup();
  const sent = job.run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].agent, 'main');
  assert.equal(sent[0].points, 76);
  assert.equal(sent[0].resets_at, '2026-11-06T18:00:00.000Z');
  const memos = store.list('main');
  assert.equal(memos.length, 1);
  const memo = memos[0];
  assert.equal(memo.sender, 'cam');
  assert.equal(memo.ws, 'SYS');
  assert.equal(memo.title, 'Fable to spare');
  assert.equal(memo.text, 'Fable to spare: about 76 points will reset unused at Fri 10:00 AM. If you have time, run the model-trial skill on one skill that has no row in skills/model-trials.md yet, using Fable for the candidate run. Never on a task that sends, pays or files. No reply needed.');
  assert.equal(memo.text, fableSpareText(76, 'Fri 10:00 AM'));
  assert.doesNotMatch(memo.text, /[()]/);
  assert.deepEqual(nudged, ['main']);
  assert.deepEqual(store.list('second'), [], 'second has no figures');
  assert.deepEqual(store.list('cam'), [], 'the owner gets nothing');
  assert.match(lines[0], /^fable spare: main has about 76 Fable points to spare until 2026-11-06T18:00:00\.000Z; memo \d+ sent\.$/);
  const row = db.prepare('SELECT * FROM fable_spare WHERE agent = ?').get('main');
  assert.equal(row.resets_at, '2026-11-06T18:00:00.000Z');
  assert.equal(row.points, 76);
  assert.equal(row.memo_id, memo.id);
  assert.equal(RESET_WITHIN_MS, 24 * HOUR);
});

test('not twice for the same window, also after a restart of the server; the next window gets its own memo', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'memo-fable-spare-')), 'memo.db');
  const first = setup({ path });
  assert.equal(first.job.run().length, 1);
  assert.equal(first.job.run().length, 0, 'the same pass again');
  first.later(60 * 60 * 1000);
  assert.equal(first.job.run().length, 0, 'an hour later, with new figures, the same window');
  assert.equal(first.store.list('main').length, 1);
  first.db.close();
  // The server starts again on the same database.
  const again = setup({ path });
  assert.equal(again.job.run().length, 0, 'the row of the window survives the restart');
  assert.equal(again.store.list('main').length, 1);
  // A new Fable window, 18 hours away, with its own spare points.
  again.figures.main.resets_at = '2026-11-07T06:00:00Z';
  const sent = again.job.run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].resets_at, '2026-11-07T06:00:00.000Z');
  assert.equal(again.store.list('main').length, 2);
  assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM fable_spare').get().n, 2);
  again.db.close();
});

test('nothing goes when the figures are stale', () => {
  const { store, job, figures, later } = setup();
  figures.at = new Date(Date.parse('2026-11-06T12:00:00Z') - 21 * 60000).toISOString(); // the last good figures are from 21 minutes ago
  assert.equal(job.run().length, 0);
  assert.deepEqual(store.list('main'), []);
  // New figures five minutes later: the memo goes.
  later(5 * 60000);
  assert.equal(job.run().length, 1);
});

test('nothing goes when the Fable reset is more than 24 hours away, or has passed', () => {
  const far = setup({ resets_at: '2026-11-07T12:30:00Z' }); // 24 hours 30 minutes away
  assert.equal(far.job.run().length, 0);
  assert.deepEqual(far.store.list('main'), []);
  far.later(HOUR); // 23 hours 30 minutes away
  assert.equal(far.job.run().length, 1);
  const passed = setup({ resets_at: '2026-11-06T11:00:00Z' });
  assert.equal(passed.job.run().length, 0, 'the figures are from before the reset');
  const none = setup({ resets_at: null });
  assert.equal(none.job.run().length, 0, 'no reset time');
});

test('nothing goes when the Fable headroom is 30 points or lower, or when the account has no Fable figure', () => {
  // 75 percent used, 6 hours from the reset: 25 points left against 3.6 of pace, a headroom of 21.
  const low = setup({ fable: 75 });
  assert.equal(low.job.run().length, 0);
  assert.deepEqual(low.store.list('main'), []);
  // 66 percent used: 34 points left, a headroom of 30.4. That is above 30, so the memo goes with 30 points.
  const edge = setup({ fable: 66 });
  const sent = edge.job.run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].points, 30);
  const noFable = setup({ fable: null });
  assert.equal(noFable.job.run().length, 0);
});
