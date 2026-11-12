import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { openDb } from '../src/db.js';
import { createAgents } from '../src/agents.js';
import { createUsage, parseUsage, withRates, USAGE_EVERY_MS, SAMPLES } from '../src/usage.js';

// The output of `claude -p /usage --output-format stream-json`, in short: the init line, the local command answer
// with its structured twin (usage_report), and the result line.
const limits = (session, week, fable) => [
  { kind: 'session', group: 'session', percent: session, resets_at: '2026-11-06T21:00:00.271616+00:00', scope: null, severity: 'normal', is_active: false },
  { kind: 'weekly_all', group: 'weekly', percent: week, resets_at: '2026-11-10T18:00:00.271632+00:00', scope: null, severity: 'normal', is_active: false },
  { kind: 'weekly_scoped', group: 'weekly', percent: fable, resets_at: '2026-11-10T18:00:00.271771+00:00', scope: { model: { display_name: 'Fable' }, surface: null }, severity: 'critical', is_active: true },
];
const output = (rows) => [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Current session: 6% used' }] }, usage_report: { session: { total_cost_usd: 0 }, rate_limits: { limits: rows, extra_usage: { is_enabled: true } } } }),
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Current session: 6% used' }),
].join('\n') + '\n';

const CONFIG = [
  { name: 'main', kind: 'long', dir: '~/no-such-dir-for-memo-tests', model: 'm' },
  { name: 'second', kind: 'long', dir: '~/no-such-dir-for-memo-tests', model: 'm', env: { CLAUDE_CONFIG_DIR: '~/.claude-second' } },
  { name: 'twin', kind: 'long', dir: '~/no-such-dir-for-memo-tests', model: 'm', env: { CLAUDE_CONFIG_DIR: '~/.claude-second' } },
  { name: 'liaison', kind: 'short', dir: '~/p', model: 'm' },
  { name: 'mac', kind: 'remote' },
];

test('parseUsage reads the three figures of /usage from the stream-json answer', () => {
  const u = parseUsage(output(limits(6, 63, 93)));
  assert.deepEqual(u, {
    session: { percent: 6, resets_at: '2026-11-06T21:00:00.271616+00:00' },
    week: { percent: 63, resets_at: '2026-11-10T18:00:00.271632+00:00' },
    models: [{ name: 'Fable', percent: 93, resets_at: '2026-11-10T18:00:00.271771+00:00' }],
  });
  // An account with no plan limits (an API key): no rows, no error.
  assert.deepEqual(parseUsage(output([])), { session: null, week: null, models: [] });
  assert.deepEqual(parseUsage(JSON.stringify({ type: 'assistant', usage_report: { rate_limits: null } })), { session: null, week: null, models: [] });
  // No report: a wrong answer, or no sign-in.
  assert.throws(() => parseUsage('not json\n{"type":"result"}\n'), /no usage report/);
  // A percentage comes as a whole number, and a reset time that is not text is left out.
  assert.deepEqual(parseUsage(output([{ kind: 'session', percent: '42.6', resets_at: 1 }])).session, { percent: 43, resets_at: null });
});

test('createUsage asks claude once for each account, with the configuration directory of the agent', async () => {
  const calls = [];
  let clock = Date.parse('2026-11-06T18:00:00Z');
  const now = () => new Date(clock);
  const answers = { '': output(limits(6, 63, 93)), [`${homedir()}/.claude-second`]: output(limits(0, 83, 100)) };
  const usage = createUsage({ config: CONFIG, now, run: async (dir, cwd) => { calls.push([dir, cwd]); return answers[dir]; } });
  // Before the first fetch: a long agent has empty figures, a short or remote agent has none.
  assert.deepEqual(usage.get('main'), { at: null, tried: null, session: null, week: null, models: [], error: null });
  assert.equal(usage.get('liaison'), null);
  assert.equal(usage.get('mac'), null);
  assert.equal(usage.get('nobody'), null);
  await usage.refresh();
  // One run for each configuration directory, not for each agent; a dir of the agent that is not there gives the home directory.
  assert.deepEqual(calls, [['', homedir()], [`${homedir()}/.claude-second`, homedir()]]);
  // One sample: the rate is the average since the start of the window. The session started at 16:00, so 6 points in
  // 2 hours; the week started November 3 at 18:00, so 63 points in 72 hours.
  const rated = (figures, rates) => ({ session: { ...figures.session, rate: rates[0] }, week: { ...figures.week, rate: rates[1] }, models: figures.models.map((m, i) => ({ ...m, rate: rates[2 + i] })) });
  assert.deepEqual(usage.get('main'), { at: '2026-11-06T18:00:00.000Z', tried: '2026-11-06T18:00:00.000Z', error: null, ...rated(parseUsage(answers['']), [3, 0.88, 1.29]) });
  assert.equal(usage.get('second').week.percent, 83);
  assert.equal(usage.get('second').models[0].percent, 100);
  assert.deepEqual(usage.get('twin'), usage.get('second'), 'two agents with one account share the figures');
  // A failure keeps the last good figures, with the error and the time of the try.
  clock += 60000;
  answers[''] = 'no json at all\n';
  await usage.refresh();
  const main = usage.get('main');
  assert.equal(main.at, '2026-11-06T18:00:00.000Z');
  assert.equal(main.tried, '2026-11-06T18:01:00.000Z');
  assert.match(main.error, /no usage report/);
  assert.equal(main.session.percent, 6);
  assert.equal(usage.get('second').error, null);
  // claude that does not start: the same.
  const broken = createUsage({ config: CONFIG, now, run: async () => { throw new Error('claude did not start: ENOENT'); } });
  await broken.refresh();
  assert.match(broken.get('main').error, /did not start/);
  assert.equal(USAGE_EVERY_MS, 300000);
});

test('the burn rate: points per hour over the last 12 samples, else the average since the start of the window', () => {
  assert.equal(SAMPLES, 12);
  const samples = new Map();
  const t0 = Date.parse('2026-11-06T18:00:00Z');
  const at = (minutes) => t0 + minutes * 60000;
  const figures = (session, week, fable) => ({ session: { percent: session, resets_at: '2026-11-06T21:00:00Z' }, week: { percent: week, resets_at: '2026-11-10T18:00:00Z' }, models: [{ name: 'Fable', percent: fable, resets_at: '2026-11-10T18:00:00Z' }] });
  // Fewer than 3 samples: the average since the start of the window (the session started at 16:00).
  assert.equal(withRates(figures(6, 63, 93), samples, at(0)).session.rate, 3);
  assert.equal(withRates(figures(8, 63, 93), samples, at(5)).session.rate, 3.84, '8 points in 2 hours 5 minutes');
  // From 3 samples: first to last. 6 to 10 points in 10 minutes is 24 an hour.
  const third = withRates(figures(10, 64, 93), samples, at(10));
  assert.equal(third.session.rate, 24);
  assert.equal(third.week.rate, 6, '63 to 64 in 10 minutes');
  assert.equal(third.models[0].rate, 0, 'Fable did not move');
  assert.deepEqual(third.models[0], { name: 'Fable', percent: 93, resets_at: '2026-11-10T18:00:00Z', rate: 0 });
  // Only the last 12 samples count.
  for (let i = 3; i < 20; i++) withRates(figures(10 + i, 64, 93), samples, at(5 * i));
  assert.equal(samples.get('session').length, 12);
  assert.equal(samples.get('session')[0].t, at(5 * 8));
  assert.equal(withRates(figures(30, 64, 93), samples, at(100)).session.rate, 12, '18 to 30 in 55 minutes, 12 samples and a new one');
  // A reset: a new reset time, or a percent that fell, starts the samples again, and the average since the start
  // of the new window is the rate.
  const reset = withRates({ ...figures(2, 64, 93), session: { percent: 2, resets_at: '2026-11-06T23:00:00Z' } }, samples, at(105));
  assert.equal(samples.get('session').length, 1);
  assert.equal(reset.session.rate, 1.14, '2 points in 1 hour 45 minutes of the new window, which started at 18:00');
  // No reset time: no rate with fewer than 3 samples; a window that goes away drops its samples.
  assert.equal(withRates({ session: { percent: 5, resets_at: null }, week: null, models: [] }, samples, at(110)).session.rate, null);
  assert.deepEqual([...samples.keys()], ['session']);
  assert.equal(withRates({ session: null, week: null, models: [] }, samples, at(115)).session, null);
  assert.equal(samples.size, 0);
});

test('the list of the agents carries the usage of each one', () => {
  const db = openDb();
  const tmux = { has: () => false, start: () => {}, kill: () => {}, send: () => {} };
  const figures = { at: '2026-11-06T18:00:00.000Z', tried: '2026-11-06T18:00:00.000Z', error: null, session: { percent: 6, resets_at: null }, week: { percent: 63, resets_at: null }, models: [] };
  const agents = createAgents({ db, config: CONFIG.slice(0, 1).concat(CONFIG.slice(3)), root: '/nowhere', owner: 'cam', tmux, usage: (name) => (name === 'main' ? figures : null) });
  const list = agents.list();
  assert.deepEqual(list.find((a) => a.name === 'main').usage, figures);
  assert.equal(list.find((a) => a.name === 'liaison').usage, null);
  // Without a usage source (the tests of the app), an agent has none.
  assert.equal(createAgents({ db: openDb(), config: CONFIG.slice(0, 1), root: '/nowhere', owner: 'cam', tmux }).list()[0].usage, null);
});
