import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, TOKEN, LIAISON_TOKEN } from './helpers.js';

// The setup link of the GitHub Pages Inbox, as the Agents page makes it ("Set up phone").
const PAGE = 'https://example.github.io/memo-inbox/';
const KEY = 'github_pat_11ABCDEFG0123456789abcdefghijklmnopqrstuvwxyz';

// ui/ledger.js reads the link: base64url of "githubKey\nmemoToken" after #setup=.
function decode(link) {
  const m = /^(.*)#setup=([A-Za-z0-9_-]+)$/.exec(link);
  assert.ok(m, `the link has the form <page>#setup=<code>: ${link}`);
  return { page: m[1], text: Buffer.from(m[2], 'base64url').toString('utf8') };
}

test('the setup link decodes to the GitHub key and the Memo token', async () => {
  const { app } = makeApp({ ledgerPage: PAGE });
  const r = await call(app, '/api/ledger/setup-link', { ghKey: `  ${KEY}\n` });
  assert.equal(r.status, 200);
  const { page, text } = decode(r.data.link);
  assert.equal(page, PAGE);
  assert.deepEqual(text.split('\n'), [KEY, TOKEN]);
});

test('the status says whether the GitHub Inbox is set up', async () => {
  const on = await call(makeApp({ ledgerPage: PAGE }).app, '/api/ledger/status');
  assert.deepEqual(on, { status: 200, data: { configured: true, page: PAGE } });
  const off = await call(makeApp().app, '/api/ledger/status');
  assert.deepEqual(off, { status: 200, data: { configured: false, page: null } });
  assert.equal((await call(makeApp({ ledgerPage: PAGE }).app, '/api/ledger/status', undefined, LIAISON_TOKEN)).status, 403);
});

test('a bad key gives 400, and the answer never echoes the key', async () => {
  const { app } = makeApp({ ledgerPage: PAGE });
  for (const ghKey of ['', 'short', 'github_pat_with a space', 'github_pat_bad/chars+here=', 'x'.repeat(256), 42, undefined]) {
    const r = await call(app, '/api/ledger/setup-link', { ghKey });
    assert.equal(r.status, 400, `key ${JSON.stringify(ghKey)}`);
    assert.equal(r.data.error, 'That does not look like a GitHub key. It starts with github_pat_.');
    if (typeof ghKey === 'string' && ghKey) assert.ok(!JSON.stringify(r.data).includes(ghKey), 'the answer has no copy of the key');
  }
});

test('with no GitHub Inbox on this computer, the link is refused', async () => {
  const { app } = makeApp();
  const r = await call(app, '/api/ledger/setup-link', { ghKey: KEY });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, 'The GitHub Inbox is not set up on this computer.');
  assert.ok(!JSON.stringify(r.data).includes(KEY));
});

test('the setup link needs the token of the owner', async () => {
  const { app } = makeApp({ ledgerPage: PAGE });
  const none = await call(app, '/api/ledger/setup-link', { ghKey: KEY }, null);
  assert.equal(none.status, 401);
  const liaison = await call(app, '/api/ledger/setup-link', { ghKey: KEY }, LIAISON_TOKEN);
  assert.equal(liaison.status, 403);
  for (const r of [none, liaison]) {
    assert.equal(r.data.link, undefined);
    assert.ok(!JSON.stringify(r.data).includes(KEY));
    assert.ok(!JSON.stringify(r.data).includes(TOKEN));
  }
});
