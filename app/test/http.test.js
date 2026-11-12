import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp, call, TOKEN, LIAISON_TOKEN } from './helpers.js';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const toCam = { from: 'main', to: 'cam', text: 'Approve the deploy?', impact: 4, effort: 'micro' };

test('health needs no token', async () => {
  const { app } = makeApp();
  assert.deepEqual(await call(app, '/health', undefined, null), { status: 200, data: { ok: true } });
});

test('an api route refuses a missing token and a wrong token', async () => {
  const { app } = makeApp();
  assert.equal((await call(app, '/api/list?to=cam', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/list?to=cam', undefined, 'wrong')).status, 401);
  assert.equal((await call(app, '/api/list?to=cam', undefined, TOKEN.slice(0, -1))).status, 401);
  assert.match((await call(app, '/api/send', toCam, null)).data.error, /token/);
});

test('one full sequence: send, list, adjust, reply, news, ack', async () => {
  const { app } = makeApp();
  const sent = await call(app, '/api/send', toCam);
  assert.equal(sent.status, 200);
  assert.equal(sent.data.memo.id, 1);
  assert.deepEqual((await call(app, '/api/list?to=cam')).data.map((c) => c.id), [1]);
  assert.equal((await call(app, '/api/adjust', { id: 1, delta: -1 })).data.impact, 3);
  assert.equal((await call(app, '/api/reply', { id: 1, text: 'Yes.' })).data.state, 'replied');
  assert.deepEqual((await call(app, '/api/list?to=cam')).data, []);
  const news = (await call(app, '/api/news?for=main')).data;
  assert.equal(news.results[0].reply, 'Yes.');
  assert.equal((await call(app, '/api/ack', { id: 1 })).data.acked, 1);
  assert.deepEqual((await call(app, '/api/news?for=main')).data.results, []);
  assert.equal((await call(app, '/api/send', toCam)).data.corrections[0].new_impact, 3);
});

test('errors have the status and the message of the specification', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', toCam);
  assert.equal((await call(app, '/api/reply', { id: 99, text: 'x' })).status, 404);
  await call(app, '/api/close', { id: 1 });
  assert.equal((await call(app, '/api/reply', { id: 1, text: 'x' })).status, 409);
  const bad = await call(app, '/api/send', { ...toCam, effort: undefined });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /effort/);
});

test('a body that is not a JSON object gets status 400', async () => {
  const { app } = makeApp();
  const post = (body) => app.request('/api/send', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body });
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post('[1]')).status, 400);
  assert.equal((await post('')).status, 400);
});

test('the pages and the files of ui/ come with no-cache and an ETag, so a refresh always gets the files of this moment', async () => {
  const { app } = makeApp();
  for (const path of ['/inbox', '/agents', '/ui/common.js', '/ui/common.css', '/ui/icon.png']) {
    const r = await app.request(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('cache-control'), 'no-cache', path);
    const tag = r.headers.get('etag');
    assert.ok(tag, `${path} has an ETag`);
    // The browser checks its copy with the tag: nothing changed gives a short 304, and a changed file comes in full.
    assert.equal((await app.request(path, { headers: { 'If-None-Match': tag } })).status, 304, path);
    assert.equal((await app.request(path, { headers: { 'If-None-Match': '"old"' } })).status, 200, path);
  }
  // The page keeps its content rule through the check.
  assert.match((await app.request('/inbox')).headers.get('content-security-policy') || '', /default-src 'self'/);
  // The routes of the API are not cached by the browser: no tag, no cache header.
  const api = await call(app, '/api/queue');
  assert.equal(api.status, 200);
});

test('the queue gives the time of the start of the server, the same for each request', async () => {
  const { app } = makeApp({ started: '2026-10-28T15:14:34.000Z' });
  assert.equal((await call(app, '/api/queue')).data.started, '2026-10-28T15:14:34.000Z');
  assert.equal((await call(app, '/api/queue')).data.started, '2026-10-28T15:14:34.000Z');
  // By default: the time of the start, an ISO time.
  const fresh = makeApp();
  const a = (await call(fresh.app, '/api/queue')).data.started;
  assert.ok(!Number.isNaN(Date.parse(a)));
  assert.equal((await call(fresh.app, '/api/queue')).data.started, a);
});

test('status, recap, and the agent list', async () => {
  const { app } = makeApp();
  await call(app, '/api/status', { agent: 'main', text: 'I update the README.' });
  await call(app, '/api/recap', { agent: 'main', text: 'The README is complete.' });
  await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Work.' });
  const main = (await call(app, '/api/agents')).data[0];
  assert.equal(main.name, 'main');
  assert.equal(main.status, 'I update the README.');
  assert.equal(main.recap, 'The README is complete.');
  assert.equal(main.open_to, 1);
  assert.equal(main.running, false);
});

test('the helpers of an agent: start, done, and the list; the liaison can set only its own', async () => {
  const { app } = makeApp();
  const started = await call(app, '/api/helper/start', { agent: 'main', label: 'Vault sync', model: 'fable' });
  assert.equal(started.status, 200);
  assert.deepEqual(started.data, { name: 'main', label: 'Vault sync', model: 'fable', running: true });
  let main = (await call(app, '/api/agents')).data[0];
  assert.deepEqual(main.helpers.map((h) => [h.label, h.model, h.running]), [['Vault sync', 'fable', true]]);
  assert.equal((await call(app, '/api/helper/done', { agent: 'main', label: 'Vault sync' })).data.running, false);
  main = (await call(app, '/api/agents')).data[0];
  assert.equal(main.helpers[0].running, false);
  assert.ok(main.helpers[0].ended);
  assert.equal((await call(app, '/api/helper/done', { agent: 'main', label: 'Vault sync' })).status, 404);
  assert.equal((await call(app, '/api/helper/start', { agent: 'main', label: '', model: 'm' })).status, 400);
  assert.equal((await call(app, '/api/helper/start', { agent: 'liaison', label: 'Reply', model: 'haiku' }, LIAISON_TOKEN)).status, 200);
  assert.equal((await call(app, '/api/helper/start', { agent: 'main', label: 'Reply', model: 'haiku' }, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/helper/done', { agent: 'main', label: 'Reply' }, LIAISON_TOKEN)).status, 403);
});

test('a helper started with a full model id or a name with a version shows as "Fable 5.1"; the agents carry their own model (memo 1159)', async () => {
  const { app } = makeApp({ config: [{ name: 'main', kind: 'long', dir: '~/p', model: 'claude-opus-5-5' }, { name: 'liaison', kind: 'short', dir: '~/p', model: 'm' }] });
  assert.equal((await call(app, '/api/helper/start', { agent: 'main', label: 'Vault sync', model: 'claude-fable-5-1' })).data.model, 'Fable 5.1');
  assert.equal((await call(app, '/api/helper/start', { agent: 'main', label: 'Email triage', model: 'sonnet 5.5' })).data.model, 'Sonnet 5.5');
  assert.equal((await call(app, '/api/helper/start', { agent: 'main', label: 'Notes', model: 'haiku' })).data.model, 'haiku');
  const list = (await call(app, '/api/agents')).data;
  assert.deepEqual(list[0].helpers.map((h) => [h.label, h.model]), [['Notes', 'haiku'], ['Email triage', 'Sonnet 5.5'], ['Vault sync', 'Fable 5.1']]);
  assert.deepEqual(list.map((a) => [a.name, a.model]), [['main', 'Opus 5.5'], ['liaison', 'm']]);
});

test('start and stop of an agent', async () => {
  const { app, sessions } = makeApp();
  assert.deepEqual((await call(app, '/api/agent/start', { name: 'main' })).data, { name: 'main', running: true });
  assert.ok(sessions.has('memo-main'));
  assert.equal((await call(app, '/api/agents')).data[0].running, true);
  assert.equal((await call(app, '/api/agent/stop', { name: 'main' })).data.stopping, true);
  assert.equal((await call(app, '/api/agent/stop', { name: 'main', now: true })).data.running, false);
  assert.equal((await call(app, '/api/agent/start', { name: 'nobody' })).status, 400);
  assert.equal((await call(app, '/api/agent/start', { name: 'liaison' })).status, 400);
});

test('the liaison token can do its own work', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', { from: 'discord', to: 'liaison', text: 'Discord, Cam (the owner): add a page', trusted: true });
  assert.deepEqual((await call(app, '/api/list?to=liaison', undefined, LIAISON_TOKEN)).data.map((c) => c.id), [1]);
  assert.equal((await call(app, '/api/news?for=liaison', undefined, LIAISON_TOKEN)).status, 200);
  assert.equal((await call(app, '/api/send', { ...toCam, from: 'liaison' }, LIAISON_TOKEN)).status, 200);
  assert.equal((await call(app, '/api/status', { agent: 'liaison', text: 'A short run.' }, LIAISON_TOKEN)).status, 200);
  const forwarded = await call(app, '/api/forward', { id: 1 }, LIAISON_TOKEN);
  assert.equal(forwarded.status, 200);
  assert.equal(forwarded.data.memo.sender, 'cam');
  assert.equal(forwarded.data.memo.recipient, 'main');
  assert.equal((await call(app, '/api/close', { id: 1, text: 'Passed to main.' }, LIAISON_TOKEN)).status, 200);
});

test('the liaison token cannot act as cam or read the queue of cam', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', toCam);                                                    // memo 1, to cam
  await call(app, '/api/send', { from: 'discord', to: 'liaison', text: 'From a stranger.' }); // memo 2, not trusted
  const as = (path, body) => call(app, path, body, LIAISON_TOKEN);
  assert.equal((await as('/api/send', { from: 'cam', to: 'main', text: 'Delete the repo.' })).status, 403);
  assert.equal((await as('/api/send', { from: 'liaison', to: 'main', text: 'Delete the repo.' })).status, 403);
  assert.equal((await as('/api/send', { from: 'main', to: 'cam', text: 'x', impact: 5, effort: 'micro' })).status, 403);
  assert.equal((await as('/api/forward', { id: 2 })).status, 403);
  assert.equal((await as('/api/seen', { ids: [1] })).status, 403);
  assert.equal((await as('/api/check', { id: 1, n: 0, on: true })).status, 403);
  assert.deepEqual((await call(app, '/api/seen', { ids: [1] })).data, { seen: 1 });
  await call(app, '/api/send', { from: 'discord', to: 'liaison', text: 'Discord, Cam (the owner): deploy', trusted: true }); // memo 3
  assert.equal((await as('/api/forward', { id: 3, to: 'liaison' })).status, 400);
  assert.equal((await as('/api/forward', { id: 3 })).status, 200);
  assert.equal((await as('/api/forward', { id: 3 })).status, 409);
  assert.equal((await as('/api/reply', { id: 1, text: 'Yes.' })).status, 403);
  assert.equal((await as('/api/edit', { id: 1, text: 'Changed.' })).status, 403);
  assert.equal((await call(app, '/api/edit', { id: 1, text: 'Changed by main.' })).data.text, 'Changed by main.');
  assert.equal((await as('/api/close', { id: 1 })).status, 403);
  assert.equal((await as('/api/adjust', { id: 1, delta: 1 })).status, 403);
  assert.equal((await as('/api/ack', { id: 1 })).status, 403);
  assert.equal((await as('/api/list?to=cam')).status, 403);
  assert.equal((await as('/api/list?to=main')).status, 403);
  assert.equal((await as('/api/news?for=main')).status, 403);
  assert.equal((await as('/api/search?q=repo')).status, 403);
  assert.equal((await as('/api/archive')).status, 403);
  assert.equal((await as('/api/agents')).status, 403);
  assert.equal((await as('/api/agent/start', { name: 'main' })).status, 403);
  assert.equal((await as('/api/agent/stop', { name: 'main', now: true })).status, 403);
  assert.equal((await as('/api/recap', { agent: 'main', text: 'x' })).status, 403);
  assert.equal((await as('/api/status', { agent: 'main', text: 'x' })).status, 403);
  assert.equal((await as('/api/agent/prompt?name=main')).status, 403);
});

test('search and archive with the full token', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', toCam);
  await call(app, '/api/send', { ...toCam, text: 'Pick the venue in Boston.' });
  assert.deepEqual((await call(app, '/api/search?q=venue%20boston&limit=5')).data.map((c) => c.id), [2]);
  assert.equal((await call(app, '/api/search?q=')).status, 400);
  assert.deepEqual((await call(app, '/api/archive')).data.map((c) => c.id), [1, 2]);
});

test('the liaison token cannot mark its own memo as trusted', async () => {
  const { app, store } = makeApp();
  await call(app, '/api/send', { ...toCam, from: 'liaison', trusted: true }, LIAISON_TOKEN);
  assert.equal(store.get(1).trusted, 0);
});

// Tailscale Serve puts the login of the tailnet user in a header, and keeps the Host of the request.
const TAILNET = { login: 'cam@example.com', host: 'mac.example.ts.net:8443' };
const viaTailscale = (app, path, headers = {}, body) => app.request(path, {
  method: body ? 'POST' : 'GET',
  headers: { Host: TAILNET.host, 'Tailscale-User-Login': TAILNET.login, ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

test('the short tailnet name goes to the full HTTPS name, with the path and the query', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  for (const host of ['mac', 'mac:80']) {
    const r = await app.request('/inbox?x=1', { headers: { Host: host } });
    assert.equal(r.status, 308);
    assert.equal(r.headers.get('Location'), `https://${TAILNET.host}/inbox?x=1`);
  }
  const api = await app.request('/api/list?to=cam', { headers: { Host: 'mac' } });
  assert.equal(api.status, 308);
  assert.equal(await api.text(), '');
});

test('the full name and other names get no redirect', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await app.request('/health', { headers: { Host: TAILNET.host } })).status, 200);
  assert.equal((await app.request('/health', { headers: { Host: '127.0.0.1:3280' } })).status, 200);
  assert.equal((await app.request('/health', { headers: { Host: 'mac.evil.example' } })).status, 200);
  const plain = makeApp();
  assert.equal((await plain.app.request('/health', { headers: { Host: 'mac' } })).status, 200);
});

test('a request of the owner through Tailscale needs no token', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await viaTailscale(app, '/api/list?to=cam')).status, 200);
  const sent = await viaTailscale(app, '/api/send', { Origin: `https://${TAILNET.host}`, 'Sec-Fetch-Site': 'same-origin' }, { from: 'cam', to: 'main', text: 'hello' });
  assert.equal(sent.status, 200);
});

test('the Tailscale header does nothing when the server has no Tailscale configuration', async () => {
  const { app } = makeApp();
  assert.equal((await viaTailscale(app, '/api/list?to=cam')).status, 401);
});

test('a different tailnet user gets no access', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { 'Tailscale-User-Login': 'other@example.com' })).status, 401);
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { 'Tailscale-User-Login': '' })).status, 401);
});

test('the Tailscale header counts only with the Tailscale host name', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { Host: '127.0.0.1:3280' })).status, 401);
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { Host: 'evil.example:3280' })).status, 401);
});

test('a request from a different site gets no access through Tailscale', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  const memo = { from: 'cam', to: 'main', text: 'from a different site' };
  assert.equal((await viaTailscale(app, '/api/send', { Origin: 'https://evil.example' }, memo)).status, 401);
  assert.equal((await viaTailscale(app, '/api/send', { 'Sec-Fetch-Site': 'cross-site' }, memo)).status, 401);
  assert.equal((await viaTailscale(app, '/api/send', { Origin: `https://${TAILNET.host}`, 'Sec-Fetch-Site': 'same-site' }, memo)).status, 401);
});

test('a wrong token gets no access through Tailscale', async () => {
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { Authorization: `Bearer ${LIAISON_TOKEN}` })).status, 403);
});

test('a page with no saved token gets access through Tailscale', async () => {
  // The page sends "Bearer " with an empty token, and the browser removes the space at the end.
  const { app } = makeApp({ tailscale: TAILNET });
  assert.equal((await viaTailscale(app, '/api/list?to=cam', { Authorization: 'Bearer' })).status, 200);
});

test('a request for news makes a remote agent online', async () => {
  const { app } = makeApp({ config: [{ name: 'main', kind: 'long', dir: '~/p', model: 'm' }, { name: 'mac', kind: 'remote' }] });
  const mac = async () => (await call(app, '/api/agents')).data.find((a) => a.name === 'mac');
  assert.equal((await mac()).online, false);
  assert.equal((await call(app, '/api/news?for=mac')).status, 200);
  assert.equal((await mac()).online, true);
  assert.equal((await call(app, '/api/agent/start', { name: 'mac' })).status, 400);
});

test('the note route keeps the memo open, and the liaison token cannot use it', async () => {
  const { app } = makeApp();
  const id = (await call(app, '/api/send', { from: 'main', to: 'cam', text: 'Approve?', impact: 3, effort: 'short' })).data.memo.id;
  assert.equal((await call(app, '/api/note', { id, from: 'cam', text: 'Add the price.' }, LIAISON_TOKEN)).status, 403);
  const r = await call(app, '/api/note', { id, from: 'cam', text: 'Add the price.' });
  assert.equal(r.data.state, 'open');
  assert.equal((await call(app, '/api/news?for=main')).data.noted[0].notes[0].text, 'Add the price.');
  assert.equal((await call(app, '/api/queue')).data.memos[0].notes.length, 1);
  assert.equal((await call(app, '/api/ack', { id })).data.notes[0].read, 1);
});

test('the brief route sets the brief, and the liaison token cannot use it', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', { ...toCam, title: 'Deploy' });
  const r = await call(app, '/api/brief', { id: 1, next: 'Reply deploy' });
  assert.equal(r.status, 200);
  assert.equal(r.data.title, 'Deploy');
  assert.equal(r.data.next, 'Reply deploy');
  const queue = await call(app, '/api/queue');
  assert.equal(queue.data.memos[0].next, 'Reply deploy');
  assert.equal((await call(app, '/api/brief', { id: 1, title: 'X' }, LIAISON_TOKEN)).status, 403);
});

test('the compact route closes the memo and sends the new one, and the liaison token cannot use it', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', { ...toCam, tags: ['work'], title: 'Deploy' });
  assert.equal((await call(app, '/api/compact', { id: 1, from: 'main', text: 'Short.' }, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/compact', { id: 1, from: 'liaison', text: 'Short.' })).status, 403);
  const r = await call(app, '/api/compact', { id: 1, from: 'main', text: 'Short.', next: 'Reply yes' });
  assert.equal(r.status, 200);
  assert.equal(r.data.memo.id, 2);
  assert.equal(r.data.memo.title, 'Deploy');
  assert.equal(r.data.memo.next, 'Reply yes');
  assert.deepEqual(r.data.memo.tags, ['work']);
  assert.equal(r.data.old.reply, 'Compacted into memo #2.');
  assert.deepEqual((await call(app, '/api/queue')).data.memos.map((m) => m.id), [2]);
  assert.equal((await call(app, '/api/compact', { id: 1, from: 'main', text: 'Again.' })).status, 409);
});

test('the file routes: upload with the name in the query, a download with safe headers, and a refusal', async () => {
  const { app } = makeApp();
  const up = (body, name) => app.request(`/api/file?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body });
  const { name } = await (await up('# Notes\n', 'notes.md')).json();
  const r = await app.request(`/api/file/${name}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="notes.md"; filename*=UTF-8''notes.md`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await up('\0<html>', 'page.html')).status, 400); // html must be text
  assert.equal((await up('<svg/>', 'a.svg')).status, 400);
  assert.equal((await up('MZ\0\0', 'a.exe')).status, 400);
  assert.equal((await app.request('/api/file/x.md', { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 404);
});

test('answered: the memos to cam that cam answered in the last 7 days, the last answered first, read only', async () => {
  const { app, db } = makeApp();
  for (let i = 0; i < 5; i += 1) await call(app, '/api/send', { ...toCam, text: `Memo ${i + 1}` });
  await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Not to cam.' }); // memo 6
  await call(app, '/api/reply', { id: 1, text: 'Yes.' });
  await call(app, '/api/close', { id: 2 });
  await call(app, '/api/reply', { id: 3, text: 'Old.' });
  await call(app, '/api/close', { id: 6 });
  // Memo 1 was answered now, memo 2 6 days ago, memo 3 8 days ago. Memo 4 is open, memo 6 is not to cam.
  const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE memos SET closed = ? WHERE id = ?').run(ago(6), 2);
  db.prepare('UPDATE memos SET closed = ? WHERE id = ?').run(ago(8), 3);
  const list = (await call(app, '/api/answered')).data;
  assert.deepEqual(list.map((m) => m.id), [1, 2]);
  assert.equal(list[0].reply, 'Yes.');
  assert.equal(list[1].state, 'closed');
  // The same auth as the other routes of the owner: no token, a wrong token, and the liaison token get nothing.
  assert.equal((await call(app, '/api/answered', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/answered', undefined, 'wrong')).status, 401);
  assert.equal((await call(app, '/api/answered', undefined, LIAISON_TOKEN)).status, 403);
});

test('schedule: GET /api/schedule gives local/schedule.json, read on each request, with the owner auth', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'memo-schedule-'));
  const schedulePath = join(dir, 'schedule.json');
  const { app } = makeApp({ schedulePath });
  // The same auth as /api/answered.
  assert.equal((await call(app, '/api/schedule', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/schedule', undefined, 'wrong')).status, 401);
  assert.equal((await call(app, '/api/schedule', undefined, LIAISON_TOKEN)).status, 403);
  // No file: an empty list.
  assert.deepEqual(await call(app, '/api/schedule'), { status: 200, data: { items: [] } });
  // A valid file, and a change shows on the next request with no restart.
  const data = { note: 'Kept by main.', updated: '2026-10-21', items: [{ name: 'Nightly restart', when: 'Every day, 3:00 AM', where: 'launchd', what: 'Restarts main.', until: '' }] };
  writeFileSync(schedulePath, JSON.stringify(data));
  assert.deepEqual(await call(app, '/api/schedule'), { status: 200, data });
  data.items.push({ name: 'Watch', when: 'Nightly', where: 'sync', what: 'Checks a DM.', until: '2026-10-28' });
  writeFileSync(schedulePath, JSON.stringify(data));
  assert.equal((await call(app, '/api/schedule')).data.items.length, 2);
  // Invalid JSON: 500 with a clear message.
  writeFileSync(schedulePath, '{"items": [');
  const bad = await call(app, '/api/schedule');
  assert.equal(bad.status, 500);
  assert.match(bad.data.error, /schedule\.json is not valid JSON/);
  // JSON with no items list is also an error.
  writeFileSync(schedulePath, '[1, 2]');
  assert.equal((await call(app, '/api/schedule')).status, 500);
  // The route gives no other file.
  assert.equal((await call(app, '/api/schedule/../agents.json')).status, 404);
});

test('calendar: GET /api/calendar gives the events of one day, with the owner auth', async () => {
  const ics = ['BEGIN:VCALENDAR', 'X-WR-CALNAME:cam@example.com', 'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=America/New_York:20261021T130000', 'DTEND;TZID=America/New_York:20261021T133000',
    'SUMMARY:Sam and Andrea', 'LOCATION:Cafe', 'ATTENDEE:mailto:sam@example.com', 'ATTENDEE:mailto:cam@example.com', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261022', 'SUMMARY:Holiday', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  let fetches = 0;
  let clock = new Date('2026-10-21T12:00:00Z');
  const secret = 'https://calendar.example/ical/secret-part/basic.ics';
  const { app } = makeApp({ calendarUrl: secret, now: () => clock, getCalendar: async (url) => { assert.equal(url, secret); fetches++; return ics; } });
  const r = await call(app, '/api/calendar?date=2026-10-21&tz=America/New_York');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { configured: true, date: '2026-10-21', timeZone: 'America/New_York', events: [
    { title: 'Holiday', location: '', hasOthers: false, attendees: [], organizer: null, link: '', start: '2026-10-21', end: '2026-10-22', allDay: true },
    // The other people, for the detail of the event; the owner (cam) is not in the list.
    { title: 'Sam and Andrea', location: 'Cafe', hasOthers: true, attendees: [{ name: '', email: 'sam@example.com', status: '' }], organizer: null, link: '',
      start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T17:30:00.000Z', allDay: false },
  ] });
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-22&tz=America/New_York')).data.events, []);
  assert.equal(fetches, 1, 'the server keeps the calendar 5 minutes');
  clock = new Date('2026-10-21T12:06:00Z');
  await call(app, '/api/calendar?date=2026-10-21&tz=America/New_York');
  assert.equal(fetches, 2);
  assert.equal((await call(app, '/api/calendar?date=21-10-2026')).status, 400);
  assert.equal((await call(app, '/api/calendar?date=2026-10-21&tz=Nowhere/City')).status, 400);
  assert.equal((await call(app, '/api/calendar?date=2026-10-21', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/calendar?date=2026-10-21', undefined, LIAISON_TOKEN)).status, 403);
});

test('calendar: no MEMO_CALENDAR_ICS gives configured false, and a failed fetch gives 502 with no address', async () => {
  assert.deepEqual((await call(makeApp().app, '/api/calendar?date=2026-10-21')).data, { configured: false });
  const secret = 'https://calendar.example/ical/secret-part/basic.ics';
  const { app } = makeApp({ calendarUrl: secret, getCalendar: async () => { throw new Error(`fetch failed for ${secret}`); } });
  const r = await call(app, '/api/calendar?date=2026-10-21&tz=UTC');
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'The calendar did not load. Google Calendar did not answer.');
  const html = makeApp({ calendarUrl: secret, getCalendar: async () => '<html>Sign in</html>' });
  const bad = await call(html.app, '/api/calendar?date=2026-10-21&tz=UTC');
  assert.equal(bad.status, 502);
  assert.ok(!JSON.stringify(bad.data).includes('secret-part'));
});

test('client-tz: the Inbox sends the time zone of the browser, and the server keeps it in the data directory', async () => {
  const { app, dataDir } = makeApp({ now: () => new Date('2026-10-22T13:14:00Z') });
  assert.deepEqual((await call(app, '/api/client-tz')).data, { timeZone: null, seen: null });
  const r = await call(app, '/api/client-tz', { timeZone: 'America/New_York' });
  assert.deepEqual(r.data, { timeZone: 'America/New_York', seen: '2026-10-22T13:14:00.000Z' });
  assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'client-tz.json'), 'utf8')), r.data);
  assert.deepEqual((await call(app, '/api/client-tz')).data, r.data);
  assert.equal((await call(app, '/api/client-tz', { timeZone: 'Mars/Base' })).status, 400);
  assert.equal((await call(app, '/api/client-tz', { timeZone: 'UTC' }, null)).status, 401);
  assert.equal((await call(app, '/api/client-tz', { timeZone: 'UTC' }, LIAISON_TOKEN)).status, 403);
  // The calendar uses the zone of the browser when the request gives none.
  const ics = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR';
  const withCal = makeApp({ calendarUrl: 'https://calendar.example/x.ics', getCalendar: async () => ics });
  await call(withCal.app, '/api/client-tz', { timeZone: 'Asia/Tokyo' });
  assert.equal((await call(withCal.app, '/api/calendar?date=2026-10-21')).data.timeZone, 'Asia/Tokyo');
});

test('calendar: several addresses in MEMO_CALENDAR_ICS give one list, and an event on two calendars shows once', async () => {
  const cal = (name, events) => ['BEGIN:VCALENDAR', `X-WR-CALNAME:${name}`, ...events.flatMap(([uid, title, start]) => [
    'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${start}`, 'DURATION:PT1H', 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
  const work = cal('work@example.com', [['a', 'Board call', '20261021T150000Z'], ['b', 'Shared lunch', '20261021T170000Z']]);
  const home = cal('me@example.com', [['c', 'Dentist', '20261021T130000Z'], ['d', 'Shared lunch', '20261021T170000Z']]);
  const urls = { 'https://cal.example/work.ics': work, 'https://cal.example/home.ics': home };
  const { app } = makeApp({ calendarUrl: 'https://cal.example/work.ics, https://cal.example/home.ics', getCalendar: async (url) => urls[url] });
  const r = await call(app, '/api/calendar?date=2026-10-21&tz=America/New_York');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.events.map((e) => e.title), ['Dentist', 'Board call', 'Shared lunch']);
});

test('calendar: a failing second calendar is named by its place, never by its address', async () => {
  const { app } = makeApp({ calendarUrl: 'https://cal.example/a.ics https://cal.example/secret-b.ics',
    getCalendar: async (url) => { if (url.includes('secret-b')) throw new Error(`fetch failed for ${url}`); return 'BEGIN:VCALENDAR\r\nEND:VCALENDAR'; } });
  const r = await call(app, '/api/calendar?date=2026-10-21&tz=America/New_York');
  assert.equal(r.status, 502);
  assert.match(r.data.error, /^Calendar 2 did not load\./);
  assert.ok(!r.data.error.includes('secret-b'));
});

test('calendar: the owner comes from the id in the secret address, so a declined event hides even when the calendar has a display name', async () => {
  const feed = (name) => ['BEGIN:VCALENDAR', `X-WR-CALNAME:${name}`, 'X-WR-TIMEZONE:America/New_York',
    'BEGIN:VEVENT', 'UID:a', 'DTSTART:20261021T170000Z', 'DURATION:PT1H', 'SUMMARY:Team Lunch',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.com', 'ATTENDEE;PARTSTAT=DECLINED:mailto:cam@example.com', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b', 'DTSTART:20261021T150000Z', 'DURATION:PT1H', 'SUMMARY:Board call',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:cam@example.com', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const primary = 'https://calendar.google.com/calendar/ical/cam%40example.com/private-abc/basic.ics';
  const { app } = makeApp({ calendarUrl: primary, getCalendar: async () => feed('Work') });
  const r = await call(app, '/api/calendar?date=2026-10-21&tz=America/New_York');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.events.map((e) => e.title), ['Board call']);
  assert.ok(!JSON.stringify(r.data).includes('cam'), 'no part of the address in the answer');
  // A webcal address works the same.
  const webcal = makeApp({ calendarUrl: 'webcal://calendar.google.com/calendar/ical/cam%40example.com/private-abc/basic.ics', getCalendar: async () => feed('Work') });
  assert.deepEqual((await call(webcal.app, '/api/calendar?date=2026-10-21&tz=America/New_York')).data.events.map((e) => e.title), ['Board call']);
  // A group calendar has no owner: its id does not count as self, so the name rule decides (here it cannot tell).
  const group = 'https://calendar.google.com/calendar/ical/abc123%40group.calendar.google.com/private-abc/basic.ics';
  const g = makeApp({ calendarUrl: group, getCalendar: async () => feed('Work') });
  assert.deepEqual((await call(g.app, '/api/calendar?date=2026-10-21&tz=America/New_York')).data.events.map((e) => e.title), ['Board call', 'Team Lunch']);
  // An address that is not Google's gives no owner; the name of the calendar still counts when it is an address.
  const other = makeApp({ calendarUrl: 'https://cal.example/x.ics', getCalendar: async () => feed('cam@example.com') });
  assert.deepEqual((await call(other.app, '/api/calendar?date=2026-10-21&tz=America/New_York')).data.events.map((e) => e.title), ['Board call']);
});

const CALENDAR_HELP ='That is not a Google Calendar secret address. In Google Calendar on the web: Settings, click your calendar, Integrate calendar, then copy Secret address in iCal format.';
const oneEvent = (title, start) => ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1', `SUMMARY:${title}`, `DTSTART:${start}`, 'DURATION:PT1H', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

test('calendars: the Inbox page adds a calendar from its secret address, and no answer has the address', async () => {
  const secret = 'https://calendar.google.com/calendar/ical/cam%40example.com/private-0123abcd/basic.ics';
  const asked = [];
  const { app, dataDir } = makeApp({ getCalendar: async (url) => { asked.push(url); return oneEvent('Dentist', '20261021T130000Z'); } });
  assert.deepEqual((await call(app, '/api/calendars')).data, { count: 0, items: [] });
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-21&tz=UTC')).data, { configured: false });
  // Add, with white space around the address as a paste can have it. The answer has the count and the place of each
  // calendar: no part of the address.
  const added = await call(app, '/api/calendars/add', { url: ` ${secret}\n` });
  assert.equal(added.status, 200);
  assert.deepEqual(added.data, { count: 1, items: [{ index: 0, source: 'page' }] });
  const got = await call(app, '/api/calendars');
  assert.deepEqual(got.data, added.data);
  for (const part of ['calendar.google.com', 'cam%40example.com', 'private-0123abcd', 'basic.ics']) assert.ok(!JSON.stringify(got.data).includes(part), part);
  // The file is next to client-tz.json, with mode 600.
  const path = join(dataDir, 'calendars.json');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { urls: [secret] });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  // The Today card uses the new address at once, with no restart.
  const day = await call(app, '/api/calendar?date=2026-10-21&tz=UTC');
  assert.equal(day.status, 200);
  assert.deepEqual(day.data.events.map((e) => e.title), ['Dentist']);
  assert.deepEqual(asked, [secret]);
  // The same address a second time.
  const twice = await call(app, '/api/calendars/add', { url: secret });
  assert.equal(twice.status, 409);
  assert.equal(twice.data.error, 'That calendar is already in Memo.');
  // Not a secret address of Google Calendar: the help text, with no address in it.
  for (const bad of ['', 'not an address', 42, 'https://example.com/calendar/ical/x/basic.ics', 'https://calendar.google.com/calendar/embed?src=x',
    'https://calendar.google.com/calendar/ical/x/basic', 'https://calendar.google.com/calendar/ical/x/basic.ics more',
    'https://calendar.google.com/calendar/ical/a.ics,https://calendar.google.com/calendar/ical/b.ics']) {
    const r = await call(app, '/api/calendars/add', { url: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.data.error, CALENDAR_HELP);
  }
  assert.equal((await call(app, '/api/calendars')).data.count, 1);
  // Remove: the file and the Today card follow.
  const removed = await call(app, '/api/calendars/remove', { index: 0 });
  assert.deepEqual(removed.data, { count: 0, items: [] });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { urls: [] });
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-21&tz=UTC')).data, { configured: false });
  assert.equal((await call(app, '/api/calendars/remove', { index: 0 })).status, 400);
  assert.equal((await call(app, '/api/calendars/remove', { index: 'x' })).status, 400);
  // The same auth as the other routes of the owner.
  assert.equal((await call(app, '/api/calendars', undefined, null)).status, 401);
  assert.equal((await call(app, '/api/calendars', undefined, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/calendars/add', { url: secret }, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(app, '/api/calendars/remove', { index: 0 }, LIAISON_TOKEN)).status, 403);
});

test('calendars: an address of MEMO_CALENDAR_ICS comes first and stays; an address from the page adds to it', async () => {
  const env = 'https://calendar.google.com/calendar/ical/work%40example.com/private-env/basic.ics';
  const page = 'webcal://calendar.google.com/calendar/ical/me%40example.com/private-page/basic.ics';
  const texts = { [env]: oneEvent('Board call', '20261021T150000Z'), [page]: oneEvent('Dentist', '20261021T130000Z') };
  const { app } = makeApp({ calendarUrl: env, getCalendar: async (url) => texts[url] });
  assert.deepEqual((await call(app, '/api/calendars')).data, { count: 1, items: [{ index: 0, source: 'env' }] });
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-21&tz=UTC')).data.events.map((e) => e.title), ['Board call']);
  // The server kept the first calendar 5 minutes; the new address still shows at once.
  assert.deepEqual((await call(app, '/api/calendars/add', { url: page })).data, { count: 2, items: [{ index: 0, source: 'env' }, { index: 1, source: 'page' }] });
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-21&tz=UTC')).data.events.map((e) => e.title), ['Dentist', 'Board call']);
  assert.equal((await call(app, '/api/calendars/add', { url: env })).status, 409);
  // Only a calendar from the page can go: the one of .env is not the page's to remove, and the refusal has no address.
  const kept = await call(app, '/api/calendars/remove', { index: 0 });
  assert.equal(kept.status, 400);
  assert.ok(!kept.data.error.includes('private-env'));
  assert.equal((await call(app, '/api/calendars/remove', { index: 1 })).data.count, 1);
  assert.deepEqual((await call(app, '/api/calendar?date=2026-10-21&tz=UTC')).data.events.map((e) => e.title), ['Board call']);
});

test('a draft of the reply field: saved with /api/draft, in /api/queue, the newer one wins, gone with the reply', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', toCam);
  const saved = await call(app, '/api/draft', { id: 1, text: 'Yes, if', updated: '2026-10-23T09:00:10.000Z' });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data, { id: 1, text: 'Yes, if', updated: '2026-10-23T09:00:10.000Z' });
  assert.deepEqual((await call(app, '/api/queue')).data.drafts, { 1: { text: 'Yes, if', updated: '2026-10-23T09:00:10.000Z' } });
  // An older copy, from a device that was offline, does not replace the text; the answer is the draft that is stored.
  assert.equal((await call(app, '/api/draft', { id: 1, text: 'Y', updated: '2026-10-23T09:00:05.000Z' })).data.text, 'Yes, if');
  assert.equal((await call(app, '/api/draft', { id: 1, text: 'x', updated: 'no' })).status, 400);
  assert.equal((await call(app, '/api/draft', { id: 1, text: 'x', updated: '2026-10-23T09:00:20.000Z' }, LIAISON_TOKEN)).status, 403);
  await call(app, '/api/reply', { id: 1, text: 'Yes, if' });
  assert.deepEqual((await call(app, '/api/queue')).data.drafts, {});
  assert.equal((await call(app, '/api/draft', { id: 1, text: 'x', updated: '2026-10-23T09:00:30.000Z' })).status, 409);
});

test('the thread of a memo: GET /api/thread, the threads of the open memos, and re on send', async () => {
  const { app } = makeApp();
  await call(app, '/api/send', toCam);
  await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Book it, this answers memo 1' });
  const sent = await call(app, '/api/send', { ...toCam, text: 'Booked', re: [2] });
  assert.equal(sent.status, 200);
  assert.deepEqual(sent.data.memo.re, [2]);
  assert.equal((await call(app, '/api/send', { ...toCam, text: 'Booked', re: [99] })).status, 400);
  const t = await call(app, '/api/thread?id=3');
  assert.equal(t.status, 200);
  assert.deepEqual(t.data.memos.map((m) => m.id), [1, 2, 3]);
  assert.equal((await call(app, '/api/thread?id=99')).status, 404);
  assert.equal((await call(app, '/api/thread?id=3', null, null)).status, 401);
  const all = await call(app, '/api/threads');
  assert.deepEqual(Object.keys(all.data), ['1', '3']);
  assert.deepEqual((await call(app, '/api/queue')).data.memos.map((m) => m.re), [[], [2]]);
});

test('a saved draft runs onDraft, so the ledger publishes it to the phone at once', async () => {
  const drafted = [];
  const { app } = makeApp({ onDraft: (d) => drafted.push(d) });
  await call(app, '/api/send', toCam);
  await call(app, '/api/draft', { id: 1, text: 'Yes', updated: '2026-10-23T09:00:10.000Z' });
  assert.deepEqual(drafted, [{ id: 1, text: 'Yes', updated: '2026-10-23T09:00:10.000Z' }]);
  assert.equal((await call(app, '/api/draft', { id: 1, text: 'x', updated: 'no' })).status, 400);
  assert.equal(drafted.length, 1, 'a refused draft does not run it');
});

test('the agent list says what each agent does: stopped, idle in memo wait, working when news came', async () => {
  let clock = new Date('2026-10-23T09:00:00Z');
  const { app } = makeApp({ now: () => clock });
  const activity = async () => (await call(app, '/api/agents')).data.map((a) => a.activity);
  assert.deepEqual(await activity(), ['stopped', null]);
  await call(app, '/api/agent/start', { name: 'main' });
  // No memo wait request yet, and the tests have no screen to look at: the session counts as working.
  assert.deepEqual(await activity(), ['working', null]);
  await call(app, '/api/news?for=main'); // memo wait, with no news: the agent waits
  assert.equal((await activity())[0], 'idle');
  clock = new Date(clock.getTime() + 59000);
  assert.equal((await activity())[0], 'idle');
  clock = new Date(clock.getTime() + 2000);
  assert.equal((await activity())[0], 'working'); // no request in a minute: the agent left memo wait
  await call(app, '/api/news?for=main');
  assert.equal((await activity())[0], 'idle');
  // A memo arrives: the next memo wait request brings news, so memo wait ends and the agent goes to work at once.
  await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Work.' });
  await call(app, '/api/news?for=main');
  assert.equal((await activity())[0], 'working');
  // A status line or a helper is a sign of work, not of a wait.
  await call(app, '/api/status', { agent: 'main', text: 'I work.' });
  await call(app, '/api/helper/start', { agent: 'main', label: 'Sync', model: 'm' });
  assert.equal((await activity())[0], 'working');
  await call(app, '/api/agent/stop', { name: 'main' });
  assert.equal((await activity())[0], 'stopping');
  await call(app, '/api/agent/stop', { name: 'main', now: true });
  assert.equal((await activity())[0], 'stopped');
  // The lists of open memos come with the counts.
  const main = (await call(app, '/api/agents')).data[0];
  assert.deepEqual(main.memos_to.map(({ created, delivered, ...m }) => m), [{ id: 1, code: null, title: null, line: 'Work.' }]);
  assert.match(main.memos_to[0].created, /^\d{4}-/);
  // delivered: the agent got the memo through its memo wait request (memo 1407).
  assert.match(main.memos_to[0].delivered, /^\d{4}-/);
  assert.deepEqual(main.memos_from, []);
});

test('the API takes a workstream code with send, and a code in the place of an id', async () => {
  const { app } = makeApp();
  const sent = await call(app, '/api/send', { from: 'main', to: 'cam', text: 'Sign the form?', impact: 3, effort: 'micro', ws: 'ops', title: 'Insurance' });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.memo.code, 'OPS-1');
  assert.equal(sent.data.memo.ws, 'OPS');
  assert.equal(sent.data.memo.ws_n, 1);
  const bad = await call(app, '/api/send', { from: 'main', to: 'cam', text: 'x', impact: 3, effort: 'micro', ws: 'NOPE' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /ws must be one of: REL, SPEC, FUND, OPS, PROG, COMM, SYS, ME/);
  assert.equal((await call(app, '/api/brief', { id: 'OPS-1', next: 'Sign it' })).data.next, 'Sign it');
  assert.equal((await call(app, '/api/thread?id=OPS-1')).data.id, 1);
  const reply = await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Signed.', re: 'OPS-1' });
  assert.equal(reply.data.memo.code, 'OPS-2');
  assert.deepEqual(reply.data.memo.re, [1]);
  assert.deepEqual((await call(app, '/api/search?q=OPS-1')).data.map((m) => m.id), [1]);
  assert.equal((await call(app, '/api/close', { id: 'ops-1', text: 'Done.' })).data.state, 'closed');
  assert.equal((await call(app, '/api/ack', { id: 'OPS-1' })).data.acked, 1);
  const gone = await call(app, '/api/close', { id: 'OPS-9' });
  assert.equal(gone.status, 404);
  assert.match(gone.data.error, /No memo has the code OPS-9/);
  assert.equal((await call(app, '/api/queue')).data.memos.length, 0);
  assert.deepEqual((await call(app, '/api/archive')).data.map((m) => m.code), ['OPS-1', 'OPS-2']);
});

test('the queue gives fired: the time of her latest action tied to each memo, through her notes, sends, replies and the links (memo 1236)', async () => {
  const { app, store } = makeApp();
  // 1: a memo to her with no action of hers. No entry.
  await call(app, '/api/send', toCam);
  // 2: she fires off a task to main. 3: main answers it with re: fired is the time of her send.
  await call(app, '/api/send', { from: 'cam', to: 'main', text: 'Update the README.' });
  await call(app, '/api/send', { ...toCam, text: 'Done: the README is new.', re: [2] });
  // 4: a memo to her; she replies. 5: main follows up and names it in its text: fired is her reply time.
  await call(app, '/api/send', { ...toCam, text: 'Which venue?' });
  await call(app, '/api/reply', { id: 4, text: 'The hall.' });
  await call(app, '/api/send', { ...toCam, text: 'The hall is booked, see memo 4.' });
  // 6: a memo to her; her note on it: fired is the note time.
  await call(app, '/api/send', { ...toCam, text: 'Approve the quote?' });
  await call(app, '/api/note', { id: 6, from: 'cam', text: 'Add the price.' });
  // 7: a memo to her that main compacts into 8: a compact is not her action, so 8 has no entry.
  await call(app, '/api/send', { ...toCam, text: 'A long memo.' });
  await call(app, '/api/compact', { id: 7, from: 'main', text: 'Short.' });
  const queue = (await call(app, '/api/queue')).data;
  assert.deepEqual(queue.memos.map((m) => m.id).sort(), [1, 3, 5, 6, 8]);
  assert.deepEqual(queue.fired, { 3: store.get(2).created, 5: store.get(4).closed, 6: store.get(6).notes[0].created });
  for (const v of Object.values(queue.fired)) assert.match(v, /^\d{4}-\d{2}-\d{2}T/);
  // A note of main on memo 6 changes nothing; a second note of hers moves the time to that note.
  await call(app, '/api/note', { id: 6, from: 'main', text: '$14.' });
  assert.equal((await call(app, '/api/queue')).data.fired[6], store.get(6).notes[0].created);
  await call(app, '/api/note', { id: 6, from: 'cam', text: 'Fine.' });
  assert.equal((await call(app, '/api/queue')).data.fired[6], store.get(6).notes[2].created);
  // The liaison token gets no queue, as before.
  assert.equal((await call(app, '/api/queue', undefined, LIAISON_TOKEN)).status, 403);
});
