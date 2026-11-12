import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { isWork, shownMemos, step, countText, matches, filterChoices, tabTitle, TAB_TITLES, tagSuggestions, STARTER_TAGS, todayIn, addDays, nextMonday, dueWarning,
  isUgh, ughReason, ughTitle, UGH_WORDS, UGH_DAYS, daysWaited, isHighEnergy, isLowEnergy, HIGH_EFFORTS, PERSONAL_WS, TAB_TAGS,
  focusMemos, focusTitle, readAdhd, saveAdhd, ADHD_KEY, FOCUS_COUNT,
  MINIMAL_KEY, MINIMAL_WIDGETS, MINIMAL_ALWAYS, minimalDefault, parseMinimal, readMinimal, saveMinimal, setMinimal, minimalClasses, widgetShows, minimalMemos, devicePrefs, loadPrefs, savePrefs, savedWords } from '../ui/filter.js';
import { makeApp as makeServer, call, TOKEN, LIAISON_TOKEN } from './helpers.js';
import { existsSync } from 'node:fs';
import { quickItems, quickAccess } from '../ui/dash.js';
import { sortQueue } from '../src/rank.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.js';
import { recentMarks } from '../ui/recent.js';

const get = async (path) => { const r = await makeApp().app.request(path); return { type: r.headers.get('content-type') || '', text: await r.text() }; };

test('the workstream decides Work and Personal: ME is personal, every other code and no code is work (memo 1244)', () => {
  assert.equal(PERSONAL_WS, 'ME');
  assert.equal(isWork({ ws: 'ME', text: 'the dentist' }), false);
  assert.equal(isWork({ ws: 'OPS', text: 'the insurance' }), true);
  for (const ws of ['SYS', 'COMM', 'GEN', 'FUND', 'REL']) assert.equal(isWork({ ws, text: 'x' }), true, `${ws} is work`);
  // The tag work wins over the code.
  assert.equal(isWork({ ws: 'ME', tags: ['work'], text: 'the rent' }), true);
  // No code: work, so Personal holds only real personal items. The old work code SUB-n is in it.
  assert.equal(isWork({ text: '**SUB-9: Work task 3: merge the pull request.**' }), true);
  assert.equal(isWork({ text: 'The SUBJECT is ready.' }), true);
  assert.equal(isWork({ ws: null, text: 'a photo' }), true);
  assert.equal(isWork({}), true);
});

test('the tag personal makes a Personal memo whatever its code, and it wins over the tag work (memo 1251)', () => {
  assert.equal(isWork({ ws: 'SYS', tags: ['personal'], text: 'the pets of the agents' }), false);
  assert.equal(isWork({ tags: ['personal'], text: 'no code' }), false);
  assert.equal(isWork({ ws: 'ME', tags: ['personal'] }), false);
  // The two tags: the later one cannot be known, so personal wins in each order.
  assert.equal(isWork({ ws: 'SYS', tags: ['personal', 'work'] }), false);
  assert.equal(isWork({ ws: 'ME', tags: ['work', 'personal'] }), false);
  assert.equal(isWork({ ws: 'SYS', tags: ['money'] }), true, 'a different tag changes nothing');
  const memos = [{ id: 1, ws: 'SYS', tags: ['personal'] }, { id: 2, ws: 'SYS', tags: [] }, { id: 3, ws: 'ME', tags: ['work'] }, { id: 4, ws: 'OPS', tags: ['work', 'personal'] }];
  assert.deepEqual(shownMemos(memos, 'personal').map((m) => m.id), [1, 4]);
  assert.deepEqual(shownMemos(memos, 'work').map((m) => m.id), [2, 3]);
});

test('the tag high makes a High energy memo; the tag low makes a Low energy memo, but not an Ugh memo; high wins (memo 1251)', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  const m = (effort, impact, tags, days = 0, extra = {}) => ({ effort, impact, tags, created: ago(days), ...extra });
  // high: a micro or short memo with a low impact is High.
  assert.equal(isHighEnergy(m('micro', 1, ['high']), now), true);
  assert.equal(isHighEnergy(m('short', 3, ['money', 'high']), now), true);
  assert.equal(isHighEnergy(m(undefined, undefined, ['high']), now), true);
  assert.equal(isHighEnergy(m('short', 3, ['money']), now), false, 'a different tag changes nothing');
  // low: a long memo, or a memo with a high impact, is Low.
  assert.equal(isHighEnergy(m('day', 2, ['low']), now), false);
  assert.equal(isHighEnergy(m('micro', 5, ['low']), now), false);
  assert.equal(isLowEnergy(m('hour', 4, ['low']), now), true);
  // An Ugh memo stays High with the tag low, for each reason.
  assert.equal(isHighEnergy(m('micro', 1, ['low'], 6), now), true, 'waited more than 5 days');
  assert.equal(isHighEnergy(m('micro', 1, ['low'], 1, { back: ago(0.5) }), now), true, 'postponed and back');
  // The two tags: high wins in each order.
  assert.equal(isHighEnergy(m('micro', 1, ['high', 'low']), now), true);
  assert.equal(isHighEnergy(m('micro', 1, ['low', 'high']), now), true);
  const memos = [m('micro', 1, ['high']), m('day', 5, ['low']), m('micro', 1, ['low'], 6), m('short', 2, ['low', 'high']), m('short', 2, [])].map((x, i) => ({ id: i + 1, ...x }));
  assert.deepEqual(shownMemos(memos, 'high', now).map((x) => x.id), [1, 3, 4]);
  assert.deepEqual(shownMemos(memos, 'low', now).map((x) => x.id), [2, 5]);
  for (const x of memos) assert.equal(isHighEnergy(x, now) !== isLowEnergy(x, now), true, `memo ${x.id} is in exactly one`);
});

test('the Inbox suggests the tags work, personal, high and low, and they have no tab of their own (memo 1251)', () => {
  assert.deepEqual(TAB_TAGS, ['work', 'personal', 'high', 'low']);
  for (const t of TAB_TAGS) assert.ok(STARTER_TAGS.includes(t), t);
  assert.deepEqual(tagSuggestions([], { tags: ['high'] }), STARTER_TAGS.filter((t) => t !== 'high').sort());
  const memos = [{ id: 1, tags: ['personal', 'high'] }, { id: 2, tags: ['low', 'money'] }, { id: 3, tags: ['work'] }];
  assert.deepEqual(filterChoices(memos, 'all', 0).map(([v]) => v), ['all', 'work', 'personal', 'high', 'low', 'tag:money']);
  assert.match(TAB_TITLES.personal, /the tag personal/);
  assert.match(TAB_TITLES.high, /the tag high/);
  assert.match(TAB_TITLES.low, /the tag low/);
});

test('the work filter shows only work memos, and the keys move through the memos that the list shows', () => {
  const memos = [{ id: 5, text: 'SUB-1 a' }, { id: 3, ws: 'ME', text: 'the tax form' }, { id: 9, ws: 'OPS', text: 'b' }, { id: 4, ws: 'ME', text: 'a photo' }];
  assert.deepEqual(shownMemos(memos, 'all'), memos);
  const work = shownMemos(memos, 'work');
  assert.deepEqual(work.map((c) => c.id), [5, 9]);
  assert.equal(step(work, 5, 1), 9, 'j goes over the hidden memo 3');
  assert.equal(step(work, 9, 1), 9, 'j stops at the end');
  assert.equal(step(work, 9, -1), 5);
  assert.equal(step(work, 5, -1), 5, 'k stops at the start');
  assert.equal(step(work, 3, 1), 5, 'a selection that is not in the list starts at the first memo');
  assert.equal(step(memos, 5, 1), 3);
  assert.equal(step([], 5, 1), null);
  assert.equal(countText(4, 4, false), '4 memos');
  assert.equal(countText(1, 1, false), '1 memo');
  assert.equal(countText(2, 4, true), '2 of 4 memos');
});

test('the Inbox has the filter as tabs on the queue, and j and k scroll with no animation', async () => {
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /<nav class="tabs" id="filter" aria-label="Filter"/);
  // A device that had "Work only" on starts with the Work filter.
  assert.match(inbox, /localStorage\.getItem\('memo-work-only'\) === '1' \? 'work' : 'all'/);
  assert.match(inbox, /setFilter\(filter === 'work' \? 'all' : 'work'\)/);
  assert.match(inbox, /scrollIntoView\(\{ behavior: 'instant', block: 'nearest' \}\)/);
  assert.match((await get('/ui/filter.js')).type, /javascript/);
  assert.doesNotMatch((await get('/ui/common.css')).text, /scroll-behavior/);
});

test('the filter has All, Work, Personal, High energy, Low energy, and each tag in use; a memo with the tag work is a work memo', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const fresh = '2026-11-09T09:00:00Z';
  const memos = [
    { id: 1, text: 'SUB-4 the review', tags: [], created: fresh },
    { id: 2, ws: 'ME', text: 'the dentist', tags: ['health'], created: fresh },
    { id: 3, ws: 'ME', text: 'the rent', tags: ['money', 'work'], created: fresh },
    { id: 4, ws: 'ME', text: 'a photo', tags: [], created: fresh },
  ];
  assert.equal(isWork(memos[2]), true, 'the tag work makes a work memo');
  assert.deepEqual(shownMemos(memos, 'work').map((m) => m.id), [1, 3]);
  assert.deepEqual(shownMemos(memos, 'personal').map((m) => m.id), [2, 4]);
  assert.deepEqual(shownMemos(memos, 'tag:money').map((m) => m.id), [3]);
  assert.equal(matches(memos[3], 'tag:money'), false);
  assert.deepEqual(filterChoices(memos, 'all', now), [['all', 'All'], ['work', 'Work'], ['personal', 'Personal'], ['high', 'High energy'], ['low', 'Low energy'], ['tag:health', '#health'], ['tag:money', '#money']]);
  // A saved tag filter with no memo now stays a choice, so the menu does not change under the owner.
  assert.deepEqual(filterChoices([], 'tag:home').at(-1), ['tag:home', '#home']);
  // Unread (the counts line of the Inbox): the memos not opened (seen 0) and the memos changed since (seen 2).
  const seen = [{ id: 1, seen: 0, tags: [], created: fresh }, { id: 2, seen: 1, tags: [], created: fresh }, { id: 3, seen: 2, tags: [], created: fresh }];
  assert.deepEqual(shownMemos(seen, 'unread').map((m) => m.id), [1, 3]);
  assert.deepEqual(filterChoices(seen, 'unread', now)[5], ['unread', 'Unread'], 'a choice while it is on');
  assert.ok(!filterChoices(seen, 'all', now).some(([v]) => v === 'unread'), 'not a tab otherwise');
  assert.deepEqual(tagSuggestions(memos, memos[2]), [...new Set([...STARTER_TAGS, 'health'])].filter((t) => !['money', 'work'].includes(t)).sort());
  // Each tab has a tooltip; a tag tab names the tag.
  for (const [value, label] of filterChoices(memos, 'unread', now)) assert.ok(tabTitle(value, label).startsWith('Show '), value);
  assert.equal(tabTitle('tag:money', '#money'), 'Show the memos with the tag #money');
  assert.equal(tabTitle('all', 'All'), TAB_TITLES.all);
});

test('an Ugh memo waited more than 5 days, or was postponed and came back (memo 1244)', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  assert.equal(UGH_DAYS, 5);
  assert.equal(ughReason({ created: ago(5.1) }, now), 'waited', 'over 5 days');
  assert.equal(ughReason({ created: ago(5) }, now), '', '5 days exactly is not over');
  assert.equal(ughReason({ created: ago(4.9) }, now), '');
  assert.equal(ughReason({ created: ago(0) }, now), '');
  // Postponed and back: back is the time of the return (src/memos.js wake). It wins as the reason, also on a new memo.
  assert.equal(ughReason({ created: ago(1), back: ago(0.5) }, now), 'back');
  assert.equal(ughReason({ created: ago(9), back: ago(2) }, now), 'back');
  assert.equal(ughReason({ created: ago(9), back: null }, now), 'waited');
  assert.equal(ughReason({}, now), '', 'no created: not ugh');
  assert.equal(isUgh({ created: ago(6) }, now), true);
  assert.equal(isUgh({ created: ago(2) }, now), false);
  // The words: a visible chip, and a tooltip that says which reason.
  assert.equal(UGH_WORDS.label, 'Ugh');
  assert.equal(daysWaited({ created: ago(7.8) }, now), 7);
  assert.equal(ughTitle({ created: ago(7.8) }, now), 'Put off: this memo has waited 7 days');
  assert.equal(ughTitle({ created: ago(7.8), back: ago(1) }, now), 'Put off: you postponed this memo and it came back');
  // The default now is the clock.
  assert.equal(isUgh({ created: new Date(Date.now() - 6 * 86400000).toISOString() }), true);
  assert.equal(isUgh({ created: new Date().toISOString() }), false);
});

test('High energy is hour, half-day, day, impact 4 or 5, or Ugh; Low energy is the rest; every memo is in one of the two (memo 1244)', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const ago = (days) => new Date(now - days * 86400000).toISOString();
  assert.deepEqual(HIGH_EFFORTS, ['hour', 'half-day', 'day']);
  const m = (id, effort, impact, days = 0, extra = {}) => ({ id, effort, impact, created: ago(days), tags: [], ...extra });
  const memos = [
    m(1, 'micro', 3), m(2, 'short', 3), m(3, 'hour', 3), m(4, 'half-day', 1), m(5, 'day', 2),
    m(6, 'micro', 4), m(7, 'short', 5), m(8, 'micro', 1, 6), m(9, 'short', 2, 0, { back: ago(1) }),
    m(10, undefined, 3), m(11, null, 4), m(12, 'short', 1),
  ];
  assert.deepEqual(shownMemos(memos, 'high', now).map((x) => x.id), [3, 4, 5, 6, 7, 8, 9, 11]);
  assert.deepEqual(shownMemos(memos, 'low', now).map((x) => x.id), [1, 2, 10, 12]);
  assert.deepEqual(shownMemos(memos, 'ugh', now).map((x) => x.id), [8, 9]);
  for (const x of memos) assert.equal(isHighEnergy(x, now) !== isLowEnergy(x, now), true, `memo ${x.id} is in exactly one`);
  assert.equal(isHighEnergy(m(13, 'micro', 1, 6), now), true, 'an Ugh memo is High whatever its effort');
  assert.equal(isLowEnergy(m(14, undefined, 2), now), true, 'no effort counts as short: Low with an impact under 4');
  // The Ugh tab shows with its count while a memo is Ugh, and while it is on.
  assert.deepEqual(filterChoices(memos, 'all', now).find(([v]) => v === 'ugh'), ['ugh', 'Ugh', 2]);
  const calm = memos.filter((x) => !isUgh(x, now));
  assert.equal(filterChoices(calm, 'all', now).some(([v]) => v === 'ugh'), false, 'no Ugh memo: no tab');
  assert.deepEqual(filterChoices(calm, 'ugh', now).find(([v]) => v === 'ugh'), ['ugh', 'Ugh', 0], 'the tab stays while it is on');
  assert.deepEqual(filterChoices(memos, 'all', now).slice(0, 6).map(([v]) => v), ['all', 'work', 'personal', 'high', 'low', 'ugh']);
  // The green and gold marks follow the tab: computed from the memos the tab shows (ui/recent.js, commit ee6428c).
  const fired = { 1: '2026-11-09T11:00:00Z', 3: '2026-11-09T10:00:00Z', 8: '2026-11-09T09:00:00Z' };
  assert.deepEqual([...recentMarks(shownMemos(memos, 'all', now), fired)], [[1, 'latest']], '12 memos: 1 mark, for the latest');
  assert.deepEqual([...recentMarks(shownMemos(memos, 'high', now), fired)], [[3, 'latest']], 'memo 1 is Low, so the High tab marks memo 3');
  assert.deepEqual([...recentMarks(shownMemos(memos, 'ugh', now), fired)], [[8, 'latest']]);
  assert.deepEqual([...recentMarks(shownMemos(memos, 'low', now), fired)], [[1, 'latest']]);
});

test('the Inbox shows the Ugh chip in the row and in the open memo, and the Ugh tab with its count', async () => {
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /const ughChip = \(memo\) => \(isUgh\(memo\) \? el\('span', \{ className: 'ugh-tag', title: ughTitle\(memo\) \}, UGH_WORDS\.label\) : ''\);/);
  assert.match(inbox, /mark \? markChip\(memo\) : '', ughChip\(memo\), `\$\{displayName\(memo\.sender\)\}/, 'the row');
  assert.match(inbox, /markChip\(memo\), ughChip\(memo\), tag\),/, 'the open memo');
  assert.match(inbox, /function tab\(value, label, count\) \{\n  const b = button\(label, \(\) => setFilter\(value\), tabTitle\(value, label\)\);\n  if \(count\) b\.append\(el\('span', \{ className: 'badge soft' \}, String\(count\)\)\);/);
  assert.match(inbox, /choices\.map\(\(\[value, label, count\]\) => tab\(value, label, count\)\)/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.ugh-tag \{[^}]*background: var\(--warn\); color: var\(--panel\);/, 'the warn token of the theme, in light and dark');
  assert.match(css, /\.tabs \{[^}]*overflow-x: auto;/, 'the tabs scroll in their own row on a phone');
});

test('the postpone dates are in the owner\'s zone, and the picker warns when the memo is due before it comes back', () => {
  // 03:00 UTC on Thursday 15 October is still Wednesday 14 October in New York.
  const now = new Date('2026-10-15T03:00:00Z');
  assert.equal(todayIn('America/New_York', now), '2026-10-14');
  assert.equal(todayIn('UTC', now), '2026-10-15');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(nextMonday('2026-10-14'), '2026-10-19', 'Wednesday to the next Monday');
  assert.equal(nextMonday('2026-10-18'), '2026-10-19', 'Sunday to the next day');
  assert.equal(nextMonday('2026-10-19'), '2026-10-26', 'a Monday goes to the Monday after');
  assert.match(dueWarning({ due: '2026-10-16' }, '2026-10-19'), /due 2026-10-16/);
  assert.equal(dueWarning({ due: '2026-10-20' }, '2026-10-19'), '');
  assert.equal(dueWarning({}, '2026-10-19'), '');
});

// ---------- memo 1513: ADHD mode ----------
test('with ADHD mode off the list is the three memos of the highest priority, in the order of the queue (memo 1513)', () => {
  const now = new Date('2026-11-12T12:00:00');
  // The order of the server (src/rank.js): back from a postpone and not seen, due in the next two days, then impact by effort.
  const queue = sortQueue([
    { id: 1, impact: 2, effort: 'short' },
    { id: 2, impact: 5, effort: 'micro' },
    { id: 3, impact: 4, effort: 'day' },
    { id: 4, impact: 1, effort: 'hour', due: '2026-11-13' },
    { id: 5, impact: 3, effort: 'short', back: '2026-11-12T09:00:00Z', seen: 0 },
    { id: 6, impact: 5, effort: 'short' },
  ], now);
  assert.deepEqual(queue.map((m) => m.id), [5, 4, 2, 6, 1, 3]);
  assert.equal(FOCUS_COUNT, 3);
  assert.deepEqual(focusMemos(queue).map((m) => m.id), [5, 4, 2], 'the first three of the queue, in its order');
  assert.deepEqual(focusMemos(queue.slice(0, 2)).map((m) => m.id), [5, 4], 'fewer memos than three: all of them');
  assert.deepEqual(focusMemos([]), []);
  assert.deepEqual(focusMemos(null), []);
  assert.equal(focusMemos(queue).length + 3, queue.length, 'the list is a new one: the queue keeps its memos');
  // No filter applies: the three are those of the whole queue, also when a filter of the full view would hide one.
  assert.ok(shownMemos(queue, 'low').length < queue.length);
  assert.deepEqual([focusTitle(3), focusTitle(2), focusTitle(1), focusTitle(0)], ['Top 3 memos', 'Top 2 memos', 'Top memo', 'Memos']);
});

test('ADHD mode is on at the first load, the browser keeps the choice, and a browser that keeps nothing gives on (memo 1513)', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  assert.equal(readAdhd(storage), true, 'no choice yet: the Inbox as before');
  assert.equal(saveAdhd(storage, false), true);
  assert.equal(store.get(ADHD_KEY), 'off');
  assert.equal(readAdhd(storage), false, 'the choice is there after a reload');
  assert.equal(saveAdhd(storage, true), true);
  assert.deepEqual([store.get(ADHD_KEY), readAdhd(storage)], ['on', true]);
  store.set(ADHD_KEY, 'something else');
  assert.equal(readAdhd(storage), true, 'only the word off turns it off');
  // A private window: the storage throws, or is not there. Never an error, and the mode is on.
  const closed = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(readAdhd(closed), true);
  assert.equal(saveAdhd(closed, false), false);
  assert.equal(readAdhd(null), true);
  assert.equal(saveAdhd(undefined, false), false);
});

test('the Inbox has the ADHD mode button with its state, and with the mode off only the capture field, three memos and the button are on the page (memo 1513)', () => {
  const page = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  // The button: its name is "ADHD mode", its state is aria-pressed (on at the first load), and the small word is for the eye.
  assert.ok(page.includes('<button type="button" id="adhd-toggle" class="adhd-toggle" aria-pressed="true">ADHD mode<span class="adhd-state" aria-hidden="true">On</span></button>'));
  assert.ok(page.indexOf('id="adhd-toggle"') > page.indexOf('<header class="top">') && page.indexOf('id="adhd-toggle"') < page.indexOf('</header>'), 'next to the capture field');
  for (const part of ["adhdToggle.setAttribute('aria-pressed', String(adhdOn));", "adhdToggle.addEventListener('click', () => setAdhd(!adhdOn));", 'try { adhdOn = readAdhd(localStorage); } catch',
    'try { saveAdhd(localStorage, on); } catch', "document.documentElement.classList.toggle('adhd-off', !adhdOn);", 'const shown = () => (adhdOn ? shownMemos(memos, filter) : minimalMemos(memos, minimal));',
    'const rows = filtered || !adhdOn ? [] : ticks;']) assert.ok(page.includes(part), part);
  // The choice applies before the first paint, from the same key.
  assert.ok(page.includes(`<script>try{if(localStorage.getItem('${ADHD_KEY}')==='off')document.documentElement.classList.add('adhd-off');}catch(e){}</script>`));
  assert.ok(page.indexOf(`localStorage.getItem('${ADHD_KEY}')`) < page.indexOf('<body>'));
  // Off: every widget but the capture form and the list is off the page (display: none), not folded.
  // Memo 1531: the parts of the list go always; each widget has its own rule, which holds until she picks the widget.
  const rule = css.match(/html\.adhd-off \.app\.inbox :is\(([^)]*)\) \{ display: none !important; \}/);
  assert.ok(rule, 'one rule takes the parts of the list off the page');
  const each = [...css.matchAll(/^html\.adhd-off(?::not\(\.mv-[a-z0-9]+\))+ \.app\.inbox (?::is\(([^)]*)\)|([^{]*?)) \{ display: none !important; \}$/gm)].flatMap((m) => (m[1] || m[2]).split(',').map((x) => x.trim()));
  const gone = [...rule[1].split(',').map((x) => x.trim()), ...each];
  for (const part of ['.side', '.top .refresh', '.hero', '.meeting-panel', '.agent-strip', '#later', '.col-side', '#filter', '#answered-list', '#scheduled-list', '.tick']) assert.ok(gone.includes(part), part);
  for (const part of ['#capture', '#queue', '.adhd-toggle', '.top', '.queue-card', '#token-form', '#note']) assert.ok(!gone.some((g) => g === part), `${part} stays`);
  // Every widget of the page is in the rule or is one of the three things that stay: a new widget must pick a side.
  const body = page.slice(page.indexOf('<div class="page">'), page.indexOf('<template id="paperclip">'));
  const sections = [...body.matchAll(/<section class="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(sections.length >= 9);
  const hidden = (cls) => cls.split(' ').some((c) => gone.includes(`.${c}`)) || ['today', 'keys', 'dash-card'].some((c) => cls.split(' ').includes(c));
  for (const cls of sections) assert.ok(cls === 'card queue-card' || cls === 'card later' || hidden(cls), `the section ${cls} is hidden with the mode off, or is the list`);
  assert.ok(body.indexOf('<aside class="col-side">') < body.indexOf('class="card today"') && body.indexOf('id="skill-suggest"') > body.indexOf('<aside class="col-side">'), 'the side widgets are in the column that goes');
  // The phone: the button is there at each width (the Refresh button is not).
  assert.match(css, /@media \(max-width: 40rem\) \{\n  \.app\.inbox \.top \{ flex-wrap: wrap; \}\n  \.app\.inbox \.top \.adhd-toggle \{/);
  assert.ok(!/\.adhd-toggle[^{]*\{[^}]*display: none/.test(css), 'no rule hides the button');
});

// ---------- memo 1531: the minimal view, what shows with ADHD mode off ----------
test('the minimal view: the top 3 memos show until she turns them off, every other widget is off until she turns it on (memo 1531)', () => {
  assert.deepEqual(minimalDefault(), ['top3']);
  assert.deepEqual(MINIMAL_WIDGETS.filter((w) => w.on).map((w) => w.key), ['top3']);
  assert.deepEqual(MINIMAL_WIDGETS.map((w) => w.key), ['top3', 'hero', 'meeting', 'agents', 'suggest', 'today', 'quick', 'keys', 'side', 'refresh']);
  for (const w of MINIMAL_WIDGETS) { assert.match(w.key, /^[a-z0-9]+$/); assert.ok(w.label.length > 3, 'each box has words'); }
  assert.equal(new Set(MINIMAL_WIDGETS.map((w) => w.label)).size, MINIMAL_WIDGETS.length);
  // The capture field and the button are no boxes: they always show.
  assert.deepEqual(MINIMAL_ALWAYS, ['Capture field', 'ADHD mode button']);
  assert.ok(!MINIMAL_WIDGETS.some((w) => /capture|adhd/i.test(w.key + w.label)));
  // The stored value: no value is the default, an empty value is nothing, a word that is no widget is left out, and
  // the order is that of the list.
  assert.deepEqual(parseMinimal(null), ['top3']);
  assert.deepEqual(parseMinimal(undefined), ['top3']);
  assert.deepEqual(parseMinimal(''), []);
  assert.deepEqual(parseMinimal('today,top3'), ['top3', 'today']);
  assert.deepEqual(parseMinimal(' today , nothing,constructor,TOP3,today'), ['today']);
  // A click on a box.
  assert.deepEqual(setMinimal(['top3'], 'today', true), ['top3', 'today']);
  assert.deepEqual(setMinimal(['top3', 'today'], 'top3', false), ['today']);
  assert.deepEqual(setMinimal(['today'], 'today', true), ['today']);
  assert.deepEqual(setMinimal([], 'nothing', true), []);
  assert.deepEqual(setMinimal(null, 'agents', true), ['agents']);
  // The classes of the page.
  assert.deepEqual(minimalClasses(['top3', 'today']), ['mv-top3', 'mv-today']);
  assert.deepEqual(minimalClasses([]), []);
  assert.deepEqual(minimalClasses(['x y', 'today']), ['mv-today']);
});

test('what shows: with ADHD mode on every widget, with it off only the picked ones; the list is the top 3 or nothing (memo 1531)', () => {
  for (const w of MINIMAL_WIDGETS) {
    assert.equal(widgetShows(true, [], w.key), true, `on: ${w.key} shows, whatever is picked`);
    assert.equal(widgetShows(false, minimalDefault(), w.key), w.key === 'top3', `off, nothing picked yet: ${w.key}`);
    assert.equal(widgetShows(false, [w.key], w.key), true);
    assert.equal(widgetShows(false, [], w.key), false);
  }
  const queue = [{ id: 5 }, { id: 4 }, { id: 2 }, { id: 6 }];
  assert.deepEqual(minimalMemos(queue, ['top3']).map((m) => m.id), [5, 4, 2]);
  assert.deepEqual(minimalMemos(queue, ['top3', 'today']).map((m) => m.id), [5, 4, 2]);
  assert.deepEqual(minimalMemos(queue, ['today']), [], 'the top 3 memos are turned off');
  assert.deepEqual(minimalMemos(queue, []), []);
  assert.deepEqual(minimalMemos(null, ['top3']), []);
});

test('the browser keeps the minimal view, and a browser that keeps nothing gives the default (memo 1531)', () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
  assert.deepEqual(readMinimal(storage), ['top3'], 'no choice yet');
  assert.equal(saveMinimal(storage, ['today', 'top3', 'nothing']), true);
  assert.equal(store.get(MINIMAL_KEY), 'top3,today');
  assert.deepEqual(readMinimal(storage), ['top3', 'today']);
  assert.equal(saveMinimal(storage, []), true);
  assert.equal(store.get(MINIMAL_KEY), '');
  assert.deepEqual(readMinimal(storage), [], 'she turned all of them off: that is kept, it is not the default');
  assert.notEqual(MINIMAL_KEY, ADHD_KEY);
  const closed = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(readMinimal(closed), ['top3']);
  assert.equal(saveMinimal(closed, ['today']), false);
  assert.deepEqual(readMinimal(null), ['top3']);
  assert.equal(saveMinimal(undefined, ['today']), false);
});

test('the page: a rule for each widget of the minimal view, the choice before the first paint, and the settings behind the Layout button (memo 1531)', () => {
  const page = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  // Each widget has one rule that takes it off the page while ADHD mode is off and it is not picked. With the mode
  // on (no class adhd-off) no rule of the minimal view applies.
  for (const w of MINIMAL_WIDGETS) {
    const rules = css.split('\n').filter((l) => l.startsWith(`html.adhd-off:not(.mv-${w.key})`) && l.endsWith('{ display: none !important; }'));
    assert.ok(rules.length >= 1, `a rule for ${w.key}`);
  }
  for (const line of css.split('\n').filter((l) => /\.mv-[a-z0-9]+\)/.test(l))) assert.ok(line.replace(/^@media \([^)]*\) \{ /, '').startsWith('html.adhd-off:not('), `only with the mode off: ${line}`);
  // The capture field and the button are in no rule.
  for (const line of css.split('\n').filter((l) => l.startsWith('html.adhd-off') && l.includes('display: none'))) assert.ok(!/#capture|\.adhd-toggle|\.top \{|#note|#token-form/.test(line), line);
  // Before the first paint, from the same key; with no choice, and in a browser that refuses, the top 3 memos.
  const early = `<script>try{var v=localStorage.getItem('${MINIMAL_KEY}');(v===null?'top3':v).split(',').forEach(function(k){if(/^[a-z0-9]+$/.test(k))document.documentElement.classList.add('mv-'+k);});}catch(e){document.documentElement.classList.add('mv-top3');}</script>`;
  assert.ok(page.includes(early));
  assert.ok(page.indexOf(early) < page.indexOf('<body>'));
  // The settings: a fieldset with a legend in the Quick Access card, a labelled box for each widget, a status line,
  // and storage in a try.
  assert.ok(page.includes('<fieldset class="mv-set" id="minimal-settings" hidden></fieldset>'));
  assert.ok(page.indexOf('id="minimal-settings"') > page.indexOf('id="quick-access"') && page.indexOf('id="minimal-settings"') < page.indexOf('class="card keys"'));
  for (const part of ["el('legend', {}, 'Minimal view (ADHD mode off)')", "el('input', { type: 'checkbox', id: `mv-${w.key}`, checked: minimal.includes(w.key) })", "el('label', { htmlFor: `mv-${w.key}` }, box, w.label)",
    "saved.setAttribute('role', 'status');", 'try { minimal = readMinimal(localStorage); } catch', 'try { kept = saveMinimal(localStorage, minimal); } catch', 'layout: true, open: !minimalBox.hidden',
    "document.documentElement.classList.toggle('mv-editing', !minimalBox.hidden);"]) assert.ok(page.includes(part), part);
  // Phone width: the boxes are one column of rows a finger can hit, and long words wrap.
  assert.match(css, /\.mv-set label \{[^}]*min-height: 2\.1rem;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.mv-set \{[^}]*min-width: 0;/);
});

test('the Layout button of Quick Access opens the settings of the minimal view and says whether they are open (memo 1531)', () => {
  const fakeEl = (tag, props = {}, ...children) => {
    const node = { tag, ...props, children, attrs: {}, listeners: {} };
    node.setAttribute = (k, v) => { node.attrs[k] = v; };
    node.addEventListener = (k, fn) => { node.listeners[k] = fn; };
    return node;
  };
  const ran = [];
  const draw = (open) => quickAccess(quickItems({ layout: true, open }), fakeEl, { run: (what) => ran.push(what) }).children[4];
  const closed = draw(false);
  assert.deepEqual([closed.tag, closed.className, closed.attrs['aria-expanded']], ['button', 'qa', 'false']);
  assert.match(closed.title, /^Minimal view: pick which widgets show when ADHD mode is off/);
  closed.listeners.click({ stopPropagation() {} });
  assert.deepEqual(ran, ['layout']);
  assert.equal(draw(true).attrs['aria-expanded'], 'true');
  // A page with no such settings: the button is off, as before. The other buttons have no aria-expanded.
  const old = quickAccess(quickItems(), fakeEl).children;
  assert.equal(old[4].className, 'qa off');
  assert.equal(old[0].attrs['aria-expanded'], undefined);
});

test('ADHD mode off never makes the page narrower: no width rule for the page, and the columns stay unless no side widget shows (memo 1536)', () => {
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const off = css.split('\n').filter((l) => l.includes('html.adhd-off'));
  for (const line of off) assert.ok(!/max-width|(?<!min-)width:/.test(line.replace(/@media \([^)]*\)/, '')), `a width in: ${line}`);
  assert.ok(!off.some((l) => /\.page\b/.test(l)), 'no rule for the page');
  assert.ok(!off.some((l) => /\.agent-strip[^,)]*\{/.test(l) && !l.includes('display: none')), 'the agents keep their row');
  // One column only when the side column is gone; else the two columns of the full view.
  assert.ok(!css.includes('html.adhd-off .app.inbox .columns {'));
  assert.ok(css.includes('html.adhd-off:not(.mv-suggest):not(.mv-today):not(.mv-quick):not(.mv-keys):not(.mv-editing) .app.inbox .columns { grid-template-columns: minmax(0, 1fr); }'));
});

// ---------- memo 1537: the two choices on the server, for each of her devices ----------
const memoryStorage = (start = {}) => {
  const store = new Map(Object.entries(start));
  return { store, getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
};
// An api function over a server of the tests, as ui/common.js api: a body makes a POST; an error answer throws.
const apiOf = (app, token = TOKEN, calls = []) => async (path, body) => {
  calls.push([path, body]);
  const r = await call(app, path, body, token);
  if (r.status !== 200) throw new Error(r.data.error || `status ${r.status}`);
  return r.data;
};

test('the preferences of the owner: only the owner reads and writes them, and only the two valid values are kept (memo 1537)', async () => {
  const { app, dataDir } = makeServer({ now: () => new Date('2026-11-12T20:00:00Z') });
  const file = join(dataDir, 'prefs.json');
  assert.deepEqual((await call(app, '/api/prefs')).data, { adhd: null, minimal: null, updated: null }, 'nothing set yet');
  assert.equal(existsSync(file), false);
  // The owner only: no token, a wrong token and the liaison token are refused, for a read and for a write.
  for (const [token, status] of [[null, 401], ['wrong-token-0123456789', 401], [LIAISON_TOKEN, 403]]) {
    assert.equal((await call(app, '/api/prefs', undefined, token)).status, status);
    assert.equal((await call(app, '/api/prefs', { adhd: 'off' }, token)).status, status);
    const put = await app.request('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ adhd: 'off' }) });
    assert.equal(put.status, status);
  }
  assert.equal(existsSync(file), false, 'a refused write keeps nothing');
  // A write of one value keeps the other.
  const one = await call(app, '/api/prefs', { minimal: 'agents,top3' });
  assert.deepEqual([one.status, one.data], [200, { adhd: null, minimal: 'top3,agents', updated: '2026-11-12T20:00:00.000Z' }]);
  const put = await app.request('/api/prefs', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ adhd: 'off' }) });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), { adhd: 'off', minimal: 'top3,agents', updated: '2026-11-12T20:00:00.000Z' });
  assert.deepEqual((await call(app, '/api/prefs')).data, { adhd: 'off', minimal: 'top3,agents', updated: '2026-11-12T20:00:00.000Z' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { adhd: 'off', minimal: 'top3,agents', updated: '2026-11-12T20:00:00.000Z' });
  // No widget at all is a choice too.
  assert.equal((await call(app, '/api/prefs', { minimal: '' })).data.minimal, '');
  // What is refused: a name that is no preference, no name, a wrong value, a widget that is not there, a long value.
  for (const bad of [{ theme: 'dark' }, { adhd: 'off', extra: 1 }, {}, { adhd: 'maybe' }, { adhd: true }, { minimal: ['top3'] }, { minimal: 'top3,nothing' }, { minimal: 'TOP3' }, { minimal: 'top3, today' },
    { minimal: 'top3;rm -rf' }, { minimal: '../x' }, { minimal: Array(40).fill('top3').join(',') + ',' + 'a'.repeat(200) }, { minimal: 'constructor' }]) {
    assert.equal((await call(app, '/api/prefs', bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.deepEqual((await call(app, '/api/prefs')).data, { adhd: 'off', minimal: '', updated: '2026-11-12T20:00:00.000Z' }, 'a refused write changes nothing');
  assert.ok(readFileSync(file, 'utf8').length < 200, 'the file stays small');
  // A file that someone broke by hand reads as nothing set.
  const broken = makeServer();
  (await import('node:fs')).writeFileSync(join(broken.dataDir, 'prefs.json'), '{"adhd":"sideways","minimal":7,"x":"y"');
  assert.deepEqual((await call(broken.app, '/api/prefs')).data, { adhd: null, minimal: null, updated: null });
});

test('at the start of the page the choice of the server wins and goes into the copy of the browser (memo 1537)', async () => {
  const { app } = makeServer();
  await call(app, '/api/prefs', { adhd: 'off', minimal: 'top3,agents' });
  // The phone: it has an older choice of its own, with no Agents.
  const phone = memoryStorage({ [ADHD_KEY]: 'on', [MINIMAL_KEY]: 'top3' });
  const calls = [];
  const p = await loadPrefs(apiOf(app, TOKEN, calls), phone);
  assert.deepEqual(p, { adhdOn: false, minimal: ['top3', 'agents'], from: 'server', uploaded: [] });
  assert.deepEqual([phone.store.get(ADHD_KEY), phone.store.get(MINIMAL_KEY)], ['off', 'top3,agents'], 'the copy for the first paint of the next load');
  assert.deepEqual(calls, [['/api/prefs', undefined]], 'one read, no write: her ticks on the server stay');
  // A new device with nothing kept gets the same.
  assert.deepEqual((await loadPrefs(apiOf(app), memoryStorage())).minimal, ['top3', 'agents']);
  // A browser that keeps nothing still gets the choice of the server.
  const closed = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(await loadPrefs(apiOf(app), closed), { adhdOn: false, minimal: ['top3', 'agents'], from: 'server', uploaded: [] });
  assert.deepEqual((await loadPrefs(apiOf(app), null)).minimal, ['top3', 'agents']);
});

test('a choice from before goes up to the server one time, and only where the server has none (memo 1537)', async () => {
  const { app } = makeServer();
  const laptop = memoryStorage({ [ADHD_KEY]: 'off', [MINIMAL_KEY]: 'agents,top3' });
  assert.deepEqual(devicePrefs(laptop), { adhd: 'off', minimal: 'top3,agents' });
  assert.deepEqual(devicePrefs(memoryStorage()), { adhd: null, minimal: null });
  assert.deepEqual(devicePrefs(memoryStorage({ [ADHD_KEY]: 'sideways', [MINIMAL_KEY]: '' })), { adhd: null, minimal: '' });
  const calls = [];
  const first = await loadPrefs(apiOf(app, TOKEN, calls), laptop);
  assert.deepEqual(first, { adhdOn: false, minimal: ['top3', 'agents'], from: 'server', uploaded: ['adhd', 'minimal'] });
  assert.deepEqual(calls[1], ['/api/prefs', { adhd: 'off', minimal: 'top3,agents' }]);
  assert.deepEqual([(await call(app, '/api/prefs')).data.adhd, (await call(app, '/api/prefs')).data.minimal], ['off', 'top3,agents']);
  // The second load sends nothing up, and a second device with another old choice does not replace it.
  calls.length = 0;
  await loadPrefs(apiOf(app, TOKEN, calls), laptop);
  const phone = memoryStorage({ [MINIMAL_KEY]: 'top3' });
  assert.deepEqual((await loadPrefs(apiOf(app, TOKEN, calls), phone)).uploaded, []);
  assert.equal(calls.filter(([, body]) => body).length, 0);
  assert.equal((await call(app, '/api/prefs')).data.minimal, 'top3,agents');
  // Only the value the server lacks goes up: the server has the minimal view, this device has the mode too.
  const half = makeServer();
  await call(half.app, '/api/prefs', { minimal: 'today' });
  const mixed = await loadPrefs(apiOf(half.app), memoryStorage({ [ADHD_KEY]: 'off', [MINIMAL_KEY]: 'top3' }));
  assert.deepEqual(mixed, { adhdOn: false, minimal: ['today'], from: 'server', uploaded: ['adhd'] });
  assert.deepEqual([(await call(half.app, '/api/prefs')).data.adhd, (await call(half.app, '/api/prefs')).data.minimal], ['off', 'today']);
  // A device whose choice is only the default sends nothing up: the ticks of another device can still come.
  const plain = makeServer();
  const untouched = memoryStorage({ [ADHD_KEY]: 'on', [MINIMAL_KEY]: 'top3' });
  assert.deepEqual(await loadPrefs(apiOf(plain.app), untouched), { adhdOn: true, minimal: ['top3'], from: 'server', uploaded: [] });
  assert.equal((await call(plain.app, '/api/prefs')).data.updated, null);
  await loadPrefs(apiOf(plain.app), memoryStorage({ [ADHD_KEY]: 'off', [MINIMAL_KEY]: 'top3,agents' }));
  assert.deepEqual((await loadPrefs(apiOf(plain.app), untouched)).minimal, ['top3', 'agents'], 'and then the untouched device gets them');
  // A device with nothing and a server with nothing: the defaults, and nothing is written.
  const empty = makeServer();
  assert.deepEqual(await loadPrefs(apiOf(empty.app), memoryStorage()), { adhdOn: true, minimal: ['top3'], from: 'server', uploaded: [] });
  assert.equal((await call(empty.app, '/api/prefs')).data.updated, null);
});

test('with no server the copy of the browser stays, and a change is kept there (memo 1537)', async () => {
  const down = async () => { throw new Error('Failed to fetch'); };
  const device = memoryStorage({ [ADHD_KEY]: 'off', [MINIMAL_KEY]: 'top3,today' });
  assert.deepEqual(await loadPrefs(down, device), { adhdOn: false, minimal: ['top3', 'today'], from: 'device', uploaded: [] });
  assert.deepEqual(await loadPrefs(down, memoryStorage()), { adhdOn: true, minimal: ['top3'], from: 'device', uploaded: [] });
  assert.deepEqual(await loadPrefs(down, null), { adhdOn: true, minimal: ['top3'], from: 'device', uploaded: [] });
  // The token of the liaison, or none: the server refuses, and the device goes on with its own.
  const { app } = makeServer();
  assert.equal((await loadPrefs(apiOf(app, LIAISON_TOKEN), device)).from, 'device');
  // A save: the browser first, then the server.
  assert.deepEqual(await savePrefs(down, device, { minimal: ['agents', 'top3'] }), { device: true, server: false });
  assert.equal(device.store.get(MINIMAL_KEY), 'top3,agents');
  assert.deepEqual(await savePrefs(down, null, { adhdOn: true }), { device: false, server: false });
  const calls = [];
  assert.deepEqual(await savePrefs(apiOf(app, TOKEN, calls), device, { adhdOn: true, minimal: ['agents', 'nothing'] }), { device: true, server: true });
  assert.deepEqual(calls, [['/api/prefs', { adhd: 'on', minimal: 'agents' }]]);
  assert.deepEqual([device.store.get(ADHD_KEY), device.store.get(MINIMAL_KEY)], ['on', 'agents']);
  assert.deepEqual([(await call(app, '/api/prefs')).data.adhd, (await call(app, '/api/prefs')).data.minimal], ['on', 'agents']);
  // The other device sees it at its next load.
  assert.deepEqual((await loadPrefs(apiOf(app), memoryStorage({ [MINIMAL_KEY]: 'top3' }))).minimal, ['agents']);
  assert.deepEqual(await savePrefs(apiOf(app), device, {}), { device: false, server: false });
  assert.equal(savedWords({ device: true, server: true }), 'Saved for all your devices.');
  assert.match(savedWords({ device: true, server: false }), /^Saved on this device only/);
  assert.match(savedWords({ device: false, server: false }), /^Not saved/);
});

test('the Inbox loads the two choices from the server at its start and when it shows again, and sends each change (memo 1537)', () => {
  const page = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  for (const part of ['try { p = await loadPrefs(api, localStorage); } catch { return; }', "if (at !== prefsChanges || p.from !== 'server') return;", '\nsyncPrefs();\n',
    "document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncPrefs(); });", 'savePrefs(api, null, { adhdOn: on })', 'savePrefs(api, null, { minimal })',
    'sendZone(); syncPrefs(); });']) assert.ok(page.includes(part), part);
});
