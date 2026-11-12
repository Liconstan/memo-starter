import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from './helpers.js';
import { isWork, shownMemos, step, countText, matches, filterChoices, tabTitle, TAB_TITLES, tagSuggestions, STARTER_TAGS, todayIn, addDays, nextMonday, dueWarning,
  isUgh, ughReason, ughTitle, UGH_WORDS, UGH_DAYS, daysWaited, isHighEnergy, isLowEnergy, HIGH_EFFORTS, PERSONAL_WS, TAB_TAGS } from '../ui/filter.js';
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
