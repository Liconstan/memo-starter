import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { serve } from '@hono/node-server';
import { makeApp, TOKEN, ROOT } from './helpers.js';

const run = promisify(execFile);
const CLI = join(ROOT, 'scripts', 'memo.mjs');

// The server runs in this process, so the client must run without a block of the event loop (no execFileSync).
async function withServer(fn) {
  const made = makeApp();
  const server = await new Promise((done) => { const s = serve({ fetch: made.app.fetch, hostname: '127.0.0.1', port: 0 }, () => done(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const memo = async (args, env = {}) => {
    try {
      const { stdout, stderr } = await run('node', [CLI, ...args], { env: { ...process.env, MEMO_URL: url, MEMO_TOKEN: TOKEN, MEMO_WAIT_INTERVAL_MS: '50', ...env } });
      return { code: 0, stdout, stderr };
    } catch (e) {
      return { code: e.code, stdout: e.stdout, stderr: e.stderr };
    }
  };
  try { await fn({ ...made, memo, url }); } finally { server.close(); }
}

test('send, list, reply, and ack through the client', () => withServer(async ({ memo, store }) => {
  const sent = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '4', '--effort', 'micro', '--due', '2026-10-15', 'Approve', 'the deploy?']);
  assert.equal(sent.code, 0);
  assert.match(sent.stdout, /Memo 1 is sent to cam\./);
  assert.equal(store.get(1).text, 'Approve the deploy?');
  const list = await memo(['list', '--to', 'cam']);
  assert.match(list.stdout, /#1 from main to cam/);
  assert.match(list.stdout, /impact 4, effort micro, due 2026-10-15/);
  assert.match(list.stdout, /Approve the deploy\?/);
  assert.match((await memo(['reply', '1', 'Yes,', 'do it.'])).stdout, /Memo 1 has the reply\./);
  assert.equal(store.get(1).reply, 'Yes, do it.');
  assert.match((await memo(['ack', '1'])).stdout, /read/);
  assert.equal(store.get(1).acked, 1);
  assert.match((await memo(['list', '--to', 'cam'])).stdout, /No open memos to cam\./);
}));

test('send prints the corrections of the owner', () => withServer(async ({ memo, store }) => {
  await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '5', '--effort', 'micro', 'Select a color name.']);
  store.adjust(1, -1);
  const next = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '5', '--effort', 'micro', 'Second.']);
  assert.match(next.stdout, /The owner changed the impact/);
  assert.match(next.stdout, /memo 1: 5 to 4 \("Select a color name\."\)/);
}));

test('a server error goes to standard error with exit code 1', () => withServer(async ({ memo }) => {
  const r = await memo(['send', '--from', 'main', '--to', 'cam', 'No impact.']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /impact must be a whole number/);
  assert.equal((await memo(['reply', '99', 'x'])).code, 1);
  assert.match((await memo(['reply', 'abc', 'x'])).stderr, /memo id must be a number/);
}));

test('the client refuses wrong input with a clear message', () => withServer(async ({ memo }) => {
  assert.match((await memo([])).stderr, /Usage/);
  assert.match((await memo(['explode'])).stderr, /Usage/);
  assert.match((await memo(['send', '--to', 'cam', 'x'])).stderr, /--from is necessary/);
  assert.match((await memo(['send', '--from', 'main', '--color', 'red', 'x'])).stderr, /--color is not a known option/);
  assert.match((await memo(['send', '--from', 'main', '--to'])).stderr, /--to needs a value/);
  assert.match((await memo(['send', '--from', 'cam', '--to', 'main'])).stderr, /text is necessary/);
  assert.match((await memo(['ack'])).stderr, /memo id/);
}));

test('send --re names the origins of the memo', () => withServer(async ({ memo, store }) => {
  await memo(['send', '--from', 'cam', '--to', 'main', 'Do it']);
  await memo(['send', '--from', 'cam', '--to', 'main', 'And that']);
  const r = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '3', '--effort', 'micro', '--re', '1,2', 'Both done.']);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(store.get(3).re, [1, 2]);
  assert.deepEqual(store.thread(1).memos.map((m) => m.id), [1, 2, 3], 'memo 2 is in the thread through memo 3');
  assert.match((await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '3', '--effort', 'micro', '--re', '9', 'x'])).stderr, /memo 9/);
}));

test('text after -- can start with two hyphens', () => withServer(async ({ memo, store }) => {
  const r = await memo(['send', '--from', 'cam', '--to', 'main', '--', '--force is the flag to remove']);
  assert.equal(r.code, 0);
  assert.equal(store.get(1).text, '--force is the flag to remove');
}));

test('a wrong token gives exit code 1', () => withServer(async ({ memo }) => {
  const r = await memo(['list', '--to', 'cam'], { MEMO_TOKEN: 'wrong-token-0123456789' });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /token/);
}));

test('helper start takes the model with its version, as an id or a name, and asks for the version after a bare alias (memo 1159)', () => withServer(async ({ memo, agents }) => {
  const full = await memo(['helper', '--as', 'main', 'start', 'Vault sync', 'claude-fable-5-1']);
  assert.equal(full.code, 0);
  assert.match(full.stdout, /The helper "Vault sync" \(Fable 5\.1\) of main runs\./);
  assert.ok(!full.stdout.includes('version next time'), 'no hint after a model with a version');
  const quoted = await memo(['helper', '--as', 'main', 'start', 'Email triage', 'opus 5.5']);
  assert.match(quoted.stdout, /The helper "Email triage" \(Opus 5\.5\) of main runs\./);
  // The version as its own word, with no quotes: the last two words are the model, not the end of the label.
  const words = await memo(['helper', '--as', 'main', 'start', 'Review', 'the', 'deck', 'sonnet', '5.5']);
  assert.match(words.stdout, /The helper "Review the deck" \(Sonnet 5\.5\) of main runs\./);
  const bare = await memo(['helper', '--as', 'main', 'start', 'Notes', 'haiku']);
  assert.match(bare.stdout, /The helper "Notes" \(haiku\) of main runs\./);
  assert.match(bare.stdout, /Give the model with its version next time, so the Inbox shows it: for example "fable 5\.1" or claude-fable-5-1 in the place of "haiku"\./);
  // A family word and a version with no label is not a start.
  assert.match((await memo(['helper', '--as', 'main', 'start', 'fable', '5.1'])).stderr, /label and the model/);
  assert.deepEqual(agents.list()[0].helpers.map((h) => [h.label, h.model]), [['Notes', 'haiku'], ['Review the deck', 'Sonnet 5.5'], ['Email triage', 'Opus 5.5'], ['Vault sync', 'Fable 5.1']]);
  const list = await memo(['helper', '--as', 'main', 'list']);
  assert.match(list.stdout, /Running: Vault sync \(Fable 5\.1\), since \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  assert.match(list.stdout, /Running: Review the deck \(Sonnet 5\.5\)/);
}));

test('helper start, done, and list through the client', () => withServer(async ({ memo, agents }) => {
  const started = await memo(['helper', '--as', 'main', 'start', 'Vault', 'sync', 'fable']);
  assert.equal(started.code, 0);
  assert.match(started.stdout, /The helper "Vault sync" \(fable\) of main runs\./);
  await memo(['helper', '--as', 'main', 'start', 'Email triage', 'sonnet']);
  const list = await memo(['helper', '--as', 'main', 'list']);
  assert.match(list.stdout, /Running: Email triage \(sonnet\), since \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  assert.match(list.stdout, /Running: Vault sync \(fable\)/);
  assert.match((await memo(['helper', '--as', 'main', 'done', 'Vault', 'sync'])).stdout, /The helper "Vault sync" of main is done\./);
  assert.deepEqual(agents.list()[0].helpers.map((h) => [h.label, h.running]), [['Email triage', true], ['Vault sync', false]]);
  assert.match((await memo(['helper', '--as', 'main', 'list'])).stdout, /Done: Vault sync \(fable\), \d{4}-\d\d-\d\d \d\d:\d\d UTC to \d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  const gone = await memo(['helper', '--as', 'main', 'done', 'Vault sync']);
  assert.equal(gone.code, 1);
  assert.match(gone.stderr, /No helper of main with the label "Vault sync" runs\./);
  assert.match((await memo(['helper', '--as', 'main', 'start', 'Only a label'])).stderr, /label and the model/);
  assert.match((await memo(['helper', '--as', 'main', 'done'])).stderr, /Give the label/);
  assert.match((await memo(['helper', 'start', 'x', 'm'])).stderr, /--as is necessary/);
  assert.match((await memo(['helper', '--as', 'main', 'pause', 'x'])).stderr, /memo helper --as <agent> start <label> <model>/);
  assert.match((await memo(['helper', '--as', 'nobody', 'list'])).stderr, /No agent has the name nobody/);
  assert.match((await memo(['helper', '--as', 'liaison', 'list'])).stdout, /No helpers of liaison in the last day\./);
}));

test('status, recap, close, and forward', () => withServer(async ({ memo, store, agents }) => {
  assert.equal((await memo(['status', '--as', 'main', 'I update the README.'])).code, 0);
  assert.equal((await memo(['recap', '--as', 'main', 'The README is complete.'])).code, 0);
  assert.equal(agents.list()[0].status, 'I update the README.');
  assert.equal(agents.list()[0].recap, 'The README is complete.');
  store.send({ from: 'discord', to: 'liaison', text: 'Discord, Cam (the owner): add a page', trusted: true });
  assert.match((await memo(['forward', '1'])).stdout, /Memo 2 is sent to main with the text of memo 1\./);
  assert.match((await memo(['close', '1', 'Passed', 'to main.'])).stdout, /Memo 1 is closed\./);
  assert.equal(store.get(1).reply, 'Passed to main.');
  assert.equal((await memo(['close', '2'])).code, 0);
  assert.equal(store.get(2).reply, null);
}));

test('edit changes the text of a memo', () => withServer(async ({ memo, store }) => {
  await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '4', '--effort', 'micro', 'Approve the deploy?']);
  const r = await memo(['edit', '1', '--', '**Approve the deploy?**\n\n- Yes\n- No']);
  assert.match(r.stdout, /Memo 1 has the new text\./);
  assert.equal(store.get(1).text, '**Approve the deploy?**\n\n- Yes\n- No');
  assert.match((await memo(['edit', '1'])).stderr, /text is necessary/);
}));

test('prompt prints the charter text', () => withServer(async ({ memo }) => {
  const r = await memo(['prompt', '--as', 'nobody']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No agent has the name nobody/);
}));

test('wait exits with code 0 and prints the news when news exists', () => withServer(async ({ memo, store }) => {
  store.send({ from: 'cam', to: 'main', text: 'Update the README.' });
  store.send({ from: 'main', to: 'cam', text: 'Approve?', impact: 3, effort: 'micro' });
  store.reply(2, 'Yes.');
  const r = await memo(['wait', '--as', 'main', '1']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /New memos to main/);
  assert.match(r.stdout, /Update the README\./);
  assert.match(r.stdout, /Results of memos from main/);
  assert.match(r.stdout, /Reply: Yes\./);
  assert.match(r.stdout, /memo ack 2/);
}));

test('wait ignores the memos in --hold and exits with code 2 at the time limit', () => withServer(async ({ memo, store }) => {
  store.send({ from: 'cam', to: 'main', text: 'A memo that waits for an answer.' });
  const r = await memo(['wait', '--as', 'main', '--hold', '1', '0.003']);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /No news for main/);
}));

test('wait exits when a new memo arrives while it waits', () => withServer(async ({ memo, store }) => {
  setTimeout(() => store.send({ from: 'cam', to: 'main', text: 'A late memo.' }), 150);
  const r = await memo(['wait', '--as', 'main', '1']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /A late memo\./);
}));

test('wait continues when the server does not answer, and other commands fail', async () => {
  const env = { ...process.env, MEMO_URL: 'http://127.0.0.1:1', MEMO_TOKEN: TOKEN, MEMO_WAIT_INTERVAL_MS: '50' };
  const waited = await run('node', [CLI, 'wait', '--as', 'main', '0.003'], { env }).catch((e) => e);
  assert.equal(waited.code, 2); // the time limit, not an error
  const listed = await run('node', [CLI, 'list', '--to', 'main'], { env }).catch((e) => e);
  assert.equal(listed.code, 1);
  assert.match(listed.stderr, /does not answer/);
});

test('wait does not stop when a different program answers on the port', async () => {
  // While the Memo server starts again, a different server can get the request and answer with a page.
  const other = await new Promise((done) => {
    const s = createServer((req, res) => { res.statusCode = 404; res.setHeader('Content-Type', 'text/html'); res.end('<h1>Error response</h1>'); });
    s.listen(0, '127.0.0.1', () => done(s));
  });
  try {
    const env = { ...process.env, MEMO_URL: `http://127.0.0.1:${other.address().port}`, MEMO_TOKEN: TOKEN, MEMO_WAIT_INTERVAL_MS: '20' };
    const r = await run('node', [CLI, 'wait', '--as', 'main', '0.002'], { env }).catch((e) => e);
    assert.equal(r.code, 2, 'the wait ends at its time limit, not with an error');
    assert.match(r.stdout, /No news for main/);
  } finally { other.close(); }
});

test('send and brief set the title and the next step of a memo', () => withServer(async ({ memo, store }) => {
  await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '2', '--effort', 'micro', '--title', 'Lamp', '--next', 'Reply real', 'Which lamp?']);
  assert.equal(store.get(1).title, 'Lamp');
  assert.equal(store.get(1).next, 'Reply real');
  const r = await memo(['brief', '1', '--next', 'Reply look']);
  assert.match(r.stdout, /Memo 1 has the brief: Lamp · next: Reply look\./);
  assert.equal(store.get(1).title, 'Lamp');
  assert.match((await memo(['brief', '1'])).stderr, /title, next/);
  assert.match((await memo(['brief', '1', 'loose text'])).stderr, /--title and --next/);
}));

test('compact closes the memo and prints the new id', () => withServer(async ({ memo, store }) => {
  await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '4', '--effort', 'micro', '--tag', 'work', 'A', 'long', 'memo.']);
  const r = await memo(['compact', '1', '--from', 'main', '--title', 'Short', '--', '- [ ] Approve', 'the deploy']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Memo 1 is compacted into memo 2\./);
  assert.equal(store.get(2).text, '- [ ] Approve the deploy');
  assert.equal(store.get(2).title, 'Short');
  assert.deepEqual(store.get(2).tags, ['work']);
  assert.equal(store.get(1).state, 'closed');
  assert.match((await memo(['compact', '2', 'x'])).stderr, /--from is necessary/);
  assert.match((await memo([])).stderr, /memo compact <id> --from <name>/);
}));

test('memo tz prints the time zone of the browser of the owner and when the Inbox sent it, in that zone', () => withServer(async ({ memo, url }) => {
  assert.match((await memo(['tz'])).stdout, /No time zone yet/);
  const r = await fetch(`${url}/api/client-tz`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone: 'America/New_York' }) });
  const { seen } = await r.json();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(seen)).map((x) => [x.type, x.value]));
  const out = await memo(['tz']);
  assert.equal(out.code, 0);
  assert.equal(out.stdout.trim(), `America/New_York, seen ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`);
}));

test('send --ws gives a code, the lines show it, and a code works in the place of an id', () => withServer(async ({ memo, store }) => {
  const sent = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '3', '--effort', 'micro', '--ws', 'ops', '--title', 'Insurance', 'Sign the form?']);
  assert.equal(sent.code, 0, sent.stderr);
  assert.match(sent.stdout, /^Memo 1 OPS-1 is sent to cam\./);
  assert.equal(store.get(1).code, 'OPS-1');
  const list = await memo(['list', '--to', 'cam']);
  assert.match(list.stdout, /#1 OPS-1 from main to cam/);
  assert.match((await memo(['brief', 'OPS-1', '--next', 'Sign it'])).stdout, /Memo 1 OPS-1 has the brief: Insurance · next: Sign it\./);
  assert.match((await memo(['note', 'ops-1', '--from', 'cam', 'A note.'])).stdout, /Memo 1 OPS-1 has the note\./);
  const bad = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '3', '--effort', 'micro', '--ws', 'NOPE', 'x']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /ws must be one of: REL, SPEC, FUND, OPS, PROG, COMM, SYS, ME/);
  // A reply with --re takes the code; the search finds the memo by its code.
  const re = await memo(['send', '--from', 'cam', '--to', 'main', '--re', 'OPS-1', 'Signed.']);
  assert.match(re.stdout, /^Memo 2 OPS-2 is sent to main\./);
  const found = await memo(['search', 'OPS-1']);
  assert.match(found.stdout, /^#1 OPS-1 main to cam/);
  assert.match((await memo(['close', 'OPS-1', 'Done.'])).stdout, /Memo 1 OPS-1 is closed\./);
  assert.match((await memo(['ack', 'OPS-1'])).stdout, /Marked as read: 1 OPS-1\./);
  const gone = await memo(['close', 'OPS-9']);
  assert.equal(gone.code, 1);
  assert.match(gone.stderr, /No memo has the code OPS-9/);
  assert.match((await memo(['reply', 'OPS', 'x'])).stderr, /must be a number or a code/);
  // A memo with no code shows its number alone, as before.
  const plain = await memo(['send', '--from', 'main', '--to', 'cam', '--impact', '3', '--effort', 'micro', 'Plain.']);
  assert.match(plain.stdout, /^Memo 3 is sent to cam\./);
  assert.match((await memo(['list', '--to', 'cam'])).stdout, /#3 from main to cam/);
  assert.match((await memo([])).stderr, /--ws <code>/);
}));

test('wait --hold takes a code', () => withServer(async ({ memo, store }) => {
  store.send({ from: 'cam', to: 'main', text: 'Held by its code.', ws: 'REL' });
  const r = await memo(['wait', '--as', 'main', '--hold', 'rel-1', '0.003']);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /No news for main/);
  store.send({ from: 'cam', to: 'main', text: 'Not held.' });
  const news = await memo(['wait', '--as', 'main', '--hold', 'REL-1', '1']);
  assert.equal(news.code, 0);
  assert.match(news.stdout, /#2 from cam to main/);
  assert.doesNotMatch(news.stdout, /Held by its code/);
}));
