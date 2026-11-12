import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call } from './helpers.js';
import { WAIT_EVERY_MS, FAST_POLL_MS, TRACK_MAX_MS, DONE_SHOW_MS, STEPS, EXPLAIN, trackOf, stageOf, keepTracks } from '../ui/sendstage.js';

// The line that follows a memo from Send to its agent (memo 1407, ui/sendstage.js), and what the server reports for it.
const now = new Date('2026-11-10T18:00:20Z');
const long = { name: 'main', kind: 'long', running: true, activity: 'idle', waited: null, memos_to: [] };
const memo = (id, delivered) => ({ id, code: null, title: null, line: 'Work.', created: '2026-11-10T18:00:00Z', ...(delivered ? { delivered } : {}) });
const track = { id: 7, to: 'main', at: Date.parse('2026-11-10T18:00:00Z'), nudged: false };
const words = (agents, t = track, options = {}) => { const s = stageOf(t, agents, { now, ...options }); return [s.step, s.key, s.words, s.done]; };

test('trackOf takes the memo of the answer of a send; the temporary memo of the GitHub copy is not tracked', () => {
  assert.deepEqual(trackOf({ memo: { id: 7, recipient: 'main' }, corrections: [] }, now), { id: 7, to: 'main', at: now.getTime(), nudged: false });
  assert.equal(trackOf({ memo: { id: 7, recipient: 'main' }, nudged: true }, now).nudged, true);
  assert.equal(trackOf({ memo: { id: 't-abc' }, corrections: [] }, now), null);
  assert.equal(trackOf(null, now), null);
  assert.equal(trackOf({}, now), null);
});

test('stageOf says what the server reports: saved, waiting for the question of the agent, picked up', () => {
  assert.deepEqual(STEPS, ['Saved', 'Waiting', 'Picked up']);
  assert.deepEqual([WAIT_EVERY_MS, FAST_POLL_MS, TRACK_MAX_MS, DONE_SHOW_MS], [30000, 3000, 600000, 8000]);
  assert.match(EXPLAIN, /in the database on your Mac: nothing is in the cloud yet and no agent is deciding/);
  // Before an answer of the agents from after the send, the page knows only that the server has the memo.
  assert.deepEqual(words([{ ...long, memos_to: [memo(7)] }], track, { fresh: false }), [0, 'saved', 'Memo 7 is saved on your Mac for Peeve', false]);
  // The agent sits in memo wait: its last question was 20 seconds ago, so the next comes in 10.
  assert.deepEqual(words([{ ...long, waited: '2026-11-10T18:00:00Z', memos_to: [memo(7)] }]),
    [1, 'waiting', 'Waiting for Peeve to ask for news: it asks each 30 seconds, next in about 10 seconds', false]);
  // The words name the agents as the pages show them (memo 1408): main is Peeve, second is Darkness, gpt is Landon.
  assert.equal(words([{ ...long, waited: '2026-11-10T17:59:51Z', memos_to: [memo(7)] }])[2], 'Waiting for Peeve to ask for news: it asks each 30 seconds, next in about 1 second');
  assert.equal(words([{ ...long, waited: '2026-11-10T17:59:45Z', memos_to: [memo(7)] }])[2], 'Waiting for Peeve to ask for news: it asks each 30 seconds, next any moment now');
  // Idle with no recent question: at its prompt. With a nudge the server typed the wake-up; with none, only the rule.
  assert.equal(words([{ ...long, memos_to: [memo(7)] }])[2], 'Waiting for Peeve to ask for news; it asks each 30 seconds');
  assert.deepEqual(words([{ ...long, memos_to: [memo(7)] }], { ...track, nudged: true }), [1, 'waiting', 'Memo typed a wake-up into the session of Peeve; it is starting a turn', false]);
  // In a turn, stopped, stopping, blocked, offline: the memo waits, and the line says on what.
  assert.deepEqual(words([{ ...long, activity: 'working', memos_to: [memo(7)] }]), [1, 'busy', 'Peeve is in the middle of a turn and reads its queue when the turn ends', false]);
  assert.deepEqual(words([{ ...long, running: false, activity: 'stopped', memos_to: [memo(7)] }]), [1, 'held', 'Peeve is stopped: the memo waits until you start it on the Agents page', false]);
  assert.equal(words([{ ...long, activity: 'stopping', stopping_since: '2026-11-10T18:00:00Z', memos_to: [memo(7)] }])[2], 'Peeve is stopping: the memo waits for its next session');
  assert.deepEqual(words([{ ...long, activity: 'blocked', blocked: { reason: 'permission' }, memos_to: [memo(7)] }]).slice(0, 3), [1, 'held', 'Peeve waits on you for a permission or a sign-in, and reads the memo after that']);
  assert.equal(words([{ name: 'mac', kind: 'remote', online: false, activity: 'offline', memos_to: [memo(7)] }], { ...track, to: 'mac' })[2], 'mac is offline: the memo waits on your Mac until its computer asks for news');
  // The desktop worker: the wakeup in the Codex desktop app.
  const gpt = { name: 'gpt', kind: 'remote', runtime: 'codex-desktop', online: true, activity: 'idle', memos_to: [memo(7)] };
  assert.equal(words([{ ...gpt, dispatch: { state: 'queued' } }], { ...track, to: 'gpt' })[2], 'A wake-up for Landon is queued in the Codex desktop app');
  assert.equal(words([{ ...gpt, dispatch: { state: 'sending' } }], { ...track, to: 'gpt' })[2], 'Memo is waking Landon in the Codex desktop app');
  assert.deepEqual(words([{ ...gpt, dispatch: { state: 'uncertain' } }], { ...track, to: 'gpt' }).slice(0, 3), [1, 'held', 'The wake-up of Landon was not confirmed: see the Agents page']);
  // The agent has the memo: the last stage, and the line can go.
  assert.deepEqual(words([{ ...long, activity: 'working', memos_to: [memo(7, '2026-11-10T18:00:15Z')] }]), [2, 'picked', 'Peeve has memo 7 and is working', true]);
  assert.deepEqual(words([{ ...long, memos_to: [memo(7, '2026-11-10T18:00:15Z')] }]), [2, 'picked', 'Peeve has memo 7', true]);
  // The handover job moved the memo to the other agent: the line follows it.
  const second = { ...long, name: 'second', waited: '2026-11-10T18:00:10Z', memos_to: [memo(7)] };
  assert.equal(words([long, second])[2], 'Waiting for Darkness to ask for news: it asks each 30 seconds, next in about 20 seconds (moved from Peeve)');
  assert.equal(words([long, { ...second, memos_to: [memo(7, '2026-11-10T18:00:15Z')] }])[2], 'Darkness has memo 7 (moved from Peeve)');
  // The memo is in no list: the agent closed it already. A server from before the lists says nothing.
  assert.deepEqual(words([long]), [2, 'closed', 'Peeve closed memo 7', true]);
  assert.deepEqual(words([{ name: 'main', kind: 'long', running: true }]), [0, 'saved', 'Memo 7 is saved on your Mac for Peeve', true]);
});

test('keepTracks: a memo leaves the line a few seconds after its last stage, or ten minutes after the send', () => {
  const doneAt = new Map();
  const waiting = [{ ...long, waited: '2026-11-10T18:00:00Z', memos_to: [memo(7)] }];
  const picked = [{ ...long, activity: 'working', memos_to: [memo(7, '2026-11-10T18:00:15Z')] }];
  const at = (seconds) => new Date(track.at + seconds * 1000);
  assert.deepEqual(keepTracks([track], waiting, doneAt, { now: at(20) }), [track]);
  assert.equal(doneAt.size, 0);
  assert.deepEqual(keepTracks([track], picked, doneAt, { now: at(21) }), [track], 'the last stage stays in view');
  assert.equal(doneAt.get(7), at(21).getTime());
  assert.deepEqual(keepTracks([track], picked, doneAt, { now: at(21 + DONE_SHOW_MS / 1000) }), [track]);
  assert.deepEqual(keepTracks([track], picked, doneAt, { now: at(22 + DONE_SHOW_MS / 1000) }), []);
  assert.equal(doneAt.size, 0);
  // A memo that still waits after ten minutes leaves the line; the card of the agent says the rest.
  assert.deepEqual(keepTracks([track], waiting, doneAt, { now: at(TRACK_MAX_MS / 1000) }), [track]);
  assert.deepEqual(keepTracks([track], waiting, doneAt, { now: at(TRACK_MAX_MS / 1000 + 1) }), []);
  // Before a fresh answer of the agents the memo is saved, whatever the old answer says.
  assert.deepEqual(keepTracks([track], [long], doneAt, { now: at(1), fresh: () => false }), [track]);
  assert.equal(doneAt.size, 0);
});

test('the server reports each stage: the nudge in the answer of a send, the last question of the agent, the delivery of the memo', async () => {
  let clock = new Date('2026-11-10T18:00:00Z');
  const { app, agents } = makeApp({ now: () => clock });
  const advance = (seconds) => { clock = new Date(clock.getTime() + seconds * 1000); };
  const main = async () => (await call(app, '/api/agents')).data[0];
  agents.start('main');
  // The session sits at its prompt (no question in the last minute): the server types the wake-up, and says so.
  const first = (await call(app, '/api/send', { from: 'cam', to: 'main', text: 'One.' })).data;
  assert.equal(first.nudged, true);
  assert.deepEqual(trackOf(first, clock), { id: 1, to: 'main', at: clock.getTime(), nudged: true });
  assert.equal((await main()).waited, null);
  assert.equal('delivered' in (await main()).memos_to[0], false, 'the agent does not have the memo yet');
  // memo wait asks for news and gets the memo: it is delivered, and the agent goes to work.
  advance(5);
  await call(app, '/api/news?for=main');
  let a = await main();
  assert.match(a.memos_to[0].delivered, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(a.waited, null, 'a question that brought news is no wait');
  assert.deepEqual(stageOf(trackOf(first, clock), [a], { now: clock }).key, 'picked');
  await call(app, '/api/close', { id: 1, by: 'main' });
  // The agent waits again: a question with no news, and its time for the Inbox.
  advance(10);
  await call(app, '/api/news?for=main');
  assert.equal((await main()).waited, '2026-11-10T18:00:15.000Z');
  // A memo now is not nudged (the agent asks by itself), and the line counts the seconds to its next question.
  advance(12);
  const second = (await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Two.' })).data;
  assert.equal('nudged' in second, false);
  a = await main();
  assert.deepEqual(stageOf(trackOf(second, clock), [a], { now: clock }).words, 'Waiting for Peeve to ask for news: it asks each 30 seconds, next in about 18 seconds');
  advance(18);
  await call(app, '/api/news?for=main');
  assert.equal(stageOf(trackOf(second, clock), [await main()], { now: clock }).words, 'Peeve has memo 2 and is working');
  // A question from more than a minute ago is no sign of a wait.
  await call(app, '/api/close', { id: 2, by: 'main' });
  await call(app, '/api/news?for=main');
  advance(61);
  assert.equal((await main()).waited, null);
  // The Inbox shows the line under the capture field, and the server gives the file.
  const inbox = await (await app.request('/inbox')).text();
  assert.match(inbox, /<div id="sent-track" class="sent-track" hidden><\/div>/);
  assert.match(inbox, /^import\('\/ui\/sendstage\.js'\)\.then\(\(m\) => \{ stage = m; \}\)\.catch\(\(\) => \{\}\);$/m);
  assert.match(inbox, /track\(await api\('\/api\/send', \{ from: 'cam', to, text:/);
  assert.match((await app.request('/ui/sendstage.js')).headers.get('content-type'), /javascript/);
  const css = await (await app.request('/ui/common.css')).text();
  assert.match(css, /^\.sent-row \.steps i\.now \{ box-shadow: inset 0 0 0 2px var\(--accent\); animation: sent-pulse 1\.4s ease-in-out infinite; \}$/m);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.sent-row \.steps i\.now, \.sent-row \.steps i\.now \+ i::before \{ animation: none; \}/);
});
