import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';

// Before 2026-10-09 a memo had the name "card". A database from then has the old table and column names.
test('a database with the old names keeps its rows under the new names', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'memo-db-')), 'memo.db');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE cards (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, text TEXT NOT NULL, reply TEXT,
      state TEXT NOT NULL DEFAULT 'open', impact INTEGER, effort TEXT, due TEXT, trusted INTEGER NOT NULL DEFAULT 0, acked INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL, closed TEXT);
    CREATE TABLE corrections (card_id INTEGER NOT NULL, sender TEXT NOT NULL, old_impact INTEGER NOT NULL, new_impact INTEGER NOT NULL, at TEXT NOT NULL);
    INSERT INTO cards (sender, recipient, text, impact, effort, created) VALUES ('main', 'cam', 'An old card.', 4, 'micro', '2026-10-09T12:00:00.000Z');
    INSERT INTO corrections VALUES (1, 'main', 5, 4, '2026-10-09T12:01:00.000Z');
  `);
  old.close();
  const store = createStore(openDb(path), { owner: 'cam', names: ['cam', 'discord', 'main'] });
  assert.equal(store.get(1).text, 'An old card.');
  assert.deepEqual(store.list('cam').map((m) => m.id), [1]);
  assert.equal(store.corrections('main')[0].memo_id, 1);
  assert.equal(store.send({ from: 'main', to: 'cam', text: 'A new memo.', impact: 1, effort: 'micro' }).memo.id, 2);
  openDb(path); // a second start changes nothing
  assert.equal(store.list('cam').length, 2);
});

test('a database from before the new tag gets the column, and its memos count as seen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-db-'));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE memos (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, text TEXT NOT NULL, reply TEXT,
    state TEXT NOT NULL DEFAULT 'open', impact INTEGER, effort TEXT, due TEXT, trusted INTEGER NOT NULL DEFAULT 0, acked INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL, closed TEXT);
    INSERT INTO memos (sender, recipient, text, impact, effort, created) VALUES ('main', 'cam', 'An old question.', 3, 'micro', '2026-10-01T00:00:00.000Z');`);
  old.close();
  const store = createStore(openDb(path), { owner: 'cam', names: ['cam', 'discord', 'main'] });
  assert.equal(store.get(1).seen, 1);
  store.send({ from: 'main', to: 'cam', text: 'A new question.', impact: 3, effort: 'micro' });
  assert.equal(store.get(2).seen, 0);
  createStore(openDb(path), { owner: 'cam', names: ['cam', 'discord', 'main'] });
});

// Workstream codes (2026-11-04): a database from before them gets the columns ws and ws_n, and its memos keep their numbers.
test('a database from before the workstream codes gets the two columns; its memos have no code, and the index holds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-db-'));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE memos (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT NOT NULL, recipient TEXT NOT NULL, text TEXT NOT NULL, reply TEXT,
    state TEXT NOT NULL DEFAULT 'open', impact INTEGER, effort TEXT, due TEXT, trusted INTEGER NOT NULL DEFAULT 0, acked INTEGER NOT NULL DEFAULT 0,
    seen INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL, closed TEXT, tags TEXT NOT NULL DEFAULT '', until TEXT, back TEXT, title TEXT, next TEXT, re TEXT NOT NULL DEFAULT '');
    INSERT INTO memos (sender, recipient, text, impact, effort, created) VALUES ('main', 'cam', 'An old question.', 3, 'micro', '2026-10-01T00:00:00.000Z');
    INSERT INTO memos (sender, recipient, text, impact, effort, created) VALUES ('main', 'cam', 'Another one.', 3, 'micro', '2026-10-02T00:00:00.000Z');`);
  old.close();
  const db = openDb(path);
  const columns = db.prepare('PRAGMA table_info(memos)').all().map((c) => c.name);
  assert.ok(columns.includes('ws') && columns.includes('ws_n'));
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'memos_ws'").get());
  const store = createStore(db, { owner: 'cam', names: ['cam', 'discord', 'main'], workstreams: { OPS: 'Operations' } });
  assert.deepEqual(store.list('cam').map((m) => [m.id, m.code]), [[1, null], [2, null]]);
  // The first memo with a code is OPS-1, whatever the ids before it.
  assert.equal(store.send({ from: 'main', to: 'cam', text: 'New.', impact: 3, effort: 'micro', ws: 'OPS' }).memo.code, 'OPS-1');
  assert.equal(store.get('OPS-1').id, 3);
  // Two memos cannot have one code.
  assert.throws(() => db.prepare("UPDATE memos SET ws = 'OPS', ws_n = 1 WHERE id = 1").run(), /UNIQUE/);
  openDb(path); // a second start changes nothing
  assert.equal(createStore(openDb(path), { owner: 'cam', names: ['cam', 'discord', 'main'] }).get(3).code, 'OPS-1');
});
