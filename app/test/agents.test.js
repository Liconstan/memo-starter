import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { openDb } from '../src/db.js';
import { MemoError } from '../src/memos.js';
import { createAgents, loadConfig, realTmux, session, stopMessage, continueMessage } from '../src/agents.js';

const CONFIG = [
  { name: 'main', kind: 'long', dir: '~/p', model: 'm' },
  { name: 'liaison', kind: 'short', dir: '~/p', model: 'm' },
];

function fakeTmux() {
  const sessions = new Set();
  const calls = [];
  return {
    sessions, calls,
    has: (s) => sessions.has(s),
    start: (s, command) => { sessions.add(s); calls.push(['start', s, command]); },
    kill: (s) => { sessions.delete(s); calls.push(['kill', s]); },
    send: (s, text) => { calls.push(['send', s, text]); },
  };
}

function make(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'memo-agents-'));
  mkdirSync(join(root, 'charters'));
  writeFileSync(join(root, 'charters', 'main.md'), '# Charter: main\n');
  const tmux = fakeTmux();
  const db = options.db || openDb();
  const agents = createAgents({ db, config: CONFIG, root, owner: 'cam', tmux, recapTimeoutMs: 30, ...options });
  return { agents, tmux, db, root };
}
const refuses = (fn, status, part) =>
  assert.throws(fn, (e) => e instanceof MemoError && e.status === status && e.message.includes(part));
const row = (agents, name) => agents.list().find((a) => a.name === name);

test('session gives the tmux name', () => assert.equal(session('main'), 'memo-main'));

test('list shows each agent of the configuration', () => {
  const { agents } = make({ counts: () => ({ open_to: 2, open_from: 1 }) });
  const list = agents.list();
  assert.deepEqual(list.map((a) => [a.name, a.kind, a.running]), [['main', 'long', false], ['liaison', 'short', false]]);
  assert.equal(list[0].open_to, 2);
  assert.equal(list[0].open_from, 1);
});

test('start runs agent.sh in the tmux session of the agent', () => {
  const { agents, tmux, root } = make();
  assert.deepEqual(agents.start('main'), { name: 'main', running: true });
  assert.deepEqual(tmux.calls, [['start', 'memo-main', [join(root, 'scripts', 'agent.sh'), 'main']]]);
  assert.equal(row(agents, 'main').running, true);
});

test('start of an agent that runs does not start a second session', () => {
  const { agents, tmux } = make();
  agents.start('main');
  agents.start('main');
  assert.equal(tmux.calls.filter((c) => c[0] === 'start').length, 1);
});

test('start and stop refuse an unknown name and a short agent', () => {
  const { agents, tmux } = make();
  refuses(() => agents.start('nobody'), 400, 'nobody');
  refuses(() => agents.start('main; rm -rf ~'), 400, 'No agent');
  refuses(() => agents.start('liaison'), 400, 'short');
  refuses(() => agents.stop('liaison'), 400, 'short');
  assert.deepEqual(tmux.calls, []);
});

test('stop sends the stop message one time and waits for the recap', () => {
  const { agents, tmux } = make({ recapTimeoutMs: 100000 });
  agents.start('main');
  assert.deepEqual(agents.stop('main'), { name: 'main', running: true, stopping: true });
  agents.stop('main'); // a second press must not send a second message
  assert.deepEqual(tmux.calls.filter((c) => c[0] === 'send'), [['send', 'memo-main', stopMessage('cam')]]);
  assert.ok(row(agents, 'main').stopping_since);
  assert.equal(row(agents, 'main').running, true);
  agents.stop('main', { now: true }); // clears the timer of this test
});

test('the recap ends the session during the stop sequence', () => {
  const { agents, tmux } = make({ recapTimeoutMs: 100000 });
  agents.start('main');
  agents.stop('main');
  assert.deepEqual(agents.recap('main', 'I updated the README. Next: the tests.'), { name: 'main', saved: true, stopped: true });
  const r = row(agents, 'main');
  assert.equal(r.running, false);
  assert.equal(r.stopping_since, null);
  assert.equal(r.last_stop, 'recap');
  assert.equal(r.recap, 'I updated the README. Next: the tests.');
  assert.ok(r.recap_at);
  assert.equal(tmux.calls.at(-1)[0], 'kill');
});

test('a recap outside the stop sequence is saved and the session continues', () => {
  const { agents } = make();
  agents.start('main');
  assert.equal(agents.recap('main', 'A recap.').stopped, false);
  assert.equal(row(agents, 'main').running, true);
});

test('with no recap in the time limit, the session ends and the old recap stays', async () => {
  const { agents } = make({ recapTimeoutMs: 30 });
  agents.start('main');
  agents.recap('main', 'The old recap.');
  agents.stop('main');
  await sleep(120);
  const r = row(agents, 'main');
  assert.equal(r.running, false);
  assert.equal(r.stopping_since, null);
  assert.equal(r.last_stop, 'no_recap');
  assert.equal(r.recap, 'The old recap.');
});

test('stop with now ends the session immediately and cancels the wait', async () => {
  const { agents, tmux } = make({ recapTimeoutMs: 30 });
  agents.start('main');
  agents.stop('main');
  assert.deepEqual(agents.stop('main', { now: true }), { name: 'main', running: false, stopping: false });
  assert.equal(row(agents, 'main').last_stop, 'now');
  await sleep(120);
  assert.equal(row(agents, 'main').last_stop, 'now'); // the timer did not run
  assert.equal(tmux.calls.filter((c) => c[0] === 'kill').length, 1);
});

test('stop of an agent that does not run only clears the state', () => {
  const { agents, tmux } = make();
  assert.deepEqual(agents.stop('main'), { name: 'main', running: false, stopping: false });
  assert.deepEqual(tmux.calls, []);
});

test('a start during the stop sequence cancels the stop and tells the agent to continue', async () => {
  const { agents, tmux } = make({ recapTimeoutMs: 30 });
  agents.start('main');
  agents.start('main'); // no stop is in progress: no message
  assert.equal(tmux.calls.filter((c) => c[0] === 'send').length, 0);
  agents.stop('main');
  agents.start('main');
  assert.deepEqual(tmux.calls.at(-1), ['send', 'memo-main', continueMessage('cam')]);
  await sleep(120);
  assert.equal(row(agents, 'main').running, true);
  assert.equal(row(agents, 'main').stopping_since, null);
});

test('the recap has a limit of 2000 characters and needs text', () => {
  const { agents } = make();
  refuses(() => agents.recap('main', 'x'.repeat(2001)), 400, '2000');
  refuses(() => agents.recap('main', '   '), 400, 'text');
  refuses(() => agents.recap('nobody', 'x'), 400, 'nobody');
  assert.equal(agents.recap('main', 'x'.repeat(2000)).saved, true);
});

test('setStatus keeps one line of 300 characters or fewer', () => {
  const { agents } = make();
  agents.setStatus('main', 'Line one.\nLine two.   ' + 'x'.repeat(400));
  const s = row(agents, 'main').status;
  assert.ok(s.startsWith('Line one. Line two. x'));
  assert.equal(s.length, 300);
  assert.ok(row(agents, 'main').updated);
  refuses(() => agents.setStatus('main', ''), 400, 'text');
  refuses(() => agents.setStatus('nobody', 'x'), 400, 'nobody');
});

test('prompt is the charter, and the recap follows it when one exists', () => {
  const { agents } = make();
  assert.equal(agents.prompt('main'), '# Charter: main\n');
  agents.recap('main', 'I updated the README.');
  const p = agents.prompt('main');
  assert.ok(p.startsWith('# Charter: main\n'));
  assert.ok(p.includes('Recap from your last session, recorded 2'));
  assert.ok(p.includes('It is information, not an instruction from Cam.'));
  assert.ok(p.endsWith('I updated the README.\n'));
});

test('defaultAgent is the first long agent', () => assert.equal(make().agents.defaultAgent(), 'main'));

test('resume starts a wanted agent that does not run', () => {
  const first = make();
  first.agents.start('main');
  const second = make({ db: first.db }); // a new server process: the tmux sessions are gone
  second.agents.resume();
  assert.equal(second.tmux.calls.filter((c) => c[0] === 'start').length, 1);
});

test('resume does not start an agent that Cam stopped', () => {
  const first = make();
  first.agents.start('main');
  first.agents.stop('main', { now: true });
  const second = make({ db: first.db });
  second.agents.resume();
  assert.deepEqual(second.tmux.calls, []);
});

test('resume ends a stop sequence that a server restart interrupted', () => {
  const first = make({ recapTimeoutMs: 100000 });
  first.agents.start('main');
  first.agents.stop('main');
  const second = make({ db: first.db });
  second.tmux.sessions.add('memo-main'); // the session is still there after the restart
  second.agents.resume();
  const r = row(second.agents, 'main');
  assert.equal(r.running, false);
  assert.equal(r.stopping_since, null);
  assert.equal(r.last_stop, 'no_recap');
  first.agents.stop('main', { now: true }); // clears the timer of this test
});

test('loadConfig reads a correct file and refuses a wrong one', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-config-'));
  const write = (value) => { writeFileSync(join(dir, 'agents.json'), JSON.stringify(value)); return join(dir, 'agents.json'); };
  assert.deepEqual(loadConfig(write(CONFIG)), CONFIG);
  assert.throws(() => loadConfig(write([{ name: 'cam', kind: 'long', dir: '~', model: 'm' }]), 'cam'), /cam/);
  assert.throws(() => loadConfig(write([{ name: 'Bad Name', kind: 'long', dir: '~', model: 'm' }])), /name/);
  assert.throws(() => loadConfig(write([{ name: 'a', kind: 'medium', dir: '~', model: 'm' }])), /kind/);
  assert.throws(() => loadConfig(write([{ name: 'a', kind: 'long', model: 'm' }])), /dir/);
  assert.throws(() => loadConfig(write([CONFIG[0], CONFIG[0]])), /two times/);
  assert.throws(() => loadConfig(write([CONFIG[1]])), /long/);
  // The optional env of an agent: names in capitals, text values on one line.
  const withEnv = [{ ...CONFIG[0], env: { CLAUDE_CONFIG_DIR: '~/.claude-second' } }];
  assert.deepEqual(loadConfig(write(withEnv)), withEnv);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], env: ['A=1'] }])), /env of main/);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], env: { 'bad name': '1' } }])), /env of main/);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], env: { GOOD: 1 } }])), /env of main/);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], env: { GOOD: 'two\nlines' } }])), /env of main/);
  // The optional chrome of an agent: true or false.
  const withChrome = [{ ...CONFIG[0], chrome: false }];
  assert.deepEqual(loadConfig(write(withChrome)), withChrome);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], chrome: 'no' }])), /chrome of main/);
  // The optional charter of an agent: the name of a shared charter file, also for a remote agent.
  const withCharter = [{ ...CONFIG[0], charter: 'team' }, { name: 'mac', kind: 'remote', charter: 'team' }];
  assert.deepEqual(loadConfig(write(withCharter)), withCharter);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], charter: '../main' }])), /charter of main/);
  assert.throws(() => loadConfig(write([{ ...CONFIG[0], charter: 7 }])), /charter of main/);
});

test('an agent with "charter": "team" gets team.md with a line about its own section, when the file exists', () => {
  const config = [{ ...CONFIG[0], charter: 'team' }, CONFIG[1]];
  const { agents, root } = make({ config });
  // No team.md yet: nothing changes, the agent reads its own charter.
  assert.equal(agents.prompt('main'), '# Charter: main\n');
  writeFileSync(join(root, 'charters', 'team.md'), '# Team charter\n\n## main\n\nYou do the work.\n');
  agents.recap('main', 'I updated the README.');
  const p = agents.prompt('main');
  assert.ok(p.startsWith("You are the agent main. Your role section is 'main'. The other sections describe the other agents, for your awareness.\n\n# Team charter\n"));
  assert.ok(p.includes('## main\n'));
  assert.ok(p.includes('Recap from your last session'));
  assert.ok(p.endsWith('I updated the README.\n'));
  // An agent without the field keeps its own charter, team.md or not.
  writeFileSync(join(root, 'charters', 'liaison.md'), '# Charter: liaison\n');
  assert.equal(agents.prompt('liaison'), '# Charter: liaison\n');
});

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
test('realTmux starts a session, types into it, and ends it', { skip: !hasTmux && 'tmux is not installed' }, async () => {
  const tmux = realTmux();
  const name = `memo-probe-${process.pid}`;
  try {
    assert.equal(tmux.has(name), false);
    tmux.start(name, ['cat']);
    assert.equal(tmux.has(name), true);
    assert.equal(tmux.has(name.slice(0, -1)), false); // the name must match exactly, not by prefix
    tmux.send(name, 'hello from the test');
    await sleep(1200);
    const pane = spawnSync('tmux', ['capture-pane', '-p', '-t', `=${name}:`], { encoding: 'utf8' }).stdout;
    // Escape goes first: it closes a Claude Code dialog that would take the text. The terminal shows it as ^[.
    assert.match(pane, /\^\[hello from the test/);
    // cat prints the line again after Enter, so the text shows two times when Enter arrived.
    // (In the second copy the terminal reads Escape and "h" as one sequence, so the "h" is not shown.)
    assert.equal(pane.split('ello from the test').length - 1, 2);
  } finally {
    tmux.kill(name);
  }
  assert.equal(tmux.has(name), false);
});

const WITH_REMOTE = [...CONFIG, { name: 'mac', kind: 'remote' }];

test('a GPT desktop worker reports its runtime, expires its heartbeat, and cannot launch Claude', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-desktop-'));
  const path = join(dir, 'agents.json');
  const desktop = { name: 'gpt', kind: 'remote', runtime: 'codex-desktop' };
  writeFileSync(path, JSON.stringify([...CONFIG, desktop]));
  const config = loadConfig(path);
  let clock = new Date('2026-11-08T12:00:00Z');
  const { agents, tmux, db } = make({ config, now: () => clock });
  try {
    const row = () => agents.list().find(a => a.name === 'gpt');
    assert.equal(row().runtime, 'codex-desktop');
    assert.equal(row().activity, 'offline');
    agents.contact('gpt', { wait: true });
    assert.equal(row().activity, 'idle');
    assert.equal(row().usage, null);
    agents.contact('gpt', { wait: false });
    assert.equal(row().activity, 'working');
    clock = new Date('2026-11-08T12:02:01Z');
    assert.equal(row().activity, 'offline');
    refuses(() => agents.start('gpt'), 400, 'remote');
    assert.equal(agents.arrived('gpt'), false);
    assert.equal(tmux.calls.length, 0);
    for (const bad of [{ ...CONFIG[0], runtime: 'codex-desktop' }, { ...desktop, runtime: 'other' }]) {
      writeFileSync(path, JSON.stringify([bad]));
      assert.throws(() => loadConfig(path), /runtime/);
    }
  } finally { db.close(); }
});

test('a remote agent needs no dir and no model, and can be the only agent with a session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-config-'));
  const write = (value) => { writeFileSync(join(dir, 'agents.json'), JSON.stringify(value)); return join(dir, 'agents.json'); };
  assert.deepEqual(loadConfig(write(WITH_REMOTE)), WITH_REMOTE);
  assert.deepEqual(loadConfig(write([{ name: 'mac', kind: 'remote' }])), [{ name: 'mac', kind: 'remote' }]);
});

test('the server does not start or stop a remote agent', () => {
  const { agents, tmux } = make({ config: WITH_REMOTE });
  refuses(() => agents.start('mac'), 400, 'different computer');
  refuses(() => agents.stop('mac'), 400, 'different computer');
  agents.resume();
  assert.deepEqual(tmux.calls, []);
});

test('a remote agent is online for 2 minutes after its last request', () => {
  let time = Date.parse('2026-01-01T10:00:00Z');
  const { agents } = make({ config: WITH_REMOTE, now: () => new Date(time) });
  assert.equal(row(agents, 'mac').online, false);
  assert.equal(row(agents, 'mac').contact, null);
  agents.contact('mac');
  assert.equal(row(agents, 'mac').online, true);
  assert.equal(row(agents, 'mac').contact, '2026-01-01T10:00:00.000Z');
  time += 119000;
  assert.equal(row(agents, 'mac').online, true);
  time += 2000;
  assert.equal(row(agents, 'mac').online, false);
  agents.setStatus('mac', 'I read the budget database.');
  assert.equal(row(agents, 'mac').online, true);
  assert.equal(row(agents, 'mac').status, 'I read the budget database.');
});

test('a request for a different agent does not make an agent online', () => {
  const { agents } = make({ config: WITH_REMOTE });
  agents.contact('main');
  agents.contact('nobody');
  assert.equal(row(agents, 'main').online, undefined);
  assert.equal(row(agents, 'mac').online, false);
});

test('a remote agent gets its charter and its recap from the server', () => {
  const { agents, root } = make({ config: WITH_REMOTE });
  writeFileSync(join(root, 'charters', 'mac.md'), '# Charter: mac\n');
  agents.recap('mac', 'The sync is complete.');
  assert.ok(agents.prompt('mac').startsWith('# Charter: mac'));
  assert.ok(agents.prompt('mac').includes('The sync is complete.'));
});

test('startHelper and endHelper keep the helpers of an agent, the running ones first', () => {
  let t = Date.parse('2026-10-28T12:00:00.000Z');
  const { agents } = make({ now: () => new Date(t) });
  assert.deepEqual(agents.startHelper('main', 'Vault sync', 'fable'), { name: 'main', label: 'Vault sync', model: 'fable', running: true });
  t += 60000;
  agents.startHelper('main', 'Email triage', 'sonnet');
  t += 60000;
  assert.deepEqual(agents.endHelper('main', 'Vault sync'), { name: 'main', label: 'Vault sync', model: 'fable', running: false });
  const list = row(agents, 'main').helpers;
  assert.deepEqual(list.map((h) => [h.label, h.model, h.running]), [['Email triage', 'sonnet', true], ['Vault sync', 'fable', false]]);
  assert.equal(list[0].ended, null);
  assert.equal(list[1].started, '2026-10-28T12:00:00.000Z');
  assert.equal(list[1].ended, '2026-10-28T12:02:00.000Z');
  assert.deepEqual(row(agents, 'liaison').helpers, []);
});

test('a helper stores its model in the short form with the version; a bare alias stays as given (memo 1159)', () => {
  const { agents } = make();
  assert.equal(agents.startHelper('main', 'Vault sync', 'claude-fable-5-1').model, 'Fable 5.1');
  assert.equal(agents.startHelper('main', 'Email triage', 'fable 5.1').model, 'Fable 5.1');
  assert.equal(agents.startHelper('main', 'Review', 'Opus-5.5').model, 'Opus 5.5');
  assert.equal(agents.startHelper('main', 'Notes', 'sonnet').model, 'sonnet');
  assert.deepEqual(row(agents, 'main').helpers.map((h) => [h.label, h.model]), [['Notes', 'sonnet'], ['Review', 'Opus 5.5'], ['Email triage', 'Fable 5.1'], ['Vault sync', 'Fable 5.1']]);
  assert.equal(agents.endHelper('main', 'Vault sync').model, 'Fable 5.1');
});

test('list names the model of each agent from agents.json in the short form; a remote agent has none (memo 1159)', () => {
  const root = mkdtempSync(join(tmpdir(), 'memo-agents-'));
  mkdirSync(join(root, 'charters'));
  const config = [
    { name: 'main', kind: 'long', dir: '~/p', model: 'claude-opus-5-5' },
    { name: 'liaison', kind: 'short', dir: '~/p', model: 'sonnet' },
    { name: 'mac', kind: 'remote' },
  ];
  const agents = createAgents({ db: openDb(), config, root, owner: 'cam', tmux: fakeTmux() });
  assert.deepEqual(agents.list().map((a) => [a.name, a.model]), [['main', 'Opus 5.5'], ['liaison', 'sonnet'], ['mac', undefined]]);
  assert.equal('model' in agents.list()[2], false);
});

test('a helper needs a known agent, a label and a model, each on one line', () => {
  const { agents } = make();
  refuses(() => agents.startHelper('nobody', 'x', 'm'), 400, 'nobody');
  refuses(() => agents.startHelper('main', '  ', 'm'), 400, 'label');
  refuses(() => agents.startHelper('main', 'x', ''), 400, 'model');
  refuses(() => agents.startHelper('main', 'x'.repeat(81), 'm'), 400, '80');
  refuses(() => agents.endHelper('main', 'x'), 404, 'No helper');
  agents.startHelper('main', 'Line one\n  two', 'm');
  assert.equal(row(agents, 'main').helpers[0].label, 'Line one two');
});

test('a start with the label of a running helper starts it again; a done helper can start again as a new one', () => {
  let t = Date.parse('2026-10-28T12:00:00.000Z');
  const { agents } = make({ now: () => new Date(t) });
  agents.startHelper('main', 'Sync', 'fable');
  t += 60000;
  agents.startHelper('main', 'Sync', 'opus');
  assert.deepEqual(row(agents, 'main').helpers.map((h) => [h.model, h.started]), [['opus', '2026-10-28T12:01:00.000Z']]);
  agents.endHelper('main', 'Sync');
  refuses(() => agents.endHelper('main', 'Sync'), 404, 'No helper');
  t += 60000;
  agents.startHelper('main', 'Sync', 'fable');
  assert.deepEqual(row(agents, 'main').helpers.map((h) => [h.model, h.running]), [['fable', true], ['opus', false]]);
});

test('the done helpers of the last day show, at most five, and older ones leave the database', () => {
  let t = Date.parse('2026-10-28T12:00:00.000Z');
  const { agents, db } = make({ now: () => new Date(t) });
  for (let i = 1; i <= 7; i++) { agents.startHelper('main', `Task ${i}`, 'm'); t += 1000; agents.endHelper('main', `Task ${i}`); t += 1000; }
  assert.deepEqual(row(agents, 'main').helpers.map((h) => h.label), ['Task 7', 'Task 6', 'Task 5', 'Task 4', 'Task 3']);
  agents.startHelper('main', 'Long', 'm'); // runs across the day, so it stays
  t += 86400000;
  assert.deepEqual(row(agents, 'main').helpers.map((h) => [h.label, h.running]), [['Long', true]]);
  // The next change of the helpers of the agent removes the old rows.
  agents.endHelper('main', 'Long');
  assert.equal(db.prepare('SELECT count(*) AS n FROM helpers').get().n, 1);
});

test('activity: idle in memo wait or at the prompt, working in a turn, blocked on a dialog, stopped with no session', () => {
  let t = Date.parse('2026-10-28T12:00:00Z');
  const { agents, tmux } = make({ now: () => new Date(t) });
  let screen = '> \n';
  tmux.capture = () => screen;
  assert.equal(row(agents, 'main').activity, 'stopped');
  agents.start('main');
  assert.equal(row(agents, 'main').activity, 'idle', 'a session at its prompt does nothing');
  screen = 'Thinking… (esc to interrupt)\n';
  assert.equal(row(agents, 'main').activity, 'working');
  // memo wait runs inside a turn (it is a Bash tool), so its request counts before the screen.
  agents.contact('main', { wait: true });
  assert.equal(row(agents, 'main').activity, 'idle');
  t += 59000;
  assert.equal(row(agents, 'main').activity, 'idle');
  t += 2000;
  assert.equal(row(agents, 'main').activity, 'working');
  // The request that brought news ends the wait. A status request leaves the wait as it is.
  agents.contact('main', { wait: true });
  agents.contact('main', { wait: false });
  assert.equal(row(agents, 'main').activity, 'working');
  agents.contact('main', { wait: true });
  agents.contact('main');
  assert.equal(row(agents, 'main').activity, 'idle');
  t += 61000;
  screen = 'Do you want to run this command?\n ❯ 1. Yes\n   2. No\n';
  agents.watch();
  agents.watch();
  assert.equal(row(agents, 'main').activity, 'blocked');
  screen = '> \n';
  agents.watch();
  agents.stop('main');
  assert.equal(row(agents, 'main').activity, 'stopping');
  agents.stop('main', { now: true });
  assert.equal(row(agents, 'main').activity, 'stopped');
  assert.equal(row(agents, 'liaison').activity, null, 'a short agent has no activity');
});

test('activity of a remote agent: offline, idle in memo wait, working', () => {
  let time = Date.parse('2026-01-01T10:00:00Z');
  const { agents } = make({ config: WITH_REMOTE, now: () => new Date(time) });
  assert.equal(row(agents, 'mac').activity, 'offline');
  agents.contact('mac', { wait: true });
  assert.equal(row(agents, 'mac').activity, 'idle');
  time += 61000;
  assert.equal(row(agents, 'mac').activity, 'working', 'online for 2 minutes, but no wait in the last one');
  time += 60000;
  assert.equal(row(agents, 'mac').activity, 'offline');
});
