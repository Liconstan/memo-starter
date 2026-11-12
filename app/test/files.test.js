import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createFiles, disposition } from '../src/files.js';
import { safeFileName, withFile, fileLinks, FILE_MAX_BYTES } from '../ui/attach.js';
import { inline } from '../ui/markdown.js';
import { makeApp, TOKEN, LIAISON_TOKEN, ROOT } from './helpers.js';

const run = promisify(execFile);
const PDF = Buffer.from('%PDF-1.7\nfake pdf body\n%%EOF');
// A small zip: the local header signature, then the names that an Office file has in its list.
const office = (part) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`fake [Content_Types].xml ${part}/document.xml`)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('a plain zip with photos.jpg')]);
// A HEIF file: a box size, then "ftyp" and the brand.
const heif = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`), Buffer.from([0, 0, 0, 0]), Buffer.from('mif1heic'), Buffer.alloc(16)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64), Buffer.from('This program cannot be run in DOS mode.')]);
const post = (app, body, name, token = TOKEN) => app.request(`/api/file?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body });
const get = (app, name, token = TOKEN) => app.request(`/api/file/${name}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('each allowed file goes in and comes back as a download with a safe type', async () => {
  const { app } = makeApp();
  const text = 'text/plain; charset=utf-8';
  const cases = [
    [PDF, 'report.pdf', 'pdf', 'application/pdf'],
    [office('word'), 'Letter.docx', 'docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    [office('xl'), 'Budget.XLSX', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    [office('ppt'), 'Deck.pptx', 'pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    [Buffer.from('a,b\n1,2\n'), 'data.csv', 'csv', text],
    [Buffer.from('Notes: café ✓\n'), 'notes.txt', 'txt', text],
    [Buffer.from('# Plan\n\n- one\n'), 'plan.md', 'md', text],
    [Buffer.from('{"a":1}'), 'data.json', 'json', text],
    [Buffer.from('<!doctype html><script>alert(1)</script>'), 'page.html', 'html', text],
    [Buffer.from('<p>old page</p>'), 'old.HTM', 'htm', text],
    [heif('heic'), 'IMG_0001.HEIC', 'heic', 'image/heic'],
    [heif('mif1'), 'photo.heif', 'heif', 'image/heif'],
    [heif('heix'), 'photo.heif', 'heif', 'image/heif'],
  ];
  for (const [bytes, original, ext, type] of cases) {
    const r = await post(app, bytes, original);
    assert.equal(r.status, 200, original);
    const { name, original: back } = await r.json();
    assert.match(name, new RegExp(`^[0-9a-f]{16}\\.${ext}$`));
    assert.equal(back, original);
    const file = await get(app, name);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), type);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.match(file.headers.get('content-disposition'), /^attachment; filename="/);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  }
});

test('the download keeps the original name, also with letters outside ASCII', async () => {
  const { app } = makeApp();
  const { name } = await (await post(app, PDF, 'Rapport été "final".pdf')).json();
  const header = (await get(app, name)).headers.get('content-disposition');
  assert.equal(header, `attachment; filename="Rapport _t_ final.pdf"; filename*=UTF-8''Rapport%20%C3%A9t%C3%A9%20final.pdf`);
});

test('svg, js, an executable, a plain zip, and a fake HEIC are refused', async () => {
  const { app } = makeApp();
  const cases = [
    [Buffer.from([0x00, 0x3c, 0x68, 0x74, 0x6d, 0x6c]), 'binary.html'], // html must be text
    [heif('isom'), 'video.heic'], // an MP4, not a HEIF image
    [Buffer.from('not a photo'), 'photo.heic'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg'],
    [Buffer.from('alert(1)'), 'run.js'],
    [EXE, 'setup.exe'],
    [EXE, 'setup.txt'], // binary content with a text name
    [Buffer.from([0xff, 0xfe, 0x41, 0x00]), 'utf16.txt'],
    [ZIP, 'photos.zip'],
    [ZIP, 'fake.docx'], // a zip that is not an Office file
    [PDF.subarray(1), 'broken.pdf'],
    [Buffer.from('no extension'), 'README'],
  ];
  for (const [bytes, original] of cases) {
    const r = await post(app, bytes, original);
    assert.equal(r.status, 400, original);
    assert.match((await r.json()).error, /PDF, Word, Excel, PowerPoint, CSV, text, Markdown, JSON, HTML, or HEIC\/HEIF/, original);
  }
  assert.equal((await post(app, Buffer.alloc(0), 'empty.txt')).status, 400);
});

test('a file of more than 20 MB is refused', async () => {
  const { app } = makeApp();
  const r = await post(app, Buffer.concat([PDF, Buffer.alloc(FILE_MAX_BYTES)]), 'big.pdf');
  assert.equal(r.status, 413);
  assert.match((await r.json()).error, /20 MB/);
  const files = createFiles(mkdtempSync(join(tmpdir(), 'memo-files-')));
  assert.throws(() => files.save(Buffer.concat([PDF, Buffer.alloc(FILE_MAX_BYTES)]), 'big.pdf'), /20 MB/);
});

test('a file needs the full token', async () => {
  const { app } = makeApp();
  const { name } = await (await post(app, PDF, 'a.pdf')).json();
  assert.equal((await get(app, name, null)).status, 401);
  assert.equal((await get(app, name, LIAISON_TOKEN)).status, 403);
  assert.equal((await post(app, PDF, 'a.pdf', LIAISON_TOKEN)).status, 403);
});

test('only a stored name gives a file', async () => {
  const { app } = makeApp();
  const { name } = await (await post(app, PDF, 'a.pdf')).json();
  for (const bad of ['0123456789abcdef.pdf', `${name}.json`, '..%2F..%2F.env', '%2e%2e%2f.env', 'x.pdf', `${name.slice(0, 16)}.html`, name.toUpperCase()]) {
    assert.equal((await get(app, bad)).status, 404, bad);
  }
});

test('the store: the same content keeps one file and its first name; the name is safe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-files-'));
  const files = createFiles(dir);
  const first = files.save(PDF, '../../etc/report.pdf');
  assert.equal(first.original, 'report.pdf');
  assert.equal(files.save(PDF, 'other.pdf').name, first.name);
  assert.equal(files.read(first.name).original, 'report.pdf');
  assert.deepEqual(readdirSync(dir).sort(), [first.name, `${first.name}.json`].sort());
  assert.equal(files.save(PDF.subarray(0, 20), 'no-extension').original, 'no-extension.pdf', 'a PDF by its bytes');
});

test('a safe file name', () => {
  assert.equal(safeFileName('C:\\Users\\me\\a<b>.txt', 'txt'), 'ab.txt');
  assert.equal(safeFileName('.hidden.md', 'md'), 'hidden.md');
  assert.equal(safeFileName('line\nbreak.csv', 'csv'), 'linebreak.csv');
  assert.equal(safeFileName('', 'pdf'), 'file.pdf');
  assert.equal(safeFileName('report.exe', 'pdf'), 'report.exe.pdf');
  const long = safeFileName(`${'x'.repeat(300)}.docx`, 'docx');
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.docx'));
  assert.match(disposition('a.pdf'), /^attachment; filename="a\.pdf"; filename\*=UTF-8''a\.pdf$/);
});

test('an attached file is a Markdown link line, and the Inbox shows it as a file', () => {
  const name = '0123456789abcdef.pdf';
  assert.equal(withFile('', name, 'report.pdf'), `[report.pdf](file:${name})\n`);
  assert.equal(withFile('See this:\n', name, 'a [draft].pdf'), `See this:\n\n[a  draft .pdf](file:${name})\n`);
  assert.deepEqual(fileLinks(`[a.pdf](file:${name}) and [b.pdf](file:${name}) [x](file:../../.env)`), [{ name, label: 'a.pdf' }]);
  assert.deepEqual(inline(`Read [report.pdf](file:${name}).`), [
    { t: 'text', text: 'Read ' }, { t: 'file', text: 'report.pdf', name, kind: 'PDF' }, { t: 'text', text: '.' },
  ]);
  assert.equal(inline(`[a.heic](file:0123456789abcdef.heic)`)[0].kind, 'HEIC');
  assert.equal(inline(`[a.html](file:0123456789abcdef.html)`)[0].kind, 'HTML');
  for (const text of ['[x](file:///etc/passwd)', '[x](file:0123456789abcdef.svg)', '[x](file:0123456789abcdef.js)', '[x](file:../a.pdf)']) {
    assert.deepEqual(inline(text), [{ t: 'text', text }], text);
  }
});

test('memo file saves a file under its original name, and memo list names the attached files', async () => {
  const { app, store } = makeApp();
  const server = await new Promise((done) => { const s = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => done(s)); });
  const env = { ...process.env, MEMO_URL: `http://127.0.0.1:${server.address().port}`, MEMO_TOKEN: TOKEN, MEMO_IMAGE_DIR: mkdtempSync(join(tmpdir(), 'memo-got-')) };
  const memo = (...args) => run('node', [join(ROOT, 'scripts', 'memo.mjs'), ...args], { env }).catch((e) => e);
  const dir = mkdtempSync(join(tmpdir(), 'memo-cli-file-'));
  try {
    const { name } = await (await post(app, PDF, 'Q3 report.pdf')).json();
    const got = await memo('file', name, dir);
    assert.equal(got.stdout, `${join(dir, 'Q3 report.pdf')}\n`);
    assert.deepEqual(readFileSync(join(dir, 'Q3 report.pdf')), PDF);
    assert.equal(statSync(join(dir, 'Q3 report.pdf')).mode & 0o777, 0o600);
    // The same file again keeps one copy; a different file with that name gets a new name.
    assert.equal((await memo('file', name, dir)).stdout, `${join(dir, 'Q3 report.pdf')}\n`);
    writeFileSync(join(dir, 'other.pdf'), 'x');
    const { name: other } = await (await post(app, Buffer.from('%PDF-1.4 other'), 'Q3 report.pdf')).json();
    assert.equal((await memo('file', other, dir)).stdout, `${join(dir, 'Q3 report (2).pdf')}\n`);
    const missing = await memo('file', '0000000000000000.pdf', dir);
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /No file has that name/);
    const bad = await memo('file', '../.env', dir);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /stored name/);
    assert.equal(existsSync(join(dir, '.env')), false);
    store.send({ from: 'cam', to: 'main', text: `Read this:\n\n[Q3 report.pdf](file:${name})\n` });
    assert.match((await memo('list', '--to', 'main')).stdout, new RegExp(`File "Q3 report\\.pdf" is attached\\. To get it, run: memo file ${name.replace('.', '\\.')}`));
  } finally { server.close(); }
});
