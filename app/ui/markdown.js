// A small Markdown reader for memo text. parse() gives plain data; render() makes DOM nodes from it.
// No text goes into the page as markup, so HTML in a memo stays text.
// Supported: paragraphs, # headings, - and 1. lists, > quotes, ``` code blocks, **bold**, *italic*, `code`,
// [text](link), bare web addresses, tables, ![text](image:<name>) for an image that Memo stores (memo image),
// and [name](file:<name>) for a file that Memo stores (a download link).
// Memo 1513: a ```diff block shows as removed and added lines (diffRows, diffView), and [text](/system#file=<id>&edit=1)
// is a link to one rule document of the System page (a charter, the lessons, a skill), which the Inbox opens in a
// dialog (ui/skillmodal.js).
// Memo 1523: a ```old block is the text that is there now and is to be replaced, in a red-tinted box with the words
// "Now (the text to replace)"; a ```new block is the text to put there, in a green-tinted box with the words "New
// text, copy this" and a copy button for exactly that text. A line range after the word, as in ```old lines 113-115,
// shows in the label as "Lines 113 to 115".
// Memo 1527: when the memo also links to a rule document, those words are a link to it with the lines in data-lines,
// and the dialog opens the document at those lines in its editor (ui/skillmodal.js, ui/linenumbers.js).
// A link must start with http or https. An image on the internet becomes a link: the page loads nothing from there.
const TOKEN = /`(?<code>[^`\n]+)`|\*\*(?<bold>[^*\n]+)\*\*|\*(?<italic>[^\s*][^*\n]*)\*|!\[(?<alt>[^\]\n]*)\]\((?<src>[^)\s]+)\)|\[(?<label>[^\]\n]+)\]\((?<href>[^)\s]+)\)|(?<bare>https?:\/\/[^\s<>"'`]+)/g;
const isWeb = (href) => /^https?:\/\//i.test(href);
const STORED = /^image:([0-9a-f]{16}\.(?:png|jpg|gif|webp))$/;
const STORED_FILE = /^file:([0-9a-f]{16}\.(pdf|docx|xlsx|pptx|csv|txt|md|json|html|htm|heic|heif))$/;
// A video that Memo keeps for a short time: [clip.mov](video:<name>). The page asks the server for its state.
const STORED_VIDEO = /^video:([0-9a-f]{16}\.(?:mov|mp4|m4v|webm))$/;
// A rule document of the System page (memo 1513): /system#file=charter:team&edit=1, /system#file=lessons,
// /system#file=skill:<name>&edit=1, /system#file=hand:<name>. The ids are those of src/system.js; nothing else of the
// System page is a link in a memo.
export const DOC_LINK = /^\/system#file=(?:charter:[a-z][a-z0-9-]{0,63}|lessons|(?:skill|hand):[a-z0-9][a-z0-9_-]{0,63})(?:&edit=1)?$/;
// The same document by a full address (memo 1523: a bare /system path confused her, so the agents write the whole
// address): the address of this page's own server, of Memo on this computer (127.0.0.1 or localhost), or of a
// computer of the tailnet (a name that ends in .ts.net). The dialog reads the document from the server of the page
// by its id alone, so the host of the link opens nothing by itself. The result: the part from /system on, or null.
const MEMO_HOST = /^(?:https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?|https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net(?::\d{1,5})?)$/i;
export function docLinkOf(href, origin = globalThis.location?.origin) {
  const text = String(href || '');
  if (DOC_LINK.test(text)) return text;
  const m = text.match(/^(https?:\/\/[^/?#\s]+)(\/system#.*)$/i);
  if (!m || !DOC_LINK.test(m[2])) return null;
  const own = Boolean(origin) && m[1].toLowerCase() === String(origin).toLowerCase();
  return own || MEMO_HOST.test(m[1]) ? m[2] : null;
}
// The short word next to a file link.
const FILE_KIND = { pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', csv: 'CSV', txt: 'Text', md: 'Markdown', json: 'JSON',
  html: 'HTML', htm: 'HTML', heic: 'HEIC', heif: 'HEIF' };
const SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
// The cells of one table line. "\|" is a pipe inside a cell.
const TASK = /^\[([ xX])\]\s+(.*)$/s;
const cells = (line) => line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

export function inline(text) {
  const spans = [];
  const push = (span) => {
    const last = spans.at(-1);
    if (span.t === 'text' && last?.t === 'text') last.text += span.text;
    else if (span.t !== 'text' || span.text) spans.push(span);
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    push({ t: 'text', text: text.slice(at, m.index) });
    at = m.index + m[0].length;
    const g = m.groups;
    if (g.code !== undefined) push({ t: 'code', text: g.code });
    else if (g.bold !== undefined) push({ t: 'b', text: g.bold });
    else if (g.italic !== undefined) push({ t: 'i', text: g.italic });
    else if (g.src !== undefined) {
      const stored = g.src.match(STORED);
      if (stored) push({ t: 'img', alt: g.alt, name: stored[1] });
      else if (isWeb(g.src)) push({ t: 'a', text: g.alt ? `Image: ${g.alt}` : 'Image', href: g.src });
      else push({ t: 'text', text: m[0] });
    } else if (g.label !== undefined) {
      const file = g.href.match(STORED_FILE);
      const video = g.href.match(STORED_VIDEO);
      if (file) push({ t: 'file', text: g.label, name: file[1], kind: FILE_KIND[file[2]] });
      else if (video) push({ t: 'video', text: g.label, name: video[1], kind: 'Video' });
      else if (docLinkOf(g.href)) push({ t: 'doc', text: g.label, href: g.href });
      else push(isWeb(g.href) ? { t: 'a', text: g.label, href: g.href } : { t: 'text', text: m[0] });
    } else {
      // Punctuation at the end of a bare address belongs to the sentence, not to the address.
      const href = g.bare.replace(/[.,;:!?)]+$/, '');
      // A whole address of a rule document, written with no link text, opens the dialog too (memo 1523).
      push({ t: docLinkOf(href) ? 'doc' : 'a', text: href, href });
      push({ t: 'text', text: g.bare.slice(href.length) });
    }
  }
  push({ t: 'text', text: text.slice(at) });
  return spans;
}

// The rule that the frame document starts with. Nothing in the frame can load from a network.
const FRAME_RULE = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:";
// The frame cannot be measured from outside, so it reports its own height to the page.
const FRAME_SIZER = "const send=()=>parent.postMessage({memoFrameHeight:document.documentElement.scrollHeight},'*');"
  + "new ResizeObserver(send).observe(document.documentElement);addEventListener('load',send);send();";

// The document of the frame for one html block. vars: the colors of the page as CSS variables ("--ink:#111;--bg:#fff").
export function frameDocument(html, vars = '') {
  const colors = /^[-\w\s#(),.%:;]*$/.test(vars) ? vars : '';
  return '<!doctype html><html><head><meta charset="utf-8">'
    + `<meta http-equiv="Content-Security-Policy" content="${FRAME_RULE}">`
    + `<style>:root{color-scheme:light dark;${colors}}html{margin:0}body{margin:0;padding:8px;background:transparent;color:var(--ink);`
    + 'font:15px/1.45 -apple-system,system-ui,sans-serif}svg,canvas,img,table{max-width:100%}</style></head><body>'
    + `${html}<script>${FRAME_SIZER}</script></body></html>`;
}

// A closed frame for one document (a memo html block, or the system map on the System page).
// The frame has its own empty origin: its script cannot read the page, the token, or the Memo API.
// The sandbox is set before the document, so the document never runs without it.
export function makeFrame(doc, title, className = 'frame') {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.className = className;
  frame.title = title;
  frame.srcdoc = doc;
  return frame;
}

// html: true makes a block that starts with ```html a frame. Without it the block is code, as all other blocks.
export function parse(text, { html = false } = {}) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  let tasks = 0; // the count of check boxes before this place in the text
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', spans: inline(para.join('\n')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if (/^```/.test(line)) {
      flush();
      const body = [];
      // ```diff: a change, shown as removed and added lines (memo 1513).
      // ```old and ```new, with or with no line range: the text to replace and the text to put there (memo 1523).
      const swap = line.match(SWAP_FENCE);
      const type = html && /^```html\s*$/i.test(line) ? 'html' : /^```diff\s*$/i.test(line) ? 'diff' : swap ? swap[1].toLowerCase() : 'pre';
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      if (swap) blocks.push({ type, text: body.join('\n'), lines: swap[2] ? { from: Number(swap[2]), to: Number(swap[3] || swap[2]) } : null });
      else blocks.push(type === 'diff' ? { type, text: body.join('\n'), rows: diffRows(body.join('\n')) } : { type, text: body.join('\n') });
    } else if (!line.trim()) {
      flush();
    } else if ((m = line.match(/^#{1,4}\s+(.*)$/))) {
      flush();
      blocks.push({ type: 'h', spans: inline(m[1]) });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      const body = [m[1]];
      while (i + 1 < lines.length && (m = lines[i + 1].match(/^>\s?(.*)$/))) { body.push(m[1]); i++; }
      // text: the quote as it was written, with no "> " marks, for the copy button.
      blocks.push({ type: 'quote', spans: inline(body.join('\n')), text: body.join('\n') });
    } else if (/^\s*[-*]\s+\S/.test(line) || /^\s*\d+[.)]\s+\S/.test(line)) {
      flush();
      const type = /^\s*\d/.test(line) ? 'ol' : 'ul';
      const item = type === 'ol' ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items = [];
      const at = []; // the line of each item
      for (; i < lines.length; i++) {
        const found = lines[i].match(item);
        if (found) { items.push(found[1]); at.push(i); }
        else if (/^\s+\S/.test(lines[i])) items[items.length - 1] += `\n${lines[i].trim()}`; // an indented line continues the item
        else break;
      }
      i--;
      // "- [ ] text" and "- [x] text" are items with a check box. checks has one entry for each item: null for a plain
      // item, or { n, on, line }: the number of the box in the text, its state, and its line.
      const boxes = type === 'ul' ? items.map((text) => text.match(TASK)) : [];
      if (boxes.some(Boolean)) {
        const checks = boxes.map((box, k) => (box ? { n: tasks++, on: box[1] !== ' ', line: at[k] } : null));
        blocks.push({ type, items: items.map((text, k) => inline(boxes[k] ? boxes[k][2] : text)), checks });
      } else blocks.push({ type, items: items.map(inline) });
    } else if (line.includes('|') && i + 1 < lines.length && SEPARATOR.test(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|'); i++) {
        const row = cells(lines[i]).slice(0, head.length);
        while (row.length < head.length) row.push('');
        rows.push(row.map(inline));
      }
      i--;
      blocks.push({ type: 'table', head: head.map(inline), rows });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

// ---------- the text to replace and the new text (memo 1523) ----------
// The first line of such a block: ```old, ```new, ```old lines 113-115, ```new line 40, ```old lines 3 to 9.
const SWAP_FENCE = /^```(old|new)(?:\s+lines?\s+(\d{1,7})(?:\s*(?:-|–|to)\s*(\d{1,7}))?)?\s*$/i;
export const SWAP_WORDS = { old: 'Now (the text to replace)', new: 'New text, copy this' };
// The words of the label of a block: "Now (the text to replace) · Lines 113 to 115". lines: { from, to } or null.
export const rangeWords = (lines) => (!lines ? '' : lines.from === lines.to ? `Line ${lines.from}` : `Lines ${lines.from} to ${lines.to}`);
export function swapLabel(kind, lines = null) {
  const range = rangeWords(lines);
  return range ? `${SWAP_WORDS[kind]} · ${range}` : SWAP_WORDS[kind];
}
// The rule document that the lines of each old or new block are lines of (memo 1527): the address of the link to a
// rule document that is nearest before the block in the memo, or else the first one after it. blocks: those of parse.
// The result has one entry for each block: the address for an old or new block with a line range, else null.
export function swapDocs(blocks) {
  const hrefs = (spans) => (spans || []).flatMap((s) => (s.t === 'doc' ? [s.href] : s.t === 'b' || s.t === 'i' ? hrefs(inline(s.text)) : []));
  const of = (b) => [...hrefs(b.spans), ...(b.items || []).flatMap(hrefs), ...(b.head || []).flatMap(hrefs), ...(b.type === 'table' ? b.rows : []).flatMap((r) => r.flatMap(hrefs))];
  const found = blocks.map(of);
  const first = found.flat()[0] || null;
  let last = null;
  return blocks.map((b, i) => {
    if (found[i].length) last = found[i].at(-1);
    return (b.type === 'old' || b.type === 'new') && b.lines ? last || first : null;
  });
}

// ---------- a change as removed and added lines (memo 1513) ----------
// A row is { t: 'ctx' | 'del' | 'add', text }, or { t: 'gap', count } for lines that are left out.

// The longest common part of two lists, as rows in order. Lists whose table would be too large give no common part:
// all of x removed, then all of y added.
const LCS_CELLS = 2_000_000;
function lcsRows(x, y) {
  const n = x.length;
  const m = y.length;
  if (n * m > LCS_CELLS) return [...x.map((text) => ({ t: 'del', text })), ...y.map((text) => ({ t: 'add', text }))];
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w); // t[i * w + j]: the length of the common part of x from i and y from j
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { rows.push({ t: 'ctx', text: x[i] }); i++; j++; } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) rows.push({ t: 'del', text: x[i++] });
    else rows.push({ t: 'add', text: y[j++] });
  }
  while (i < n) rows.push({ t: 'del', text: x[i++] });
  while (j < m) rows.push({ t: 'add', text: y[j++] });
  return rows;
}

// The rows of the change from one text to another, line by line. The equal lines at the two ends are not compared.
export function diffLines(before, after) {
  // A text file ends with a new line: that end is no line of its own.
  const linesOf = (text) => { const list = String(text ?? '').split('\n'); if (list.length > 1 && list.at(-1) === '') list.pop(); return list; };
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const ctx = (text) => ({ t: 'ctx', text });
  return [...a.slice(0, start).map(ctx), ...lcsRows(a.slice(start, endA), b.slice(start, endB)), ...a.slice(endA).map(ctx)];
}

// The rows with only the lines near a change: `context` lines before and after each change, and a gap row with the
// count of the lines left out. No change gives no rows.
export function diffHunks(rows, context = 3) {
  const keep = new Array(rows.length).fill(false);
  rows.forEach((r, i) => {
    if (r.t === 'ctx') return;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) keep[k] = true;
  });
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (keep[i]) { out.push(rows[i]); continue; }
    const last = out.at(-1);
    if (last?.t === 'gap') last.count += 1; else out.push({ t: 'gap', count: 1 });
  }
  return out.some((r) => r.t === 'del' || r.t === 'add') ? out : [];
}

// The rows of a ```diff block: a line that starts with - is removed, with + is added, the others are context. The
// head lines of a diff of git (diff --git, index, --- a/x with +++ b/x) are left out, and a line @@ is a gap. When
// each changed line has a space after its sign ("- old", "+ new"), that space is not part of the text.
export function diffRows(text) {
  const lines = String(text ?? '').split('\n');
  const signed = lines.filter((l) => /^[-+]./.test(l) && !/^(---|\+\+\+) /.test(l));
  const spaced = signed.length > 0 && signed.every((l) => l[1] === ' ');
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(diff --git |index [0-9a-f]+\.\.|\\ No newline)/.test(line)) continue;
    if (/^--- /.test(line) && /^\+\+\+ /.test(lines[i + 1] || '')) { i++; continue; }
    if (/^@@/.test(line)) { if (rows.length && rows.at(-1).t !== 'gap') rows.push({ t: 'gap', count: 0 }); continue; }
    if (line[0] === '-' || line[0] === '+') rows.push({ t: line[0] === '-' ? 'del' : 'add', text: line.slice(spaced && line[1] === ' ' ? 2 : 1) });
    else rows.push({ t: 'ctx', text: line.replace(spaced ? /^ {1,2}/ : /^ /, '') });
  }
  return rows;
}

// The words that differ between a removed text and the added text that replaces it: { del, add }, each a list of
// { text, on }; on marks a part that is only on that side. null when the two texts share less than half of the
// words of the shorter one: then the whole lines are the change, and marks inside them would say nothing.
export function diffWords(removed, added) {
  const split = (text) => String(text).match(/\s+|[^\s]+/g) || [];
  const x = split(removed);
  const y = split(added);
  if (x.length * y.length > 250_000) return null;
  const rows = lcsRows(x, y);
  const words = (list) => list.filter((w) => /\S/.test(w)).length;
  const common = words(rows.filter((r) => r.t === 'ctx').map((r) => r.text));
  if (!common || common * 2 < Math.min(words(x), words(y))) return null;
  const side = (drop) => {
    const parts = [];
    for (const r of rows) {
      if (r.t === drop) continue;
      const on = r.t !== 'ctx';
      const last = parts.at(-1);
      // The space between two marked words is marked too, so a changed phrase is one mark.
      if (last && last.on === on) last.text += r.text;
      else if (last && on && parts.length > 1 && !/\S/.test(last.text) && parts.at(-2).on) { parts.pop(); parts.at(-1).text += last.text + r.text; } else parts.push({ text: r.text, on });
    }
    return parts;
  };
  return { del: side('add'), add: side('del') };
}

// The words a screen reader hears before the lines of a part, and the words of the whole change.
export const DIFF_WORDS = { del: 'Removed:', add: 'Added:' };
export function diffSummary(rows) {
  const n = (t) => rows.filter((r) => r.t === t).length;
  const lines = (count) => (count === 1 ? '1 line' : `${count} lines`);
  return `Change: ${lines(n('del'))} removed, ${lines(n('add'))} added`;
}

// The nodes of a change (memo 1513): the removed lines in a red-tinted part that starts with the word "Removed:", the
// added lines in a green-tinted part that starts with "Added:", the lines around them plain. The two words are text
// of the page, so a screen reader says them before the lines and nothing depends on a color. Where added lines
// replace removed ones and most words stay, the words that differ have a mark. el: the element function of common.js.
export function diffView(rows, el) {
  const parts = []; // { t: 'ctx', lines } | { t: 'gap', count } | { t: 'change', del: [], add: [] }
  for (const r of rows) {
    const last = parts.at(-1);
    if (r.t === 'gap') parts.push({ t: 'gap', count: r.count || 0 });
    else if (r.t === 'ctx') { if (last?.t === 'ctx') last.lines.push(r.text); else parts.push({ t: 'ctx', lines: [r.text] }); } else {
      const change = last?.t === 'change' ? last : parts[parts.push({ t: 'change', del: [], add: [] }) - 1];
      change[r.t].push(r.text);
    }
  }
  const part = (kind, text, pieces) => el('div', { className: `diff-part ${kind}` }, el('b', { className: 'diff-label' }, DIFF_WORDS[kind]),
    el('pre', {}, el(kind === 'del' ? 'del' : 'ins', {}, ...(pieces ? pieces.map((p) => (p.on ? el('span', { className: 'diff-word' }, p.text) : p.text)) : [text]))));
  const children = [];
  for (const p of parts) {
    if (p.t === 'ctx') children.push(el('pre', { className: 'diff-ctx' }, p.lines.join('\n')));
    else if (p.t === 'gap') children.push(el('p', { className: 'diff-gap' }, p.count ? `${p.count === 1 ? '1 line' : `${p.count} lines`} with no change` : 'Lines with no change'));
    else {
      const del = p.del.join('\n');
      const add = p.add.join('\n');
      const words = p.del.length && p.add.length ? diffWords(del, add) : null;
      if (p.del.length) children.push(part('del', del, words?.del));
      if (p.add.length) children.push(part('add', add, words?.add));
    }
  }
  const box = el('div', { className: 'diff' }, ...children);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', diffSummary(rows));
  return box;
}

// One line of plain text for a memo in a list (the Inbox, the Agents page): the first line of the first block that has
// text, with no Markdown marks.
export function summary(text, max = 140) {
  for (const block of parse(text)) {
    const first = block.items?.[0];
    const spans = block.spans || (Array.isArray(first) ? first : first?.spans) || [];
    const line = spans.map((s) => s.text || s.alt || '').join('').split('\n')[0].replace(/\s+/g, ' ').trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return '';
}

// The check boxes of a text, in order: [{ n, on, line }]. The server uses this to change one box.
export function checkBoxes(text) {
  return parse(text).flatMap((block) => (block.checks || []).filter(Boolean));
}

// The text with box n set to on or off. null if the text has no box n.
export function setCheckBox(text, n, on) {
  const box = checkBoxes(text).find((b) => b.n === n);
  if (!box) return null;
  const lines = String(text).split('\n');
  lines[box.line] = lines[box.line].replace(/^(\s*[-*]\s+)\[[ xX]\]/, `$1[${on ? 'x' : ' '}]`);
  return lines.join('\n');
}

// Puts a text on the clipboard and gives true if that worked. The clipboard interface needs a secure page and,
// in some browsers, permission; where it is not there or fails, a hidden field and the old copy command do the work.
// env: the window, for tests.
export async function copyText(text, env = globalThis) {
  try {
    if (env.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* try the old way */ }
  const doc = env.document;
  if (!doc?.execCommand) return false;
  const field = doc.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  doc.body.append(field);
  field.select();
  let ok = false;
  try { ok = doc.execCommand('copy'); } catch { ok = false; }
  field.remove();
  return ok;
}

export const COPIED_MS = 1200; // how long the check mark shows

// A small icon in the corner that copies `text` exactly as it is in the memo. The style sheet draws the icon
// (two sheets), and a check mark for a moment after the copy. The words are for a screen reader and for the pointer.
function copyButton(el, text) {
  const button = el('button', { type: 'button', className: 'copy', title: 'Copy' });
  button.setAttribute('aria-label', 'Copy this text');
  let timer;
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    const ok = await copyText(text);
    button.classList.toggle('copied', ok);
    button.classList.toggle('failed', !ok);
    button.title = ok ? 'Copied' : 'Not copied';
    button.setAttribute('aria-label', ok ? 'Copied' : 'The text was not copied');
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.classList.remove('copied');
      button.classList.remove('failed');
      button.title = 'Copy';
      button.setAttribute('aria-label', 'Copy this text');
    }, COPIED_MS);
  });
  return button;
}

// A paperclip icon: a copy of the inline SVG in the page (<template id="paperclip">). With no template, a text glyph.
// It is decoration: the caller gives the label.
export function paperclip(className = 'clip') {
  const svg = document.getElementById('paperclip')?.content.firstElementChild?.cloneNode(true);
  const node = svg || Object.assign(document.createElement('span'), { textContent: '\u{1F4CE}' });
  node.setAttribute('class', className);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// el: the element function of common.js. Returns the list of nodes for the text.
// A code block and a quote get a copy button. Inline code and the frame of an html block do not.
// options.onCheck(n, on): called when the reader changes a check box. Without it the boxes are read-only.
// options.html: show html blocks in a frame. options.vars: the page colors for the frame.
export function render(text, el, { html = false, vars = '', onCheck = null } = {}) {
  const TAG = { b: 'strong', i: 'em', code: 'code' };
  const node = (span) => {
    if (span.t === 'text') return span.text;
    if (span.t === 'a') return el('a', { href: span.href, target: '_blank', rel: 'noopener noreferrer' }, span.text);
    if (span.t === 'code') return el('code', {}, span.text);
    // A rule document of the System page (memo 1513). The Inbox opens it in a dialog (ui/skillmodal.js takes the
    // click on an a.doc-link); on a page with no dialog the address opens the file in the System page.
    if (span.t === 'doc') return el('a', { href: span.href, className: 'doc-link', title: 'Open this rule document: its text, and its latest change' }, span.text);
    if (span.t === 'file') {
      // A download link. The page gets the file with the token on a click (loadImages in common.js).
      // The link text is the file name; the kind is a small label that a screen reader skips.
      // A paperclip mark first: a file is never shown as an image.
      const link = el('a', { href: `/api/file/${span.name}`, className: 'file', download: span.text },
        paperclip(), el('span', { className: 'file-kind' }, span.kind), span.text);
      link.children[1].setAttribute('aria-hidden', 'true');
      link.dataset.file = span.name;
      return link;
    }
    if (span.t === 'video') {
      // A download link too, with a line about its time: "deleted in 2 days", or "deleted" (then the link is no link).
      // The page fills the state in from the server (loadVideos in common.js).
      const link = el('a', { href: `/api/video/${span.name}`, className: 'file video', download: span.text },
        paperclip(), el('span', { className: 'file-kind' }, span.kind), span.text, el('span', { className: 'file-state' }, ''));
      link.children[1].setAttribute('aria-hidden', 'true');
      link.dataset.video = span.name;
      return link;
    }
    if (span.t === 'img') {
      // The page gets the file with the token later (loadImages in common.js).
      const img = el('img', { alt: span.alt });
      img.dataset.image = span.name;
      return img;
    }
    // Bold and italic text can contain code and links, for example **the `--ax` hook**.
    return el(TAG[span.t], {}, ...inline(span.text).map(node));
  };
  const blocks = parse(text, { html });
  const docs = swapDocs(blocks);
  return blocks.map((block, at) => {
    if (block.type === 'html') return makeFrame(frameDocument(block.text, vars), 'Content from the memo');
    // The icon is in the top right corner of the box. The code keeps space at the right of its first lines for it.
    if (block.type === 'diff') return diffView(block.rows, el);
    if (block.type === 'old' || block.type === 'new') {
      // The label is text of the page, so a screen reader says which of the two texts this is; the tint is the same
      // thing for the eye. The new text has a copy button for exactly its text; the old text is not for copying.
      // With a line range and a rule document in the memo (memo 1527), the range is a link: it opens that document at
      // those lines. On a page with no dialog it is the plain link to the document.
      let label = [swapLabel(block.type, block.lines)];
      if (block.lines && docs[at]) {
        const range = rangeWords(block.lines);
        const jump = el('a', { href: docs[at], className: 'doc-link swap-goto', title: `Open the document at ${range.toLowerCase()}` }, range);
        jump.setAttribute('data-lines', `${block.lines.from}-${block.lines.to}`);
        label = [`${SWAP_WORDS[block.type]} · `, jump];
      }
      const box = el('div', { className: `swap ${block.type}` }, el('b', { className: 'swap-label' }, ...label),
        block.type === 'new' ? copyButton(el, block.text) : '', el('pre', {}, el('code', {}, block.text)));
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', swapLabel(block.type, block.lines));
      return box;
    }
    if (block.type === 'pre') return el('div', { className: 'code' }, copyButton(el, block.text), el('pre', {}, el('code', {}, block.text)));
    if (block.type === 'table') {
      const row = (tag, list) => el('tr', {}, ...list.map((spans) => el(tag, {}, ...spans.map(node))));
      // The wrapper lets a wide table scroll inside the memo on a phone.
      return el('div', { className: 'table' }, el('table', {}, el('thead', {}, row('th', block.head)), el('tbody', {}, ...block.rows.map((r) => row('td', r)))));
    }
    if (block.checks) {
      return el('ul', { className: 'tasks' }, ...block.items.map((spans, k) => {
        const check = block.checks[k];
        if (!check) return el('li', {}, ...spans.map(node));
        const box = el('input', { type: 'checkbox', checked: check.on, disabled: !onCheck });
        if (onCheck) box.addEventListener('change', () => onCheck(check.n, box.checked, box));
        return el('li', { className: 'task' }, el('label', {}, box, ' ', ...spans.map(node)));
      }));
    }
    if (block.type === 'ul' || block.type === 'ol') return el(block.type, {}, ...block.items.map((spans) => el('li', {}, ...spans.map(node))));
    if (block.type === 'quote') return el('blockquote', {}, copyButton(el, block.text), ...block.spans.map(node));
    return el({ p: 'p', h: 'h3' }[block.type], {}, ...block.spans.map(node));
  });
}
