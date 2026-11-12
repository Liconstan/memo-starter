import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { createDesktopDispatch } from '../src/desktop-dispatch.js';
import { taskCapability, pickSpecialist } from '../ui/specialists.js';
import { pickAgent } from '../ui/agentstate.js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseCodexLimits } from '../src/codex-usage.js';
import { makeApp, call, LIAISON_TOKEN } from './helpers.js';

const thread = '01a1bd0a-8401-7282-86c1-f400c82ad641';
const config = [{ name: 'gpt', kind: 'remote', runtime: 'codex-desktop', desktopThread: thread, model: 'gpt-6.1-terra', desktopVerified: true }];
function setup(queue) {
  const db = openDb();
  const store = createStore(db, { owner: 'cam', names: ['cam', 'gpt'], forwardTo: ['gpt'] });
  const args = { db, config, root: '/tmp/memo root', owner: 'cam', queue };
  return { db, store, args, dispatch: createDesktopDispatch(args) };
}

test('desktop dispatch does no model work for an empty or unchanged queue, including restart', async () => {
  const calls = [];
  const { store, args, dispatch } = setup(async (...a) => { calls.push(a); return 'queue-1'; });
  dispatch.scan(); await dispatch.settled();
  assert.equal(calls.length, 0);
  store.send({ from: 'cam', to: 'gpt', text: 'Observe a page' });
  dispatch.arrived('gpt'); dispatch.arrived('gpt'); await dispatch.settled();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], thread);
  assert.match(calls[0][1], /memo:1/);
  assert.match(calls[0][1], /arrival-triggered/);
  dispatch.scan(); await dispatch.settled();
  const restarted = createDesktopDispatch(args); restarted.scan(); await restarted.settled();
  assert.equal(calls.length, 1);
  assert.equal(restarted.status('gpt').state, 'queued');
  store.edit(1, 'Changed instructions');
  restarted.scan(); await restarted.settled();
  assert.equal(calls.length, 2, 'an edited task gets a new wakeup');
});

test('arrivals during a pending send are picked up without interrupting or losing the new work', async () => {
  let release;
  const calls = [];
  const { store, dispatch } = setup(async (...a) => {
    calls.push(a);
    if (calls.length === 1) await new Promise(r => { release = r; });
    return `queue-${calls.length}`;
  });
  store.send({ from: 'cam', to: 'gpt', text: 'First' }); dispatch.arrived('gpt');
  store.send({ from: 'cam', to: 'gpt', text: 'Second' }); dispatch.arrived('gpt');
  release(); await dispatch.settled();
  assert.equal(calls.length, 2);
  assert.match(calls[1][1], /memo:2/);
});

test('ambiguous queue failures do not retry and potentially duplicate work', async () => {
  let calls = 0;
  const { store, args, dispatch } = setup(async () => { calls++; throw Error('timeout after possible acceptance'); });
  store.send({ from: 'cam', to: 'gpt', text: 'First' }); dispatch.scan(); await dispatch.settled();
  dispatch.scan(); await dispatch.settled();
  const restarted = createDesktopDispatch(args); restarted.scan(); await restarted.settled();
  assert.equal(calls, 1);
  assert.equal(restarted.status('gpt').state, 'uncertain');
});

test('postponed tasks are not dispatched before due; replies and notes wake their owner once', async () => {
  const calls = [];
  const { db, store, dispatch } = setup(async (...a) => { calls.push(a); return 'queue'; });
  const task = store.send({ from: 'cam', to: 'gpt', text: 'Later' }).memo;
  db.prepare('UPDATE memos SET until = ? WHERE id = ?').run('2099-01-01T00:00:00Z', task.id);
  dispatch.scan(); await dispatch.settled(); assert.equal(calls.length, 0);
  db.prepare('UPDATE memos SET until = NULL WHERE id = ?').run(task.id);
  dispatch.scan(); await dispatch.settled(); assert.equal(calls.length, 1);
  store.reply(task.id, 'Done');
  const question = store.send({ from: 'gpt', to: 'cam', text: 'Choose one', impact: 2, effort: 'micro' }).memo;
  store.note(question.id, 'cam', 'Choose A');
  dispatch.scan(); await dispatch.settled(); assert.match(calls.at(-1)[1], /note:/);
  store.reply(question.id, 'Proceed');
  dispatch.scan(); await dispatch.settled(); assert.match(calls.at(-1)[1], /result:/);
});

const verified = { name: 'gpt', runtime: 'codex-desktop', dispatch: { verified: true, model: 'gpt-6.1-terra', state: 'queued' } };
test('specialist routing requires verified model and transport, with fresh quota checks', () => {
  assert.equal(pickSpecialist([verified], 'computer-use').name, 'gpt');
  assert.equal(pickSpecialist([{ ...verified, dispatch: { ...verified.dispatch, verified: false } }], 'computer-use'), null);
  assert.equal(pickSpecialist([{ ...verified, dispatch: { ...verified.dispatch, state: 'uncertain' } }], 'computer-use'), null);
  assert.equal(pickSpecialist([{ ...verified, dispatch: { ...verified.dispatch, model: 'other' } }], 'computer-use'), null);
  const exhausted = { ...verified, usage: { at: '2026-11-08T22:00:00Z', windows: [{ percent: 100, resets_at: '2026-11-09T00:00:00Z' }] } };
  assert.equal(pickSpecialist([exhausted], 'computer-use', new Date('2026-11-08T22:01:00Z')), null);
  assert.equal(pickSpecialist([exhausted], 'computer-use', new Date('2026-11-08T22:30:00Z')).name, 'gpt');
});

test('exhausted allowance can use confirmed existing credits, only for the exhausted bucket', () => {
  const now = new Date('2026-11-08T22:01:00Z');
  const bucket = credits => ({ primary: { usedPercent: 100 }, credits });
  const pick = buckets => pickSpecialist([{ ...verified, usage: {
    ...parseCodexLimits({ rateLimitsByLimitId: buckets }), at: '2026-11-08T22:00:00Z',
  } }], 'computer-use', now);
  for (const credits of [{ hasCredits: true, unlimited: false, balance: null }, { hasCredits: false, unlimited: true }]) {
    assert.equal(pick({ codex: bucket(credits) }).name, 'gpt');
    assert.match(pick({ codex: bucket(credits) }).hint, /included allowance exhausted; credits available/);
  }
  for (const credits of [undefined, {}, { hasCredits: false, unlimited: false }, { hasCredits: 'true', balance: '20' }]) {
    assert.equal(pick({ codex: bucket(credits) }), null);
  }
  assert.equal(pick({ codex: bucket({ hasCredits: false }), other: bucket({ hasCredits: true }) }), null);
  assert.equal(pick({ codex: bucket({ hasCredits: true }), other: { primary: { usedPercent: 20 } } }).name, 'gpt');
  assert.equal(pick({ codex: bucket({ hasCredits: true }), other: bucket({}) }), null);
});

test('suggestions recognize explicit visual requests without hijacking ordinary coding or analysis', () => {
  for (const text of ['Generate an image of a tree', 'Please edit this photo', '[image] A blue cover']) assert.equal(taskCapability(text), 'image-generation');
  for (const text of ['Use Chrome to check the form', '[computer] Fill in the draft']) assert.equal(taskCapability(text), 'computer-use');
  for (const text of ['Write code for image uploads', 'Compare computer use models', 'Research image generation costs']) assert.equal(taskCapability(text), 'general');
});

const browserRequests = [
  'login to linkedin and extract all the conference people',
  'open up linkedin and scrape the conference people I talked to into a csv with all of our convos',
  'Can you please sign in to LinkedIn?', 'Please log into my account',
  'open and login to linkedin', 'open and log in to LinkedIn',
  'Could you open the browser and check my messages?', 'Open https://example.org',
  'Go to example.com', 'Open Airtable and log in', 'Export my conversations from LinkedIn',
];
test('natural browser actions route to GPT; conceptual and code requests remain general', () => {
  for (const text of browserRequests) {
    assert.equal(taskCapability(text), 'computer-use', text);
    assert.equal(pickAgent([{ name: 'main', kind: 'long' }, verified], { task: text }).name, 'gpt', text);
    const unavailable = pickAgent([{ name: 'main', kind: 'long' }], { task: text });
    assert.equal(unavailable.name, '', text);
    assert.match(unavailable.hint, /GPT browser worker unavailable/);
  }
  for (const text of ['Explain how to login to LinkedIn', 'Fix the LinkedIn login code',
    'Write a scraper for LinkedIn', 'Compare browser automation tools', 'Open a pull request for login',
    'Create a login page', 'Can you explain browser sessions?', 'Review the code to open Chrome',
    'I cannot login to LinkedIn', 'Analyze a CSV exported from LinkedIn']) {
    assert.equal(taskCapability(text), 'general', text);
  }
});

test('capture submits auto, preserves explicit choice, and blocks stale fallback when GPT disappears', async () => {
  const page = readFileSync(new URL('../ui/inbox.html', import.meta.url), 'utf8');
  const handlers = {};
  const to = { value: 'main', addEventListener: (event, fn) => { handlers.change = fn; },
    replaceChildren(...options) { this.value = options.find(o => o.selected)?.value || ''; } };
  const text = { value: browserRequests[0], addEventListener() {}, dispatchEvent() {} };
  const hint = {};
  const agents = [{ name: 'main', kind: 'long' }, { ...verified, kind: 'remote' }];
  const calls = [];
  let pending;
  const context = { agents, pickAgent, fableShortNote: () => '',
    capture: { elements: { to, text }, querySelector: () => ({}), addEventListener: (event, fn) => { handlers[event] = fn; } },
    document: { getElementById: () => hint }, el: (tag, props) => props,
    api: async (path, body) => { calls.push(body); }, send: (button, fn) => { pending = fn(); },
    note: msg => { context.notice = msg; }, Event: class {}, renderAgents() {}, track() {}, displayName: (name) => name };
  runInNewContext(page.slice(page.indexOf('let handPicked = false;'), page.indexOf('// The capture field grows')), context);
  context.chooseAgent();
  assert.equal(to.value, 'gpt');
  handlers.submit({ preventDefault() {} }); await pending;
  assert.equal(calls.at(-1).to, 'auto');
  text.value = browserRequests[0]; context.chooseAgent();
  to.value = 'main'; handlers.change();
  handlers.submit({ preventDefault() {} }); await pending;
  assert.equal(calls.at(-1).to, 'main');
  text.value = browserRequests[0];
  agents.pop(); context.chooseAgent();
  assert.equal(to.value, ''); assert.equal(hint.hidden, false);
  handlers.submit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.match(context.notice, /GPT browser worker unavailable/);
  assert.equal(text.value, browserRequests[0]);
});

test('API routes auto capabilities, honors an explicit recipient and protects the liaison boundary', async () => {
  const { app, agents } = makeApp({ config: [{ name: 'main', kind: 'long', dir: '/tmp', model: 'm' }, ...config] });
  const originalList = agents.list;
  agents.list = () => originalList().map(a => a.name === 'gpt' ? { ...a, dispatch: verified.dispatch } : a);
  let r = await call(app, '/api/send', { from: 'cam', to: 'auto', capability: 'computer-use', text: 'Observe a page' });
  assert.equal(r.status, 200); assert.equal(r.data.memo.recipient, 'gpt');
  for (const text of browserRequests) {
    r = await call(app, '/api/send', { from: 'cam', to: 'auto', text });
    assert.equal(r.status, 200); assert.equal(r.data.memo.recipient, 'gpt', text);
  }
  r = await call(app, '/api/send', { from: 'cam', to: 'main', capability: 'computer-use', text: 'Plan this first' });
  assert.equal(r.data.memo.recipient, 'main');
  agents.list = originalList;
  r = await call(app, '/api/send', { from: 'cam', to: 'auto', text: browserRequests[0] });
  assert.equal(r.status, 409, 'a stale UI snapshot cannot silently send browser work to Claude');
  r = await call(app, '/api/send', { from: 'cam', to: 'auto', capability: 'computer-use', text: 'Observe' });
  assert.equal(r.status, 409);
  r = await call(app, '/api/send', { from: 'cam', to: 'auto', capability: 'unknown', text: 'Observe' });
  assert.equal(r.status, 400);
  r = await call(app, '/api/send', { from: 'liaison', to: 'auto', capability: 'computer-use', text: 'Observe' }, LIAISON_TOKEN);
  assert.equal(r.status, 403);
});
