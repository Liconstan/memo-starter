import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, inline, frameDocument, checkBoxes, setCheckBox, summary, render, copyText, diffRows, diffLines, diffHunks, diffWords, diffSummary, DOC_LINK, swapLabel, SWAP_WORDS, docLinkOf } from '../ui/markdown.js';
import { makeApp } from './helpers.js';

test('plain text is one paragraph and keeps its line breaks', () => {
  assert.deepEqual(parse('Line one.\nLine two.'), [{ type: 'p', spans: [{ t: 'text', text: 'Line one.\nLine two.' }] }]);
});

test('a blank line starts a new paragraph', () => {
  assert.deepEqual(parse('One.\n\n\nTwo.').map((b) => b.spans[0].text), ['One.', 'Two.']);
});

test('bold, italic, and code', () => {
  assert.deepEqual(inline('A **bold** and *italic* and `code` word.'), [
    { t: 'text', text: 'A ' }, { t: 'b', text: 'bold' }, { t: 'text', text: ' and ' }, { t: 'i', text: 'italic' },
    { t: 'text', text: ' and ' }, { t: 'code', text: 'code' }, { t: 'text', text: ' word.' },
  ]);
});

test('marks inside code stay as text', () => {
  assert.deepEqual(inline('`a **b** c`'), [{ t: 'code', text: 'a **b** c' }]);
});

test('a lone asterisk and snake_case stay as text', () => {
  assert.deepEqual(inline('2 * 3 and my_file_name'), [{ t: 'text', text: '2 * 3 and my_file_name' }]);
});

test('a link with text, and a bare web address', () => {
  assert.deepEqual(inline('See [the page](https://example.org/a) or https://example.com/x?y=1.'), [
    { t: 'text', text: 'See ' }, { t: 'a', text: 'the page', href: 'https://example.org/a' }, { t: 'text', text: ' or ' },
    { t: 'a', text: 'https://example.com/x?y=1', href: 'https://example.com/x?y=1' }, { t: 'text', text: '.' },
  ]);
});

test('a link that is not http or https stays as text', () => {
  for (const text of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](/inbox)']) {
    assert.ok(inline(text).every((s) => s.t === 'text'), text);
  }
});

test('bullet lists and numbered lists', () => {
  assert.deepEqual(parse('Options:\n- Keep **it**\n- Remove it\n\n1. First\n2) Second'), [
    { type: 'p', spans: [{ t: 'text', text: 'Options:' }] },
    { type: 'ul', items: [[{ t: 'text', text: 'Keep ' }, { t: 'b', text: 'it' }], [{ t: 'text', text: 'Remove it' }]] },
    { type: 'ol', items: [[{ t: 'text', text: 'First' }], [{ t: 'text', text: 'Second' }]] },
  ]);
});

test('an indented line continues the list item before it', () => {
  assert.deepEqual(parse('- One\n  more\n- Two')[0].items.map((i) => i[0].text), ['One\nmore', 'Two']);
});

test('headings, a quote, and a code block', () => {
  assert.deepEqual(parse('## Decision\n> quoted *text*\n> more\n```sh\nnpm test **x**\n\n- not a list\n```\nAfter.'), [
    { type: 'h', spans: [{ t: 'text', text: 'Decision' }] },
    { type: 'quote', spans: [{ t: 'text', text: 'quoted ' }, { t: 'i', text: 'text' }, { t: 'text', text: '\nmore' }], text: 'quoted *text*\nmore' },
    { type: 'pre', text: 'npm test **x**\n\n- not a list' },
    { type: 'p', spans: [{ t: 'text', text: 'After.' }] },
  ]);
});

test('a code block with no end takes the rest of the text', () => {
  assert.deepEqual(parse('```\nline'), [{ type: 'pre', text: 'line' }]);
});

test('HTML in the text stays text', () => {
  assert.deepEqual(parse("<b>x</b> <script>alert(1)</script>"), [{ type: 'p', spans: [{ t: 'text', text: "<b>x</b> <script>alert(1)</script>" }] }]);
});

test('empty text gives no blocks', () => assert.deepEqual(parse(''), []));

test('the server gives the markdown file to the pages', async () => {
  const r = await makeApp().app.request('/ui/markdown.js');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /javascript/);
});

test('a table with a header row', () => {
  assert.deepEqual(parse('Before.\n| Option | Cost |\n|---|:--:|\n| **A** | 5 |\n| B \\| C | `x` | extra |\n| short |\nAfter.'), [
    { type: 'p', spans: [{ t: 'text', text: 'Before.' }] },
    { type: 'table',
      head: [[{ t: 'text', text: 'Option' }], [{ t: 'text', text: 'Cost' }]],
      rows: [
        [[{ t: 'b', text: 'A' }], [{ t: 'text', text: '5' }]],
        [[{ t: 'text', text: 'B | C' }], [{ t: 'code', text: 'x' }]],
        [[{ t: 'text', text: 'short' }], []],
      ] },
    { type: 'p', spans: [{ t: 'text', text: 'After.' }] },
  ]);
});

test('a table needs no pipes at the ends of its lines', () => {
  const [table] = parse('a | b\n--- | ---\n1 | 2');
  assert.equal(table.type, 'table');
  assert.deepEqual(table.rows, [[[{ t: 'text', text: '1' }], [{ t: 'text', text: '2' }]]]);
});

test('a line with a pipe and no separator line stays a paragraph', () => {
  assert.deepEqual(parse('a | b\nc | d').map((b) => b.type), ['p']);
  assert.deepEqual(parse('yes | no\n---').map((b) => b.type), ['p']);
});

test('an image that Memo stores', () => {
  assert.deepEqual(inline('See ![the new page](image:0123456789abcdef.png) here.'), [
    { t: 'text', text: 'See ' }, { t: 'img', alt: 'the new page', name: '0123456789abcdef.png' }, { t: 'text', text: ' here.' },
  ]);
});

test('an image on the internet becomes a link and does not load', () => {
  assert.deepEqual(inline('![chart](https://example.com/c.png)'), [{ t: 'a', text: 'Image: chart', href: 'https://example.com/c.png' }]);
  assert.deepEqual(inline('![](https://example.com/c.png)'), [{ t: 'a', text: 'Image', href: 'https://example.com/c.png' }]);
});

test('an image with a wrong name or address stays text', () => {
  for (const text of ['![x](image:../../.env)', '![x](image:abc.svg)', '![x](file:///etc/passwd)', '![x](javascript:alert(1))']) {
    assert.ok(inline(text).every((s) => s.t === 'text'), text);
  }
});

test('an html block becomes a frame only when the caller permits it', () => {
  const text = 'A chart:\n```html\n<svg><rect width="10" height="10"/></svg>\n<script>draw()</script>\n```\nEnd.';
  const html = '<svg><rect width="10" height="10"/></svg>\n<script>draw()</script>';
  assert.deepEqual(parse(text, { html: true }).map((b) => b.type), ['p', 'html', 'p']);
  assert.equal(parse(text, { html: true })[1].text, html);
  assert.deepEqual(parse(text)[1], { type: 'pre', text: html });
  assert.deepEqual(parse(text, { html: false })[1], { type: 'pre', text: html });
});

test('HTML outside an html block stays text also when frames are permitted', () => {
  assert.deepEqual(parse('<script>alert(1)</script>', { html: true }), [{ type: 'p', spans: [{ t: 'text', text: '<script>alert(1)</script>' }] }]);
  assert.equal(parse('```js\n<b>x</b>\n```', { html: true })[0].type, 'pre');
});

test('the frame document puts the network rule before the memo HTML', () => {
  const doc = frameDocument('<p id="memo">hi</p><meta http-equiv="Content-Security-Policy" content="default-src *">', '--ink:#111;--bg:#fff');
  const rule = doc.indexOf(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:">`);
  assert.ok(rule > 0 && rule < doc.indexOf('<p id="memo">'), 'the rule must be first');
  assert.ok(doc.includes('--ink:#111;--bg:#fff'));
  assert.ok(doc.includes('memoFrameHeight'));
});

test('the frame document refuses theme text that is not a list of colors', () => {
  const doc = frameDocument('<p>hi</p>', '--ink:#111}</style><script>alert(1)</script>');
  assert.ok(!doc.includes('alert(1)'));
});

test('list items with a check box', () => {
  const text = 'Pack:\n- [ ] Rain jacket\n- [x] **Hiking** shoes\n- A plain item\n\n1. [ ] a numbered item is not a box\n\n- [X] Charger';
  const blocks = parse(text);
  assert.deepEqual(blocks[1].checks, [{ n: 0, on: false, line: 1 }, { n: 1, on: true, line: 2 }, null]);
  assert.deepEqual(blocks[1].items[1], [{ t: 'b', text: 'Hiking' }, { t: 'text', text: ' shoes' }]);
  assert.equal(blocks[2].checks, undefined);
  assert.deepEqual(blocks[3].checks, [{ n: 2, on: true, line: 7 }]);
  assert.deepEqual(checkBoxes(text).map((b) => b.n), [0, 1, 2]);
});

test('a list with no check box has no checks, and a box in a code block is not a box', () => {
  assert.equal(parse('- one\n- two')[0].checks, undefined);
  assert.deepEqual(checkBoxes('```\n- [ ] in code\n```\n- [ ] real'), [{ n: 0, on: false, line: 3 }]);
});

test('setCheckBox changes one box and nothing more', () => {
  const text = '- [ ] one\n```\n- [ ] in code\n```\n* [x] two\n- [ ] three';
  assert.equal(setCheckBox(text, 1, false), '- [ ] one\n```\n- [ ] in code\n```\n* [ ] two\n- [ ] three');
  assert.equal(setCheckBox(text, 2, true), '- [ ] one\n```\n- [ ] in code\n```\n* [x] two\n- [x] three');
  assert.equal(setCheckBox(text, 0, false), text);
  assert.equal(setCheckBox(text, 3, true), null);
});

test('the summary of a memo is its first line as plain text', () => {
  assert.equal(summary('**Approve the deploy?** Reply `yes`.\nA second line.\n\nMore text.'), 'Approve the deploy? Reply yes.');
  assert.equal(summary('- [ ] Rain jacket\n- [ ] Boots'), 'Rain jacket');
  assert.equal(summary(''), '');
});

test('a long summary is cut', () => {
  const s = summary('word '.repeat(60));
  assert.equal(s.length <= 140, true);
  assert.equal(s.endsWith('…'), true);
});

// A small element function for the tests: it keeps the tag, the properties, the children, and the click handler.
function fakeEl(tag, props = {}, ...children) {
  const node = { tag, ...props, children, handlers: {}, classes: new Set() };
  node.addEventListener = (name, fn) => { node.handlers[name] = fn; };
  node.classList = { toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)), remove: (c) => node.classes.delete(c) };
  node.attributes = {};
  node.setAttribute = (name, value) => { node.attributes[name] = value; };
  return node;
}
const find = (nodes, test, out = []) => {
  for (const n of nodes) if (n && typeof n === 'object') { if (test(n)) out.push(n); find(n.children || [], test, out); }
  return out;
};

test('a code block and a quote get a copy button; inline code, a table, and a list do not', () => {
  const text = 'Run `npm test` first.\n\n```sh\nnpm test **x**\n\n  - not a list\n```\n\n> Dear Sam,\n> the *draft*.\n\n- one\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  const nodes = render(text, fakeEl);
  const buttons = find(nodes, (n) => n.className === 'copy');
  assert.equal(buttons.length, 2);
  const code = nodes.find((n) => n.className === 'code');
  assert.deepEqual(code.children.map((n) => n.tag), ['button', 'pre'], 'the button is in the box of the code');
  assert.equal(code.children[1].children[0].children[0], 'npm test **x**\n\n  - not a list');
  const quote = nodes.find((n) => n.tag === 'blockquote');
  assert.equal(quote.children[0].className, 'copy');
  assert.equal(find([nodes[0]], (n) => n.className === 'copy').length, 0, 'no button for inline code');
});

test('the copy icon copies the exact text of the block and then shows a check mark', async () => {
  const copied = [];
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied.push(t); } } }, configurable: true });
  try {
    const raw = '## Title\n\n- [ ] **bold** `code`\n    indented <b>html</b>';
    const nodes = render(`\`\`\`md\n${raw}\n\`\`\`\n\n> Dear Sam,\n> the *draft* is ready.`, fakeEl);
    const [codeButton, quoteButton] = find(nodes, (n) => n.className === 'copy');
    let stopped = false;
    await codeButton.handlers.click({ stopPropagation: () => { stopped = true; } });
    assert.deepEqual(copied, [raw], 'no change to the Markdown in the block, and no new line at the end');
    assert.ok(codeButton.classes.has('copied'), 'the icon becomes a check mark');
    assert.equal(codeButton.attributes['aria-label'], 'Copied');
    assert.deepEqual(codeButton.children, [], 'the button is an icon, with no word in it');
    assert.ok(stopped, 'a tap on the button does not select the memo');
    await quoteButton.handlers.click({ stopPropagation() {} });
    assert.equal(copied[1], 'Dear Sam,\nthe *draft* is ready.', 'the quote with no "> " marks');
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before); else delete globalThis.navigator;
  }
});

test('copyText uses the old copy command where the clipboard interface is not there or fails', async () => {
  const made = [];
  const doc = (works) => ({
    execCommand: (name) => { made.push(`exec ${name}`); return works; },
    createElement: (tag) => { const f = { tag, style: {}, setAttribute() {}, select() { made.push(`select ${f.value}`); }, remove() { made.push('remove'); } }; return f; },
    body: { append: () => made.push('append') },
  });
  assert.equal(await copyText('abc', { document: doc(true) }), true);
  assert.deepEqual(made, ['append', 'select abc', 'exec copy', 'remove']);
  // The interface is there but refuses (no permission, or a page that is not secure).
  assert.equal(await copyText('abc', { navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } }, document: doc(true) }), true);
  assert.equal(await copyText('abc', { document: doc(false) }), false);
  assert.equal(await copyText('abc', {}), false);
  let got = '';
  assert.equal(await copyText('x\ny', { navigator: { clipboard: { writeText: async (t) => { got = t; } } } }), true);
  assert.equal(got, 'x\ny');
});

test('a quote contains its copy button, so a quote of one line does not let the button hang out', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/common.css', import.meta.url), 'utf8');
  assert.match(css, /\.md blockquote:has\(\.copy\) \{ display: flow-root; \}/);
  // The copy control is an icon with no frame.
  assert.match(css, /\.md \.copy \{[^}]*border: 0; background: none;/);
});

// ---------- memo 1513: a change as removed and added lines, and a link to a rule document ----------
const textOf = (n) => (typeof n === 'string' ? n : (n?.children || []).map(textOf).join(''));

test('a diff block gives rows: - is removed, + is added, the rest is context, and the head lines of git are left out (memo 1513)', () => {
  assert.deepEqual(diffRows(' keep\n-old line\n+new line\n keep too'), [
    { t: 'ctx', text: 'keep' }, { t: 'del', text: 'old line' }, { t: 'add', text: 'new line' }, { t: 'ctx', text: 'keep too' }]);
  // The way an agent writes it by hand, with a space after each sign: the space is not part of the text.
  assert.deepEqual(diffRows('- Ask before each payment.\n+ Ask before each payment over 50 dollars.\n  The rest stays.'), [
    { t: 'del', text: 'Ask before each payment.' }, { t: 'add', text: 'Ask before each payment over 50 dollars.' }, { t: 'ctx', text: 'The rest stays.' }]);
  // A diff of git: no file names, and @@ is a gap between two places.
  const git = 'diff --git a/x.md b/x.md\nindex 1a2b3c4..5d6e7f8 100644\n--- a/x.md\n+++ b/x.md\n@@ -1,2 +1,2 @@\n one\n-two\n+2\n@@ -9 +9 @@\n-nine\n+9\n\\ No newline at end of file';
  assert.deepEqual(diffRows(git).map((r) => `${r.t}:${r.text ?? ''}`), ['ctx:one', 'del:two', 'add:2', 'gap:', 'del:nine', 'add:9']);
  // A removed list item keeps its own dash.
  assert.deepEqual(diffRows('-- an item\n+- the item'), [{ t: 'del', text: '- an item' }, { t: 'add', text: '- the item' }]);
  // Only a block with the language diff is a diff: every other block is code, as before.
  assert.deepEqual(parse('```diff\n-a\n+b\n```').map((b) => b.type), ['diff']);
  assert.deepEqual(parse('```DIFF\n-a\n```')[0].rows, [{ t: 'del', text: 'a' }]);
  assert.deepEqual(parse('```sh\n-a\n+b\n```'), [{ type: 'pre', text: '-a\n+b' }]);
  assert.deepEqual(parse('```\n-a\n```'), [{ type: 'pre', text: '-a' }]);
});

test('a diff block shows as a part "Removed:" and a part "Added:", in words and not only in colors (memo 1513)', () => {
  const nodes = render('The change:\n\n```diff\n One question per memo.\n- Ask before each payment.\n+ Ask before each payment over 50 dollars.\n```', fakeEl);
  const box = nodes[1];
  assert.equal(box.className, 'diff');
  assert.equal(box.attributes.role, 'group');
  assert.equal(box.attributes['aria-label'], 'Change: 1 line removed, 1 line added');
  assert.deepEqual(box.children.map((n) => n.className), ['diff-ctx', 'diff-part del', 'diff-part add']);
  const [, removed, added] = box.children;
  // The word comes first in each part, as text of the page: a screen reader says it before the lines.
  assert.deepEqual([removed.children[0].tag, textOf(removed.children[0])], ['b', 'Removed:']);
  assert.deepEqual([added.children[0].tag, textOf(added.children[0])], ['b', 'Added:']);
  assert.equal(textOf(removed), 'Removed:Ask before each payment.');
  assert.equal(textOf(added), 'Added:Ask before each payment over 50 dollars.');
  assert.deepEqual([removed.children[1].children[0].tag, added.children[1].children[0].tag], ['del', 'ins']);
  // The words that differ have a mark; the words that stay have none.
  assert.deepEqual(find([added], (n) => n.className === 'diff-word').map(textOf), ['payment over 50 dollars.']);
  assert.deepEqual(find([removed], (n) => n.className === 'diff-word').map(textOf), ['payment.']);
  // The text goes in as text: markup in a diff stays text, and a diff has no link and no button.
  const raw = render('```diff\n+<img src=x onerror=alert(1)> **bold** [a](https://example.org)\n```', fakeEl)[0];
  assert.equal(textOf(raw), 'Added:<img src=x onerror=alert(1)> **bold** [a](https://example.org)');
  assert.deepEqual(find([raw], (n) => ['a', 'img', 'button', 'strong'].includes(n.tag)), []);
  // Several lines of one kind are one part; a gap says that lines are left out.
  const two = render('```diff\n-a\n-b\n@@\n+c\n```', fakeEl)[0];
  assert.deepEqual(two.children.map((n) => n.className), ['diff-part del', 'diff-gap', 'diff-part add']);
  assert.equal(textOf(two.children[0]), 'Removed:a\nb');
  assert.equal(diffSummary([{ t: 'del' }, { t: 'del' }, { t: 'add' }]), 'Change: 2 lines removed, 1 line added');
});

test('the change between two texts: the lines, the lines near a change, and the words (memo 1513)', () => {
  const before = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\n';
  const after = 'one\ntwo\nthree\nfour\nFIVE\nsix\nseven\neight\nnine\nten\n';
  const rows = diffLines(before, after);
  assert.deepEqual(rows.filter((r) => r.t !== 'ctx'), [{ t: 'del', text: 'five' }, { t: 'add', text: 'FIVE' }, { t: 'add', text: 'ten' }]);
  assert.equal(rows.filter((r) => r.t === 'ctx').length, 8, 'the end of a file is no line of its own');
  assert.deepEqual(diffHunks(rows, 1).map((r) => (r.t === 'gap' ? `gap ${r.count}` : `${r.t} ${r.text}`)),
    ['gap 3', 'ctx four', 'del five', 'add FIVE', 'ctx six', 'gap 2', 'ctx nine', 'add ten']);
  assert.deepEqual(diffHunks(diffLines(before, before)), [], 'no change, no rows');
  assert.deepEqual(diffLines('', 'a\nb'), [{ t: 'del', text: '' }, { t: 'add', text: 'a' }, { t: 'add', text: 'b' }]);
  assert.deepEqual(diffLines('a\nb\nc', 'a\nc').map((r) => r.t), ['ctx', 'del', 'ctx']);
  // Two texts too long to compare line by line: all removed, then all added, and never an error.
  const long = (word) => Array.from({ length: 1600 }, (_, i) => `${word} ${i}`).join('\n');
  const big = diffLines(long('a'), long('b'));
  assert.deepEqual([big.length, big[0].t, big.at(-1).t], [3200, 'del', 'add']);
  // The words: marks where most words stay, none where the two texts share little.
  assert.deepEqual(diffWords('Send the memo on Monday.', 'Send the memo on Tuesday morning.'), {
    del: [{ text: 'Send the memo on ', on: false }, { text: 'Monday.', on: true }],
    add: [{ text: 'Send the memo on ', on: false }, { text: 'Tuesday morning.', on: true }] });
  assert.equal(diffWords('A whole new rule.', 'Nothing of it is left'), null);
});

test('a link to a rule document of the System page is a link that the Inbox opens in a dialog; other addresses stay text (memo 1513)', () => {
  for (const href of ['/system#file=charter:team&edit=1', '/system#file=charter:cloud', '/system#file=lessons&edit=1', '/system#file=lessons',
    '/system#file=skill:email-reply-drafts&edit=1', '/system#file=hand:botec']) assert.ok(DOC_LINK.test(href), href);
  for (const href of ['/system', '/system#h-skills', '/system#file=map', '/system#file=charter:', '/system#file=skill:../x', '/system#file=lessons&edit=1&x=1',
    '/inbox#file=lessons', '//evil.test/system#file=lessons', 'javascript:alert(1)', '/system#new=daily-review']) assert.ok(!DOC_LINK.test(href), href);
  assert.deepEqual(inline('I changed [the team charter](/system#file=charter:team&edit=1).'), [
    { t: 'text', text: 'I changed ' }, { t: 'doc', text: 'the team charter', href: '/system#file=charter:team&edit=1' }, { t: 'text', text: '.' }]);
  assert.deepEqual(inline('[x](/system#h-skills)'), [{ t: 'text', text: '[x](/system#h-skills)' }]);
  const [p] = render('See [the lessons](/system#file=lessons&edit=1) and [a page](https://example.org).', fakeEl);
  const [doc, web] = find([p], (n) => n.tag === 'a');
  assert.deepEqual([doc.href, doc.className, doc.target, textOf(doc)], ['/system#file=lessons&edit=1', 'doc-link', undefined, 'the lessons']);
  assert.equal(web.target, '_blank', 'a web link opens in a new tab, as before');
  assert.equal(summary('[the team charter](/system#file=charter:team&edit=1) has a new rule'), 'the team charter has a new rule');
});

// ---------- memo 1523: the text to replace and the new text ----------
test('an old block is a box "Now (the text to replace)" and a new block a box "New text, copy this" with a copy button for its text alone (memo 1523)', async () => {
  const text = 'In the charter:\n\n```old lines 113-115\n- Ask before each payment.\n+ a plus stays text\n```\n\n```new\n- Ask before each payment over 50 dollars.\n  <b>second</b> line\n```';
  assert.deepEqual(parse(text).slice(1), [
    { type: 'old', text: '- Ask before each payment.\n+ a plus stays text', lines: { from: 113, to: 115 } },
    { type: 'new', text: '- Ask before each payment over 50 dollars.\n  <b>second</b> line', lines: null }]);
  // The line range: a range, one line, the word "to"; with none, the words alone.
  assert.deepEqual([SWAP_WORDS.old, SWAP_WORDS.new], ['Now (the text to replace)', 'New text, copy this']);
  assert.equal(swapLabel('old', { from: 113, to: 115 }), 'Now (the text to replace) · Lines 113 to 115');
  assert.equal(swapLabel('new', { from: 40, to: 40 }), 'New text, copy this · Line 40');
  assert.equal(swapLabel('new'), 'New text, copy this');
  assert.deepEqual(parse('```new lines 3 to 9\nx\n```')[0].lines, { from: 3, to: 9 });
  assert.deepEqual(parse('```OLD line 7\nx\n```')[0], { type: 'old', text: 'x', lines: { from: 7, to: 7 } });
  // Anything else after the word is a code block, as before, and so is every other language.
  assert.deepEqual(parse('```old text\nx\n```'), [{ type: 'pre', text: 'x' }]);
  assert.deepEqual(parse('```newer\nx\n```'), [{ type: 'pre', text: 'x' }]);
  assert.deepEqual(parse('```diff\n-a\n+b\n```')[0].type, 'diff', 'the diff block stays');
  const [, was, now] = render(text, fakeEl);
  assert.deepEqual([was.className, now.className], ['swap old', 'swap new']);
  // The words are text of the page and the name of the group: a screen reader says them, whatever the color.
  assert.deepEqual([was.children[0].tag, textOf(was.children[0])], ['b', 'Now (the text to replace) · Lines 113 to 115']);
  assert.deepEqual([now.children[0].tag, textOf(now.children[0])], ['b', 'New text, copy this']);
  assert.deepEqual([was.attributes.role, was.attributes['aria-label']], ['group', 'Now (the text to replace) · Lines 113 to 115']);
  assert.deepEqual([now.attributes.role, now.attributes['aria-label']], ['group', 'New text, copy this']);
  // The text goes in as it is: no sign is taken off, and markup stays text.
  assert.equal(textOf(find([was], (n) => n.tag === 'pre')[0]), '- Ask before each payment.\n+ a plus stays text');
  assert.equal(textOf(find([now], (n) => n.tag === 'pre')[0]), '- Ask before each payment over 50 dollars.\n  <b>second</b> line');
  assert.deepEqual(find([was, now], (n) => ['a', 'img', 'strong'].includes(n.tag)), []);
  // Only the new text has a copy button, and it copies the text of the box alone: no label, no fence.
  assert.equal(find([was], (n) => n.className === 'copy').length, 0);
  const [copy] = find([now], (n) => n.className === 'copy');
  const copied = [];
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { copied.push(t); } } }, configurable: true });
  try {
    await copy.handlers.click({ stopPropagation() {} });
  } finally {
    if (before) Object.defineProperty(globalThis, 'navigator', before); else delete globalThis.navigator;
  }
  assert.deepEqual(copied, ['- Ask before each payment over 50 dollars.\n  <b>second</b> line']);
  assert.equal(copy.attributes['aria-label'], 'Copied');
});

test('a whole address of a rule document is a link of the dialog, with link text or bare; any other web address opens a new tab (memo 1523)', () => {
  const full = 'https://mac.tail.ts.net:8443/system#file=charter:team&edit=1';
  assert.equal(docLinkOf(full), '/system#file=charter:team&edit=1');
  assert.equal(docLinkOf('http://127.0.0.1:3280/system#file=lessons'), '/system#file=lessons');
  assert.equal(docLinkOf('https://memo.example.org/system#file=lessons', 'https://memo.example.org'), '/system#file=lessons');
  assert.equal(docLinkOf('https://memo.example.org/system#file=lessons', 'https://other.example.org'), null);
  assert.equal(docLinkOf('https://mac.tail.ts.net:8443/system#h-skills'), null);
  assert.equal(docLinkOf('/system#file=lessons'), '/system#file=lessons');
  assert.deepEqual(inline(`I changed [the team charter](${full}).`), [{ t: 'text', text: 'I changed ' }, { t: 'doc', text: 'the team charter', href: full }, { t: 'text', text: '.' }]);
  // Bare, at the end of a sentence: the full stop is not part of the address.
  assert.deepEqual(inline(`See ${full}.`), [{ t: 'text', text: 'See ' }, { t: 'doc', text: full, href: full }, { t: 'text', text: '.' }]);
  const [p] = render(`[the team charter](${full}) and https://example.org/system#file=lessons`, fakeEl);
  const [doc, web] = find([p], (n) => n.tag === 'a');
  assert.deepEqual([doc.className, doc.href, doc.target], ['doc-link', full, undefined]);
  assert.deepEqual([web.className, web.target], [undefined, '_blank']);
});
