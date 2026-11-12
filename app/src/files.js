import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoError } from './memos.js';
import { FILE_MAX_BYTES, FILE_NAME, HEIF_TYPES, extension, safeFileName } from '../ui/attach.js';

const TEXT = 'text/plain; charset=utf-8';
// The browser gets only these types. A text file is always plain text, so it never runs as a page.
// HTML is plain text too: with the download header and nosniff, a browser never renders it.
const TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: TEXT, txt: TEXT, md: TEXT, json: TEXT, html: TEXT, htm: TEXT,
  heic: 'image/heic', heif: 'image/heif',
};
const OFFICE = ['docx', 'xlsx', 'pptx'];
const PLAIN = ['csv', 'txt', 'md', 'json', 'html', 'htm'];
const REFUSED = 'The file must be a PDF, Word, Excel, PowerPoint, CSV, text, Markdown, JSON, HTML, or HEIC/HEIF file.';
// A HEIF file starts with an ftyp box: bytes 4 to 8 are "ftyp", and bytes 8 to 12 are the brand.
const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis'];
const HEIF_BRANDS = ['mif1', 'msf1'];
function heifBrand(b) {
  if (b.length < 12 || b.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  const brand = b.subarray(8, 12).toString('latin1');
  if (HEIC_BRANDS.includes(brand)) return 'heic';
  if (HEIF_BRANDS.includes(brand)) return 'heif';
  return null;
}

// A zip file starts with "PK\3\4". An Office file is a zip with "[Content_Types].xml" in its list of names.
const isZip = (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOffice = (b) => isZip(b) && b.includes('[Content_Types].xml', 0, 'latin1');
// Text is valid UTF-8 with no zero bytes.
function isText(b) {
  if (b.includes(0)) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(b); return true; } catch { return false; }
}

// The type comes from the first bytes where the file has a signature, and else from the extension with a text check.
function kind(b, ext) {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  const heif = heifBrand(b);
  if (heif) return HEIF_TYPES.includes(ext) ? ext : heif;
  if (HEIF_TYPES.includes(ext)) return null;
  if (OFFICE.includes(ext)) return isOffice(b) ? ext : null;
  if (PLAIN.includes(ext)) return isText(b) ? ext : null;
  return null;
}

// The original name is in a small JSON file next to the file: <name>.json.
export function createFiles(dir) {
  const meta = (name) => join(dir, `${name}.json`);
  function save(bytes, original) {
    const b = Buffer.from(bytes);
    if (b.length > FILE_MAX_BYTES) throw new MemoError(400, 'A file must be 20 MB or smaller.');
    if (!b.length) throw new MemoError(400, 'The file is empty.');
    const ext = kind(b, extension(original));
    if (!ext) throw new MemoError(400, REFUSED);
    const name = `${createHash('sha256').update(b).digest('hex').slice(0, 16)}.${ext}`;
    const label = safeFileName(original, ext);
    mkdirSync(dir, { recursive: true });
    // The same content keeps its first name.
    if (!existsSync(join(dir, name))) writeFileSync(join(dir, name), b);
    if (!existsSync(meta(name))) writeFileSync(meta(name), JSON.stringify({ name: label }));
    return { name, original: originalName(name) };
  }
  function originalName(name) {
    try { return safeFileName(JSON.parse(readFileSync(meta(name), 'utf8')).name, name.split('.')[1]); } catch { return name; }
  }
  // Only a name in the stored form goes on to a file path.
  function read(name) {
    if (!FILE_NAME.test(name) || !existsSync(join(dir, name))) throw new MemoError(404, 'No file has that name.');
    return { bytes: readFileSync(join(dir, name)), type: TYPES[name.split('.')[1]], original: originalName(name) };
  }
  return { save, read };
}

// The Content-Disposition value: always a download. The plain name is for old clients, filename* keeps the real name.
export function disposition(original) {
  const plain = original.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(original).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
