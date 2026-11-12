// The rules for an image that the owner attaches to a memo. This file has no DOM code, so a test and the
// command-line client can import it.

export const MAX_BYTES = 5 * 1024 * 1024; // the limit of the server (src/images.js)
export const MAX_SIDE = 2400; // the longest side of an image that the browser makes smaller, in pixels
const SMALL_BYTES = 1.5 * 1024 * 1024;
const STORED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_LINK = /!\[[^\]\n]*\]\(image:([0-9a-f]{16}\.(?:png|jpg|gif|webp))\)/g;

// True if the browser sends the file with no change. A GIF can move, so it stays a GIF. A large photo and a type
// that the server does not store (HEIC, for example) become a smaller JPEG first.
export function sendsAsIs(type, size) {
  if (type === 'image/gif') return size <= MAX_BYTES;
  return STORED_TYPES.includes(type) && size <= SMALL_BYTES;
}

// The size of an image after the browser makes it fit in a square of `max` pixels. A small image keeps its size.
export function fit(width, height, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// The text of a field after an image is attached: the image is a Markdown line at the end. alt: its text, for
// example "Frame 2 of 6 at 0:05, clip.mov" for a still frame of a video.
export function withImage(text, name, alt = 'image') {
  const line = `![${String(alt).replace(/[[\]\n]/g, ' ').trim() || 'image'}](image:${name})`;
  return text.trim() ? `${text.replace(/\s+$/, '')}\n\n${line}\n` : `${line}\n`;
}

// The names of the stored images that a text shows, each name one time.
export function imageNames(text) {
  return [...new Set([...String(text || '').matchAll(IMAGE_LINK)].map((m) => m[1]))];
}

// The rules for other files (src/files.js stores them). The server checks the content too.
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
// HTML and HEIC/HEIF are files too: the server gives them only as downloads, never as a page or an image.
export const FILE_TYPES = ['pdf', 'docx', 'xlsx', 'pptx', 'csv', 'txt', 'md', 'json', 'html', 'htm', 'heic', 'heif'];
export const HEIF_TYPES = ['heic', 'heif'];
export const FILE_NAME = /^[0-9a-f]{16}\.(pdf|docx|xlsx|pptx|csv|txt|md|json|html|htm|heic|heif)$/;
const FILE_LINK = /\[([^\]\n]+)\]\(file:([0-9a-f]{16}\.(?:pdf|docx|xlsx|pptx|csv|txt|md|json|html|htm|heic|heif))\)/g;
// The rules for a video (src/videos.js keeps it for a short time). A video is not stored for good: Memo deletes it
// 48 hours after the upload, or when the memo it is in closes, whichever comes first. The still frames stay as images.
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_HOURS = 48;
export const VIDEO_TYPES = ['mov', 'mp4', 'm4v', 'webm'];
export const VIDEO_NAME = /^[0-9a-f]{16}\.(mov|mp4|m4v|webm)$/;
const VIDEO_LINK = /\[([^\]\n]+)\]\(video:([0-9a-f]{16}\.(?:mov|mp4|m4v|webm))\)/g;
// For the file picker: the images, the videos (video/* makes a phone offer its videos too; an iPhone sends a .mov as
// video/quicktime), and the other types by extension (a phone does not always know the MIME type).
export const ACCEPT = `image/png,image/jpeg,image/gif,image/webp,video/*,${[...VIDEO_TYPES, ...FILE_TYPES].map((t) => `.${t}`).join(',')}`;

// The extension of a file name in lower case, or ''.
export const extension = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();

// A file name that is safe on a disk and in a header: no directory, no control characters, no leading dot,
// at most 120 characters, and the extension of the stored file at the end.
export function safeFileName(name, ext) {
  let base = String(name || '').split(/[/\\]/).pop().replace(/[\u0000-\u001f\u007f"*:<>?|]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (ext && extension(base) !== ext) base = `${base || 'file'}.${ext}`;
  if (base.length > 120) {
    const tail = ext ? `.${ext}` : '';
    base = base.slice(0, 120 - tail.length).trimEnd() + tail;
  }
  return base || (ext ? `file.${ext}` : 'file');
}

// The text of a field after a file is attached: a Markdown link line at the end. The link text is the file name.
export function withFile(text, name, original) {
  const label = String(original || '').replace(/[[\]\n]/g, ' ').trim() || name;
  const line = `[${label}](file:${name})`;
  return text.trim() ? `${text.replace(/\s+$/, '')}\n\n${line}\n` : `${line}\n`;
}

// The stored files that a text links to, each name one time: [{ name, label }].
export function fileLinks(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(FILE_LINK)) if (!seen.has(m[2])) seen.set(m[2], { name: m[2], label: m[1] });
  return [...seen.values()];
}

// The text of a field after a video is attached: a Markdown link line at the end, [clip.mov](video:<name>).
export function withVideo(text, name, original) {
  const label = String(original || '').replace(/[[\]\n]/g, ' ').trim() || name;
  const line = `[${label}](video:${name})`;
  return text.trim() ? `${text.replace(/\s+$/, '')}\n\n${line}\n` : `${line}\n`;
}

// The videos that a text links to, each name one time: [{ name, label }].
export function videoLinks(text) {
  const seen = new Map();
  for (const m of String(text || '').matchAll(VIDEO_LINK)) if (!seen.has(m[2])) seen.set(m[2], { name: m[2], label: m[1] });
  return [...seen.values()];
}

// The words for the time a video has left: "deleted in 2 days", "deleted in 5 hours", "deleted in 20 minutes",
// "deleted soon"; and "deleted" when the time is past or the video is gone. The page and `memo list` show them.
export function expiryWords(expires, now = Date.now(), gone = false) {
  const left = Date.parse(expires) - (now instanceof Date ? now.getTime() : now);
  if (gone || Number.isNaN(left) || left <= 0) return 'deleted';
  const minutes = Math.round(left / 60000);
  if (minutes < 2) return 'deleted soon';
  if (minutes < 60) return `deleted in ${minutes} minutes`;
  const hours = Math.round(left / 3600000);
  if (hours < 36) return `deleted in ${hours} hour${hours === 1 ? '' : 's'}`;
  return `deleted in ${Math.round(left / 86400000)} days`;
}

// "0:05" or "1:02:03" for a number of seconds, for the text of a frame.
export function clock(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
