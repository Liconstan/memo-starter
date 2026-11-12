// Code that the two Memo pages share. All text goes into the page as text nodes, never as markup.
import { MAX_BYTES, MAX_SIDE, sendsAsIs, fit, withImage, imageNames, ACCEPT, FILE_MAX_BYTES, FILE_TYPES, HEIF_TYPES, extension, withFile,
  VIDEO_MAX_BYTES, VIDEO_TYPES, withVideo, expiryWords, clock } from '/ui/attach.js';
import { paperclip } from '/ui/markdown.js';
import { openLightbox } from '/ui/lightbox.js';

const KEY = 'memo-token';
let memory = '';
const readToken = () => { try { return localStorage.getItem(KEY) || memory; } catch { return memory; } };
const saveToken = (value) => { memory = value; try { localStorage.setItem(KEY, value); } catch { /* a private window: keep it in memory */ } };

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

export function button(label, onClick, title = '') {
  const node = el('button', { type: 'button', title }, label);
  node.addEventListener('click', (event) => { event.stopPropagation(); onClick(node); });
  return node;
}

// A color for a name, as a hue from 0 to 359. The same name gets the same color on each page and each device.
export function hue(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

// The first letter of a name in a colored circle, for the sender of a memo or the name of an agent.
// The name is in the text next to it, so the circle is decoration.
export function avatar(name, big = false) {
  const node = el('span', { className: big ? 'avatar big' : 'avatar', title: String(name) }, String(name).charAt(0).toUpperCase());
  node.style.setProperty('--h', hue(name));
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// The owner's photo (local/owner.png) in the place of the circle. With no photo, the circle stays.
export function ownerAvatar(name) {
  const node = avatar(name, true);
  const img = el('img', { src: '/ui/owner.png', alt: '' });
  img.addEventListener('load', () => { node.textContent = ''; node.append(img); node.classList.add('photo'); });
  return node;
}

export function note(message) {
  const node = document.getElementById('note');
  node.textContent = message;
  node.hidden = !message;
}

// keepalive: the request goes on when the page closes or goes to the background (a draft that must be saved).
export async function api(path, body, { keepalive = false } = {}) {
  // The GitHub Pages copy of the Inbox talks to the private repository, not to the computer (ui/ledger.js).
  if (globalThis.MEMO_LEDGER) return (await import('./ledger.js')).ledgerApi(path, body, { keepalive });
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${readToken()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  if (response.status === 401) {
    document.getElementById('token-form').hidden = false;
    throw new Error('Enter the token. To copy it, run this in the Memo directory: sed -n "s/^MEMO_TOKEN=//p" .env | tr -d "\\n" | pbcopy');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `The request failed with status ${response.status}.`);
  return data;
}

export function tokenForm(onSaved) {
  const form = document.getElementById('token-form');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveToken(form.elements.token.value.trim());
    form.elements.token.value = '';
    form.hidden = true;
    note('');
    onSaved();
  });
}

export function age(iso) {
  if (!iso) return 'never';
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 90) return 'now';
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 129600) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

// Images of memos (<img data-image="name">, made by markdown.js). The request needs the token, so the page
// gets each file itself and gives the element a local address. One request for each image name.
const imageUrls = new Map();
export function loadImages(root) {
  loadFiles(root);
  loadVideos(root);
  for (const img of root.querySelectorAll('img[data-image]')) {
    const name = img.dataset.image;
    if (!imageUrls.has(name)) {
      imageUrls.set(name, fetch(`/api/image/${name}`, { headers: { Authorization: `Bearer ${readToken()}` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('no image'))))
        .then((blob) => URL.createObjectURL(blob))
        .catch(() => { imageUrls.delete(name); return ''; }));
    }
    imageUrls.get(name).then((url) => {
      if (url) img.src = url;
      else img.replaceWith(`[The image "${img.alt}" did not load.]`);
    });
    // The Inbox calls this again at each refresh. An image gets its listeners only one time.
    if (img.dataset.zoom) continue;
    img.dataset.zoom = 'on';
    img.tabIndex = 0;
    img.setAttribute('aria-haspopup', 'dialog');
    img.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); zoom(img); });
    img.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      zoom(img);
    });
  }
}

// File links of memos (<a data-file="name">, made by markdown.js). A click gets the file with the token and saves it
// under the name of the link. The link keeps its address, so with no token (Tailscale) the plain link works too.
function loadFiles(root) {
  for (const link of root.querySelectorAll('a[data-file]')) {
    if (link.dataset.ready) continue;
    link.dataset.ready = 'on';
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const r = await fetch(`/api/file/${link.dataset.file}`, { headers: { Authorization: `Bearer ${readToken()}` } });
        if (!r.ok) throw new Error();
        const url = URL.createObjectURL(await r.blob());
        el('a', { href: url, download: link.download }).click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch { note(`The file "${link.download}" did not download. Try again.`); }
    });
  }
}

// Video links of memos (<a data-video="name">, made by markdown.js). The page asks the server for the state of each
// video and writes it next to the name: "deleted in 2 days", or "deleted", when the link becomes plain text
// ("Video deleted"). A click gets the file as a file link does; with no token (Tailscale), the plain link works alone,
// so a long video streams from the disk and does not sit in the memory of the page.
const videoMeta = new Map(); // name -> { at, promise } of its state; asked again after a minute (the list loads each 15 seconds)
function loadVideos(root) {
  for (const link of root.querySelectorAll('a[data-video]')) {
    if (link.dataset.ready) continue;
    link.dataset.ready = 'on';
    const name = link.dataset.video;
    const cached = videoMeta.get(name);
    if (!cached || Date.now() - cached.at > 60000) {
      const promise = fetch(`/api/video/${name}/meta`, { headers: { Authorization: `Bearer ${readToken()}` } })
        .then((r) => (r.ok ? r.json() : r.status === 404 ? { deleted: true } : Promise.reject(new Error('no answer'))))
        .catch(() => { videoMeta.delete(name); return null; });
      videoMeta.set(name, { at: Date.now(), promise });
    }
    videoMeta.get(name).promise.then((meta) => {
      const state = link.querySelector('.file-state');
      if (!meta) { if (state) state.textContent = ''; return; }
      if (meta.deleted) {
        const gone = el('span', { className: 'file video gone' }, paperclip(), el('span', { className: 'file-kind' }, 'Video'), 'Video deleted', el('span', { className: 'file-state' }, link.download));
        gone.children[1].setAttribute('aria-hidden', 'true');
        gone.title = 'Memo keeps a video 48 hours, or until its memo closes. The still frames stay.';
        link.replaceWith(gone);
        return;
      }
      if (state) state.textContent = expiryWords(meta.expires);
      link.title = `Memo deletes this video ${new Date(meta.expires).toLocaleString()} or when the memo closes.`;
    });
    link.addEventListener('click', async (event) => {
      if (!readToken()) return; // no token: the plain link streams the file
      event.preventDefault();
      event.stopPropagation();
      try {
        const r = await fetch(`/api/video/${name}`, { headers: { Authorization: `Bearer ${readToken()}` } });
        if (!r.ok) throw new Error();
        const url = URL.createObjectURL(await r.blob());
        el('a', { href: url, download: link.download }).click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      } catch { note(`The video "${link.download}" did not download. It may be deleted: Memo keeps a video 48 hours, or until the memo closes.`); }
    });
  }
}

// Opens the image in the lightbox, with the other loaded images of the same memo (or of the same row of thumbnails).
// The thumbnails of an unsent reply are in the memo too, but they are not part of its images.
function zoom(img) {
  if (!img.src) return;
  const group = img.closest('.thumbs') || img.closest('.memo') || img.parentElement;
  const draft = group.matches('.thumbs');
  const images = [...group.querySelectorAll('img[data-image]')].filter((i) => i.src && (draft || !i.closest('.thumbs')));
  openLightbox(images, Math.max(0, images.indexOf(img)), el);
}

// A photo from a phone can be 12 megapixels, or a type that the server does not store. The browser makes a JPEG
// that fits the limits. It tries smaller sizes until the file is small enough.
async function toJpeg(file) {
  let source;
  try { source = await createImageBitmap(file); } catch {
    const error = new Error('This browser cannot read the image. Use a PNG or JPEG file.');
    error.cannotDecode = true;
    throw error;
  }
  for (const [side, quality] of [[MAX_SIDE, 0.85], [1800, 0.8], [1200, 0.7]]) {
    const size = fit(source.width, source.height, side);
    const canvas = el('canvas', size);
    canvas.getContext('2d').drawImage(source, 0, 0, size.width, size.height);
    const blob = await new Promise((done) => canvas.toBlob(done, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('The image is too large.');
}

// Stores one image file in Memo and gives its name.
export async function uploadImage(file) {
  const body = sendsAsIs(file.type, file.size) ? file : await toJpeg(file);
  const r = await fetch('/api/image', { method: 'POST', headers: { Authorization: `Bearer ${readToken()}` }, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `The image was not stored (status ${r.status}).`);
  return data.name;
}

// Stores one other file (PDF, Office, or text) in Memo and gives { name, original }.
export async function uploadFile(file) {
  if (!FILE_TYPES.includes(extension(file.name))) throw new Error(`Memo cannot store "${file.name}". Attach an image, or a PDF, Word, Excel, PowerPoint, CSV, text, Markdown, JSON, HTML, or HEIC/HEIF file.`);
  if (file.size > FILE_MAX_BYTES) throw new Error(`"${file.name}" is larger than 20 MB.`);
  const r = await fetch(`/api/file?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { Authorization: `Bearer ${readToken()}` }, body: file });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `The file was not stored (status ${r.status}).`);
  return data;
}

// Stores one video for a short time and gives { name, original, expires, frames: [{image, seconds}] }. The browser
// sends the file as it is; the server writes it to the disk as it arrives and makes the still frames.
export async function uploadVideo(file) {
  if (file.size > VIDEO_MAX_BYTES) throw new Error(`"${file.name}" is larger than 500 MB.`);
  const r = await fetch(`/api/video?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { Authorization: `Bearer ${readToken()}` }, body: file });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `The video was not stored (status ${r.status}).`);
  return data;
}
// The text of a field after a video is attached: the video link, then its still frames as images.
function withVideoAndFrames(text, sent) {
  let out = withVideo(text, sent.name, sent.original);
  const n = sent.frames?.length || 0;
  sent.frames?.forEach((f, i) => { out = withImage(out, f.image, `Frame ${i + 1} of ${n} at ${clock(f.seconds)}, ${sent.original}`); });
  return out;
}
// A video by its type or its extension (an iPhone sends a .mov as video/quicktime; a browser does not always know).
const isVideo = (file) => VIDEO_TYPES.includes(extension(file.name)) || (file.type.startsWith('video/') && !FILE_TYPES.includes(extension(file.name)));

// An image goes through the image path (it can become a smaller JPEG). A file with a known extension is a file
// first: a PDF is never an image.
// A HEIC/HEIF photo is an image first (the browser tries to make a JPEG); if the browser cannot read it, the original
// goes as a file instead.
const isHeif = (file) => HEIF_TYPES.includes(extension(file.name)) || /^image\/hei[cf]/.test(file.type);
const isImage = (file) => file.type.startsWith('image/') && (isHeif(file) || !FILE_TYPES.includes(extension(file.name)));
async function imageOrFile(file) {
  try { return { image: await uploadImage(file) }; } catch (error) {
    if (!error.cannotDecode || !isHeif(file)) throw error;
    return { file: await uploadFile(file) };
  }
}

// Lets the owner attach images and files to the text of `area`: with the icon in the field, with a paste, and with a drop.
// The function gives a box that contains the field and the icon; put the box where the field must be.
// `onBusy` gets true while a file goes to the server and false after it: the caller turns its send buttons off. Each image becomes a Markdown line in the text, and `thumbs` shows the images of the text.
// Each other file becomes a Markdown link line with its name.
export function attach(area, thumbs, onBusy = () => {}) {
  const input = el('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true });
  // A small paperclip icon at the right of the field (.attach in common.css).
  const label = el('label', { className: 'attach', title: 'Attach a file, image or video (PDF, Office, CSV, text, Markdown, JSON, HTML, HEIC; 20 MB at most; a video of 500 MB at most, kept 48 hours). You can also paste or drop it on the field.' }, paperclip('attach-icon'), input);
  label.setAttribute('aria-label', 'Attach a file or image');
  // The field and the icon go into one box, so that the icon can be inside the field.
  const box = el('div', { className: 'field' });
  if (area.parentNode) area.replaceWith(box);
  box.append(area, label);
  const show = () => {
    thumbs.replaceChildren(...imageNames(area.value).map((name) => { const img = el('img', { alt: 'Attached image' }); img.dataset.image = name; return img; }));
    thumbs.hidden = !thumbs.children.length;
    loadImages(thumbs);
  };
  const add = async (files) => {
    if (!files.length) return;
    label.classList.add('busy');
    onBusy(true);
    try {
      for (const file of files) {
        if (isVideo(file)) {
          note(`Sending "${file.name}" (${Math.round(file.size / 1048576)} MB) and making its frames...`);
          area.value = withVideoAndFrames(area.value, await uploadVideo(file));
        } else {
          const sent = isImage(file) ? await imageOrFile(file) : { file: await uploadFile(file) };
          area.value = sent.image ? withImage(area.value, sent.image) : withFile(area.value, sent.file.name, sent.file.original);
        }
        area.dispatchEvent(new Event('input', { bubbles: true }));
      }
      note('');
    } catch (error) { note(error.message); } finally { label.classList.remove('busy'); onBusy(false); }
  };
  input.addEventListener('change', () => { add([...input.files]); input.value = ''; });
  label.addEventListener('click', (event) => event.stopPropagation());
  area.addEventListener('input', show);
  area.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (files.length) { event.preventDefault(); add(files); }
  });
  area.addEventListener('dragover', (event) => { if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault(); });
  area.addEventListener('drop', (event) => {
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    add([...event.dataTransfer.files]);
  });
  show();
  return box;
}

// The colors of the page, for the frames of html blocks.
export function themeVars() {
  const style = getComputedStyle(document.documentElement);
  return ['--bg', '--panel', '--ink', '--dim', '--line', '--accent', '--warn'].map((name) => `${name}:${style.getPropertyValue(name).trim()}`).join(';');
}

// A frame reports its height (markdown.js). The page trusts only a number, from a frame that it made, in a safe range.
window.addEventListener('message', (event) => {
  const height = event.data?.memoFrameHeight;
  if (!Number.isFinite(height)) return;
  for (const frame of document.querySelectorAll('iframe.frame')) {
    if (frame.contentWindow === event.source) frame.style.height = `${Math.min(1500, Math.max(40, Math.ceil(height)))}px`;
  }
});
