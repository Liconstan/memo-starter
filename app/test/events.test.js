import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.js';
import { createStore, EVENT_KINDS, SERVER_ACTOR } from '../src/memos.js';
import { exportDay, exportEvent, dayStart, dayOf, shiftDay, TEXT_KEYS } from '../src/events.js';
import { checkBoxes } from '../ui/markdown.js';
import { makeApp, call, LIAISON_TOKEN, ROOT } from './helpers.js';

const NAMES = ['cam', 'discord', 'main', 'second', 'liaison'];
// A store with a clock that the test moves. Each read of the clock is the same time until the test changes it.
function makeStore(start = '2026-11-09T18:00:00Z', path) {
  const clock = { t: Date.parse(start) };
  const db = openDb(path);
  const store = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'], now: () => new Date(clock.t), timeZone: 'America/Los_Angeles', workstreams: { OPS: 'Operations' } });
  const events = (kind) => db.prepare(`SELECT * FROM events ${kind ? 'WHERE kind = ?' : ''} ORDER BY id`).all(...(kind ? [kind] : []))
    .map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  return { db, store, clock, events, last: (kind) => events(kind).at(-1) };
}
const toCam = { from: 'main', to: 'cam', text: 'Approve the deploy?', impact: 4, effort: 'micro', title: 'Deploy', ws: 'OPS' };
const SECOND = 1000;

test('each kind of event is written, with its time, its memo, its actor and its facts', () => {
  const { store, clock, events, last } = makeStore();
  const step = (ms = SECOND) => { clock.t += ms; };

  const { memo } = store.send({ ...toCam, tags: ['work'], next: 'Say yes or no', due: '2026-11-20' });
  let e = last('send');
  assert.deepEqual({ at: e.at, memo_id: e.memo_id, actor: e.actor }, { at: '2026-11-09T18:00:00.000Z', memo_id: memo.id, actor: 'main' });
  assert.deepEqual(e.payload, { sender: 'main', recipient: 'cam', code: 'OPS-1', title: 'Deploy', impact: 4, effort: 'micro',
    text: 'Approve the deploy?', next: 'Say yes or no', due: '2026-11-20', tags: ['work'], re: [], trusted: 0 });
  assert.equal(e.at, memo.created, 'the event has the time of the memo');

  step();
  store.inboxLoaded({ time_zone: 'America/Los_Angeles' });
  e = last('inbox_load');
  assert.deepEqual({ memo_id: e.memo_id, actor: e.actor, payload: e.payload }, { memo_id: null, actor: 'cam', payload: { time_zone: 'America/Los_Angeles' } });

  step();
  assert.deepEqual(store.seen([memo.id]), { seen: 1 });
  store.seen([memo.id]);
  assert.equal(events('seen').length, 1, 'a memo that was seen already gives no second event');
  assert.equal(last('seen').actor, 'cam');

  step();
  store.note(memo.id, 'cam', 'Which server?');
  e = last('note');
  assert.equal(e.actor, 'cam');
  assert.equal(e.payload.text, 'Which server?');
  assert.equal(e.payload.note_id, store.get(memo.id).notes[0].id);
  assert.equal(e.at, store.get(memo.id).notes[0].created);

  step();
  store.edit(memo.id, 'Approve the deploy to the test server?', 'main');
  e = last('edit');
  assert.equal(e.actor, 'main');
  assert.equal(e.payload.actor_inferred, undefined, 'a named actor is not inferred');

  store.brief(memo.id, { title: 'Deploy to test', next: '' });
  e = last('brief');
  assert.deepEqual({ actor: e.actor, inferred: e.payload.actor_inferred, old_title: e.payload.old_title, new_title: e.payload.new_title, old_next: e.payload.old_next, new_next: e.payload.new_next, title: e.payload.title },
    { actor: 'main', inferred: true, old_title: 'Deploy', new_title: 'Deploy to test', old_next: 'Say yes or no', new_next: null, title: 'Deploy to test' });

  store.adjust(memo.id, 1, 'cam');
  e = last('impact');
  assert.deepEqual({ actor: e.actor, old: e.payload.old_impact, now: e.payload.new_impact, impact: e.payload.impact }, { actor: 'cam', old: 4, now: 5, impact: 5 });
  store.adjust(memo.id, 1, 'cam');
  assert.equal(events('impact').length, 1, 'an impact that stays at 5 gives no event');
  assert.equal(store.corrections('main').length, 1, 'the corrections table is as before');

  store.tag(memo.id, 'money', true, 'cam');
  e = last('tag');
  assert.deepEqual({ actor: e.actor, tag: e.payload.tag, tags: e.payload.tags }, { actor: 'cam', tag: 'money', tags: ['money', 'work'] });
  store.tag(memo.id, 'money', true, 'cam');
  assert.equal(events('tag').length, 1, 'a tag that the memo has gives no event');
  store.tag(memo.id, 'work', false);
  e = last('untag');
  assert.deepEqual({ actor: e.actor, inferred: e.payload.actor_inferred, tag: e.payload.tag, tags: e.payload.tags }, { actor: 'cam', inferred: true, tag: 'work', tags: ['money'] });

  store.postpone(memo.id, '2026-11-12', 'cam');
  e = last('postpone');
  assert.deepEqual({ actor: e.actor, date: e.payload.date, until: e.payload.until }, { actor: 'cam', date: '2026-11-12', until: '2026-11-12T17:00:00.000Z' });
  store.postpone(memo.id, null, 'cam');
  assert.deepEqual({ date: last('postpone').payload.date, until: last('postpone').payload.until }, { date: null, until: null });

  const boxes = store.send({ ...toCam, text: '- [ ] one\n- [ ] two' }).memo;
  const box = checkBoxes(boxes.text)[0].n;
  store.check(boxes.id, box, true);
  e = last('check');
  assert.deepEqual({ memo_id: e.memo_id, actor: e.actor, n: e.payload.n, on: e.payload.on }, { memo_id: boxes.id, actor: 'cam', n: box, on: true });

  step();
  const done = store.compact(boxes.id, 'main', { text: '- [ ] both' });
  e = last('compact');
  assert.deepEqual({ memo_id: e.memo_id, actor: e.actor, payload: { new: e.payload.new_memo_id, old_text: e.payload.old_text, new_text: e.payload.new_text } },
    { memo_id: boxes.id, actor: 'main', payload: { new: done.memo.id, old_text: '- [x] one\n- [ ] two', new_text: '- [ ] both' } });
  e = last('send');
  assert.deepEqual({ memo_id: e.memo_id, from: e.payload.compacted_from, code: e.payload.code }, { memo_id: done.memo.id, from: boxes.id, code: 'OPS-3' });

  step();
  store.reply(memo.id, 'Yes.', 'cam');
  e = last('reply');
  assert.deepEqual({ actor: e.actor, text: e.payload.text, at: e.at }, { actor: 'cam', text: 'Yes.', at: store.get(memo.id).closed });
  store.ack(memo.id, 'main');
  e = last('ack');
  assert.deepEqual({ actor: e.actor, of: e.payload.of }, { actor: 'main', of: 'result' });

  store.close(done.memo.id, 'Not now.', 'cam');
  e = last('close');
  assert.deepEqual({ actor: e.actor, text: e.payload.text, memo_id: e.memo_id }, { actor: 'cam', text: 'Not now.', memo_id: done.memo.id });

  // A memo from the owner that its agent never got moves to the other agent: the handover job.
  const task = store.send({ from: 'cam', to: 'main', text: 'Do the thing.' }).memo;
  assert.equal(store.move(task.id, 'main', 'second'), true);
  e = last('move');
  assert.deepEqual({ actor: e.actor, from: e.payload.from, to: e.payload.to, recipient: e.payload.recipient }, { actor: SERVER_ACTOR, from: 'main', to: 'second', recipient: 'second' });
  assert.equal(store.move(task.id, 'main', 'second'), false);
  assert.equal(events('move').length, 1, 'a move that did not happen gives no event');

  const kinds = new Set(events().map((x) => x.kind));
  for (const kind of EVENT_KINDS) assert.ok(kinds.has(kind), `the log has a ${kind} event`);
  assert.deepEqual([...kinds].filter((k) => !EVENT_KINDS.includes(k)), [], 'EVENT_KINDS names every kind');
  const ids = events().map((x) => x.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
});

test('an edit keeps the old text and the new text', () => {
  const { store, last } = makeStore();
  const { memo } = store.send(toCam);
  store.edit(memo.id, 'Approve the deploy of Friday?');
  store.edit(memo.id, 'Approve the Friday deploy?');
  const e = last('edit');
  assert.equal(e.payload.old_text, 'Approve the deploy of Friday?');
  assert.equal(e.payload.new_text, 'Approve the Friday deploy?');
  assert.equal(e.actor, 'main', 'with no name, the sender of the memo');
  assert.equal(e.payload.actor_inferred, true);
  assert.equal(store.get(memo.id).text, 'Approve the Friday deploy?');
});

test('a forward and an ack of notes say so in their events', () => {
  const { store, last } = makeStore();
  const dm = store.send({ from: 'discord', to: 'liaison', text: 'Please book the room.', trusted: true }).memo;
  const sent = store.forward(dm.id, 'main');
  assert.deepEqual({ memo_id: last('send').memo_id, actor: last('send').actor, from: last('send').payload.forwarded_from }, { memo_id: sent.memo.id, actor: 'cam', from: dm.id });
  const { memo } = store.send(toCam);
  store.note(memo.id, 'cam', 'Noted, no answer needed.');
  store.ack(memo.id);
  assert.deepEqual({ actor: last('ack').actor, of: last('ack').payload.of, inferred: last('ack').payload.actor_inferred }, { actor: 'main', of: 'notes', inferred: true });
});

test('a reply and a close of the owner say how long she took', () => {
  const { store, clock, last } = makeStore();
  const a = store.send(toCam).memo;
  const b = store.send(toCam).memo;
  const c = store.send({ from: 'cam', to: 'main', text: 'Do the thing.' }).memo;
  clock.t += 600 * SECOND;
  store.reply(a.id, 'Yes.', 'cam');
  assert.deepEqual({ sent: last('reply').payload.seconds_since_sent, seen: last('reply').payload.seconds_since_first_seen, load: last('reply').payload.seconds_since_inbox_load },
    { sent: 600, seen: null, load: null }, 'before the first load of the Inbox, the two are not known');
  store.inboxLoaded();
  clock.t += 30 * SECOND;
  store.seen([b.id]);
  clock.t += 60 * SECOND;
  store.inboxLoaded();
  clock.t += 15 * SECOND;
  store.close(b.id, undefined, 'cam');
  const e = last('close');
  assert.deepEqual({ text: e.payload.text, sent: e.payload.seconds_since_sent, seen: e.payload.seconds_since_first_seen, load: e.payload.seconds_since_inbox_load },
    { text: null, sent: 705, seen: 75, load: 15 }, 'since the last load, and since the memo was first on her screen');
  // The reply of an agent to a memo of the owner has no such times; nor has a close by the server.
  store.reply(c.id, 'Done.', 'main');
  assert.equal(last('reply').payload.seconds_since_sent, undefined);
  const d = store.send(toCam).memo;
  store.close(d.id, 'main works again.', SERVER_ACTOR);
  assert.equal(last('close').actor, SERVER_ACTOR);
  assert.equal(last('close').payload.seconds_since_sent, undefined);
  // With no name, the close of a memo to the owner counts as hers, and the event says that this is a guess.
  const f = store.send(toCam).memo;
  store.close(f.id);
  assert.deepEqual({ actor: last('close').actor, inferred: last('close').payload.actor_inferred, sent: last('close').payload.seconds_since_sent }, { actor: 'cam', inferred: true, sent: 0 });
  assert.throws(() => store.close(store.send(toCam).memo.id, 'x', 'nobody'), /by must be one of/);
});

test('the log is append only: an UPDATE and a DELETE on events fail', () => {
  const { db, store, events } = makeStore();
  store.send(toCam);
  assert.throws(() => db.prepare("UPDATE events SET kind = 'other'").run(), /append only/);
  assert.throws(() => db.prepare('UPDATE events SET payload = ? WHERE id = 1').run('{}'), /append only/);
  assert.throws(() => db.prepare('DELETE FROM events').run(), /append only/);
  assert.throws(() => db.exec('DELETE FROM events WHERE id = 1'), /append only/);
  assert.throws(() => db.prepare('INSERT OR REPLACE INTO events (id, at, kind, actor) VALUES (1, ?, ?, ?)').run('2026-01-01T00:00:00.000Z', 'send', 'main'), /append only/);
  assert.equal(events().length, 1);
  assert.equal(events()[0].kind, 'send');
  assert.equal(events()[0].payload.text, toCam.text);
});

test('a change that fails leaves no event, and an event that fails undoes the change', () => {
  const { db, store, events } = makeStore();
  const { memo } = store.send(toCam);
  store.reply(memo.id, 'Yes.', 'cam');
  const before = events().length;
  assert.throws(() => store.reply(memo.id, 'Yes again.', 'cam'), /cannot change/);
  assert.throws(() => store.send({ ...toCam, impact: 9 }), /impact/);
  assert.throws(() => store.edit(memo.id, 'New text'), /cannot change/);
  assert.equal(events().length, before);

  // The event is in the transaction of the change. A trigger makes the write of 'note' events fail: the note, and
  // the marks it sets, are undone with it.
  const open = store.send(toCam).memo;
  db.exec("CREATE TRIGGER refuse_note BEFORE INSERT ON events WHEN NEW.kind = 'note' BEGIN SELECT RAISE(ABORT, 'no note events'); END");
  assert.throws(() => store.note(open.id, 'cam', 'A question'), /no note events/);
  assert.equal(store.get(open.id).notes, undefined, 'the note is not saved');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notes').get().n, 0);
  db.exec("CREATE TRIGGER refuse_compact BEFORE INSERT ON events WHEN NEW.kind = 'compact' BEGIN SELECT RAISE(ABORT, 'no compact events'); END");
  const count = db.prepare('SELECT COUNT(*) AS n FROM memos').get().n;
  assert.throws(() => store.compact(open.id, 'main', { text: 'Short.' }), /no compact events/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memos').get().n, count, 'the new memo of the compact is undone too');
  assert.equal(store.get(open.id).state, 'open');
  assert.equal(events('send').length, 2, 'and its send event');
  // The store works on after a failed change.
  store.close(open.id, 'ok', 'cam');
  assert.equal(events('close').length, 1);
});

test('a database from before the log gets the table, and its old rows stay as they are', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'memo-events-db-')), 'memo.db');
  const first = makeStore('2026-11-09T18:00:00Z', path);
  const { memo } = first.store.send(toCam);
  first.store.reply(memo.id, 'Yes.', 'cam');
  first.db.exec('DROP TRIGGER events_no_update; DROP TRIGGER events_no_delete; DROP TABLE events;');
  first.db.close();
  const again = makeStore('2026-11-10T18:00:00Z', path);
  assert.deepEqual(again.events(), [], 'no event is made up for an old memo');
  assert.equal(again.store.get(memo.id).reply, 'Yes.');
  again.store.send(toCam);
  assert.equal(again.events().length, 1);
  assert.throws(() => again.db.exec('DELETE FROM events'), /append only/);
});

test('the start of a day in a time zone', () => {
  assert.equal(dayStart('2026-11-09', 'America/Los_Angeles'), '2026-11-09T08:00:00.000Z');
  assert.equal(dayStart('2026-07-01', 'America/Los_Angeles'), '2026-07-01T07:00:00.000Z');
  // The day of the autumn clock change has 25 hours; the day of the spring change 23.
  assert.equal(dayStart('2026-11-01', 'America/Los_Angeles'), '2026-11-01T07:00:00.000Z');
  assert.equal(dayStart('2026-11-02', 'America/Los_Angeles'), '2026-11-02T08:00:00.000Z');
  assert.equal(dayStart('2026-03-08', 'America/New_York'), '2026-03-08T05:00:00.000Z');
  assert.equal(dayStart('2026-03-09', 'America/New_York'), '2026-03-09T04:00:00.000Z');
  assert.equal(dayStart('2026-11-09', 'UTC'), '2026-11-09T00:00:00.000Z');
  assert.equal(dayStart('2026-11-09', 'Asia/Kolkata'), '2026-11-08T18:30:00.000Z');
  assert.equal(dayStart('2026-11-09', 'Pacific/Kiritimati'), '2026-11-08T10:00:00.000Z');
  assert.equal(dayStart('2026-11-09', 'Pacific/Pago_Pago'), '2026-11-09T11:00:00.000Z');
  assert.equal(dayOf(new Date('2026-11-10T07:59:00Z'), 'America/Los_Angeles'), '2026-11-09');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
});

// Three days of events in Los Angeles: the 8th (one send), the 9th (a send, a note, an edit, a reply), the 10th (a send).
function threeDays(path) {
  const made = makeStore('2026-11-09T07:59:59Z', path); // 11:59 PM on the 8th
  const { store, clock } = made;
  store.send({ ...toCam, text: 'The memo of the 8th.' });
  clock.t = Date.parse('2026-11-09T08:00:00Z'); // midnight: the 9th starts
  const { memo } = store.send({ ...toCam, text: 'Pay the invoice of Dr. Ruiz?', next: 'Call 555 0100' });
  clock.t = Date.parse('2026-11-09T20:00:00Z');
  store.note(memo.id, 'cam', 'Which invoice?');
  store.edit(memo.id, 'Pay invoice 12 of Dr. Ruiz?', 'main');
  clock.t = Date.parse('2026-11-10T07:59:59Z'); // 11:59 PM on the 9th
  store.reply(memo.id, 'Yes, pay it.', 'cam');
  clock.t = Date.parse('2026-11-10T08:00:00Z'); // midnight: the 10th starts
  store.send({ ...toCam, text: 'The memo of the 10th.' });
  return made;
}
const lines = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('the export writes the events of the day before, one JSONL file for the day, with no memo text', () => {
  const { db } = threeDays();
  const dir = join(mkdtempSync(join(tmpdir(), 'memo-events-')), 'raw', 'memo-events');
  const done = exportDay({ db, dir, timeZone: 'America/Los_Angeles', now: () => new Date('2026-11-10T08:15:00Z') });
  assert.deepEqual({ day: done.day, path: done.path, count: done.count }, { day: '2026-11-09', path: join(dir, '2026-11-09.jsonl'), count: 4 });
  assert.deepEqual(readdirSync(dir), ['2026-11-09.jsonl'], 'one file, and no part file is left');
  const raw = readFileSync(done.path, 'utf8');
  assert.ok(raw.endsWith('\n'));
  const out = lines(done.path);
  assert.deepEqual(out.map((e) => e.kind), ['send', 'note', 'edit', 'reply'], 'only the 9th, in the order of the log');
  assert.deepEqual(out.map((e) => e.at), ['2026-11-09T08:00:00.000Z', '2026-11-09T20:00:00.000Z', '2026-11-09T20:00:00.000Z', '2026-11-10T07:59:59.000Z']);
  // No text of a memo, a note, an edit or a reply, and no next step, is in the file.
  for (const secret of ['Ruiz', 'invoice', 'Yes, pay it', '555 0100', 'Which']) assert.ok(!raw.includes(secret), `the file must not hold "${secret}"`);
  for (const e of out) for (const key of TEXT_KEYS) assert.ok(!(key in e.payload), `${e.kind} has no ${key}`);
  // The ids, the kinds, the times, the actors, the impact, the effort, the code, the title and the lengths stay.
  assert.deepEqual(out[0], { id: 2, at: '2026-11-09T08:00:00.000Z', kind: 'send', memo_id: 2, actor: 'main',
    payload: { sender: 'main', recipient: 'cam', code: 'OPS-2', title: 'Deploy', impact: 4, effort: 'micro', text_length: 28, next_length: 13, due: null, tags: [], re: [], trusted: 0 } });
  assert.deepEqual(out[1].payload.text_length, 14);
  assert.deepEqual({ actor: out[2].actor, old: out[2].payload.old_text_length, now: out[2].payload.new_text_length }, { actor: 'main', old: 28, now: 27 });
  assert.deepEqual({ actor: out[3].actor, length: out[3].payload.text_length, sent: out[3].payload.seconds_since_sent }, { actor: 'cam', length: 12, sent: 86399 });

  // With the text: the same events, and the bodies too.
  const full = exportDay({ db, dir, day: '2026-11-09', timeZone: 'America/Los_Angeles', withText: true });
  const withText = lines(full.path);
  assert.equal(withText.length, 4);
  assert.equal(withText[0].payload.text, 'Pay the invoice of Dr. Ruiz?');
  assert.equal(withText[0].payload.text_length, 28);
  assert.deepEqual({ old: withText[2].payload.old_text, now: withText[2].payload.new_text }, { old: 'Pay the invoice of Dr. Ruiz?', now: 'Pay invoice 12 of Dr. Ruiz?' });
  assert.equal(withText[3].payload.text, 'Yes, pay it.');

  // A different day, a different zone, an empty day, and a day that is not a date.
  assert.equal(exportDay({ db, dir, day: '2026-11-08', timeZone: 'America/Los_Angeles' }).count, 1);
  assert.equal(exportDay({ db, dir, day: '2026-11-10', timeZone: 'America/Los_Angeles' }).count, 1);
  assert.equal(exportDay({ db, dir, day: '2026-11-09', timeZone: 'UTC' }).count, 4, 'in UTC the 9th has the send of 07:59:59 and not the reply of the 10th');
  const empty = exportDay({ db, dir, day: '2026-11-07', timeZone: 'America/Los_Angeles' });
  assert.equal(empty.count, 0);
  assert.equal(readFileSync(empty.path, 'utf8'), '');
  assert.throws(() => exportDay({ db, dir, day: '2026-02-30' }), /YYYY-MM-DD/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n, 6, 'the export changes nothing');
});

test('exportEvent keeps a payload it cannot read as an empty one', () => {
  assert.deepEqual(exportEvent({ id: 1, at: 'a', kind: 'send', memo_id: 2, actor: 'main', payload: 'not json' }),
    { id: 1, at: 'a', kind: 'send', memo_id: 2, actor: 'main', payload: {} });
  assert.deepEqual(exportEvent({ id: 1, at: 'a', kind: 'close', memo_id: 2, actor: 'cam', payload: '{"text":null,"title":"T"}' }).payload, { text_length: null, title: 'T' });
});

test('scripts/export-events.js writes the file of a day to the folder of its argument, of --out, or of MEMO_EVENTS_DIR', async () => {
  const run = promisify(execFile);
  const base = mkdtempSync(join(tmpdir(), 'memo-events-script-'));
  const dbPath = join(base, 'data', 'memo.db');
  mkdirSync(join(base, 'data'));
  threeDays(dbPath).db.close();
  const script = join(ROOT, 'scripts', 'export-events.js');
  const env = { ...process.env, DATABASE_PATH: dbPath, MEMO_TZ: 'America/Los_Angeles', MEMO_EVENTS_DIR: join(base, 'from-env') };
  const node = (args, e = env) => run(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...args], { env: e });

  const a = await node(['--out', join(base, 'out'), '--day', '2026-11-09']);
  assert.match(a.stdout, /^4 event\(s\) of 2026-11-09 \(America\/Los_Angeles\) are in .*out\/2026-11-09\.jsonl, with no memo text\.\n$/);
  const out = readFileSync(join(base, 'out', '2026-11-09.jsonl'), 'utf8');
  assert.equal(out.split('\n').filter(Boolean).length, 4);
  assert.ok(!out.includes('Ruiz'));

  const b = await node([join(base, 'arg'), '--day', '2026-11-09', '--with-text', '--tz', 'UTC']);
  assert.match(b.stdout, /\(UTC\).*with the memo text/);
  assert.ok(readFileSync(join(base, 'arg', '2026-11-09.jsonl'), 'utf8').includes('Pay the invoice of Dr. Ruiz?'));

  // With no day: the day before today, by the real clock, in the folder of MEMO_EVENTS_DIR.
  const c = await node([]);
  const yesterday = shiftDay(dayOf(new Date(), 'America/Los_Angeles'), -1);
  assert.match(c.stdout, new RegExp(`^\\d+ event\\(s\\) of ${yesterday} `));
  assert.deepEqual(readdirSync(join(base, 'from-env')), [`${yesterday}.jsonl`]);

  await assert.rejects(node(['--day', 'tomorrow']), /YYYY-MM-DD/);
  await assert.rejects(node(['--text']), /not a known option/);
  await assert.rejects(node(['--tz', 'Mars/Phobos']), /not a time zone name/);
  await assert.rejects(node([], { ...env, DATABASE_PATH: join(base, 'none.db') }), /did not open/);
});

test('the routes give the actor to the log: by of the request, the liaison for its token, and the load of the Inbox', async () => {
  const { app, db } = makeApp();
  const last = (kind) => { const e = db.prepare('SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind); return e && { ...e, payload: JSON.parse(e.payload) }; };
  const sent = (await call(app, '/api/send', { from: 'main', to: 'cam', text: 'Approve?', impact: 3, effort: 'short' })).data.memo;
  assert.equal(last('send').actor, 'main');
  assert.equal((await call(app, '/api/client-tz', { timeZone: 'America/Los_Angeles' })).status, 200);
  assert.deepEqual({ actor: last('inbox_load').actor, zone: last('inbox_load').payload.time_zone }, { actor: 'cam', zone: 'America/Los_Angeles' });
  assert.equal((await call(app, '/api/client-tz', { timeZone: 'Nowhere/None' })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'inbox_load'").get().n, 1);

  await call(app, '/api/seen', { ids: [sent.id] });
  await call(app, '/api/adjust', { id: sent.id, delta: 1, by: 'cam' });
  assert.equal(last('impact').payload.actor_inferred, undefined);
  await call(app, '/api/tag', { id: sent.id, tag: 'work', on: true, by: 'main' });
  assert.equal(last('tag').actor, 'main');
  await call(app, '/api/postpone', { id: sent.id, date: null, by: 'cam' });
  assert.equal(last('postpone').actor, 'cam');
  await call(app, '/api/brief', { id: sent.id, title: 'Approve', by: 'main' });
  assert.equal(last('brief').actor, 'main');
  await call(app, '/api/edit', { id: sent.id, text: 'Approve it?' });
  assert.deepEqual({ actor: last('edit').actor, inferred: last('edit').payload.actor_inferred, old: last('edit').payload.old_text }, { actor: 'main', inferred: true, old: 'Approve?' });
  assert.equal((await call(app, '/api/reply', { id: sent.id, text: 'Yes.', by: 'nobody' })).status, 400);
  assert.equal((await call(app, '/api/reply', { id: sent.id, text: 'Yes.', by: SERVER_ACTOR })).status, 400, 'a request cannot be the server');
  assert.equal(last('reply'), undefined, 'a refused reply leaves no event');
  const replied = (await call(app, '/api/reply', { id: sent.id, text: 'Yes.', by: 'cam' })).data;
  const e = last('reply');
  assert.deepEqual({ actor: e.actor, at: e.at }, { actor: 'cam', at: replied.closed });
  for (const key of ['seconds_since_sent', 'seconds_since_first_seen', 'seconds_since_inbox_load']) assert.equal(typeof e.payload[key], 'number', key);
  await call(app, '/api/ack', { id: sent.id, by: 'main' });
  assert.equal(last('ack').actor, 'main');

  // The liaison token is the liaison, whatever the request says.
  const toLiaison = (await call(app, '/api/send', { from: 'discord', to: 'liaison', text: 'Hello' })).data.memo;
  assert.equal((await call(app, '/api/close', { id: toLiaison.id, text: 'Read.', by: 'cam' }, LIAISON_TOKEN)).status, 200);
  assert.deepEqual({ actor: last('close').actor, sent: last('close').payload.seconds_since_sent }, { actor: 'liaison', sent: undefined });
});
