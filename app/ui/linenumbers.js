// Line numbers for the editor of a rule document (memo 1527): a charter, the lessons, a skill. An agent says "change
// line 113", and counts the lines as `grep -n` does: line 1 is the first line of the file, and the lines of the
// frontmatter count. The editor is a <textarea> in which a long line wraps, so the number of a line stands at the first
// row of that line and the rows it wraps onto have no number.
//
// One module for the editor of the System page (ui/system.html) and the editor in the dialog (ui/skillmodal.js):
// numberedEditor(area, el) gives the node that takes the place of the textarea. It holds a "Go to line" field, the
// gutter with the numbers at the left of the text, and the textarea itself, which stays the same element, so a save
// reads its value as before.
//
// The first part of this file is plain text work with no page, so a test can run it.

// The rows of the text as the editor has them: one for each line. A text that ends with a newline has one more row,
// the empty one after it, where the cursor can stand.
export const rowsOf = (text) => String(text ?? '').split('\n');

// The count of the lines of the file, as `grep -c ''` and `wc -l` give it: a last line with no newline counts, and the
// empty row after a last newline does not. An empty text has 0 lines.
export function lineCount(text) {
  const rows = rowsOf(text);
  return rows.at(-1) === '' ? rows.length - 1 : rows.length;
}

// The place in the text where line n starts (n from 1), for the cursor. A number outside the text gives the nearest row.
export function lineStart(text, n) {
  const rows = rowsOf(text);
  const line = Math.min(Math.max(1, Math.trunc(Number(n)) || 1), rows.length);
  let at = 0;
  for (let i = 0; i < line - 1; i++) at += rows[i].length + 1;
  return at;
}

// The number of the line that holds a place in the text (the cursor), from 1.
export function lineAt(text, offset) {
  const all = String(text ?? '');
  const end = Math.min(Math.max(0, Math.trunc(Number(offset)) || 0), all.length);
  return all.slice(0, end).split('\n').length;
}

// What she typed in the field, or what a memo names: "113", "113-115", "113 to 115", "line 113", "lines 113, 115",
// "113:4" (a line and a column: the column is left out). The result is { from, to } with from <= to, or null.
const GOTO = /^\s*(?:lines?\s*)?(\d{1,7})(?:\s*(?:-|–|,|to)\s*(\d{1,7})|:\d{1,7})?\s*$/i;
export function parseGoto(input) {
  const m = GOTO.exec(String(input ?? ''));
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  if (a < 1 || b < 1) return null;
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

// Where "Go to line" goes in a text: { from, to, start, words }, or { error } with the words for her. start is the
// place of the cursor, the start of the line `from`. A number past the end goes to the last line and says so.
export function gotoTarget(input, text) {
  const asked = typeof input === 'object' && input ? parseGoto(`${input.from}-${input.to ?? input.from}`) : parseGoto(input);
  if (!asked) return { error: 'Type the number of a line, for example 113.' };
  const count = lineCount(text);
  if (!count) return { error: 'This text is empty: it has no lines.' };
  const total = count === 1 ? '1 line' : `${count} lines`;
  if (asked.from > count) return { from: count, to: count, start: lineStart(text, count), words: `This text has only ${total}. You are at line ${count}, the last one.` };
  const to = Math.min(asked.to, count);
  const words = to === asked.from ? `Line ${asked.from} of ${count}.` : `Lines ${asked.from} to ${to} of ${count}.`;
  return { from: asked.from, to, start: lineStart(text, asked.from), words };
}

// The top of each line in the editor, from the height of each line (a wrapped line is as high as its rows together).
// tops[i] is the top of line i + 1; the last entry is the height of the whole text.
export function lineTops(heights) {
  const tops = [0];
  for (const h of heights) tops.push(tops.at(-1) + h);
  return tops;
}

// The count of the digits of the largest number, at least 2, so the gutter does not change width at line 10.
export const gutterDigits = (rows) => Math.max(2, String(Math.max(1, rows)).length);

// ---------- the page ----------
let serial = 0;
// The styles of the textarea that decide where a line wraps and how high a row is.
const COPIED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'lineHeight', 'letterSpacing', 'wordSpacing',
  'tabSize', 'textIndent', 'textTransform', 'whiteSpace', 'overflowWrap', 'wordBreak', 'direction', 'paddingLeft', 'paddingRight'];
const HIGHLIGHT_MS = 2200;

// area: the <textarea class="editor">. el: the element function of ui/common.js. The result is { node, goTo, refresh }:
// node goes into the page where the textarea went; goTo(lines) moves to a line ("113", "113-115", { from, to }) and
// gives the result of gotoTarget; refresh() is for a caller that sets the value of the textarea itself.
export function numberedEditor(area, el) {
  const id = `ln-${++serial}`;
  // The gutter is for the eye only. A screen reader reads the text of the textarea, and has "Go to line" for a number.
  const numbers = el('div', { className: 'ln-numbers' });
  const gutter = el('div', { className: 'ln-gutter' }, numbers);
  gutter.setAttribute('aria-hidden', 'true');
  // The mirror: a block with the width and the font of the textarea, not visible, in which each line is one element.
  // The height of that element is the height the line has in the textarea, with its wrapped rows.
  const mirror = el('div', { className: 'ln-mirror' });
  mirror.setAttribute('aria-hidden', 'true');
  // The ruler: one character in the font of the editor. Its size changes when the size of the letters changes.
  const ruler = el('span', { className: 'ln-ruler' }, '0');
  ruler.setAttribute('aria-hidden', 'true');
  const flash = el('div', { className: 'ln-flash', hidden: true });
  flash.setAttribute('aria-hidden', 'true');
  const box = el('div', { className: 'ln-box' }, gutter, area, mirror, ruler, flash);

  const field = el('input', { type: 'text', id, className: 'ln-field', inputMode: 'numeric', autocomplete: 'off', placeholder: '113', title: 'The number of a line, or a range such as 113-115. Then press Enter.' });
  const status = el('span', { className: 'ln-status', id: `${id}-status` });
  status.setAttribute('role', 'status');
  field.setAttribute('aria-describedby', `${id}-status`);
  const go = el('button', { type: 'button', className: 'ln-go', title: 'Move to that line in the text below' }, 'Go');
  const bar = el('div', { className: 'ln-goto' }, el('label', { htmlFor: id }, 'Go to line'), field, go, status);
  const node = el('div', { className: 'ln-editor' }, bar, box);

  let heights = [];
  let tops = [0];
  let styleKey = '';
  let padTop = 0;
  let cache = new Map(); // the text of a line -> its height, for the width and the font of now
  let marked = null; // { from, to } while a line is highlighted
  let timer = null;

  // The numbers move with the text, and so does the highlight.
  function follow() {
    numbers.style.transform = `translateY(${-area.scrollTop}px)`;
    if (!marked) return;
    // The band over the lines, cut to the part of the text that shows.
    const top = padTop + tops[marked.from - 1] - area.scrollTop;
    const bottom = padTop + tops[marked.to] - area.scrollTop;
    const from = Math.max(top, 0);
    const to = Math.min(bottom, area.clientHeight);
    flash.hidden = to <= from;
    flash.style.top = `${area.offsetTop + area.clientTop + from}px`;
    flash.style.height = `${Math.max(0, to - from)}px`;
    flash.style.left = `${area.offsetLeft + area.clientLeft}px`;
    flash.style.width = `${area.clientWidth}px`;
  }

  function measure() {
    // Not on the page, or not shown (a closed part of the page): nothing to measure yet. The observer below calls
    // again when the textarea gets a size.
    if (!area.isConnected || !area.clientWidth) return false;
    // A row of whole pixels: with a part of a pixel in the height of a row, the textarea and the mirror round it in
    // different ways, and the numbers drift from their lines far down a long text. The ruler has the line height of
    // the style sheet, so this follows a new size of the letters.
    const natural = parseFloat(getComputedStyle(ruler).lineHeight);
    const whole = natural ? `${Math.round(natural)}px` : '';
    if (area.style.lineHeight !== whole) area.style.lineHeight = whole;
    const cs = getComputedStyle(area);
    // Safari on an iPhone or iPad keeps 3 pixels free at each side of the text of a textarea, inside its padding.
    const inner = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)) ? 3 : 0;
    const key = [area.clientWidth, inner, ...COPIED.map((p) => cs[p])].join('|');
    if (key !== styleKey) {
      styleKey = key;
      cache = new Map();
      for (const p of COPIED) mirror.style[p] = cs[p];
      mirror.style.paddingLeft = `${parseFloat(cs.paddingLeft) + inner}px`;
      mirror.style.paddingRight = `${parseFloat(cs.paddingRight) + inner}px`;
      mirror.style.width = `${area.clientWidth}px`;
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing']) gutter.style[p] = cs[p];
      padTop = parseFloat(cs.paddingTop) || 0;
      numbers.style.paddingTop = `${area.clientTop + padTop - gutter.clientTop}px`;
    }
    const rows = rowsOf(area.value);
    const unknown = [...new Set(rows)].filter((row) => !cache.has(row));
    if (unknown.length) {
      if (cache.size > 20000) cache = new Map();
      // An empty line is one row high: a character with no width gives it its height.
      const probes = unknown.map((row) => el('div', {}, row || '​'));
      mirror.replaceChildren(...probes);
      unknown.forEach((row, i) => cache.set(row, probes[i].getBoundingClientRect().height));
      mirror.replaceChildren();
    }
    const next = rows.map((row) => cache.get(row));
    const same = next.length === heights.length && next.every((h, i) => h === heights[i]);
    heights = next;
    tops = lineTops(heights);
    if (!same || numbers.childElementCount !== rows.length) {
      gutter.style.width = `${gutterDigits(rows.length)}ch`;
      numbers.replaceChildren(...heights.map((h, i) => {
        const n = el('div', { className: marked && i + 1 >= marked.from && i + 1 <= marked.to ? 'ln-n on' : 'ln-n' }, String(i + 1));
        n.style.height = `${h}px`;
        return n;
      }));
    }
    follow();
    return true;
  }

  function unmark() {
    clearTimeout(timer);
    marked = null;
    flash.hidden = true;
    flash.classList.remove('fade');
    for (const n of numbers.querySelectorAll('.ln-n.on')) n.classList.remove('on');
  }

  function goTo(lines) {
    const target = gotoTarget(lines, area.value);
    status.textContent = target.error || target.words;
    status.classList.toggle('bad', Boolean(target.error));
    if (target.error) return target;
    unmark();
    area.focus({ preventScroll: true });
    area.setSelectionRange(target.start, target.start);
    if (!measure()) return target;
    // The line comes a third of the way down the box, so the lines before it show too.
    const place = () => { area.scrollTop = Math.max(0, tops[target.from - 1] - area.clientHeight / 3); };
    place();
    marked = { from: target.from, to: target.to };
    for (let i = target.from; i <= target.to; i++) numbers.children[i - 1]?.classList.add('on');
    follow();
    // The page, or the dialog, moves too when the line is outside the window.
    if (!flash.hidden) flash.scrollIntoView({ block: 'nearest' });
    // Some browsers move the text to the cursor a moment after the focus: put the line back.
    requestAnimationFrame(() => { if (marked) { place(); follow(); } });
    timer = setTimeout(() => { flash.classList.add('fade'); timer = setTimeout(unmark, 600); }, HIGHLIGHT_MS - 600);
    return target;
  }

  const submit = () => { if (!goTo(field.value).error) field.value = ''; };
  field.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    submit();
  });
  go.addEventListener('click', submit);
  area.addEventListener('input', measure);
  area.addEventListener('scroll', follow);
  // A new size of the textarea (the window, a turn of the phone, her drag of its corner, the part of the page that
  // opens) and a new size of the letters (the zoom of the page, the text size of the device) both give a new place
  // to each line. The ruler has the font of the textarea from the style sheet, so it changes size with the letters.
  if (typeof ResizeObserver === 'function') {
    const watch = new ResizeObserver(() => measure());
    watch.observe(area);
    watch.observe(ruler);
  }
  globalThis.document?.fonts?.ready?.then(() => { styleKey = ''; measure(); }).catch(() => {});

  return { node, goTo, refresh: measure };
}
