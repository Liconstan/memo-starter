// The store of videos. A video is not kept: it lives in a folder outside data/ (and outside every backup), and
// Memo deletes it 48 hours after the upload, or when the memo it is in closes, whichever comes first. The still
// frames of the video are normal images (src/images.js) and stay. The upload goes to the disk as a stream, so a
// 500 MB video never sits in memory.
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { once } from 'node:events';
import { MemoError } from './memos.js';
import { VIDEO_MAX_BYTES, VIDEO_HOURS, VIDEO_NAME, VIDEO_TYPES, extension, safeFileName } from '../ui/attach.js';

export const TYPES = { mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm' };
const REFUSED = 'The file must be a video: .mov, .mp4, .m4v or .webm.';
const TOO_BIG = 'A video must be 500 MB or smaller.';
// An MP4 family file starts with an ftyp box: bytes 4 to 8 are "ftyp", bytes 8 to 12 are the brand.
const MOV_BRANDS = ['qt  '];
const M4V_BRANDS = ['M4V ', 'M4VH', 'M4VP'];
const MP4_BRANDS = ['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'f4v ', '3gp4', '3gp5', '3gp6', '3g2a', 'dash', 'mmp4'];
// A WebM file is an EBML document (1A 45 DF A3) whose DocType, in the header, is "webm".
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const HEAD = 64; // the bytes that decide the type
// How long the small record of a deleted video stays, so the page can say "Video deleted" and not "not found".
const RECORD_DAYS = 30;

// The type from the first bytes and the extension of the original name, or null for a file that is not a video.
export function kind(b, ext) {
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = b.subarray(8, 12).toString('latin1');
    if (MOV_BRANDS.includes(brand)) return 'mov';
    if (M4V_BRANDS.includes(brand)) return 'm4v';
    if (MP4_BRANDS.includes(brand)) return ['mp4', 'm4v', 'mov'].includes(ext) ? ext : 'mp4';
    return null; // an image (HEIC) or an unknown brand
  }
  if (b.length >= 4 && b.subarray(0, 4).equals(EBML)) return b.subarray(0, HEAD).includes('webm', 0, 'latin1') ? 'webm' : null;
  return null;
}

// dir: the folder of the videos. hours: the life of a video. now: the clock (a test gives its own). maxBytes: the
// limit (a test gives a small one).
export function createVideos({ dir, hours = VIDEO_HOURS, now = () => new Date(), log = (line) => console.error(line), maxBytes = VIDEO_MAX_BYTES }) {
  const meta = (name) => join(dir, `${name}.json`);
  const readMeta = (name) => { try { return JSON.parse(readFileSync(meta(name), 'utf8')); } catch { return null; } };
  const writeMeta = (name, data) => writeFileSync(meta(name), JSON.stringify(data), { mode: 0o600 });
  const ensure = () => mkdirSync(dir, { recursive: true, mode: 0o700 });

  // source: a web ReadableStream (the request body), a Node stream, or bytes. original: the file name of the owner.
  // length: the Content-Length header, when the client sent one, so a file over the limit is refused before a byte.
  // Gives { name, original, expires, path, size }.
  async function save(source, original, { length } = {}) {
    if (Number(length) > maxBytes) throw new MemoError(413, TOO_BIG);
    const ext0 = extension(original);
    let stream;
    if (source instanceof Readable) stream = source;
    else if (source instanceof Uint8Array || source instanceof ArrayBuffer) stream = Readable.from([Buffer.from(source)]);
    else if (source && typeof source.getReader === 'function') stream = Readable.fromWeb(source);
    else throw new MemoError(400, 'The request has no body.');
    ensure();
    const tmp = join(dir, `.upload-${randomUUID()}`);
    const out = createWriteStream(tmp, { mode: 0o600 });
    const hash = createHash('sha256');
    let size = 0, head = Buffer.alloc(0), ext = null;
    try {
      for await (const chunk of stream) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += b.length;
        if (size > maxBytes) throw new MemoError(413, TOO_BIG);
        if (head.length < HEAD) {
          head = Buffer.concat([head, b]).subarray(0, HEAD);
          // The type is decided as soon as the first bytes are here, so a large file of a wrong type stops at once.
          if (head.length >= HEAD) { ext = kind(head, ext0); if (!ext) throw new MemoError(400, REFUSED); }
        }
        hash.update(b);
        if (!out.write(b)) await once(out, 'drain');
      }
      out.end();
      await finished(out);
      if (!size) throw new MemoError(400, 'The file is empty.');
      if (!ext) { ext = kind(head, ext0); if (!ext) throw new MemoError(400, REFUSED); }
    } catch (err) {
      out.destroy();
      rmSync(tmp, { force: true });
      throw err;
    }
    const name = `${hash.digest('hex').slice(0, 16)}.${ext}`;
    const path = join(dir, name);
    // The same content keeps its first file and its first name; a new upload of a deleted video gets a new life.
    if (existsSync(path)) rmSync(tmp, { force: true }); else renameSync(tmp, path);
    const old = readMeta(name);
    const created = now().toISOString();
    const expires = new Date(now().getTime() + hours * 3600000).toISOString();
    const record = old && !old.deleted && old.expires > created ? old : { name: safeFileName(original, ext), created, expires };
    writeMeta(name, record);
    return { name, original: record.name, expires: record.expires, path, size: statSync(path).size };
  }

  // What the page and the client show about a video: { name, original, expires, deleted (a time, or null), size }.
  // A name that was never stored gives 404; the record of a deleted video stays for a month, so the memo says
  // "Video deleted" and not "No video has that name".
  function info(name) {
    if (!VIDEO_NAME.test(name)) throw new MemoError(404, 'No video has that name.');
    const m = readMeta(name);
    if (!m) throw new MemoError(404, 'No video has that name.');
    const present = existsSync(join(dir, name));
    const deleted = m.deleted || (present ? null : m.expires);
    return { name, original: safeFileName(m.name, name.split('.')[1]), expires: m.expires, created: m.created, deleted,
      size: present ? statSync(join(dir, name)).size : 0, type: TYPES[name.split('.')[1]] };
  }
  // The file of a video, for a download: { path, size, type, original, expires }. 410 after the delete.
  function read(name) {
    const m = info(name);
    if (m.deleted) throw new MemoError(410, 'The video was deleted. Memo keeps a video 48 hours, or until its memo closes.');
    return { path: join(dir, name), size: m.size, type: m.type, original: m.original, expires: m.expires };
  }
  // Deletes a video now (the memo closed). The small record stays with the time of the delete.
  function remove(name) {
    if (!VIDEO_NAME.test(name)) return false;
    const m = readMeta(name);
    const path = join(dir, name);
    const had = existsSync(path);
    rmSync(path, { force: true });
    if (m && !m.deleted) writeMeta(name, { ...m, deleted: now().toISOString() });
    return had;
  }
  // Deletes the videos past their time, the records of a month ago, and uploads that never finished. Gives the names
  // of the deleted videos. The server runs it at its start and each 10 minutes.
  function sweep() {
    if (!existsSync(dir)) return [];
    const t = now().getTime();
    const gone = [];
    for (const file of readdirSync(dir)) {
      try {
        if (file.startsWith('.upload-')) { if (t - statSync(join(dir, file)).mtimeMs > 86400000) rmSync(join(dir, file), { force: true }); continue; }
        if (VIDEO_NAME.test(file) && !existsSync(meta(file))) { rmSync(join(dir, file), { force: true }); gone.push(file); continue; }
        if (!file.endsWith('.json')) continue;
        const name = file.slice(0, -5);
        if (!VIDEO_NAME.test(name)) continue;
        const m = readMeta(name);
        if (!m) { rmSync(join(dir, file), { force: true }); continue; }
        if (m.deleted) { if (t - Date.parse(m.deleted) > RECORD_DAYS * 86400000) rmSync(join(dir, file), { force: true }); continue; }
        if (Date.parse(m.expires) <= t) { if (remove(name)) gone.push(name); }
      } catch (err) { log(`video sweep ${file}: ${err.message}`); }
    }
    return gone;
  }
  return { save, info, read, remove, sweep, dir, types: VIDEO_TYPES };
}
