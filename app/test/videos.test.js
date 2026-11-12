import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { serve } from '@hono/node-server';
import { createVideos, kind } from '../src/videos.js';
import { createFrames } from '../src/frames.js';
import { VIDEO_MAX_BYTES, VIDEO_HOURS, withVideo, videoLinks, withImage, expiryWords, clock, ACCEPT } from '../ui/attach.js';
import { inline } from '../ui/markdown.js';
import { makeApp, call, TOKEN, LIAISON_TOKEN, ROOT } from './helpers.js';

const run = promisify(execFile);
const HOUR = 3600000;
const T0 = new Date('2026-11-09T15:00:00Z');
// A file of the MP4 family starts with a box size, then "ftyp" and the brand.
const ftyp = (brand, more = 'isommp42') => Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from(`ftyp${brand}`), Buffer.from([0, 0, 0, 1]), Buffer.from(more), Buffer.alloc(80, 7)]);
const MOV = ftyp('qt  ', 'qt  ');
const MP4 = ftyp('isom');
const M4V = ftyp('M4V ');
// A WebM file is an EBML document whose DocType is "webm".
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x84]), Buffer.from('webm'), Buffer.alloc(80, 3)]);
const MKV = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82, 0x88]), Buffer.from('matroska'), Buffer.alloc(80, 3)]);
const HEIC = ftyp('heic', 'mif1heic');
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
const REAL_MOV = readFileSync(join(ROOT, 'test', 'fixtures', 'clip.mov'));
const REAL_MP4 = readFileSync(join(ROOT, 'test', 'fixtures', 'clip.mp4'));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake frame')]);

const post = (app, body, name, token = TOKEN) => app.request(`/api/video?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
const get = (app, name, token = TOKEN, headers = {}) => app.request(`/api/video/${name}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
const meta = (app, name) => app.request(`/api/video/${name}/meta`, { headers: { Authorization: `Bearer ${TOKEN}` } });
// A clock the test moves.
function clockApp(options = {}) {
  let at = T0;
  const made = makeApp({ now: () => at, ...options });
  return { ...made, tick: (ms) => { at = new Date(at.getTime() + ms); } };
}

test('the type comes from the first bytes: mov, mp4, m4v and webm go in; an image, a program and other EBML do not', async () => {
  const { app } = clockApp();
  const cases = [[MOV, 'IMG_0001.MOV', 'mov', 'video/quicktime'], [MP4, 'clip.mp4', 'mp4', 'video/mp4'], [M4V, 'show.m4v', 'm4v', 'video/x-m4v'],
    [WEBM, 'screen.webm', 'webm', 'video/webm'], [REAL_MOV, 'real.mov', 'mov', 'video/quicktime'], [REAL_MP4, 'real.mp4', 'mp4', 'video/mp4'],
    [ftyp('mp42'), 'phone.mov', 'mov', 'video/quicktime'], [ftyp('iso2'), 'no-extension', 'mp4', 'video/mp4']];
  for (const [bytes, original, ext, type] of cases) {
    const r = await post(app, bytes, original);
    assert.equal(r.status, 200, original);
    const data = await r.json();
    assert.match(data.name, new RegExp(`^[0-9a-f]{16}\\.${ext}$`), original);
    assert.equal(data.original, ext === 'mp4' && original === 'no-extension' ? 'no-extension.mp4' : original);
    assert.equal(data.expires, new Date(T0.getTime() + VIDEO_HOURS * HOUR).toISOString());
    assert.deepEqual(data.frames, []);
    const file = await get(app, data.name);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), type);
    assert.equal(file.headers.get('accept-ranges'), 'bytes');
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('content-disposition'), /^attachment; filename="/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  }
  for (const [bytes, original] of [[HEIC, 'photo.heic'], [HEIC, 'photo.mov'], [EXE, 'setup.mov'], [MKV, 'film.webm'], [Buffer.from('%PDF-1.7 fake'), 'doc.mp4'],
    [Buffer.from('just text'), 'note.mov'], [MOV.subarray(0, 8), 'short.mov']]) {
    const r = await post(app, bytes, original);
    assert.equal(r.status, 400, original);
    assert.match((await r.json()).error, /must be a video/);
  }
  assert.equal((await post(app, Buffer.alloc(0), 'empty.mov')).status, 400);
  assert.equal(kind(ftyp('avc1'), 'm4v'), 'm4v', 'a known brand keeps a video extension');
  assert.equal(kind(ftyp('avc1'), 'heic'), 'mp4', 'and gives mp4 for any other');
  assert.equal(kind(ftyp('qt  '), 'mp4'), 'mov', 'QuickTime is always mov');
});

test('the limit: 500 MB, refused by the Content-Length before a byte and by the count of bytes as they arrive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-videos-'));
  const real = createVideos({ dir, log: () => {} });
  await assert.rejects(real.save(MOV, 'a.mov', { length: VIDEO_MAX_BYTES + 1 }), /500 MB/);
  assert.equal(VIDEO_MAX_BYTES, 500 * 1024 * 1024);
  const small = createVideos({ dir, maxBytes: 1000, log: () => {} });
  // A stream that would go on past the limit: the save stops at the limit, and nothing stays on the disk.
  let sent = 0;
  const endless = Readable.from((function* () { yield MOV; for (;;) { sent += 100; yield Buffer.alloc(100, 1); } })());
  await assert.rejects(small.save(endless, 'big.mov'), (e) => e.status === 413 && /500 MB/.test(e.message));
  assert.ok(sent < 2000, `the stream stopped soon after the limit (${sent} bytes more)`);
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('.upload-')), [], 'no half upload stays');
  // A wrong type stops at its first bytes too, before the rest of a large file is read.
  sent = 0;
  const wrong = Readable.from((function* () { yield EXE; for (;;) { sent += 100; yield Buffer.alloc(100, 1); } })());
  await assert.rejects(real.save(wrong, 'big.mov'), /must be a video/);
  assert.equal(sent, 0);
  assert.equal(readdirSync(dir).length, 0);
});

test('a video goes after 48 hours: the sweep deletes the file, the memo says "deleted", the record goes after a month', async () => {
  const { app, videos, tick } = clockApp();
  const { name } = await (await post(app, MOV, 'walk.mov')).json();
  const path = join(videos.dir, name);
  assert.ok(existsSync(path));
  assert.equal((statSync(path).mode & 0o777), 0o600);
  tick(47 * HOUR);
  assert.deepEqual(videos.sweep(), []);
  assert.ok(existsSync(path), 'still there at 47 hours');
  let m = await (await meta(app, name)).json();
  assert.equal(m.deleted, null);
  assert.equal(expiryWords(m.expires, T0.getTime() + 47 * HOUR), 'deleted in 1 hour');
  tick(HOUR);
  assert.deepEqual(videos.sweep(), [name]);
  assert.equal(existsSync(path), false, 'gone at 48 hours');
  m = await (await meta(app, name)).json();
  assert.equal(m.deleted, new Date(T0.getTime() + 48 * HOUR).toISOString());
  assert.equal(m.original, 'walk.mov');
  const gone = await get(app, name);
  assert.equal(gone.status, 410);
  assert.match((await gone.json()).error, /deleted/);
  assert.deepEqual(videos.sweep(), [], 'a second sweep finds nothing');
  // The same content comes back as a new upload with a new life.
  const again = await (await post(app, MOV, 'walk.mov')).json();
  assert.equal(again.name, name);
  assert.equal(again.expires, new Date(T0.getTime() + 96 * HOUR).toISOString());
  assert.equal((await get(app, name)).status, 200);
  videos.remove(name);
  tick(31 * 24 * HOUR);
  videos.sweep();
  assert.equal((await meta(app, name)).status, 404, 'the record of a deleted video goes after a month');
  assert.deepEqual(readdirSync(videos.dir), []);
});

test('the sweep at the start of the server: a file past its time, a file with no record, and an old half upload go', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-videos-'));
  let at = T0;
  const videos = createVideos({ dir, now: () => at, log: () => {} });
  const old = '0123456789abcdef.mov';
  writeFileSync(join(dir, old), MOV);
  writeFileSync(join(dir, `${old}.json`), JSON.stringify({ name: 'old.mov', created: '2026-11-01T00:00:00Z', expires: '2026-11-03T00:00:00Z' }));
  writeFileSync(join(dir, 'fedcba9876543210.mp4'), MP4); // no record
  writeFileSync(join(dir, '.upload-abc'), 'half');
  // The sweep compares the time of the file on the disk with its clock. The clock here is the test's, so the file
  // gets the same time: with the real time of the disk, the test failed from one day after T0.
  utimesSync(join(dir, '.upload-abc'), T0, T0);
  writeFileSync(join(dir, 'other.txt'), 'not ours');
  assert.deepEqual(videos.sweep().sort(), [old, 'fedcba9876543210.mp4']);
  assert.ok(existsSync(join(dir, '.upload-abc')), 'a half upload of today may still be in progress');
  at = new Date(T0.getTime() + 2 * 24 * HOUR);
  videos.sweep();
  assert.equal(existsSync(join(dir, '.upload-abc')), false);
  assert.ok(existsSync(join(dir, 'other.txt')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, `${old}.json`), 'utf8')).deleted, T0.toISOString());
});

test('a video goes when its memo closes, or is replied to, unless another open memo still links to it; the frames stay', async () => {
  const fakeFrames = { make: async () => [{ bytes: JPEG, seconds: 1.5 }, { bytes: Buffer.concat([JPEG, Buffer.from('2')]), seconds: 4.5 }] };
  const { app, store, images, videos } = clockApp({ frames: fakeFrames });
  const up = await (await post(app, MOV, 'walk.mov')).json();
  assert.equal(up.frames.length, 2);
  assert.deepEqual(up.frames.map((f) => f.seconds), [1.5, 4.5]);
  for (const f of up.frames) assert.deepEqual(images.read(f.image).type, 'image/jpeg');
  const text = up.frames.reduce((t, f, i) => withImage(t, f.image, `Frame ${i + 1} of 2 at ${clock(f.seconds)}, walk.mov`), withVideo('Look at this:', up.name, 'walk.mov'));
  assert.equal(text, `Look at this:\n\n[walk.mov](video:${up.name})\n\n![Frame 1 of 2 at 0:02, walk.mov](image:${up.frames[0].image})\n\n![Frame 2 of 2 at 0:05, walk.mov](image:${up.frames[1].image})\n`);
  const a = (await call(app, '/api/send', { from: 'cam', to: 'main', text })).data.memo;
  const b = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `Same clip: [walk.mov](video:${up.name})` })).data.memo;
  // The first memo closes: the second one still has the video, so it stays.
  assert.equal((await call(app, '/api/close', { id: a.id, text: 'Seen.' })).status, 200);
  assert.equal((await get(app, up.name)).status, 200, 'another open memo links to it');
  // The second memo gets a reply: now nothing open has it.
  assert.equal((await call(app, '/api/reply', { id: b.id, text: 'Thanks.' })).status, 200);
  assert.equal((await get(app, up.name)).status, 410);
  assert.ok((await (await meta(app, up.name)).json()).deleted);
  for (const f of up.frames) assert.deepEqual(images.read(f.image).type, 'image/jpeg', 'the still frames stay');
  // A video in a note goes with the memo too; a video of a memo that stays open is not touched by a different close.
  const second = await (await post(app, MP4, 'run.mp4')).json();
  const third = await (await post(app, WEBM, 'screen.webm')).json();
  const c = (await call(app, '/api/send', { from: 'main', to: 'cam', impact: 2, effort: 'micro', text: 'A question' })).data.memo;
  await call(app, '/api/note', { id: c.id, from: 'cam', text: `Here: [run.mp4](video:${second.name})` });
  const d = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `[screen.webm](video:${third.name})` })).data.memo;
  await call(app, '/api/close', { id: c.id, text: 'Done.' });
  assert.equal((await get(app, second.name)).status, 410, 'the video of the note went with its memo');
  assert.equal((await get(app, third.name)).status, 200, 'the other memo is open');
  // A compact keeps the video when the new text keeps the link, and deletes it when the new text drops it.
  const e = (await call(app, '/api/send', { from: 'main', to: 'cam', impact: 2, effort: 'micro', text: `Long text [screen.webm](video:${third.name})` })).data.memo;
  await call(app, '/api/close', { id: d.id, text: 'ok' });
  assert.equal((await get(app, third.name)).status, 200, 'memo e still has it');
  const kept = await call(app, '/api/compact', { id: e.id, from: 'main', text: `Short [screen.webm](video:${third.name})` });
  assert.equal(kept.status, 200);
  assert.equal((await get(app, third.name)).status, 200);
  await call(app, '/api/compact', { id: kept.data.memo.id, from: 'main', text: 'Shorter, no video' });
  assert.equal((await get(app, third.name)).status, 410);
  assert.equal(store.holdsOpen(`video:${third.name}`), false);
  assert.ok(videos.dir);
});

test('a video attached in a reply or in a note is new: the reply or the note that carries it does not delete it', async () => {
  const { app, videos, tick } = clockApp();
  const first = await (await post(app, MOV, 'walk.mov')).json();
  const answer = await (await post(app, MP4, 'answer.mp4')).json();
  const a = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `Look: [walk.mov](video:${first.name})` })).data.memo;
  // The reply carries a new video: the video of the memo goes, the video of the reply stays.
  assert.equal((await call(app, '/api/reply', { id: a.id, text: `Like this: [answer.mp4](video:${answer.name})` })).status, 200);
  assert.equal((await get(app, first.name)).status, 410, 'the video of the memo went with the reply');
  assert.equal((await get(app, answer.name)).status, 200, 'the video in the reply is new');
  assert.equal((await (await meta(app, answer.name)).json()).deleted, null);
  // Nothing else links to it, so it goes at its 48 hours.
  tick(47 * HOUR);
  assert.deepEqual(videos.sweep(), []);
  assert.equal((await get(app, answer.name)).status, 200, 'still there at 47 hours');
  tick(HOUR);
  assert.deepEqual(videos.sweep(), [answer.name]);
  assert.equal((await get(app, answer.name)).status, 410);
  // A video in a note stays after the note. A close of the memo keeps it while another open memo links to it.
  const noted = await (await post(app, WEBM, 'screen.webm')).json();
  const b = (await call(app, '/api/send', { from: 'main', to: 'cam', impact: 2, effort: 'micro', text: 'A question' })).data.memo;
  assert.equal((await call(app, '/api/note', { id: b.id, from: 'cam', text: `Here: [screen.webm](video:${noted.name})` })).status, 200);
  assert.equal((await get(app, noted.name)).status, 200, 'the note does not delete its video');
  const c = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `Also here: [screen.webm](video:${noted.name})` })).data.memo;
  await call(app, '/api/close', { id: b.id, text: 'Done.' });
  assert.equal((await get(app, noted.name)).status, 200, 'another open memo links to it');
  // The reply to the last memo that has it deletes it: the reply does not carry it.
  assert.equal((await call(app, '/api/reply', { id: c.id, text: 'Thanks.' })).status, 200);
  assert.equal((await get(app, noted.name)).status, 410);
  // A note video with no other memo goes with a later reply to its memo.
  const last = await (await post(app, M4V, 'last.m4v')).json();
  const d = (await call(app, '/api/send', { from: 'main', to: 'cam', impact: 2, effort: 'micro', text: 'One more' })).data.memo;
  await call(app, '/api/note', { id: d.id, from: 'cam', text: `[last.m4v](video:${last.name})` });
  assert.equal((await get(app, last.name)).status, 200);
  assert.equal((await call(app, '/api/reply', { id: d.id, text: 'Seen.' })).status, 200);
  assert.equal((await get(app, last.name)).status, 410, 'a later reply to the memo deletes the video of the note');
});

test('a video attached in a close is new: the close that carries it does not delete it', async () => {
  const { app, videos, tick } = clockApp();
  const first = await (await post(app, MOV, 'walk.mov')).json();
  const answer = await (await post(app, MP4, 'answer.mp4')).json();
  const a = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `Look: [walk.mov](video:${first.name})` })).data.memo;
  // The close carries a new video: the video of the memo goes, the video of the close stays.
  assert.equal((await call(app, '/api/close', { id: a.id, text: `Done, see: [answer.mp4](video:${answer.name})` })).status, 200);
  assert.equal((await get(app, first.name)).status, 410, 'the video of the memo went with the close');
  assert.equal((await get(app, answer.name)).status, 200, 'the video in the close is new');
  assert.equal((await (await meta(app, answer.name)).json()).deleted, null);
  // Nothing else links to it, so it goes at its 48 hours.
  tick(47 * HOUR);
  assert.deepEqual(videos.sweep(), []);
  assert.equal((await get(app, answer.name)).status, 200, 'still there at 47 hours');
  tick(HOUR);
  assert.deepEqual(videos.sweep(), [answer.name]);
  assert.equal((await get(app, answer.name)).status, 410);
  // A close with no text still deletes the video of its memo.
  const again = await (await post(app, WEBM, 'screen.webm')).json();
  const b = (await call(app, '/api/send', { from: 'cam', to: 'main', text: `[screen.webm](video:${again.name})` })).data.memo;
  assert.equal((await call(app, '/api/close', { id: b.id })).status, 200);
  assert.equal((await get(app, again.name)).status, 410);
});

test('a range of a video, the token, and only a stored name', async () => {
  const { app } = clockApp();
  const { name } = await (await post(app, REAL_MP4, 'clip.mp4')).json();
  const part = await get(app, name, TOKEN, { Range: 'bytes=4-7' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 4-7/${REAL_MP4.length}`);
  assert.equal(part.headers.get('content-length'), '4');
  assert.equal(Buffer.from(await part.arrayBuffer()).toString('latin1'), 'ftyp');
  const tail = await get(app, name, TOKEN, { Range: 'bytes=-10' });
  assert.equal(tail.status, 206);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), REAL_MP4.subarray(REAL_MP4.length - 10));
  assert.equal((await get(app, name, TOKEN, { Range: `bytes=${REAL_MP4.length}-` })).status, 416);
  assert.equal((await get(app, name, null)).status, 401);
  assert.equal((await get(app, name, LIAISON_TOKEN)).status, 403);
  assert.equal((await post(app, MOV, 'a.mov', LIAISON_TOKEN)).status, 403);
  assert.equal((await meta(app, '0000000000000000.mov')).status, 404);
  for (const bad of ['0000000000000000.mov', `${name}.json`, '..%2F..%2F.env', 'x.mov', `${name.slice(0, 16)}.heic`, name.toUpperCase()]) {
    assert.equal((await get(app, bad)).status, 404, bad);
  }
});

test('the words of a video: the link line, the links in a text, the time left, and the Inbox span', () => {
  const name = '0123456789abcdef.mov';
  assert.equal(withVideo('', name, 'IMG_0001.MOV'), `[IMG_0001.MOV](video:${name})\n`);
  assert.equal(withVideo('See:\n', name, 'a [clip].mov'), `See:\n\n[a  clip .mov](video:${name})\n`);
  assert.deepEqual(videoLinks(`[a.mov](video:${name}) and [b.mov](video:${name}) [x](video:../../.env) [f](file:0123456789abcdef.pdf)`), [{ name, label: 'a.mov' }]);
  assert.deepEqual(inline(`Watch [walk.mov](video:${name}).`), [
    { t: 'text', text: 'Watch ' }, { t: 'video', text: 'walk.mov', name, kind: 'Video' }, { t: 'text', text: '.' },
  ]);
  for (const text of ['[x](video:0123456789abcdef.exe)', '[x](video:../a.mov)', '[x](video:0123456789abcdef.heic)']) assert.deepEqual(inline(text), [{ t: 'text', text }], text);
  const now = T0.getTime();
  assert.equal(expiryWords(new Date(now + 48 * HOUR).toISOString(), now), 'deleted in 2 days');
  assert.equal(expiryWords(new Date(now + 35 * HOUR).toISOString(), now), 'deleted in 35 hours');
  assert.equal(expiryWords(new Date(now + 36 * HOUR).toISOString(), now), 'deleted in 2 days');
  assert.equal(expiryWords(new Date(now + 90 * 60000).toISOString(), now), 'deleted in 2 hours');
  assert.equal(expiryWords(new Date(now + 59 * 60000).toISOString(), now), 'deleted in 59 minutes');
  assert.equal(expiryWords(new Date(now + 61 * 60000).toISOString(), now), 'deleted in 1 hour');
  assert.equal(expiryWords(new Date(now + 20 * 60000).toISOString(), now), 'deleted in 20 minutes');
  assert.equal(expiryWords(new Date(now + 30000).toISOString(), now), 'deleted soon');
  assert.equal(expiryWords(new Date(now - 1).toISOString(), now), 'deleted');
  assert.equal(expiryWords('not a time', now), 'deleted');
  assert.equal(expiryWords(new Date(now + HOUR).toISOString(), now, true), 'deleted');
  assert.equal(clock(5), '0:05');
  assert.equal(clock(65.4), '1:05');
  assert.equal(clock(3723), '1:02:03');
  assert.equal(withImage('', 'abcdef0123456789.jpg', 'Frame 1 of 6 at 0:05, a [b].mov'), '![Frame 1 of 6 at 0:05, a  b .mov](image:abcdef0123456789.jpg)\n');
  assert.equal(withImage('', 'abcdef0123456789.jpg'), '![image](image:abcdef0123456789.jpg)\n');
  assert.ok(ACCEPT.includes('video/*') && ACCEPT.includes('.mov'));
});

test('memo list names a video with its time left, and memo file gets it while Memo has it', async () => {
  // The real clock: the client compares the time of the delete with now.
  const { app, store, videos } = makeApp();
  const server = await new Promise((done) => { const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => done(s)); });
  const env = { ...process.env, MEMO_URL: `http://127.0.0.1:${server.address().port}`, MEMO_TOKEN: TOKEN, MEMO_IMAGE_DIR: mkdtempSync(join(tmpdir(), 'memo-got-')) };
  const memo = (...args) => run('node', [join(ROOT, 'scripts', 'memo.mjs'), ...args], { env }).catch((e) => e);
  const dir = mkdtempSync(join(tmpdir(), 'memo-cli-video-'));
  try {
    // Over the network, as the browser sends it: the body reaches the store as a stream.
    const up = await fetch(`${env.MEMO_URL}/api/video?name=Walk%20home.mov`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: REAL_MOV });
    assert.equal(up.status, 200);
    const { name, expires } = await up.json();
    assert.deepEqual(readFileSync(join(videos.dir, name)), REAL_MOV);
    const refused = await fetch(`${env.MEMO_URL}/api/video?name=x.mov`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: Buffer.alloc(200, 65) });
    assert.equal(refused.status, 400);
    store.send({ from: 'cam', to: 'main', text: `Watch:\n\n[Walk home.mov](video:${name})\n` });
    const list = (await memo('list', '--to', 'main')).stdout;
    const at = `${expires.slice(0, 16).replace('T', ' ')} UTC`;
    assert.match(list, new RegExp(`Video "Walk home\\.mov" is attached, deleted in 2 days \\(${at}, or when the memo closes\\)\\. To get it, run: memo file ${name.replace('.', '\\.')}`));
    const got = await memo('file', name, dir);
    assert.equal(got.stdout, `${join(dir, 'Walk home.mov')}\n`);
    assert.deepEqual(readFileSync(join(dir, 'Walk home.mov')), REAL_MOV);
    videos.remove(name);
    const after = await memo('file', name, dir);
    assert.equal(after.code, 1);
    assert.match(after.stderr, /deleted/);
    assert.match((await memo('list', '--to', 'main')).stdout, /Video "Walk home\.mov" was attached and is deleted/);
    const bad = await memo('file', '../.env', dir);
    assert.equal(bad.code, 1);
  } finally { server.close(); }
});

// The real tool: built with swiftc when the Mac has it (the Command Line Tools), else one thumbnail with qlmanage.
// The binary is kept across runs in the temporary directory, so only the first run builds it.
const hasSwift = await run('xcrun', ['--find', 'swiftc']).then(() => true, () => false);
test('six still frames of a real clip, with AVFoundation', { skip: !hasSwift && 'no swiftc on this computer' }, async () => {
  const frames = createFrames({ binDir: join(tmpdir(), 'memo-frames-bin'), log: () => {} });
  assert.equal(await frames.prepare(), 'swift');
  const made = await frames.make(join(ROOT, 'test', 'fixtures', 'clip.mp4'));
  assert.equal(made.length, 6);
  const times = made.map((f) => f.seconds);
  assert.deepEqual([...times].sort((a, b) => a - b), times, 'in order of time');
  assert.ok(new Set(times).size >= 5, `different moments of the clip: ${times.join(', ')}`);
  for (const f of made) assert.deepEqual([...f.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  const mov = await frames.make(join(ROOT, 'test', 'fixtures', 'clip.mov'));
  assert.equal(mov.length, 6);
  assert.deepEqual(await frames.make(join(ROOT, 'test', 'fixtures', 'clip.mov.missing')), [], 'no video: no frames, no error');
});

test('one thumbnail with qlmanage when there is no Swift compiler', { skip: !existsSync('/usr/bin/qlmanage') && 'not macOS' }, async () => {
  const frames = createFrames({ binDir: mkdtempSync(join(tmpdir(), 'memo-frames-none-')), source: '/nonexistent/video-frames.swift', log: () => {} });
  assert.equal(await frames.prepare(), 'qlmanage');
  const made = await frames.make(join(ROOT, 'test', 'fixtures', 'clip.mp4'));
  assert.equal(made.length, 1);
  assert.deepEqual([...made[0].bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});
