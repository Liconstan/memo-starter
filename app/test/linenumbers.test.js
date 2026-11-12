// Memo 1527: line numbers in the editor of a rule document, "Go to line", and the line range of an old or new block
// of a memo as a link that opens the document at those lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeApp, ROOT } from './helpers.js';
import { rowsOf, lineCount, lineStart, lineAt, parseGoto, gotoTarget, lineTops, gutterDigits, numberedEditor } from '../ui/linenumbers.js';
import { parse, render, swapDocs, rangeWords } from '../ui/markdown.js';

const SKILL = '---\nname: email-reply-drafts\ndescription: Draft a reply.\n---\n\n# Email reply drafts\n\nFirst check the sent mail.\n\n- one\n- two\n';

test('the numbers of the editor are those of grep -n: line 1 is the first line, the frontmatter counts, and a last newline adds no line', () => {
  // The file on the disk, numbered by grep itself.
  const path = join(mkdtempSync(join(tmpdir(), 'memo-lines-')), 'SKILL.md');
  writeFileSync(path, SKILL);
  const grep = execFileSync('grep', ['-n', '', path], { encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => { const at = l.indexOf(':'); return [Number(l.slice(0, at)), l.slice(at + 1)]; });
  const rows = rowsOf(SKILL);
  assert.equal(lineCount(SKILL), grep.length);
  assert.equal(lineCount(SKILL), 11);
  for (const [n, text] of grep) {
    assert.equal(rows[n - 1], text, `row ${n} of the editor is line ${n} of grep`);
    // The cursor at the start of line n is in line n, and the text from there starts with the line.
    assert.equal(lineAt(SKILL, lineStart(SKILL, n)), n);
    assert.ok(SKILL.slice(lineStart(SKILL, n)).startsWith(text));
  }
  assert.deepEqual([rows[0], rows[1], rows[3], rows[5]], ['---', 'name: email-reply-drafts', '---', '# Email reply drafts']);
  // The editor has one more row after the last newline, where the cursor can stand: it is no line of the file.
  assert.equal(rows.length, 12);
  assert.equal(rows.at(-1), '');
});

test('the count of the lines: with and with no last newline, empty lines, an empty text', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a'), 1);
  assert.equal(lineCount('a\n'), 1);
  assert.equal(lineCount('a\nb'), 2);
  assert.equal(lineCount('a\n\n\nb\n'), 4);
  assert.equal(lineCount('\n'), 1);
  assert.equal(lineCount(null), 0);
  assert.deepEqual(rowsOf('a\n\nb'), ['a', '', 'b']);
  // A long line is one line, however many rows it wraps onto.
  assert.equal(lineCount(`${'word '.repeat(400)}\nnext\n`), 2);
});

test('the start of a line and the line of a place in the text', () => {
  const text = 'ab\n\ncdef\ng';
  assert.deepEqual([1, 2, 3, 4].map((n) => lineStart(text, n)), [0, 3, 4, 9]);
  // Outside the text: the nearest row.
  assert.equal(lineStart(text, 0), 0);
  assert.equal(lineStart(text, 99), 9);
  assert.equal(lineStart(text, 'x'), 0);
  assert.deepEqual([0, 2, 3, 4, 8, 9, 10, 500].map((at) => lineAt(text, at)), [1, 1, 2, 3, 3, 4, 4, 4]);
});

test('what the Go to line field takes: a number, a range, the words of a memo', () => {
  assert.deepEqual(parseGoto('113'), { from: 113, to: 113 });
  assert.deepEqual(parseGoto('  113 '), { from: 113, to: 113 });
  assert.deepEqual(parseGoto('113-115'), { from: 113, to: 115 });
  assert.deepEqual(parseGoto('113 to 115'), { from: 113, to: 115 });
  assert.deepEqual(parseGoto('113–115'), { from: 113, to: 115 });
  assert.deepEqual(parseGoto('lines 113, 115'), { from: 113, to: 115 });
  assert.deepEqual(parseGoto('Line 7'), { from: 7, to: 7 });
  assert.deepEqual(parseGoto('115-113'), { from: 113, to: 115 }, 'a range the wrong way round');
  assert.deepEqual(parseGoto('113:4'), { from: 113, to: 113 }, 'a line and a column, as grep and an editor write it');
  for (const bad of ['', ' ', 'abc', '0', '-3', '1.5', '12abc', '1 2 3', '99999999', null, undefined]) assert.equal(parseGoto(bad), null, `not a line: ${bad}`);
});

test('Go to line: the place of the cursor and the words for her; past the end goes to the last line and says so', () => {
  const text = Array.from({ length: 240 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const one = gotoTarget('113', text);
  assert.deepEqual([one.from, one.to, one.words], [113, 113, 'Line 113 of 240.']);
  assert.ok(text.slice(one.start).startsWith('line 113\n'));
  assert.equal(text[one.start - 1], '\n', 'the cursor is at the start of the line');
  const range = gotoTarget('113-115', text);
  assert.deepEqual([range.from, range.to, range.words, range.start], [113, 115, 'Lines 113 to 115 of 240.', one.start]);
  assert.deepEqual(gotoTarget({ from: 113, to: 115 }, text), range);
  assert.equal(gotoTarget('1', text).start, 0);
  // A range that ends past the end stops at the last line.
  assert.deepEqual([gotoTarget('239-300', text).to, gotoTarget('239-300', text).words], [240, 'Lines 239 to 240 of 240.']);
  const past = gotoTarget('999', text);
  assert.deepEqual([past.from, past.to, past.words], [240, 240, 'This text has only 240 lines. You are at line 240, the last one.']);
  assert.ok(text.slice(past.start).startsWith('line 240'));
  assert.equal(gotoTarget('2', 'only').words, 'This text has only 1 line. You are at line 1, the last one.');
  // Nothing to go to: words, and no place.
  assert.deepEqual(gotoTarget('abc', text), { error: 'Type the number of a line, for example 113.' });
  assert.deepEqual(gotoTarget('', text), { error: 'Type the number of a line, for example 113.' });
  assert.deepEqual(gotoTarget('1', ''), { error: 'This text is empty: it has no lines.' });
});

test('the top of each line from the heights: a wrapped line moves the numbers after it down by its rows', () => {
  // Line 2 wraps onto 3 rows of 20 pixels.
  assert.deepEqual(lineTops([20, 60, 20, 20]), [0, 20, 80, 100, 120]);
  assert.deepEqual(lineTops([]), [0]);
  assert.deepEqual([1, 9, 10, 99, 100, 1234].map(gutterDigits), [2, 2, 2, 2, 3, 4]);
});

// A small element function with what the editor uses of a page.
function fakeEl(tag, props = {}, ...children) {
  const node = { tag, ...props, children, handlers: {}, attributes: {}, style: {}, classes: new Set(String(props.className || '').split(' ').filter(Boolean)) };
  node.addEventListener = (name, fn) => { node.handlers[name] = fn; };
  node.setAttribute = (name, value) => { node.attributes[name] = value; };
  node.classList = { add: (c) => node.classes.add(c), remove: (c) => node.classes.delete(c), toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)) };
  node.querySelectorAll = () => [];
  return node;
}
const find = (nodes, test, out = []) => {
  for (const n of nodes) if (n && typeof n === 'object') { if (test(n)) out.push(n); find(n.children || [], test, out); }
  return out;
};
const textOf = (n) => (typeof n === 'string' ? n : (n?.children || []).map(textOf).join(''));

test('the editor node: a labelled Go to line field, a gutter that a screen reader skips, and the same textarea; Enter and Go move the cursor', () => {
  const area = fakeEl('textarea', { className: 'editor', value: 'a\nbb\nccc\n' });
  const calls = [];
  area.focus = (o) => calls.push(['focus', o]);
  area.setSelectionRange = (a, b) => calls.push(['select', a, b]);
  const editor = numberedEditor(area, fakeEl);
  const all = find([editor.node], () => true);
  assert.ok(all.includes(area), 'the textarea is the same element, so a save reads its value as before');
  const [gutter] = find([editor.node], (n) => n.className === 'ln-gutter');
  assert.equal(gutter.attributes['aria-hidden'], 'true');
  for (const name of ['ln-mirror', 'ln-ruler', 'ln-flash']) assert.equal(find([editor.node], (n) => n.className === name)[0].attributes['aria-hidden'], 'true', name);
  const [field] = find([editor.node], (n) => n.tag === 'input');
  const [label] = find([editor.node], (n) => n.tag === 'label');
  assert.equal(textOf(label), 'Go to line');
  assert.equal(label.htmlFor, field.id);
  assert.ok(field.id);
  assert.equal(field.inputMode, 'numeric');
  const [status] = find([editor.node], (n) => n.className === 'ln-status');
  assert.equal(status.attributes.role, 'status');
  assert.equal(field.attributes['aria-describedby'], status.id);
  const [go] = find([editor.node], (n) => n.tag === 'button');
  assert.equal(textOf(go), 'Go');
  // Enter in the field: the cursor goes to the start of line 3, and the words say where she is. The key does not
  // reach the page behind.
  field.value = '3';
  let stopped = 0;
  field.handlers.keydown({ key: 'Enter', preventDefault: () => { stopped++; }, stopPropagation: () => { stopped++; } });
  assert.equal(stopped, 2);
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['select', 5, 5]]);
  assert.equal(status.textContent, 'Line 3 of 3.');
  assert.equal(field.value, '', 'the field is empty again for the next number');
  // Another key does nothing.
  field.value = '2';
  field.handlers.keydown({ key: 'a', preventDefault: () => assert.fail(), stopPropagation: () => assert.fail() });
  assert.equal(calls.length, 2);
  // The Go button does the same as Enter (the number keys of a phone have no Enter).
  go.handlers.click();
  assert.deepEqual(calls.slice(2), [['focus', { preventScroll: true }], ['select', 2, 2]]);
  assert.equal(status.textContent, 'Line 2 of 3.');
  // Not a number: words in the status, the cursor stays, and her text stays in the field.
  field.value = 'abc';
  go.handlers.click();
  assert.equal(calls.length, 4);
  assert.equal(status.textContent, 'Type the number of a line, for example 113.');
  assert.ok(status.classes.has('bad'));
  assert.equal(field.value, 'abc');
  // From code (the link of a memo): the same.
  assert.equal(editor.goTo('1-2').words, 'Lines 1 to 2 of 3.');
  assert.ok(!status.classes.has('bad'));
  // Two editors on one page have two ids.
  const other = numberedEditor(fakeEl('textarea', { value: '' }), fakeEl);
  assert.notEqual(find([other.node], (n) => n.tag === 'input')[0].id, field.id);
});

test('the line range of an old or new block is a link to the rule document of the memo, with the lines (memo 1527)', () => {
  const text = 'I changed [the team charter](/system#file=charter:team&edit=1).\n\n```old lines 113-115\n- Ask first.\n```\n\n```new line 113\n- Ask over 50 dollars.\n```\n\nAnd in [the lessons](/system#file=lessons&edit=1):\n\n```old line 7\nx\n```\n\n```new\ny\n```';
  const blocks = parse(text);
  assert.deepEqual(swapDocs(blocks), [null, '/system#file=charter:team&edit=1', '/system#file=charter:team&edit=1', null, '/system#file=lessons&edit=1', null]);
  const nodes = render(text, fakeEl);
  const links = find(nodes, (n) => n.tag === 'a' && /swap-goto/.test(n.className));
  assert.deepEqual(links.map((a) => [a.href, a.attributes['data-lines'], textOf(a), a.className]), [
    ['/system#file=charter:team&edit=1', '113-115', 'Lines 113 to 115', 'doc-link swap-goto'],
    ['/system#file=charter:team&edit=1', '113-113', 'Line 113', 'doc-link swap-goto'],
    ['/system#file=lessons&edit=1', '7-7', 'Line 7', 'doc-link swap-goto']]);
  // The words of the label and the name of the group stay as they were.
  const boxes = find(nodes, (n) => /^swap /.test(n.className || ''));
  assert.deepEqual(boxes.map((b) => textOf(b.children[0])), ['Now (the text to replace) · Lines 113 to 115', 'New text, copy this · Line 113', 'Now (the text to replace) · Line 7', 'New text, copy this']);
  assert.equal(boxes[0].attributes['aria-label'], 'Now (the text to replace) · Lines 113 to 115');
  // The lines of the link are lines that Go to line takes.
  for (const a of links) assert.ok(parseGoto(a.attributes['data-lines']));
  // The document named after the block counts when none is named before it; a link inside bold text counts.
  assert.deepEqual(swapDocs(parse('```old line 2\nx\n```\n\n**See [the charter](/system#file=charter:main&edit=1).**')), ['/system#file=charter:main&edit=1', null]);
  // A memo with no rule document: the label is plain text, as before, and there is no link.
  const plain = render('```old lines 3-4\nx\n```', fakeEl);
  assert.deepEqual(find(plain, (n) => n.tag === 'a'), []);
  assert.equal(textOf(plain[0].children[0]), 'Now (the text to replace) · Lines 3 to 4');
  assert.deepEqual([rangeWords(null), rangeWords({ from: 2, to: 2 }), rangeWords({ from: 2, to: 9 })], ['', 'Line 2', 'Lines 2 to 9']);
});

test('the server gives the file, and the System page and the dialog use the one module', async () => {
  const r = await makeApp().app.request('/ui/linenumbers.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
  const system = readFileSync(join(ROOT, 'ui', 'system.html'), 'utf8');
  const modal = readFileSync(join(ROOT, 'ui', 'skillmodal.js'), 'utf8');
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  // A page must work with a server from before ui/linenumbers.js: it loads the file by itself and goes on without it.
  assert.match(system, /^import\('\/ui\/linenumbers\.js'\)\.then\(\(m\) => \{ lineUi = m; \}\)\.catch\(\(\) => \{\}\);$/m);
  assert.match(modal, /^import\('\.\/linenumbers\.js'\)\.then\(\(m\) => \{ lineUi = m; \}\)\.catch\(\(\) => \{\}\);$/m);
  assert.ok(!/^import [^\n]*linenumbers\.js/m.test(system) && !/^import [^\n]*linenumbers\.js/m.test(modal));
  // Each editor of the two files goes through numberedEditor: two on the System page (a file, a draft), two in the dialog.
  assert.equal(system.match(/className: 'editor'/g).length, 2);
  assert.equal(system.match(/numbered\(area\)/g).length, 2);
  assert.equal(modal.match(/className: 'editor'/g).length, 2);
  assert.equal(modal.match(/lineUi\.numberedEditor\(area, el\)/g).length, 2);
  // The link of a memo gives its lines to the dialog, and the dialog goes there.
  assert.match(modal, /lines: a\.getAttribute\('data-lines'\) \|\| ''/);
  assert.match(modal, /editor\.goTo\(lines\)/);
  // The save reads the textarea itself, as before.
  assert.match(modal, /api\('\/api\/system\/save', \{ id, text: area\.value, base: state\.hash \}\)/);
  assert.match(system, /api\('\/api\/system\/save', \{ id, text: area\.value, base: state\.hash \}\)/);
  // The look: only the color variables, so the two themes hold; the long line still wraps (no white-space: pre or
  // nowrap on the editor); less motion when the device asks for it.
  const rules = css.split('\n').filter((l) => /^\.ln-|\.swap-goto/.test(l) || /^\s+background: var\(--lo-bg\); color: var\(--lo-ink\); text-align: right/.test(l));
  assert.ok(rules.length >= 15);
  for (const rule of rules) assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(rule), `a plain color in: ${rule}`);
  assert.ok(!/\.editor[^{]*\{[^}]*white-space/.test(css));
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.ln-flash/);
});
