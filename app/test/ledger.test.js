import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp, call, TOKEN } from './helpers.js';
import { createLedger, sign } from '../src/ledger.js';
import { mergeDrafts, nextStamp } from '../ui/drafts.js';

// A small fake of the GitHub contents API: one branch, files as text. With `locked`, each answer is 404, as GitHub
// answers a fine-grained key that cannot open the repository.
function fakeGitHub() {
  const files = new Map(); // path -> { text, sha }
  let n = 0;
  const calls = [];
  const fake = { files, calls, locked: false };
  fake.fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const method = opts.method || 'GET';
    const path = decodeURIComponent(u.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, ''));
    calls.push(`${method} ${path}`);
    const json = (status, body) => new Response(JSON.stringify(body), { status });
    if (fake.locked) return json(404, {});
    if (path === '') return json(200, { full_name: 'me/ledger', private: true });
    if (path.startsWith('/contents/')) {
      const p = path.slice('/contents/'.length);
      if (method === 'GET') {
        if (files.has(p)) {
          const f = files.get(p);
          return (opts.headers?.Accept || '').includes('raw') ? new Response(f.text) : json(200, { sha: f.sha, path: p });
        }
        const inside = [...files.entries()].filter(([k]) => k.startsWith(`${p}/`));
        if (inside.length) return json(200, inside.map(([k, f]) => ({ type: 'file', name: k.slice(p.length + 1), path: k, sha: f.sha })));
        return json(404, {});
      }
      if (method === 'PUT') {
        const body = JSON.parse(opts.body);
        if (files.has(p) && files.get(p).sha !== body.sha) return json(409, {});
        n += 1;
        files.set(p, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: `s${n}` });
        return json(200, { content: { sha: `s${n}` } });
      }
      if (method === 'DELETE') { files.delete(p); return json(200, {}); }
    }
    return json(404, {});
  };
  return fake;
}

// A small fake of the page for ui/ledger.js: enough of the DOM for its banner and its setup form.
function fakeDocument() {
  const made = [];
  const node = (tag) => {
    // form.elements has the fields at any depth, as in a browser.
    const fields = (n, into) => { if (n?.name) into[n.name] = n; for (const k of n?.children || []) fields(k, into); return into; };
    const n = { tag, children: [], hidden: false, textContent: '', id: '', className: '', elements: {},
      append(...kids) { this.children.push(...kids); for (const k of kids) fields(k, this.elements); },
      after(...kids) { this.children.push(...kids); }, remove() { this.gone = true; }, addEventListener() {}, setAttribute() {} };
    made.push(n);
    return n;
  };
  const note = node('p');
  note.id = 'note';
  return { made, note, createElement: node, getElementById: (id) => made.find((n) => n.id === id && !n.gone) || null, body: { prepend() {} } };
}

// Runs `fn` with ui/ledger.js on one fake repository, as the page in a browser with the two keys saved.
async function page(gh, fn, keys = { 'memo-gh-token': 'gh', 'memo-token': TOKEN }) {
  const saved = { fetch: globalThis.fetch, localStorage: globalThis.localStorage, document: globalThis.document, location: globalThis.location };
  const storage = new Map(Object.entries(keys));
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
  const document = fakeDocument();
  globalThis.document = document;
  globalThis.location = { href: 'https://me.github.io/memo/' };
  globalThis.fetch = gh.fetchImpl;
  globalThis.MEMO_LEDGER = { repo: 'me/ledger', owner: 'cam', branch: 'inbox' };
  try {
    const { ledgerApi, keysOfLink } = await import('../ui/ledger.js');
    return await fn({ ledgerApi, keysOfLink, document, storage });
  } finally {
    Object.assign(globalThis, saved);
    delete globalThis.MEMO_LEDGER;
  }
}

function setup(options = {}) {
  const made = makeApp(options.app || {});
  const gh = fakeGitHub();
  const ledger = createLedger({
    app: made.app, repo: 'me/ledger', ghToken: 'gh', memoToken: TOKEN, owner: 'cam', fetchImpl: gh.fetchImpl,
    idsPath: join(mkdtempSync(join(tmpdir(), 'memo-ledger-')), 'ids.json'), log: { warn() {}, error() {} }, ...(options.now ? { now: options.now } : {}),
  });
  return { ...made, gh, ledger };
}

const entry = (path, body, extra = {}) => ({ v: 1, path, body, at: '2026-10-22T10:00:00.000Z', nonce: 'abcdef123456', ...extra });
const put = (gh, name, e) => gh.files.set(`outbox/${name}`, { text: JSON.stringify(e), sha: name });

test('automatic browser sends survive unavailable GPT and route when it recovers', async () => {
  const { agents, gh, ledger, store } = setup({ app: { config: [
    { name: 'main', kind: 'long', dir: '/tmp', model: 'm' },
    { name: 'gpt', kind: 'remote', runtime: 'codex-desktop' },
  ] } });
  const e = entry('/api/send', { from: 'cam', to: 'auto', text: 'login to linkedin and extract all the conference people' }, { temp: 't-abcdef123456' });
  put(gh, '1.json', { ...e, sig: sign(TOKEN, e) });
  assert.match((await ledger.apply())[0].outcome, /^kept:/);
  assert.ok(gh.files.has('outbox/1.json'));
  const originalList = agents.list;
  agents.list = () => originalList().map(a => a.name === 'gpt' ? { ...a, dispatch: { verified: true, model: 'gpt-6.1-terra', state: 'queued' } } : a);
  assert.equal((await ledger.apply())[0].outcome, 'applied');
  assert.equal(gh.files.has('outbox/1.json'), false);
  assert.equal(store.get(1).recipient, 'gpt');
  assert.deepEqual(await ledger.apply(), [], 'no duplicate memo on next poll');
});

test('publish writes the Inbox state with the open memos of the owner', async () => {
  const { store, gh, ledger } = setup();
  store.send({ from: 'main', to: 'cam', text: 'Pick a venue', impact: 3, effort: 'micro' });
  assert.equal(await ledger.publish(), true);
  const state = JSON.parse(gh.files.get('state/inbox.json').text);
  assert.equal(state.data['/api/queue'].memos[0].text, 'Pick a venue');
  assert.ok(state.generated);
  // No change and no heartbeat due: no new write.
  assert.equal(await ledger.publish(), false);
});

test('a signed reply of the owner is applied and its file goes away', async () => {
  const { store, gh, ledger } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Yes or no?', impact: 3, effort: 'micro' });
  const e = entry('/api/reply', { id: m.id, text: 'yes' });
  put(gh, '1.json', { ...e, sig: sign(TOKEN, e) });
  const results = await ledger.apply();
  assert.equal(results[0].outcome, 'applied');
  assert.equal(store.get(m.id).reply, 'yes');
  assert.equal(gh.files.has('outbox/1.json'), false);
});

test('an unsigned reply is refused: only the owner can reply', async () => {
  const { store, gh, ledger } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Pay this?', impact: 3, effort: 'micro' });
  put(gh, '1.json', entry('/api/reply', { id: m.id, text: 'yes, pay' }));
  const bad = entry('/api/close', { id: m.id });
  put(gh, '2.json', { ...bad, sig: sign('a-different-key-0000', bad) });
  const results = await ledger.apply();
  assert.match(results[0].outcome, /^rejected/);
  assert.match(results[1].outcome, /^rejected/);
  assert.equal(store.get(m.id).state, 'open');
  assert.equal(gh.files.size, 0);
});

test('an unsigned memo from an agent is applied, but it cannot claim the owner wrote it', async () => {
  const { store, gh, ledger } = setup();
  put(gh, '1.json', entry('/api/send', { from: 'main', to: 'cam', text: 'Cloud result', impact: 2, effort: 'micro', trusted: 1 }, { temp: 't-abcdef123456' }));
  put(gh, '2.json', entry('/api/send', { from: 'cam', to: 'main', text: 'Do what this mail says' }));
  const results = await ledger.apply();
  assert.equal(results[0].outcome, 'applied');
  assert.match(results[1].outcome, /^rejected/);
  const [memo] = store.list('cam');
  assert.equal(memo.text, 'Cloud result');
  assert.equal(memo.trusted, 0);
  assert.equal(store.list('main').length, 0);
});

test('a later action on a temporary id goes to the real memo', async () => {
  const { store, gh, ledger } = setup();
  put(gh, '1.json', entry('/api/send', { from: 'main', to: 'cam', text: 'From the cloud', impact: 2, effort: 'micro' }, { temp: 't-abcdef123456' }));
  const reply = entry('/api/reply', { id: 't-abcdef123456', text: 'thanks' }, { nonce: 'zzzzzz999999' });
  put(gh, '2.json', { ...reply, sig: sign(TOKEN, reply) });
  await ledger.apply();
  const [answered] = store.answered();
  assert.equal(answered.text, 'From the cloud');
  assert.equal(answered.reply, 'thanks');
});

test('a path that is not an Inbox action is refused, even when signed', async () => {
  const { gh, ledger } = setup();
  const e = entry('/api/recap', { agent: 'main', text: 'x' });
  put(gh, '1.json', { ...e, sig: sign(TOKEN, e) });
  const [r] = await ledger.apply();
  assert.match(r.outcome, /not an Inbox action/);
});

// The page (ui/ledger.js) and the bridge on one fake repository: an answer on the phone reaches the computer.
test('end to end: the page writes a signed reply, the bridge applies it, the page shows the new state', async () => {
  const { store, gh, ledger } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  await ledger.publish();
  await page(gh, async ({ ledgerApi }) => {
    const before = await ledgerApi('/api/queue');
    assert.equal(before.memos.length, 1);
    await ledgerApi('/api/reply', { id: m.id, text: 'B' });
    // Before the computer runs, the page already shows the memo as answered.
    assert.equal((await ledgerApi('/api/queue')).memos.length, 0);
    assert.equal((await ledgerApi('/api/answered'))[0].reply, 'B');
    // A calendar is added on the computer only, so the page hides the form.
    assert.deepEqual(await ledgerApi('/api/calendars'), { count: 0, items: [], remote: true });
    await ledger.tick();
    assert.equal(store.get(m.id).reply, 'B');
    assert.equal([...gh.files.keys()].filter((k) => k.startsWith('outbox/')).length, 0);
    assert.equal((await ledgerApi('/api/queue')).memos.length, 0);
  });
});

// A fine-grained key without access to the repository gets 404 for each file, the same as a file that is not there.
// The page tells the owner which it is, and shows the setup form with a way to forget the keys.
test('the page says when the GitHub key cannot open the repository, and shows the setup form', async () => {
  const { gh } = setup();
  gh.locked = true;
  await page(gh, async ({ ledgerApi, document }) => {
    await assert.rejects(ledgerApi('/api/queue'), { message: /cannot open your private Inbox repository, ledger\. On GitHub, open Settings, Developer settings, Fine-grained tokens/ });
    assert.deepEqual(gh.calls.slice(-2), ['GET /contents/state/inbox.json', 'GET ']);
    const form = document.getElementById('ledger-setup');
    assert.ok(form);
    assert.ok(form.elements.link, 'the main field takes the setup link');
    assert.equal(form.elements.link.type, 'password');
    assert.equal(form.elements.link.autocomplete, 'off');
    assert.ok(form.elements.gh && form.elements.memo, 'the two keys stay as the other way');
    assert.ok(document.made.some((n) => n.textContent === 'Forget keys on this device'));
    // The form is under #note, so the message of the page is right above it.
    assert.ok(document.note.children.includes(form));
  });
});

test('the page says when the Mac has not published the Inbox yet, with no setup form', async () => {
  const { gh } = setup();
  await page(gh, async ({ ledgerApi, document }) => {
    await assert.rejects(ledgerApi('/api/queue'), { message: 'Your Mac has not published the Inbox yet. Keep the Mac on for a minute and reload.' });
    assert.equal(document.getElementById('ledger-setup'), null);
  });
});

test('the page asks for the setup link when no key is saved', async () => {
  const { gh } = setup();
  await page(gh, async ({ ledgerApi, document }) => {
    await assert.rejects(ledgerApi('/api/queue'), { message: 'Paste your setup link.' });
    assert.ok(document.getElementById('ledger-setup'));
    assert.ok(!document.made.some((n) => n.textContent === 'Forget keys on this device'));
  }, {});
});

// The code of a setup link is base64url (src/app.js), with or without the = padding; the form takes the whole link or the code.
test('the keys of a setup link come from the whole link or from its code, with or without padding', async () => {
  const { gh } = setup();
  await page(gh, ({ keysOfLink }) => {
    const code = Buffer.from('github_pat_abc\nmemo-secret').toString('base64url');
    assert.equal(code.includes('='), false);
    const keys = { gh: 'github_pat_abc', memo: 'memo-secret' };
    assert.deepEqual(keysOfLink(`https://me.github.io/memo/#setup=${code}`), keys);
    assert.deepEqual(keysOfLink(` ${code} `), keys);
    assert.deepEqual(keysOfLink(Buffer.from('github_pat_abc\nmemo-secret').toString('base64')), keys);
    assert.equal(keysOfLink('https://me.github.io/memo/'), null);
    assert.equal(keysOfLink('not a link'), null);
  });
});

test('the bridge writes state/archive.json with all memos, at most once an hour and only when it changed', async () => {
  let t = Date.parse('2026-10-25T12:00:00Z');
  const made = makeApp();
  const gh = fakeGitHub();
  const ledger = createLedger({
    app: made.app, repo: 'me/ledger', ghToken: 'gh', memoToken: TOKEN, owner: 'cam', fetchImpl: gh.fetchImpl, now: () => new Date(t),
    idsPath: join(mkdtempSync(join(tmpdir(), 'memo-ledger-')), 'ids.json'), log: { warn() {}, error() {} },
  });
  made.store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  assert.equal(await ledger.publishArchive(), true);
  const first = JSON.parse(gh.files.get('state/archive.json').text);
  assert.deepEqual(first.memos.map((m) => m.text), ['Venue A or B?']);
  made.store.send({ from: 'cam', to: 'main', text: 'Book B' });
  assert.equal(await ledger.publishArchive(), false, 'not again within the hour');
  t += 61 * 60 * 1000;
  assert.equal(await ledger.publishArchive(), true);
  assert.equal(JSON.parse(gh.files.get('state/archive.json').text).memos.length, 2);
  t += 61 * 60 * 1000;
  assert.equal(await ledger.publishArchive(), false, 'no change, no write');
});

test('a draft is an action of the owner: signed it is applied, unsigned it is refused', async () => {
  const { store, gh, ledger } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  put(gh, '1.json', entry('/api/draft', { id: m.id, text: 'A, since', updated: '2026-10-22T10:00:00.000Z' }));
  const e = entry('/api/draft', { id: m.id, text: 'B, since', updated: '2026-10-22T10:00:01.000Z' }, { nonce: 'zzzzzz999999' });
  put(gh, '2.json', { ...e, sig: sign(TOKEN, e) });
  const results = await ledger.apply();
  assert.match(results[0].outcome, /^rejected/);
  assert.equal(results[1].outcome, 'applied');
  assert.deepEqual(store.drafts(), { [m.id]: { text: 'B, since', updated: '2026-10-22T10:00:01.000Z' } });
});

// The draft follows the owner from the computer to the phone and back: the computer publishes its drafts in the state,
// the page writes each change as a signed action, and the newer time wins on both sides.
test('end to end: a draft typed on the phone reaches the computer, and the reply clears it on both', async () => {
  const { store, gh, ledger } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  store.draft(m.id, 'B, bec', '2026-10-22T09:59:00.000Z');
  await ledger.publish();
  await page(gh, async ({ ledgerApi }) => {
    // The draft of the computer is on the phone.
    assert.deepEqual((await ledgerApi('/api/queue')).drafts, { [m.id]: { text: 'B, bec', updated: '2026-10-22T09:59:00.000Z' } });
    // The phone types more: the page shows its newer draft at once; the answer is the draft as the computer would give it.
    const saved = await ledgerApi('/api/draft', { id: m.id, text: 'B, because', updated: '2026-10-22T10:00:00.000Z' });
    assert.deepEqual(saved, { id: m.id, text: 'B, because', updated: '2026-10-22T10:00:00.000Z' });
    assert.equal((await ledgerApi('/api/queue')).drafts[m.id].text, 'B, because');
    // An older copy from another device does not win on the page.
    await ledgerApi('/api/draft', { id: m.id, text: 'B', updated: '2026-10-22T09:30:00.000Z' });
    assert.equal((await ledgerApi('/api/queue')).drafts[m.id].text, 'B, because');
    // The computer applies both files in order and keeps the newer text.
    await ledger.tick();
    assert.deepEqual(store.drafts(), { [m.id]: { text: 'B, because', updated: '2026-10-22T10:00:00.000Z' } });
    assert.equal((await ledgerApi('/api/queue')).drafts[m.id].text, 'B, because');
    // The reply: the draft is gone on the page before the computer runs, and on the computer after.
    await ledgerApi('/api/reply', { id: m.id, text: 'B, because' });
    assert.deepEqual((await ledgerApi('/api/queue')).drafts, {});
    await ledger.tick();
    assert.deepEqual(store.drafts(), {});
    assert.equal(store.get(m.id).reply, 'B, because');
  });
});

const stamp = (s) => `2026-10-22T10:00:${String(s).padStart(2, '0')}.000Z`;

// What the owner saw (memo 376): the same memo open on both devices, "test" in both fields. She types on the phone,
// and the computer must show the new text within seconds, also with the cursor in its field, without a reload or a
// collapse; and what she types on the computer at that moment is never replaced.
test('a draft typed on the phone reaches the open memo on the computer within one quick run, and never over her keystrokes', async () => {
  const { store, gh, ledger, app } = setup();
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  store.draft(m.id, 'test', stamp(0));
  await ledger.tick();
  await page(gh, async ({ ledgerApi }) => {
    assert.equal((await ledgerApi('/api/queue')).drafts[m.id].text, 'test');
    // The phone types more. "Draft saved" shows after this answer: the signed action is a commit in outbox/.
    const saved = await ledgerApi('/api/draft', { id: m.id, text: 'test, and more', updated: stamp(5) });
    assert.equal(saved.text, 'test, and more');
    assert.ok([...gh.files.keys()].some((k) => k.startsWith('outbox/')), 'the draft is in the repository');
    // The quick run of the computer (each 10 seconds) applies it and publishes the state at once.
    const r = await ledger.quick();
    assert.equal(r.applied[0].outcome, 'applied');
    assert.equal(r.published, true);
    const queue = (await call(app, '/api/queue')).data;
    assert.equal(queue.drafts[m.id].text, 'test, and more');
    assert.equal(JSON.parse(gh.files.get('state/inbox.json').text).data['/api/queue'].drafts[m.id].text, 'test, and more');
    // The computer page polls the drafts (ui/inbox.html pollDrafts) and merges: the field with "test" takes the new text.
    const local = { [m.id]: { text: 'test', updated: stamp(0) } };
    assert.deepEqual(mergeDrafts(local, queue.drafts).changed, [String(m.id)]);
    // But a field she types in now (busy) keeps her keystrokes: the draft of the phone waits for the next poll.
    const typing = { [m.id]: { text: 'test here', updated: nextStamp(local[m.id], Date.parse(stamp(6))) } };
    assert.deepEqual(mergeDrafts(typing, queue.drafts, () => true), { merged: typing, send: [], changed: [] });
    // Her text is newer than the phone's, so when the pause comes it goes to the server and wins there.
    assert.deepEqual(mergeDrafts(typing, queue.drafts).send, [String(m.id)]);
    assert.equal(store.draft(m.id, typing[m.id].text, typing[m.id].updated).text, 'test here');
    // A quiet quick run is one read of outbox/ and no write.
    const before = gh.calls.length;
    assert.deepEqual(await ledger.quick(), { applied: [], published: false });
    assert.deepEqual(gh.calls.slice(before), ['GET /contents/outbox']);
  });
});

test('a draft typed on the computer is published to the phone after two seconds, prompt publishes ten seconds apart', async () => {
  let t = Date.parse('2026-10-22T10:00:00Z');
  const { store, gh, ledger, app } = setup({ now: () => new Date(t) });
  const { memo: m } = store.send({ from: 'main', to: 'cam', text: 'Venue A or B?', impact: 3, effort: 'micro' });
  await ledger.tick();
  // The full run published just now, and a prompt publish keeps the gap from it too. A minute later:
  t += 60 * 1000;
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    // The local Inbox saves a draft: the server runs onDraft (src/server.js gives it ledger.nudge).
    await call(app, '/api/draft', { id: m.id, text: 'A, since', updated: stamp(1) });
    const first = ledger.nudge();
    assert.equal(ledger.nudge(), first, 'a second change in the pause joins the same publish');
    const writes = () => gh.calls.filter((c) => c === 'PUT /contents/state/inbox.json').length;
    const n = writes();
    mock.timers.tick(2000);
    assert.equal(await first, true);
    assert.equal(writes(), n + 1);
    // The phone page reads this file each 15 seconds, also with the memo open and the cursor in the field.
    assert.equal(JSON.parse(gh.files.get('state/inbox.json').text).data['/api/queue'].drafts[m.id].text, 'A, since');
    // More typing right after: the next prompt publish waits for the gap, so typing makes at most six commits a minute.
    t += 1000;
    await call(app, '/api/draft', { id: m.id, text: 'A, since it', updated: stamp(2) });
    let done = false;
    const second = ledger.nudge().then((r) => { done = true; return r; });
    mock.timers.tick(2000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(done, false, 'not within ten seconds of the last publish');
    mock.timers.tick(7000);
    assert.equal(await second, true);
    assert.equal(JSON.parse(gh.files.get('state/inbox.json').text).data['/api/queue'].drafts[m.id].text, 'A, since it');
    // Nothing changed: a nudge publishes nothing and asks GitHub nothing.
    const before = gh.calls.length;
    const third = ledger.nudge();
    mock.timers.tick(10000);
    assert.equal(await third, false);
    assert.equal(gh.calls.length, before);
  } finally { mock.timers.reset(); }
});

test('the threads of the open memos go to the phone, and the page gives the thread of a memo from them', async () => {
  const { store, gh, ledger } = setup();
  const a = store.send({ from: 'cam', to: 'main', text: 'Book the venue' }).memo;
  const b = store.send({ from: 'main', to: 'cam', text: 'Booked, this answers memo 1', impact: 3, effort: 'micro' }).memo;
  const c = store.send({ from: 'main', to: 'cam', text: 'Alone', impact: 3, effort: 'micro' }).memo;
  await ledger.tick();
  assert.deepEqual(Object.keys(JSON.parse(gh.files.get('state/inbox.json').text).data['/api/threads']), [String(b.id)]);
  await page(gh, async ({ ledgerApi }) => {
    await ledgerApi('/api/queue');
    assert.deepEqual((await ledgerApi(`/api/thread?id=${b.id}`)).memos.map((m) => m.id), [a.id, b.id]);
    assert.deepEqual(await ledgerApi(`/api/thread?id=${c.id}`), { id: c.id, memos: [] });
    assert.deepEqual(await ledgerApi('/api/thread?id=t-abc'), { id: 't-abc', memos: [] });
  });
});

test('start runs the full run each 30 seconds and the quick run each 10 seconds', async () => {
  const { ledger } = setup();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const timers = ledger.start();
    assert.equal(timers.length, 2);
    for (const timer of timers) clearInterval(timer);
  } finally { mock.timers.reset(); }
});

// Memo 492: the writes of the page go out one at a time, and a 409 of GitHub (a commit at the same second) is tried
// again. Two writes at once never overlap, and a reply is not lost when the branch is busy.
test('page writes go one at a time and a 409 is tried again', async () => {
  const { serialWrite } = await import('../ui/ledger.js');
  const wait = () => Promise.resolve();
  let running = 0;
  let most = 0;
  const order = [];
  const slow = (name) => async () => {
    running += 1; most = Math.max(most, running);
    await new Promise((done) => setTimeout(done, 5));
    running -= 1; order.push(name);
    return name;
  };
  const [a, b] = await Promise.all([serialWrite(slow('draft'), wait), serialWrite(slow('reply'), wait)]);
  assert.deepEqual([a, b], ['draft', 'reply']);
  assert.deepEqual(order, ['draft', 'reply']);
  assert.equal(most, 1);

  let tries = 0;
  const busy = async () => { tries += 1; if (tries < 3) throw Object.assign(new Error('GitHub gave status 409.'), { status: 409 }); return 'saved'; };
  assert.equal(await serialWrite(busy, wait), 'saved');
  assert.equal(tries, 3);

  // Another error is not tried again, and a failed write does not stop the next one.
  let other = 0;
  await assert.rejects(serialWrite(async () => { other += 1; throw Object.assign(new Error('x'), { status: 422 }); }, wait), /x/);
  assert.equal(other, 1);
  assert.equal(await serialWrite(async () => 'next', wait), 'next');

  // A branch that stays busy gives up after the last wait, with the error for the page.
  let always = 0;
  await assert.rejects(serialWrite(async () => { always += 1; throw Object.assign(new Error('GitHub gave status 409.'), { status: 409 }); }, wait), /409/);
  assert.equal(always, 5);
});

// Memo 494: the Agents page on the phone showed the state of its first load, so an answered question stayed there and
// taps on it did nothing to be seen. Now it reads the state again when it is older than 15 seconds, and a sent answer
// takes the question away at once.
test('the Agents page reads the state again, and a sent answer takes the question away', async () => {
  const gh = fakeGitHub();
  const state = (status, blocked) => JSON.stringify({ v: 1, generated: new Date().toISOString(), ids: {}, data: {
    '/api/queue': { memos: [], ticks: [], postponed: 0 },
    '/api/agents': [{ name: 'main', kind: 'long', status, blocked }] } });
  gh.files.set('state/inbox.json', { text: state('Deploying', { reason: 'permission', prompt: 'Do you want to proceed?', since: '2026-10-29T20:53:00Z' }), sha: 'a' });
  const realNow = Date.now;
  try {
    await page(gh, async ({ ledgerApi }) => {
      await ledgerApi('/api/queue');
      assert.equal((await ledgerApi('/api/agents'))[0].blocked.reason, 'permission');
      await ledgerApi('/api/agent/answer', { name: 'main', key: '1' });
      assert.equal((await ledgerApi('/api/agents'))[0].blocked, null);
      // The computer applies the answer and publishes.
      for (const k of [...gh.files.keys()]) if (k.startsWith('outbox/')) gh.files.delete(k);
      gh.files.set('state/inbox.json', { text: state('Idle', null), sha: 'b' });
      assert.equal((await ledgerApi('/api/agents'))[0].status, 'Deploying');
      const at = realNow();
      Date.now = () => at + 16000;
      const agents = await ledgerApi('/api/agents');
      assert.equal(agents[0].status, 'Idle');
      assert.equal(agents[0].blocked, null);
    });
  } finally { Date.now = realNow; }
});
