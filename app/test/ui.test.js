import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, ROOT } from './helpers.js';
import { enterSends, fieldHeight } from '../ui/keys.js';
import { MAX_BYTES, sendsAsIs, fit, withImage, imageNames, ACCEPT } from '../ui/attach.js';
import { layout, hourRange, eventLabel, eventDetails, attendeeLabel, hourLabel, dayLabel, zoneLabel, minuteOf } from '../ui/calendar.js';
import { recentMarks, markCount, RECENT_SHARE, MARK_WORDS } from '../ui/recent.js';

const get = async (path) => { const r = await makeApp().app.request(path); return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() }; };

test('the two pages and the two shared files need no token', async () => {
  const inbox = await get('/inbox');
  assert.equal(inbox.status, 200);
  assert.match(inbox.type, /text\/html/);
  assert.match(inbox.text, /<title>Memo Inbox<\/title>/);
  const agents = await get('/agents');
  assert.equal(agents.status, 200);
  assert.match(agents.text, /<title>Memo Agents<\/title>/);
  assert.match((await get('/ui/common.js')).type, /javascript/);
  assert.match((await get('/ui/common.css')).type, /text\/css/);
  assert.equal((await get('/')).status, 302);
});

test('the ui route gives only the two shared files', async () => {
  assert.equal((await get('/ui/inbox.html')).status, 404);
  assert.equal((await get('/ui/..%2F.env')).status, 404);
  assert.equal((await get('/ui/%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await get('/ui/constructor')).status, 404);
});

test('the pages put text into the document only as text', () => {
  for (const name of readdirSync(join(ROOT, 'ui'))) {
    const source = readFileSync(join(ROOT, 'ui', name), 'utf8');
    for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) {
      assert.ok(!source.includes(word), `ui/${name} must not use ${word}`);
    }
  }
});

test('the pages load nothing from the internet', () => {
  for (const name of readdirSync(join(ROOT, 'ui'))) {
    let source = readFileSync(join(ROOT, 'ui', name), 'utf8');
    // The one exception: the GitHub Pages copy of the Inbox talks to the GitHub API, and only to it.
    if (name === 'ledger.js') source = source.replaceAll('https://api.github.com/repos/', '');
    assert.ok(!/https?:\/\//.test(source), `ui/${name} must not contain a web address`);
  }
});

test('memo HTML can show only in a frame with no access to the page', () => {
  const source = readFileSync(join(ROOT, 'ui', 'markdown.js'), 'utf8');
  assert.equal(source.split("createElement('iframe')").length - 1, 1);
  assert.ok(source.includes("frame.setAttribute('sandbox', 'allow-scripts');"));
  for (const name of readdirSync(join(ROOT, 'ui'))) {
    const text = readFileSync(join(ROOT, 'ui', name), 'utf8');
    for (const word of ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-forms']) assert.ok(!text.includes(word), `ui/${name} must not use ${word}`);
    if (name !== 'markdown.js') assert.ok(!text.includes('iframe') || name === 'common.js' || name === 'common.css', `ui/${name} must not make a frame`);
  }
  // The Inbox does not permit frames for memos that quote Discord text.
  assert.ok(readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8').includes("html: !['liaison', 'discord'].includes(memo.sender)"));
  assert.ok(!readFileSync(join(ROOT, 'ui', 'agents.html'), 'utf8').includes('html:'));
});

test('the pages have a content rule that stops requests to other hosts', async () => {
  for (const path of ['/inbox', '/agents', '/system']) {
    const r = await makeApp().app.request(path);
    const rule = r.headers.get('content-security-policy') || '';
    for (const part of ["default-src 'self'", "connect-src 'self'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(rule.includes(part), `${path}: ${part}`);
    assert.ok(!rule.includes('calendar.google.com'), path);
  }
});

test('the Inbox shows the day grid of the owner in the Today card, with no frame', async () => {
  const inbox = (await get('/inbox')).text;
  assert.ok(!inbox.includes('<iframe'));
  assert.ok(!inbox.includes('__CALENDAR_'));
  assert.ok(!inbox.includes('calendar.google.com'));
  for (const id of ['cal-prev', 'cal-next', 'cal-today', 'cal-zone', 'cal-grid', 'cal-list']) assert.ok(inbox.includes(`id="${id}"`), id);
  // Each event is a button with its full text (title and aria-label); a click opens its detail in a modal dialog, which
  // closes on Escape and gives the focus back. So the grid is not hidden from a screen reader; the hour lines are.
  assert.match(inbox, /class="cal-scroll" id="cal-scroll"><div class="cal-grid" id="cal-grid" role="group" aria-label="Events of the day">/);
  assert.doesNotMatch(inbox, /id="cal-(scroll|allday)" aria-hidden/);
  assert.match(inbox, /<p class="visually-hidden" id="cal-list"><\/p>/);
  assert.ok(inbox.includes("el('button', { type: 'button', className, title: label }"));
  assert.ok(inbox.includes("node.setAttribute('aria-label', label);"));
  assert.ok(inbox.includes("el('div', { className: 'cal-hour', ariaHidden: 'true' }"));
  assert.ok(inbox.includes("el('dialog', { className: 'cal-detail' }"));
  assert.ok(inbox.includes("dialog.setAttribute('aria-labelledby', 'cal-detail-title');"));
  assert.ok(inbox.includes('dialog.showModal();'));
  assert.ok(inbox.includes("(opener.isConnected ? opener : calEls.grid.querySelector('.cal-ev'))?.focus();"));
  assert.ok(inbox.includes("Add your calendar's secret iCal address to Memo to show your day here."));
  // The form that adds a calendar: the address goes in a password field, and the page never shows one.
  assert.match(inbox, /<form class="cal-setup" id="cal-setup" hidden>/);
  assert.match(inbox, /<input name="url" type="password" placeholder="Paste the secret address of a calendar"/);
  assert.ok(inbox.includes('In Google Calendar on the web: Settings, click your calendar, then Integrate calendar. Copy Secret address in iCal format and paste it here.'));
  assert.ok(inbox.includes('id="cal-manage"') && inbox.includes('>Calendars</button>'));
  assert.ok(inbox.includes("localStorage.getItem('memo.today')"));
  assert.ok(inbox.includes("Intl.DateTimeFormat().resolvedOptions().timeZone"));
  assert.ok(inbox.includes("api('/api/client-tz', { timeZone: browserZone })"));
  assert.ok(inbox.includes('id="today-toggle"'));
  assert.match((await get('/ui/calendar.js')).type, /javascript/);
});

test('the day grid: overlapping events side by side, hours from 7 AM to 10 PM or more, text for a screen reader', () => {
  const zone = 'America/New_York';
  const ev = (title, start, end, more = {}) => ({ title, start, end, allDay: false, location: '', hasOthers: true, ...more });
  const events = [
    ev('Sam and Andrea', '2026-10-21T17:00:00.000Z', '2026-10-21T17:30:00.000Z'), // 1:00 to 1:30 PM
    ev('Design review', '2026-10-21T17:15:00.000Z', '2026-10-21T18:00:00.000Z'), // 1:15 to 2:00 PM
    ev('Focus', '2026-10-21T17:45:00.000Z', '2026-10-21T19:00:00.000Z'), // 1:45 to 3:00 PM
    ev('Walk', '2026-10-21T20:00:00.000Z', '2026-10-21T20:30:00.000Z'), // 4:00 PM, alone
    { title: 'Holiday', start: '2026-10-21', end: '2026-10-22', allDay: true, location: '', hasOthers: false },
  ];
  const items = layout(events, '2026-10-21', zone);
  const by = Object.fromEntries(items.map((x) => [x.event.title, x]));
  assert.equal(items.length, 4, 'the all-day event is not a block');
  assert.deepEqual([by['Sam and Andrea'].from, by['Sam and Andrea'].to], [780, 810]);
  assert.deepEqual([by['Sam and Andrea'].col, by['Design review'].col, by.Focus.col], [0, 1, 0]);
  assert.deepEqual([by['Sam and Andrea'].cols, by['Design review'].cols, by.Focus.cols], [2, 2, 2]);
  assert.deepEqual([by.Walk.col, by.Walk.cols], [0, 1]);
  assert.deepEqual(hourRange(items), { first: 7, last: 22 });
  // An early flight and a late call make the grid larger.
  const wide = layout([ev('Flight', '2026-10-21T09:30:00.000Z', '2026-10-21T11:00:00.000Z'), ev('Call', '2026-10-22T02:00:00.000Z', '2026-10-22T03:30:00.000Z')], '2026-10-21', zone);
  assert.deepEqual(hourRange(wide), { first: 5, last: 24 });
  // An event from the day before starts at the top of the day.
  assert.equal(minuteOf('2026-10-21T02:00:00.000Z', '2026-10-21', zone), 0);
  assert.equal(minuteOf('2026-10-22T05:00:00.000Z', '2026-10-21', zone), 1440);
  assert.equal(eventLabel(events[0], zone), '1:00 to 1:30 PM, Sam and Andrea');
  assert.equal(eventLabel({ ...events[0], start: '2026-10-21T15:30:00.000Z' }, zone), '11:30 AM to 1:30 PM, Sam and Andrea');
  assert.equal(eventLabel({ ...events[3], location: 'Park' }, zone), '4:00 to 4:30 PM, Walk, Park');
  assert.equal(eventLabel(events[4], zone), 'All day, Holiday');
  // The same events in a different zone: the times follow the browser.
  assert.equal(eventLabel(events[0], 'Europe/London'), '6:00 to 6:30 PM, Sam and Andrea');
  assert.deepEqual([hourLabel(7), hourLabel(12), hourLabel(15), hourLabel(0)], ['7 AM', '12 PM', '3 PM', '12 AM']);
  assert.equal(dayLabel('2026-10-21'), 'Wednesday, October 21');
  assert.match(zoneLabel(zone, new Date('2026-10-21T12:00:00Z')), /^America\/New York \(EDT\)$/);
});

test('the detail of an event: the day and time, the place, the video link, the organizer, and the people with their answers', () => {
  const zone = 'America/New_York';
  const attendees = [
    { name: 'Sam Lee', email: 'sam@example.com', status: 'accepted' },
    { name: '', email: 'andrea@example.com', status: 'needs-action' },
    { name: 'Kim', email: 'kim@example.com', status: 'tentative' },
  ];
  const event = { title: 'Sync', start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T17:30:00.000Z', allDay: false, location: 'Room 4', hasOthers: true,
    attendees, organizer: { name: 'Sam Lee', email: 'sam@example.com' }, link: 'https://meet.google.com/abc-defg-hij' };
  assert.deepEqual(eventDetails(event, '2026-10-21', zone), [
    { label: 'When', text: 'Wednesday, October 21, 1:00 to 1:30 PM' },
    { label: 'Where', text: 'Room 4' },
    { label: 'Link', text: 'Join on meet.google.com', href: 'https://meet.google.com/abc-defg-hij' },
    { label: 'Organizer', text: 'Sam Lee' },
    { label: 'With', items: ['Sam Lee (accepted)', 'andrea@example.com (no answer)', 'Kim (maybe)'] },
  ]);
  assert.equal(attendeeLabel({ name: 'Kim', email: 'kim@example.com', status: 'declined' }), 'Kim (declined)');
  assert.equal(attendeeLabel({ name: 'Kim', email: 'kim@example.com', status: '' }), 'Kim');
  // The owner organizes (the server gives no organizer then): no Organizer row. A web address as the place is a link,
  // and not a second time as Link.
  const mine = { ...event, organizer: null, location: 'https://zoom.us/j/1', link: 'https://zoom.us/j/1' };
  assert.deepEqual(eventDetails(mine, '2026-10-21', zone).map((r) => r.label), ['When', 'Where', 'With']);
  assert.deepEqual(eventDetails(mine, '2026-10-21', zone)[1], { label: 'Where', text: 'zoom.us', href: 'https://zoom.us/j/1' });
  // An event from an older copy of the Inbox, with no people and no link: only the time.
  assert.deepEqual(eventDetails({ title: 'Walk', start: '2026-10-21T20:00:00.000Z', end: '2026-10-21T20:30:00.000Z', allDay: false, location: '' }, '2026-10-21', zone),
    [{ label: 'When', text: 'Wednesday, October 21, 4:00 to 4:30 PM' }]);
  // All day, one day and several days.
  assert.deepEqual(eventDetails({ title: 'Holiday', start: '2026-10-21', end: '2026-10-22', allDay: true }, '2026-10-21', zone), [{ label: 'When', text: 'All day, Wednesday, October 21' }]);
  assert.deepEqual(eventDetails({ title: 'Conference', start: '2026-10-21', end: '2026-10-23', allDay: true }, '2026-10-22', zone), [{ label: 'When', text: 'All day, Wednesday, October 21 to Thursday, October 22' }]);
});

test('nothing pops up over the Inbox: no toasts (memo 895), and a memo that arrives simply appears in the list with its tag', async () => {
  const inbox = (await get('/inbox')).text;
  const css = (await get('/ui/common.css')).text;
  // The pop-up toasts went (memo 895): no box, no script, no style for them.
  assert.doesNotMatch(inbox, /toast/i);
  assert.doesNotMatch(css, /toast/i);
  // The new tag on a memo in the list stays: that is how an arrival shows.
  assert.ok(inbox.includes("if (tag) { tag.classList.add('gone'); setTimeout(() => tag.remove(), 1500); }"));
  // The one-column rule of the CSS stays a media query, so it follows a rotation of the phone.
  assert.match(inbox, /const phone = matchMedia\('\(max-width: 52rem\)'\);/);
  // Nothing else opens by itself on the page: no alert, confirm, prompt, notification, or install prompt. The event
  // detail and the image viewer are dialogs that the owner opens with a tap.
  const pages = [inbox, (await get('/ui/common.js')).text, (await get('/ui/ledger.js')).text, (await get('/ui/calendar.js')).text, (await get('/ui/lightbox.js')).text].join('\n');
  assert.doesNotMatch(pages, /\b(alert|confirm|prompt)\(|new Notification|requestPermission|beforeinstallprompt|serviceWorker/);
});

test('the Inbox links to the Agents page, and the Agents page links back', async () => {
  assert.match((await get('/inbox')).text, /href="\/agents"/);
  assert.match((await get('/agents')).text, /href="\/inbox"/);
});

test('the capture field has many lines and the page loads its key rules', async () => {
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /<textarea name="text"[^>]*aria-label="Task"/);
  assert.doesNotMatch(inbox, /<input name="text"/);
  assert.match((await get('/ui/keys.js')).type, /javascript/);
});

test('in the capture field Enter sends and Shift+Enter adds a line', () => {
  const key = (more = {}) => ({ key: 'Enter', shiftKey: false, altKey: false, isComposing: false, ...more });
  assert.equal(enterSends(key(), false), true);
  assert.equal(enterSends(key({ shiftKey: true }), false), false);
  assert.equal(enterSends(key({ altKey: true }), false), false);
  assert.equal(enterSends(key({ isComposing: true }), false), false, 'Enter that confirms an input method text does not send');
  assert.equal(enterSends(key({ keyCode: 229 }), false), false, 'Safari: the Enter after the composition ends has the key code 229');
  assert.equal(enterSends(key({ repeat: true }), false), false, 'a held key does not send again');
  assert.equal(enterSends(key({ key: 'a' }), false), false);
  assert.equal(enterSends(key(), true), false, 'on a touch screen Enter adds a line');
});

test('the capture field grows to a limit', () => {
  assert.equal(fieldHeight(40.2, 300), 41);
  assert.equal(fieldHeight(900, 300), 300);
  assert.equal(fieldHeight(-5, 300), 0);
});

test('the pages can attach an image', async () => {
  assert.match((await get('/ui/attach.js')).type, /javascript/);
  const common = (await get('/ui/common.js')).text;
  assert.match(common, /accept: ACCEPT/);
  // video/* makes a phone offer its videos (an iPhone sends a .mov as video/quicktime); the extensions are for a browser that does not know a type.
  assert.equal(ACCEPT, 'image/png,image/jpeg,image/gif,image/webp,video/*,.mov,.mp4,.m4v,.webm,.pdf,.docx,.xlsx,.pptx,.csv,.txt,.md,.json,.html,.htm,.heic,.heif');
  assert.match((await get('/inbox')).text, /attach\(capture\.elements\.text/);
});

test('a small image goes as it is, and a large photo or an unknown type becomes a JPEG first', () => {
  assert.equal(sendsAsIs('image/png', 200_000), true);
  assert.equal(sendsAsIs('image/jpeg', 1_000_000), true);
  assert.equal(sendsAsIs('image/jpeg', 4_000_000), false, 'a large photo gets smaller');
  assert.equal(sendsAsIs('image/heic', 200_000), false);
  assert.equal(sendsAsIs('image/svg+xml', 2_000), false);
  assert.equal(sendsAsIs('image/gif', 4_000_000), true, 'a GIF can move, so it stays a GIF');
  assert.equal(sendsAsIs('image/gif', MAX_BYTES + 1), false);
});

test('an image that the browser makes smaller keeps its shape', () => {
  assert.deepEqual(fit(4032, 3024, 2400), { width: 2400, height: 1800 });
  assert.deepEqual(fit(3024, 4032, 2400), { width: 1800, height: 2400 });
  assert.deepEqual(fit(800, 600, 2400), { width: 800, height: 600 });
  assert.deepEqual(fit(0, 0, 2400), { width: 1, height: 1 });
});

test('an attached image is a Markdown line at the end of the text', () => {
  const name = '0123456789abcdef.jpg';
  assert.equal(withImage('', name), `![image](image:${name})\n`);
  assert.equal(withImage('The pain is here:\n', name), `The pain is here:\n\n![image](image:${name})\n`);
  const two = withImage(withImage('See', name), 'fedcba9876543210.png');
  assert.deepEqual(imageNames(two), [name, 'fedcba9876543210.png']);
  assert.deepEqual(imageNames(`${two}${two}`), [name, 'fedcba9876543210.png'], 'each name one time');
  assert.deepEqual(imageNames('![x](image:../../etc/passwd) ![y](https://example.com/a.png) ![z](image:0123.png)'), []);
  assert.deepEqual(imageNames(undefined), []);
});

test('the send buttons show a spinner, then a check mark, and do not send two times', async () => {
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /send\(sendButton, async \(\) => \{/);
  assert.match(inbox, /button\('Reply', \(b\) => reply\(memo, area\.value, b\)/);
  // Each caller of reply, addNote, and close gives a button: the key Command-Return gives the Reply button.
  assert.match(inbox, /reply\(memo, area\.value, sendButtons\[0\]\)/);
  assert.doesNotMatch(inbox, /reply\(memo, area\.value\)/);
  assert.doesNotMatch(inbox, /addNote\(memo, area\.value\)/);
  assert.doesNotMatch(inbox, /close\(memo\)/);
  assert.match((await get('/ui/feedback.js')).type, /javascript/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /button\.sending::after/);
  assert.match(css, /button\.sent::after/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('a check box with the focus does not stop the keys and the refresh', async () => {
  assert.match((await get('/inbox')).text, /at\.type !== 'checkbox'/);
});

test('a click on a memo image opens the lightbox, not a new tab', async () => {
  assert.match((await get('/ui/lightbox.js')).type, /javascript/);
  const common = (await get('/ui/common.js')).text;
  assert.doesNotMatch(common, /window\.open/);
  assert.match(common, /import \{ openLightbox \} from '\/ui\/lightbox\.js'/);
  // The Inbox calls loadImages at each refresh: an image must not get a second listener.
  assert.match(common, /if \(img\.dataset\.zoom\) continue;/);
  // The keyboard can open it too.
  assert.match(common, /img\.tabIndex = 0;/);
  assert.match(common, /event\.key !== 'Enter' && event\.key !== ' '/);
});

test('the lightbox is a modal dialog with a caption, a close button, Escape, and a link to the original', async () => {
  const box = (await get('/ui/lightbox.js')).text;
  assert.match(box, /dialog\.showModal\(\)/);
  assert.match(box, /caption\.textContent = img\.alt/);
  assert.match(box, /'Open original'/);
  assert.match(box, /target: '_blank', rel: 'noopener'/);
  assert.match(box, /setAttribute\('aria-label', 'Close the image'\)/);
  // Escape closes a modal dialog in the browser. All the ways to close end in the close event, which gives the focus back.
  assert.match(box, /addEventListener\('close', \(\) => \{[^}]*opener\.focus\(\)/s);
  assert.match(box, /event\.target === dialog \|\| event\.target === figure/);
  assert.match(box, /'ArrowRight'/);
  assert.match(box, /'ArrowLeft'/);
});

test('the lightbox does not block pinch-zoom on a phone', async () => {
  const css = (await get('/ui/common.css')).text;
  const box = (await get('/ui/lightbox.js')).text;
  assert.doesNotMatch(css, /touch-action\s*:/);
  assert.doesNotMatch(box, /preventDefault/);
  assert.doesNotMatch((await get('/inbox')).text, /user-scalable|maximum-scale/);
  assert.match(css, /\.lightbox \{[^}]*var\(--bg\)/, 'the backdrop follows the light or dark page color');
});

test('the lightbox steps round the images of a memo, and a swipe must be long and sideways', async () => {
  const { stepIndex, swipeStep } = await import('../ui/lightbox.js');
  assert.equal(stepIndex(0, 3, 1), 1);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(swipeStep(-80, 10), 1, 'a move to the left goes to the next image');
  assert.equal(swipeStep(80, -5), -1, 'a move to the right goes to the previous image');
  assert.equal(swipeStep(-30, 0), 0, 'a short move does nothing');
  assert.equal(swipeStep(-80, 70), 0, 'a move that is mostly down does nothing');
});

test('the Inbox keys do not act behind the lightbox, and draft thumbnails are not part of the memo images', async () => {
  const box = (await get('/ui/lightbox.js')).text;
  // The Inbox listens for its keys on the document. The dialog stops each key before it gets there.
  assert.match((await get('/inbox')).text, /document\.addEventListener\('keydown'/);
  assert.match(box, /addEventListener\('keydown', \(event\) => \{\s*(\/\/[^\n]*\n\s*)*event\.stopPropagation\(\);/);
  const common = (await get('/ui/common.js')).text;
  assert.match(common, /img\.closest\('\.thumbs'\) \|\| img\.closest\('\.memo'\)/);
  assert.match(common, /draft \|\| !i\.closest\('\.thumbs'\)/);
});

test('the Inbox shows each memo as a row with its name and next step; one memo is open at a time, and no full view is kept on the device', async () => {
  const page = (await get('/inbox')).text;
  assert.match(page, /memo\.title \|\| summary\(memo\.text\)/);
  assert.match(page, /'Next: '/);
  // One open memo: to open a memo draws the open one as its brief again. No choice is kept on the device, and the old key goes.
  assert.match(page, /let openId = null;/);
  assert.match(page, /function toggleOpen\(id\) \{\n  const was = openId;\n  openId = openId === id \? null : id;\n(  .*\n)*  if \(was !== null && was !== id\) redraw\(was\);\n  const node = redraw\(id\);/);
  assert.match(page, /localStorage\.removeItem\('memo-compact'\)/);
  assert.doesNotMatch(page, /localStorage\.(getItem|setItem)\('memo-compact'/);
  assert.doesNotMatch(page, /COMPACT_KEY/);
  // A brief is not the full text, so it does not mark the memo as seen.
  assert.match(page, /if \(memo\.id !== openId\) return briefView\(memo\)/);
  assert.match(page, /querySelectorAll\('\.memo:not\(\.brief\)'\)/);
  assert.match(page, /clearTimeout\(waiting\.get\(id\)\);\n  waiting\.delete\(id\);\n  old\.replaceWith/);
});

test('no header button expands all memos; the open memo has Collapse, and the keys o and c open and collapse', async () => {
  const page = (await get('/inbox')).text;
  assert.doesNotMatch(page, /id="compact"/);
  assert.match(page, /button\('Collapse', \(\) => toggleOpen\(memo\.id\)/);
  assert.match(page, /if \(event\.key === 'c'\) \{ if \(openId !== null\) toggleOpen\(openId\); return; \}/);
  assert.match(page, /else if \(event\.key === 'o'\) toggleOpen\(selected\);/);
  assert.match(page, /<dt><kbd>c<\/kbd><\/dt><dd>Collapse the open memo<\/dd>/);
  // The table head shows whenever the list has memos: the rows are always the table.
  assert.match(page, /\.hidden = answeredMode \? !answered\.length : scheduledMode \|\| !list\.length;/);
});

test('the Agents page shows the helpers of each agent: label, model, running or done, and the times', async () => {
  const page = (await get('/agents')).text;
  assert.match(page, /if \(agent\.helpers\?\.length\) parts\.push\(helpersView\(agent\)\)/);
  const block = page.slice(page.indexOf('const helperItem'), page.indexOf('function view('));
  assert.match(block, /h\.running \? 'item' : 'item done'/);
  assert.match(block, /el\('span', \{ className: 'model' \}, h\.model\)/);
  assert.match(block, /`Running since \$\{clock\(h\.started\)\}/);
  assert.match(block, /`Done \$\{age\(h\.ended\)\} · \$\{clock\(h\.started\)\} to \$\{clock\(h\.ended\)\}`/);
  // Read only, and the label goes in as text.
  for (const word of ['button(', 'innerHTML']) assert.ok(!block.includes(word), `the helpers block must not have ${word}`);
});

test('the Agents page and the Inbox card name the model of each agent, and the helper chips show the model as the server stores it (memo 1159)', async () => {
  const agentsPage = (await get('/agents')).text;
  const view = agentsPage.slice(agentsPage.indexOf('function view('));
  assert.ok(view.length > 0 && view.includes('return card'), 'the view of an agent is on the page');
  assert.match(view,/el\('span', \{ className: 'sender', title: `Agent \$\{agent\.name\}` \}, displayName\(agent\.name\)\), agent\.model \? el\('span', \{ className: 'model', title: 'The model of this agent' \}, agent\.model\) : '', ` \$\{state\(agent\)\}`/);
  const inbox = (await get('/inbox')).text;
  const card = inbox.slice(inbox.indexOf('function agentCard'), inbox.indexOf('function renderAgents'));
  assert.match(card, /stateDot\(a\), el\('b', \{ title: `Agent \$\{a\.name\}` \}, displayName\(a\.name\)\), a\.model \? el\('span', \{ className: 'agent-model', title: 'The model of this agent' \}, a\.model\) : '', el\('span', \{ className: 'agent-state' \}, agentState\(a\)\)/);
  // The chip shows the model text of the server, "Fable 5.1" or a bare alias of an old row, with no change in the browser.
  assert.match(inbox, /helperName\(h\), el\('span', \{ className: 'model' \}, h\.model\)\)/);
  const styles = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  assert.match(styles, /\.agent-model \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var\(--dim\); font-size: \.78rem; font-weight: 500; white-space: nowrap; \}/);
  assert.match(styles, /\.agent-head b \{ flex: none; white-space: nowrap; \}/, "the agent name never shortens; the model and state do (memo 1412)");
  assert.match(styles, /\.helpers \.model, \.meta \.model \{/);
});

test('the Inbox has a Shorten button on memos from an agent, which adds the fixed note and then shows Asked', async () => {
  const { COMPACT_NOTE, compactAsked } = await import('../ui/filter.js');
  const page = (await get('/inbox')).text;
  assert.match(page, /button\('Shorten', \(b\) => send\(b, \(\) => api\('\/api\/note', \{ id: memo\.id, from: 'cam', text: COMPACT_NOTE \}\)\)/);
  assert.match(page, /const canCompact = \(memo\) => !\['cam', 'liaison', 'discord'\]\.includes\(memo\.sender\)/);
  assert.match(page, /button\('Asked'/);
  assert.match(COMPACT_NOTE, /Use: memo compact <id>$/);
  assert.equal(compactAsked({ notes: [{ text: COMPACT_NOTE, read: 0 }] }), true);
  assert.equal(compactAsked({ notes: [{ text: COMPACT_NOTE, read: 1 }] }), false, 'after the agent reads the note, the owner can ask again');
  assert.equal(compactAsked({ notes: [{ text: 'Add the price.', read: 0 }] }), false);
  assert.equal(compactAsked({}), false);
});

test('the Inbox hides the Shorten note: it is only a signal to the agent', async () => {
  const { COMPACT_NOTE, shownNotes } = await import('../ui/filter.js');
  const memo = { notes: [{ author: 'cam', text: COMPACT_NOTE, read: 0 }, { author: 'main', text: 'Done.', read: 0 }] };
  assert.deepEqual(shownNotes(memo).map((n) => n.text), ['Done.']);
  assert.deepEqual(shownNotes({}), []);
  const page = (await get('/inbox')).text;
  assert.match(page, /shownNotes\(memo\)\.length \? el\('div', \{ className: 'notes' \}/);
});

test('the Inbox has an Answered view in the side nav that shows the answered memos read only in the main column', async () => {
  const page = (await get('/inbox')).text;
  // No side card any more.
  assert.doesNotMatch(page, /id="answered-toggle"/);
  assert.doesNotMatch(page, /<section class="card" id="answered">/);
  // The nav item is a button with aria-pressed and a count badge, in the Views nav.
  assert.match(page, /id: 'nav-answered'/);
  assert.match(page, /b\.setAttribute\('aria-pressed', String\(answeredMode\)\)/);
  assert.match(page, /views\.replaceChildren\(\.\.\.choices\.map\(\(\[value, label\]\) => viewLink\(value, label\)\), answeredLink\(\), scheduledLink\(\)\)/);
  // The list is in the main column and comes from GET /api/answered.
  assert.match(page, /<main id="queue"><\/main>\s*<div id="answered-list" hidden><\/div>/);
  assert.match(page, /api\('\/api\/answered'\)/);
  // The rows reuse the queue rows with a read-only flag; the status chip has text.
  assert.match(page, /function briefView\(memo, readOnly = false\)/);
  assert.match(page, /if \(readOnly\) return answeredOpened\.has\(memo\.id\) \? answeredView\(memo\) : briefView\(memo, true\)/);
  assert.match(page, /const STATUS_WORD = \{ replied: 'Replied', closed: 'Closed' \}/);
  // The open answered memo has no buttons that change it.
  const ro = page.slice(page.indexOf('function answeredView'), page.indexOf('function view('));
  for (const word of ["'Reply'", "'Note'", "'Close'", "'Postpone'", "'+ tag'", 'textarea', 'onCheck']) assert.ok(!ro.includes(word), `the Answered view must not have ${word}`);
  // Any other view, and the Inbox link, go back to the queue.
  assert.match(page, /function setFilter\(next\) \{\n  filter = next;\n  answeredMode = false;/);
  assert.match(page, /setAnswered\(false\)/);
});

test('the Inbox has a Scheduled view in the side nav that shows local/schedule.json read only in the main column', async () => {
  const page = (await get('/inbox')).text;
  // The nav item is next to Answered, a button with aria-pressed and a count badge.
  assert.match(page, /id: 'nav-scheduled'/);
  assert.match(page, /b\.setAttribute\('aria-pressed', String\(scheduledMode\)\)/);
  assert.match(page, /schedule\.items\.length \? el\('span', \{ className: 'badge soft' \}/);
  assert.match(page, /answeredLink\(\), scheduledLink\(\)\)/);
  // The list is in the main column and comes from GET /api/schedule, read again on each load.
  assert.match(page, /<div id="answered-list" hidden><\/div>\s*<div id="scheduled-list" hidden><\/div>/);
  assert.match(page, /api\('\/api\/schedule'\)/);
  assert.match(page, /loadAnswered\(\);\n    loadSchedule\(\);/);
  // A table with column headers and row headers, the updated date, and "Ends <date>" when until is set.
  const ro = page.slice(page.indexOf('function renderScheduled'), page.indexOf('function scheduledLink'));
  for (const head of ["th('Name')", "th('When')", "th('Where')", "th('What')"]) assert.ok(ro.includes(head), `the table must have ${head}`);
  assert.match(ro, /node\.scope = 'col'/);
  assert.match(ro, /name\.scope = 'row'/);
  assert.match(ro, /'Updated '/);
  assert.match(ro, /if \(item\.until\) name\.append\(el\('span', \{ className: 'ends' \}, `Ends \$\{item\.until\}`\)\)/);
  // Read only: no buttons and no text fields; text goes in as text, not HTML.
  for (const word of ['button(', 'textarea', 'innerHTML', 'input']) assert.ok(!ro.includes(word), `the Scheduled view must not have ${word}`);
  // Answered and Scheduled are not on at the same time; Inbox and the other views go back to the queue.
  assert.match(page, /function setScheduled\(on\) \{\n  scheduledMode = on;\n  if \(on\) answeredMode = false;/);
  assert.match(page, /answeredMode = on;\n  if \(on\) scheduledMode = false;/);
  assert.match(page, /answeredMode = false;\n  scheduledMode = false;/);
  assert.match(page, /if \(!otherMode\(\)\) return;\n  event\.preventDefault\(\);\n  scheduledMode = false;\n  setAnswered\(false\);/);
});

test('the drafts: the newer one wins, a local text goes to the server, a sent draft stays as a mark, old ones go', async () => {
  const { parseDrafts, newer, mergeDrafts, pruneDrafts, draftText, nextStamp, caretAfter, DRAFTS_KEY, SAVE_AFTER_MS, SAVE_AFTER_LEDGER_MS, DRAFT_POLL_MS, DRAFT_POLL_LEDGER_MS, TYPING_MS } = await import('../ui/drafts.js');
  assert.equal(DRAFTS_KEY, 'memo-drafts');
  assert.ok(SAVE_AFTER_LEDGER_MS > SAVE_AFTER_MS, 'on the GitHub copy each save is a commit, so the pause is longer');
  assert.equal(DRAFT_POLL_MS, 5000);
  assert.equal(DRAFT_POLL_LEDGER_MS, 15000, 'on the GitHub copy the drafts poll is the same read as the list');
  assert.ok(TYPING_MS >= SAVE_AFTER_MS, 'a draft that waits for its save is never replaced');
  const at = (s) => `2026-10-28T12:00:${String(s).padStart(2, '0')}.000Z`;
  // Only drafts come out of localStorage.
  assert.deepEqual(parseDrafts('{"12":{"text":"Yes","updated":"2026-10-28T12:00:00.000Z"},"x":{"text":"no"},"13":"bad","t-abc":{"text":"","updated":"2026-10-28T12:00:00.000Z"}}'),
    { 12: { text: 'Yes', updated: at(0) }, 't-abc': { text: '', updated: at(0) } });
  assert.deepEqual(parseDrafts('not json'), {});
  assert.deepEqual(parseDrafts('[1]'), {});
  assert.deepEqual(parseDrafts(null), {});
  assert.equal(newer({ text: 'a', updated: at(2) }, { text: 'b', updated: at(1) }), true);
  assert.equal(newer({ text: 'a', updated: at(1) }, { text: 'b', updated: at(1) }), false);
  assert.equal(newer({ text: 'a', updated: at(1) }, undefined), true);
  assert.equal(newer(undefined, { text: 'a', updated: at(1) }), false);
  // The merge: the phone typed later on 1; the computer typed later on 2; 3 is only here; 4 is only there; 5 was sent here.
  const local = { 1: { text: 'old', updated: at(1) }, 2: { text: 'mine', updated: at(5) }, 3: { text: 'here', updated: at(3) }, 5: { text: '', updated: at(9) }, 6: { text: 'same', updated: at(6) } };
  const remote = { 1: { text: 'phone', updated: at(2) }, 2: { text: 'theirs', updated: at(4) }, 4: { text: 'there', updated: at(4) }, 5: { text: 'stale', updated: at(8) }, 6: { text: 'same', updated: at(6) } };
  const { merged, send, changed } = mergeDrafts(local, remote);
  assert.deepEqual(merged, { 1: remote[1], 2: local[2], 3: local[3], 4: remote[4], 5: local[5], 6: local[6] });
  assert.deepEqual(send, ['2', '3'], 'a newer local text goes to the server; a cleared draft and an equal one do not');
  assert.deepEqual(changed, ['1', '4'], 'the texts that changed on the page');
  assert.deepEqual(mergeDrafts({}, undefined), { merged: {}, send: [], changed: [] });
  // A memo she types in now (hold): its draft stays, goes nowhere, and the newer remote waits for the next merge.
  const held = mergeDrafts(local, remote, (id) => id === '1' || id === '3');
  assert.deepEqual(held.merged, { ...merged, 1: local[1] });
  assert.deepEqual(held.send, ['2']);
  assert.deepEqual(held.changed, ['4']);
  // The time of a change: the clock, or one millisecond after a draft from a device with a clock ahead.
  const clock = Date.parse(at(10));
  assert.equal(nextStamp(undefined, clock), at(10));
  assert.equal(nextStamp({ text: 'a', updated: at(5) }, clock), at(10));
  assert.equal(nextStamp({ text: 'a', updated: at(30) }, clock), '2026-10-28T12:00:30.001Z', 'the phone is 20 seconds ahead: what she types now still wins');
  assert.ok(newer({ text: 'b', updated: nextStamp({ text: 'a', updated: at(30) }, clock) }, { text: 'a', updated: at(30) }));
  // The cursor after a text from the other device: at its place when the text grew after it, else at the end.
  assert.equal(caretAfter('Yes, if', 'Yes, if the room', 4), 4);
  assert.equal(caretAfter('Yes, if', 'No', 4), 2);
  // The prune: a sent draft after a day; a draft of a memo that is gone after a week; the rest stays.
  const now = Date.parse('2026-10-28T12:00:00.000Z');
  const day = 86400000;
  const old = {
    1: { text: '', updated: new Date(now - 2 * day).toISOString() }, 2: { text: '', updated: new Date(now - day / 2).toISOString() },
    3: { text: 'gone', updated: new Date(now - 8 * day).toISOString() }, 4: { text: 'open', updated: new Date(now - 8 * day).toISOString() },
    5: { text: 'there', updated: new Date(now - 8 * day).toISOString() }, 6: { text: 'fresh', updated: new Date(now - day).toISOString() },
  };
  assert.deepEqual(Object.keys(pruneDrafts(old, [4], { 5: old[5] }, now)), ['2', '4', '5', '6']);
  assert.equal(draftText(old, 6), 'fresh');
  assert.equal(draftText(old, 99), '');
});

test('the Inbox saves the reply text of each memo as a draft, restores it, and clears it with the send', async () => {
  const page = (await get('/inbox')).text;
  assert.match(page, /import \{ DRAFTS_KEY, SAVE_AFTER_MS, SAVE_AFTER_LEDGER_MS, DRAFT_POLL_MS, DRAFT_POLL_LEDGER_MS, TYPING_MS, parseDrafts, mergeDrafts, pruneDrafts, draftText, nextStamp, caretAfter \} from '\/ui\/drafts\.js'/);
  assert.match((await get('/ui/drafts.js')).type, /javascript/);
  assert.doesNotMatch(page, /drafts\.(get|set|delete)\(/, 'the old map in memory is gone');
  // Typing saves after a pause; a text that the page itself puts into the field is not typing.
  assert.match(page, /value: draftText\(drafts, memo\.id\)/);
  assert.match(page, /area\.addEventListener\('input', \(\) => \{ if \(!settingDraft\) setDraft\(memo\.id, area\.value\); \}\)/);
  assert.match(page, /saveTimers\.set\(id, setTimeout\(\(\) => saveDraft\(id\), SAVE_AFTER\)\)/);
  assert.match(page, /const SAVE_AFTER = globalThis\.MEMO_LEDGER \? SAVE_AFTER_LEDGER_MS : SAVE_AFTER_MS;/);
  assert.match(page, /api\('\/api\/draft', \{ id: Number\(id\) \|\| id, text: d\.text, updated: d\.updated \}, \{ keepalive \}\)/);
  // The draft is in localStorage too, for a page with no server.
  assert.match(page, /localStorage\.setItem\(DRAFTS_KEY, JSON\.stringify\(drafts\)\)/);
  assert.match(page, /drafts = parseDrafts\(localStorage\.getItem\(DRAFTS_KEY\)\)/);
  // The drafts of the server come with the queue; the newer one wins; the open field gets a newer text when she does not type in it.
  assert.match(page, /if \(data\.drafts && typeof data\.drafts === 'object'\) takeDrafts\(data\.drafts\);/);
  assert.match(page, /const \{ merged, send, changed \} = mergeDrafts\(drafts, remote, \(id\) => busy\(id\) \|\| \(scope !== null && !scope\.has\(id\)\)\);/);
  // Memo 492: the answer to one save speaks for that memo only, and only drafts of memos in the Inbox go back out.
  assert.match(page, /takeDrafts\(\{ \[id\]: \{ text: saved\.text, updated: saved\.updated \} \}, \[id\]\);/);
  assert.match(page, /for \(const id of send\) if \(open\.has\(id\) && !saveTimers\.has\(id\) && !rejected\.has\(id\)\)/);
  // A change gets a time after the draft it replaces, whatever the clocks of the two devices say.
  assert.match(page, /drafts\[id\] = \{ text, updated: nextStamp\(drafts\[id\]\) \};/);
  assert.match(page, /typedAt\.set\(id, Date\.now\(\)\);/);
  // A field with a keystroke in the last seconds, or a save that waits, keeps its text; any other open field takes
  // the newer text, also with the focus in it, with the cursor at its place.
  assert.match(page, /const busy = \(id\) => Date\.now\(\) - \(typedAt\.get\(id\) \|\| 0\) < TYPING_MS \|\| saveTimers\.has\(id\);/);
  assert.match(page, /if \(area && area\.value !== draftText\(drafts, id\)\)/);
  assert.match(page, /const caret = area === document\.activeElement \? caretAfter\(area\.value, draftText\(drafts, id\), area\.selectionStart\) : null;/);
  // The drafts poll runs while a memo is open, also while she types; the list loads each 15 seconds when she does not.
  assert.match(page, /const DRAFT_POLL = globalThis\.MEMO_LEDGER \? DRAFT_POLL_LEDGER_MS : DRAFT_POLL_MS;/);
  assert.match(page, /async function pollDrafts\(\) \{\n  try \{\n    const data = await api\('\/api\/queue'\);\n    if \(data\.drafts && typeof data\.drafts === 'object'\) takeDrafts\(data\.drafts\);/);
  assert.match(page, /if \(free && Date\.now\(\) - polled >= POLL_MS - DRAFT_POLL \/ 2\) \{ polled = Date\.now\(\); load\(\); loadAgents\(\); \} else if \(openId !== null\) pollDrafts\(\);\n\}, DRAFT_POLL\);/);
  assert.doesNotMatch(page, /\}, 15000\);/, 'the one poll runs each DRAFT_POLL');
  // A collapse, a blur, and a page that goes away send the draft now.
  assert.match(page, /if \(was !== null && saveTimers\.has\(String\(was\)\)\) saveDraft\(was\);/);
  assert.match(page, /area\.addEventListener\('blur', \(\) => \{ if \(saveTimers\.has\(String\(memo\.id\)\)\) saveDraft\(memo\.id\); \}\)/);
  assert.match(page, /addEventListener\('pagehide', \(\) => flushDrafts\(true\)\)/);
  assert.match(page, /if \(document\.visibilityState === 'hidden'\) flushDrafts\(true\)/);
  // The send clears it; Close sends the draft text.
  // by: the page names the owner as the actor, for the event log.
  assert.match(page, /await api\('\/api\/reply', \{ id: memo\.id, text, by: 'cam' \}\); clearDraft\(memo\.id\);/);
  assert.match(page, /await api\('\/api\/note', \{ id: memo\.id, from: 'cam', text \}\); clearDraft\(memo\.id\);/);
  assert.match(page, /await api\('\/api\/close', \{ id: memo\.id, text: draftText\(drafts, memo\.id\) \|\| undefined, by: 'cam' \}\); clearDraft\(memo\.id\);/);
  assert.match(page, /drafts\[id\] = \{ text: '', updated: nextStamp\(drafts\[id\]\) \};/);
  // The hint under the field.
  assert.match(page, /className: 'draft-hint dim'/);
  for (const word of ["'Saving…'", "'Draft saved'", "'Draft kept on this device'"]) assert.ok(page.includes(word), word);
  assert.match((await get('/ui/common.css')).text, /\.draft-hint \{/);
  // The two copies of the page send the same request, with keepalive when the page goes away.
  const common = (await get('/ui/common.js')).text;
  assert.match(common, /export async function api\(path, body, \{ keepalive = false \} = \{\}\)/);
  assert.match(common, /ledgerApi\(path, body, \{ keepalive \}\)/);
  const ledger = readFileSync(join(ROOT, 'ui', 'ledger.js'), 'utf8');
  assert.match(ledger, /case '\/api\/draft': \{/);
  assert.match(ledger, /if \(path === '\/api\/draft'\) return \{ id: body\.id/);
});

test('the open memo has Back and Forward buttons through its thread, with a memo of the thread in the Answered form', async () => {
  const page = (await get('/inbox')).text;
  // The thread comes when the memo opens, and again with each list, from GET /api/thread.
  assert.match(page, /const t = await api\(`\/api\/thread\?id=\$\{id\}`\);/);
  assert.match(page, /if \(openId === id\) loadThread\(id\); else shownOf\.delete\(id\);/);
  assert.match(page, /if \(openId !== null && memos\.some\(\(m\) => m\.id === openId\)\) loadThread\(openId\);/);
  // The buttons, the place in the thread, and the way back to the memo.
  assert.match(page, /button\('‹ Back', \(\) => go\(-1\), 'The memo before this one in the thread'\)/);
  assert.match(page, /button\('Forward ›', \(\) => go\(1\), 'The memo after this one in the thread'\)/);
  assert.match(page, /back\.disabled = at <= 0;\n  forward\.disabled = at >= ids\.length - 1;/);
  assert.match(page, /`This memo · \$\{at \+ 1\} of \$\{ids\.length\} in its thread` : `Memo \$\{shown\.id\} · \$\{at \+ 1\} of \$\{ids\.length\}`/);
  assert.match(page, /button\('This memo', \(\) => \{ shownOf\.delete\(id\); renderThread\(id\); \}, 'Back to the open memo'\)/);
  // A memo with no thread shows no buttons.
  assert.match(page, /if \(!t \|\| t\.memos\.length < 2\) return box;/);
  // The memo of the thread shows as the Answered view shows a memo: its text, its notes, its reply or result; the text of
  // the open memo hides meanwhile, and its reply field stays.
  assert.match(page, /threadView\(memo\.id\),\n/);
  assert.match(page, /el\('div', \{ className: 'own', hidden: shownOf\.has\(memo\.id\) \},/);
  assert.match(page, /if \(own\) own\.hidden = shownOf\.has\(id\);/);
  assert.match(page, /const label = m\.state === 'replied' \? \(toOwner \? 'Your reply' : `Reply of \$\{displayName\(m\.recipient\)\}`\) : m\.state === 'closed' \? 'Closed'/);
  assert.match(page, /el\('div', \{ className: 'md' \}, \.\.\.markdown\(m\.text, el, \{ html: !\['liaison', 'discord'\]\.includes\(m\.sender\), vars: themeVars\(\) \}\)\)/);
  assert.match(page, /m\.reply \? el\('div', \{ className: 'md' \}, \.\.\.markdown\(m\.reply, el\)\) : el\('p', \{ className: 'dim' \}, 'No text\.'\)/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.thread-nav \{/);
  assert.match(css, /\.transcript \{/);
  // The phone copy answers from the threads that the computer published.
  const ledger = readFileSync(join(ROOT, 'ui', 'ledger.js'), 'utf8');
  assert.match(ledger, /if \(url\.pathname === '\/api\/thread'\) \{/);
  // A thread that does not load says so in its place (a server from before the route gives 404), and the next load asks again.
  assert.match(page, /threads\.delete\(id\);\n    const old = nodeOf\(id\)\?\.querySelector\('\.thread'\);\n    if \(old\) old\.replaceWith\(el\('div', \{ className: 'thread' \}, el\('p', \{ className: 'dim' \}, `The thread of this memo did not load: \$\{error\.message\}`\)\)\);/);
});

test('the Inbox has a Refresh button, loads again when it comes to the front, and loads itself again after a restart of the server', async () => {
  const page = (await get('/inbox')).text;
  // The button in the header, next to the capture field, on the computer and on the phone (the same page).
  assert.match(page, /<button type="button" id="refresh" class="refresh" title="Load the memos and the agents again now">Refresh<\/button>/);
  assert.match(page, /document\.getElementById\('refresh'\)\.addEventListener\('click', \(event\) => \{ withFeedback\(event\.currentTarget, refresh\)/);
  // The page comes to the front: the clocks of a page in the background stand still on a phone, so the list loads now.
  assert.match(page, /document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) refresh\(\); \}\);/);
  assert.match(page, /addEventListener\('pageshow', \(event\) => \{ if \(event\.persisted\) refresh\(\); \}\);/);
  // A reply field she typed in during the last seconds holds the list (the busy rule of the drafts); the poll comes after.
  assert.match(page, /function refresh\(\) \{\n  if \(openId !== null && busy\(String\(openId\)\)\) return Promise\.resolve\(\);\n  polled = Date\.now\(\);\n  return Promise\.all\(\[load\(\), loadAgents\(\), loadCalendar\(\)\]\);\n\}/);
  // A new list keeps the focus and the cursor of a reply field.
  assert.match(page, /const keep = active\?\.tagName === 'TEXTAREA' && active\.closest\('\.memo'\)/);
  assert.match(page, /area\.focus\(\{ preventScroll: true \}\); area\.setSelectionRange\(keep\.start, keep\.end\);/);
  // The server started again since the first load: the page loads itself again, not on the GitHub copy.
  assert.match(page, /if \(!globalThis\.MEMO_LEDGER\) \{\n(?:.*\n)?      const started = data\.started \|\| '';\n      if \(serverStart !== null && serverStart !== started\) return location\.reload\(\);\n      serverStart = started;\n    \}/);
  assert.match((await get('/ui/common.css')).text, /\.top \.refresh \{/);
});

test('the state words and the two lists of open memos of an agent', async () => {
  const { stateWord, waitingLists, memoTitle } = await import('../ui/agentstate.js');
  const long = { name: 'main', kind: 'long', running: true, open_to: 1, open_from: 2 };
  assert.equal(stateWord({ ...long, running: false }), 'Stopped');
  assert.equal(stateWord({ ...long, running: false, last_stop: 'no_recap' }), 'Stopped with no recap');
  assert.equal(stateWord({ ...long, activity: 'idle' }), 'Idle');
  assert.equal(stateWord({ ...long, activity: 'working' }), 'Working');
  assert.equal(stateWord({ ...long, activity: 'idle', stopping_since: '2026-10-28T12:00:00Z' }), 'Stopping');
  assert.equal(stateWord({ ...long, activity: 'blocked' }), 'Blocked');
  assert.equal(stateWord(long), 'Working', 'an older server gives no activity: a session that runs works');
  assert.equal(stateWord({ name: 'mac', kind: 'remote', online: false }), 'Offline');
  assert.equal(stateWord({ name: 'mac', kind: 'remote', online: true, activity: 'idle' }), 'Idle');
  assert.equal(stateWord({ name: 'liaison', kind: 'short' }), '');
  assert.equal(memoTitle({ id: 3, title: 'Driver license', line: 'Mail the form.' }), 'Driver license');
  assert.equal(memoTitle({ id: 3, title: null, line: '# **Mail** the form' }), 'Mail the form');
  assert.equal(memoTitle({ id: 3, title: null, line: '' }), 'Memo 3');
  const lists = waitingLists({ ...long, memos_to: [{ id: 7, title: null, line: 'Work.' }], memos_from: [{ id: 3, title: 'Driver license', line: 'x', until: '2026-12-01T14:00:00.000Z' }, { id: 5, title: null, line: 'Pay' }] }, 'cam');
  assert.deepEqual(lists, [
    { key: 'to', label: 'Memos waiting on Peeve', count: 1, items: [{ id: 7, title: 'Work.', postponed: false }] },
    { key: 'from', label: 'Memos waiting on cam', count: 2, items: [{ id: 3, title: 'Driver license', postponed: true }, { id: 5, title: 'Pay', postponed: false }] },
  ]);
  assert.deepEqual(waitingLists({ name: 'main', open_to: 2, open_from: 0 }, 'cam').map((w) => [w.count, w.items]), [[2, null], [0, null]], 'an older server gives the counts only');
});

// Memos 980, 982 and 1047: the pick of the capture form, by headroom.
test('the capture form picks the agent by its headroom: the numbered rule of memo 1047', async () => {
  const { pickAgent, bestAgent, fableTask, fableOf, atLimit, LIMIT_AT, PICK_HINT, CODE_WORDS, WORK_WORDS } = await import('../ui/agentstate.js');
  // Sunday at 10 in the morning in Los Angeles. The session resets in 4 hours 12 minutes, so 84 percent of it is
  // left; the week resets Tuesday at 10, so 28.6 percent of it is left. Headroom: the percent left minus that.
  const now = new Date('2026-11-08T18:00:00Z');
  const S = '2026-11-08T22:12:00Z';
  const W = '2026-11-10T18:00:00Z';
  const use = (session, week, { fable, at = '2026-11-08T17:57:00Z', sReset = S, wReset = W } = {}) => ({
    at, error: null, session: { percent: session, resets_at: sReset }, week: { percent: week, resets_at: wReset },
    models: fable === undefined ? [] : [{ name: 'Fable', percent: fable, resets_at: wReset }],
  });
  const agent = (name, activity, usage) => ({ name, kind: 'long', running: true, activity, usage });
  const pick = (agents, task = '') => bestAgent(agents, { now, task });

  // 1. Wait or work first.
  assert.equal(pick([agent('main', 'blocked', use(10, 20)), agent('second', 'working', use(10, 80))]), 'second', 'working before blocked');
  assert.equal(pick([{ ...agent('main', 'idle', use(10, 10)), running: false }, agent('second', 'working', use(10, 90))]), 'second', 'a stopped agent comes after a working one');
  assert.equal(pick([{ ...agent('main', 'idle', use(10, 10)), stopping_since: '2026-11-08T17:59:00Z' }, agent('second', 'working', use(10, 90))]), 'second', 'a stopping agent too');
  // 2. Known figures before unknown: none, older than 20 minutes, or from before a reset that passed.
  assert.equal(pick([agent('main', 'idle', null), agent('second', 'working', use(10, 90))]), 'second', 'no figures');
  assert.equal(pick([agent('main', 'idle', use(10, 20, { at: '2026-11-08T17:30:00Z' })), agent('second', 'working', use(10, 80))]), 'second', 'figures from 30 minutes ago');
  assert.equal(pick([agent('main', 'idle', use(10, 20, { sReset: '2026-11-08T17:00:00Z' })), agent('second', 'working', use(10, 80))]), 'second', 'the session reset passed with no new figures');
  assert.equal(pick([agent('main', 'idle', { error: 'no answer' }), agent('second', 'idle', null)]), 'main', 'both unknown: main');
  // 3. The floor: 5 points or fewer left in the session or the week, unless that reset is within 15 minutes.
  assert.equal(pick([agent('main', 'idle', use(96, 20)), agent('second', 'working', use(10, 20))]), 'second', 'a session at its limit comes last, even idle');
  assert.equal(pick([agent('main', 'idle', use(10, 95)), agent('second', 'working', use(10, 20))]), 'second', 'a week at its limit too');
  assert.equal(pick([agent('main', 'idle', use(96, 20, { sReset: '2026-11-08T18:10:00Z' })), agent('second', 'working', use(10, 20))]), 'main', 'the session resets in 10 minutes: the floor lets it through');
  // 4. Every agent at its limit: the one whose reset comes first, and the hint says so.
  const all = pickAgent([agent('main', 'idle', use(96, 20)), agent('second', 'idle', use(10, 97))], { now });
  assert.equal(all.name, 'main', 'the session of main resets this afternoon, the week of second on Tuesday');
  assert.equal(all.hint, 'Every agent is at its limit: Peeve resets first, this afternoon');
  assert.equal(pickAgent([agent('main', 'idle', use(10, 20)), agent('second', 'idle', use(10, 97))], { now }).hint, PICK_HINT, 'one agent has room: the usual hint');
  // 6. The higher binding headroom, the lower of the session and the week; a gap under 15 points is a tie.
  // main: session 6, week 51, so 6. second: session 6, week minus 19, so minus 19. A gap of 25.
  assert.equal(pick([agent('main', 'working', use(10, 20)), agent('second', 'idle', use(10, 90))]), 'main', 'more headroom beats idle when the gap is 15 or more');
  // second: week minus 9.6, so minus 9.6. A gap of 15.6: still not a tie.
  assert.equal(pick([agent('main', 'working', use(10, 20)), agent('second', 'idle', use(10, 81))]), 'main', 'a gap just over 15');
  // second: week minus 8.6, a gap of 14.6: a tie, and idle wins.
  assert.equal(pick([agent('main', 'working', use(10, 20)), agent('second', 'idle', use(10, 80))]), 'second', 'a gap under 15 is a tie: idle before working');
  assert.equal(pick([agent('main', 'idle', use(10, 40)), agent('second', 'idle', use(10, 40))]), 'main', 'a full tie keeps main');
  // Both with spare room, above plus 15: the one whose reset comes first, since its points expire sooner.
  const soon = '2026-11-08T19:00:00Z'; // 20 percent of the session left
  const sooner = '2026-11-08T18:30:00Z'; // 10 percent left
  const later = '2026-11-08T22:00:00Z'; // 80 percent left
  assert.equal(pick([agent('main', 'idle', use(50, 20, { sReset: soon })), agent('second', 'idle', use(0, 20, { sReset: sooner }))]), 'second', 'main has 30, second 51, both spare: second resets first');
  assert.equal(pick([agent('main', 'idle', use(0, 20, { sReset: sooner })), agent('second', 'idle', use(50, 20, { sReset: soon }))]), 'main', 'the same the other way round');
  assert.equal(pick([agent('main', 'idle', use(50, 20, { sReset: soon })), agent('second', 'idle', use(80, 20, { sReset: later }))]), 'main', 'main has 30, second minus 60: not both spare, so the higher headroom');
  assert.equal(pick([agent('main', 'idle', use(50, 20, { sReset: soon })), agent('second', 'idle', use(0, 20, { sReset: later }))]), 'main', 'main 30 and second 20 are a tie, both spare: main resets first');
  assert.equal(pick([agent('main', 'working', use(50, 20, { sReset: soon })), agent('second', 'idle', use(0, 20, { sReset: later }))]), 'second', 'in a tie an idle agent stays busy before the earlier reset');
  // 5. A Fable task: the higher Fable headroom; a gap under 10 is a tie; a known Fable figure before none; 10 Fable
  // points or fewer left is the floor.
  const a = agent('main', 'idle', use(10, 20, { fable: 80 })); // Fable headroom minus 9
  const b = agent('second', 'working', use(10, 20, { fable: 30 })); // plus 41
  assert.equal(pick([a, b], 'Draft the newsletter'), 'main', 'no Fable words: Fable does not count, and idle wins the tie');
  assert.equal(pick([a, b], 'OPS: reconcile the bank account'), 'second', 'OPS task: the most Fable headroom');
  assert.equal(pick([a, b], 'FUND: thank the donor'), 'second');
  assert.equal(pick([a, b], 'Fix the code in ui/usage.js'), 'second', 'code in plain words');
  assert.equal(pick([agent('main', 'idle', use(10, 20, { fable: 35 })), agent('second', 'working', use(10, 20, { fable: 30 }))], 'OPS'), 'main', 'a gap of 5 is a tie: idle wins');
  assert.equal(pick([agent('main', 'idle', use(10, 20, { fable: 92 })), agent('second', 'working', use(10, 20, { fable: 10 }))], 'OPS'), 'second', '8 Fable points left is under the floor for such a task');
  assert.equal(pick([agent('main', 'idle', use(10, 20, { fable: 92 })), agent('second', 'working', use(10, 20, { fable: 10 }))], 'Order lunch'), 'main', 'but not for a plain task');
  assert.equal(pick([agent('main', 'idle', use(10, 20)), agent('second', 'idle', use(10, 20, { fable: 50 }))], 'OPS'), 'second', 'a known Fable figure before none');
  assert.equal(pick([agent('main', 'working', use(10, 20, { fable: 10 })), agent('second', 'blocked', use(10, 20, { fable: 90 }))], 'OPS'), 'main', 'the state still comes first');
  // Only the long agents are candidates.
  assert.equal(pick([{ name: 'liaison', kind: 'short' }, { name: 'mac', kind: 'remote', online: true, activity: 'idle' }, agent('main', 'working', use(10, 90))]), 'main');
  assert.equal(pick([{ name: 'liaison', kind: 'short' }]), '');
  assert.equal(pick(undefined), '');
  assert.deepEqual(pickAgent([], { now }), { name: '', hint: PICK_HINT });

  // The words that make a task a Fable task: the codes OPS and FUND, and plain words for deep work or code.
  assert.equal(fableTask('OPS: pay the Gusto invoice'), true);
  assert.equal(fableTask('Follow up on FUND-3'), true);
  assert.equal(fableTask('Check the ops calendar'), false, 'lower case is a word, not the code');
  assert.equal(fableTask('OPSEC review'), false);
  assert.equal(fableTask('FUNDS for the workshop'), false);
  for (const text of ['This is deep work', 'Needs Fable', 'It needs a Fable helper', 'Use Fable for this', 'Hard reasoning ahead', 'Deep reasoning, please', 'Coding the parser', 'Refactor the codebase', 'Fix the code in ui/usage.js', 'Write code for the export', 'Review my CODE']) assert.equal(fableTask(text), true, text);
  for (const text of ['Enter the zip code', 'Add the promo code', 'The memo code is 14', 'The verification code 1234', 'The code SYS goes on the memo', 'The dress code is casual', 'the source code', 'Order lunch', 'A fable about a fox', 'deeper work', 'codes for the door', '']) assert.equal(fableTask(text), false, text);
  assert.ok(CODE_WORDS instanceof RegExp);
  // The code SPEC, and the work that goes to Fable in words (memo 764): strategy, board, funder, grant, budget,
  // bookkeeping, tax, audit, payroll, policy, contract, compliance, and her voice. Whole words, in any case.
  assert.equal(fableTask('SPEC: the workshop page'), true);
  assert.equal(fableTask('See SPEC-2'), true);
  assert.equal(fableTask('SPECIAL delivery'), false);
  assert.equal(fableTask('the spec of the form'), false, 'lower case is a word, not the code');
  for (const text of ['Draft the strategy memo', 'The board meeting is Tuesday', 'Build the board deck', 'Send the board pre-read', 'Ask the board',
    'Write to the funder', 'Two funders to thank', 'Start the grant proposal', 'Finish the grant application', 'File the grant report', 'A donor letter for May',
    'Update the budget', 'Bookkeeping for October', 'Prepare the 990', 'The tax filing', 'Taxes are due', 'The audit starts Monday', 'Set up payroll',
    'Rewrite the travel policy', 'Review the contract', 'A compliance check', 'Reply in my voice', 'Answer as me', 'STRATEGY: the offsite', 'Board pre-read']) {
    assert.equal(fableTask(text), true, text);
  }
  for (const text of ['Onboarding for the new resident', 'Fix the syntax error', 'Boarding passes for the trip', 'Call her back about 1990', 'The grant is in',
    'Book the venue for Friday', 'Order lunch for the team', 'Reply to the resident', 'Move the chairs to the hall']) {
    assert.equal(fableTask(text), false, text);
  }
  assert.ok(WORK_WORDS instanceof RegExp);
  assert.deepEqual(fableOf(use(1, 1, { fable: 40 })), { name: 'Fable', percent: 40, resets_at: W });
  assert.equal(fableOf(use(1, 1)), null);
  assert.equal(LIMIT_AT, 95);
  assert.equal(atLimit(use(95, 10)), true);
  assert.equal(atLimit(use(10, 95)), true);
  assert.equal(atLimit(use(94, 94)), false);
  assert.equal(atLimit(null), false);
  // The hint is one short sentence with no parentheses.
  assert.ok(PICK_HINT.length < 200 && !/[()]/.test(PICK_HINT) && !/\.\s/.test(PICK_HINT));

  // The Inbox keeps a choice by hand until that task goes out, and shows the hint of the pick.
  const page = (await get('/inbox')).text;
  assert.match(page, /import \{ stateWord, pickAgent, fableShortNote, pickWords, helperMemoId, statusLine, helperGroups, finishedWords \} from '\/ui\/agentstate\.js'/);
  assert.match(page, /const pick = handPicked \? was : picked\.name;/);
  assert.match(page, /const to = handPicked \? capture\.elements\.to\.value : 'auto';/);
  assert.match(page, /capture\.elements\.to\.addEventListener\('change', \(\) => \{ handPicked = true;/);
  // The pick follows the text of the task, so the words typed in the field count before the next poll.
  assert.match(page, /capture\.elements\.text\.addEventListener\('input', \(\) => \{ if \(!handPicked && agents\.length\) chooseAgent\(\); \}\);/);
  assert.match(page, /to\.title = handPicked \? '' : picked\.hint;/);
});

test('a Fable task gets one line more when Fable is short on every account (memo 1047)', async () => {
  const { fableShortNote } = await import('../ui/agentstate.js');
  const now = new Date('2026-11-08T18:00:00Z');
  const zone = { now, timeZone: 'America/Los_Angeles' };
  const use = (fable, { at = '2026-11-08T17:57:00Z', reset = '2026-11-10T18:00:00Z' } = {}) => ({
    at, error: null, session: { percent: 10, resets_at: '2026-11-08T22:12:00Z' }, week: { percent: 20, resets_at: reset },
    models: fable === undefined ? [] : [{ name: 'Fable', percent: fable, resets_at: reset }],
  });
  const agent = (name, usage) => ({ name, kind: 'long', running: true, activity: 'idle', usage });
  const line = 'Fable is short on both accounts until Tuesday morning. Use an Opus helper or hold the deep part.';
  assert.equal(fableShortNote([agent('main', use(95)), agent('second', use(90))], { ...zone, task: 'OPS: reconcile the bank account' }), line, '10 points or fewer left on both');
  assert.equal(fableShortNote([agent('main', use(95)), agent('second', use(90, { reset: '2026-11-09T18:00:00Z' }))], { ...zone, task: 'OPS' }), 'Fable is short on both accounts until tomorrow morning. Use an Opus helper or hold the deep part.', 'the earliest reset');
  assert.equal(fableShortNote([agent('main', use(95)), agent('second', use(89))], { ...zone, task: 'OPS' }), '', 'second has 11 left');
  assert.equal(fableShortNote([agent('main', use(95)), agent('second', use(90))], { ...zone, task: 'Order lunch' }), '', 'not a Fable task');
  assert.equal(fableShortNote([agent('main', use(95)), agent('second', use(10, { at: '2026-11-08T17:00:00Z' }))], { ...zone, task: 'OPS' }), 'Fable is short on the account until Tuesday morning. Use an Opus helper or hold the deep part.', 'stale figures do not count');
  assert.equal(fableShortNote([agent('main', use(undefined)), agent('second', use(undefined))], { ...zone, task: 'OPS' }), '', 'no Fable row: the rule is skipped');
  assert.equal(fableShortNote([], { ...zone, task: 'OPS' }), '');
  // The Inbox adds the line under the text when it sends the task.
  const page = (await get('/inbox')).text;
  assert.match(page, /const short = fableShortNote\(agents, \{ task: capture\.elements\.text\.value \}\);/);
  assert.match(page, /text: short \? `\$\{capture\.elements\.text\.value\}\\n\\n\$\{short\}` : capture\.elements\.text\.value/);
});

test('the Agents page shows Idle, Working or Stopped, and the two numbered lists of open memos with links to the Inbox', async () => {
  const page = (await get('/agents')).text;
  assert.match(page, /import \{ stateWord, waitingLists, statusLine, helperGroups, finishedWords \} from '\/ui\/agentstate\.js'/);
  assert.match((await get('/ui/agentstate.js')).type, /javascript/);
  // The state of an agent is never "Running" (a helper that runs still says so).
  assert.doesNotMatch(page.slice(page.indexOf('function state('), page.indexOf('function control(')), /'Running'/);
  assert.doesNotMatch(page, /Open memos to/);
  assert.match(page, /if \(word === 'Idle'\) return agent\.kind === 'remote' \? 'Idle, waits for memos on a different computer' : 'Idle, waits for memos';/);
  assert.match(page, /if \(word === 'Working'\) return agent\.kind === 'remote' \? 'Working, on a different computer' : 'Working';/);
  assert.match(page, /parts\.push\(waitsView\(agent\)\);/);
  const block = page.slice(page.indexOf('function waitsView'), page.indexOf('function view('));
  assert.match(block, /waitingLists\(agent, 'cam'\)/);
  assert.match(block, /el\('ol', \{\}, \.\.\.w\.items\.map/);
  assert.match(block, /href: `\$\{inboxHref\}#memo-\$\{m\.id\}`/);
  assert.match(block, /el\('span', \{ className: 'id' \}, `#\$\{m\.id\}`\), ` \$\{m\.title\}`/);
  assert.match(block, /' \(postponed\)'/);
  assert.match(block, /'None\.'/);
  for (const word of ['button(', 'innerHTML']) assert.ok(!block.includes(word), `the lists must not have ${word}`);
  // The Inbox address comes from the nav, so the link works on the GitHub copy too (index.html).
  assert.match(page, /const inboxHref = document\.querySelector\('\.side-nav a\.nav'\)\.getAttribute\('href'\);/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.state\.idle \{/);
  assert.match(css, /\.waits ol \{/);
});

test('the Inbox opens the memo of a link from the Agents page, and shows the same agent words and lines', async () => {
  const page = (await get('/inbox')).text;
  assert.match(page, /const m = \/\^#memo-\(\\d\+\)\$\/\.exec\(location\.hash \|\| ''\);/);
  assert.match(page, /history\.replaceState\(null, '', location\.pathname \+ location\.search\);/);
  assert.match(page, /if \(wantedId !== null && memos\.some\(\(m\) => m\.id === wantedId\)\) \{ openMemo\(wantedId\); wantedId = null; \}/);
  assert.match(page, /function openMemo\(id\) \{\n  if \(openId !== id\) toggleOpen\(id\);\n  goTo\(id\);\n\}/);
  // The agent strip: the state word of ui/agentstate.js, never "Running".
  assert.match(page, /import \{ stateWord, pickAgent, fableShortNote, pickWords, helperMemoId, statusLine, helperGroups, finishedWords \} from '\/ui\/agentstate\.js'/);
  assert.match(page, /a\.runtime === 'codex-desktop' && !a\.online \? 'No recent contact'/);
  assert.doesNotMatch(page, /'Running'/);
  assert.doesNotMatch(page, /to it, \$\{a\.open_from\} from it/);
});

// Memo 912, layout 1: the counts line and the agent strip replace the four counters, the Due soon card, the Agents
// card and the Postponed card.
test('the banner has the greeting and the date only; the head of the list has the unread and postponed counts as quiet buttons', async () => {
  const page = (await get('/inbox')).text;
  // No counts line in the banner (memo SYS-5).
  for (const word of ['id="lead"', 'class="lead', "agents' court", 'const theirs', "'need you'", 'new or updated']) assert.ok(!page.includes(word), `the Inbox must not have ${word}`);
  assert.match(page, /<p class="eyebrow" id="greeting">Hello,<\/p>\n    <h1 class="cap">cam<\/h1>\n  <\/div>\n  <div class="hero-date" id="hero-date"><\/div>/);
  // The head of the list: "12 memos · 7 unread · 3 postponed", a count of 0 left out.
  assert.match(page, /const parts = \[countText\(list\.length, memos\.length, filtered\)\];/);
  // Unread: the memos she did not open plus the memos that changed since she saw them, as the old "fresh" count.
  assert.match(page, /const fresh = memos\.filter\(\(m\) => m\.seen !== 1\)\.length;/);
  assert.match(page, /if \(fresh\) parts\.push\(countLink\(fresh, 'unread', [^)]*\(\) => setFilter\('unread'\), filter === 'unread'\)\);/);
  assert.match(page, /count\.replaceChildren\(\.\.\.parts\.flatMap\(\(p, i\) => \(i \? \[' · ', p\] : \[p\]\)\)\);/);
  // The buttons are real buttons with their name as text, pressed while their filter is on.
  assert.match(page, /const b = button\(`\$\{n\} \$\{label\}`, onClick, title\);\n  b\.className = on \? 'count on' : 'count';\n  b\.setAttribute\('aria-pressed', String\(on\)\);/);
  // The four counters, the Due soon card and the Agents side card are gone.
  for (const word of ['id="stats"', 'renderStats', 'Agents working', 'Due in ', '<h2>Due soon</h2>', 'See all →', 'id="agents"', 'id="soon"']) assert.ok(!page.includes(word), `the Inbox must not have ${word}`);
  const css = (await get('/ui/common.css')).text;
  assert.doesNotMatch(css, /\.stats \{/);
  // Quiet: the dim text of the head, no color and no badge; an underline only on hover or focus.
  assert.match(css, /#count \.count \{ padding: 0; border: 0; [^}]*color: inherit; font: inherit;/);
  assert.match(css, /#count \.count:hover, #count \.count:focus-visible \{ text-decoration: underline;/);
  assert.doesNotMatch(css, /\.counts \.count/);
});

test('the Inbox keeps the postponed memos behind the "N postponed" count in the head of the list: the card lists them with Bring back now', async () => {
  const page = (await get('/inbox')).text;
  assert.match(page, /<section class="card later" id="later" hidden>/);
  assert.match(page, /if \(postponedCount\) parts\.push\(countLink\(postponedCount, 'postponed', 'Show the memos that wait for a date', togglePostponed, laterOpen\)\);/);
  assert.match(page, /function togglePostponed\(\) \{\n  laterOpen = !laterOpen;\n  render\(\);/);
  assert.match(page, /if \(!postponedCount\) laterOpen = false;\n  laterBox\.hidden = !laterOpen;/);
  assert.match(page, /const list = await api\('\/api\/postponed'\);/);
  assert.match(page, /button\('Bring back now', \(\) => run\(async \(\) => \{ await api\('\/api\/postpone', \{ id: m\.id, date: null, by: 'cam' \}\); await showPostponed\(\); \}\)\)/);
  // Postponing itself is unchanged: the picker on the open memo.
  assert.match(page, /button\('Postpone', \(\) => toggle\(laterPanel, tagPanel\), 'Take this memo out of the Inbox until a date'\)/);
  assert.ok(!page.includes('later-toggle'));
});

test('the agent strip: one card per agent under the greeting, with its state, what it does now, its running helpers, and the answer buttons when blocked', async () => {
  const page = (await get('/inbox')).text;
  // The strip is between the greeting and the columns, with a live region that says only a change of state.
  const strip = page.indexOf('<section class="agent-strip" id="agent-strip" aria-label="Agents"></section>');
  assert.ok(strip > page.indexOf('<section class="hero">') && strip < page.indexOf('<div class="columns">'));
  assert.match(page, /<p class="visually-hidden" id="agent-live" aria-live="polite"><\/p>/);
  assert.match(page, /if \(lastStates\.has\(a\.name\) && lastStates\.get\(a\.name\) !== word\) changes\.push\(`\$\{displayName\(a\.name\)\} is now \$\{word\}\.`\);/);
  assert.match(page, /if \(changes\.length\) agentLive\.textContent = changes\.join\(' '\);/);
  // The same data as the Agents page, with each poll of the Inbox.
  assert.match(page, /agents = await api\('\/api\/agents'\);/);
  assert.match(page, /if \(free && Date\.now\(\) - polled >= POLL_MS - DRAFT_POLL \/ 2\) \{ polled = Date\.now\(\); load\(\); loadAgents\(\); \}/);
  // The card: the state dot and word, whose court the open memos are in (dots with the number, which a screen reader
  // hears), and the helpers with their models, each with its own state dot. The status line of the agent is under
  // the head (memo 1190, which replaces the rule of memo SYS-2); the card never lists the memos themselves.
  const block = page.slice(page.indexOf('const DOTS_MAX'), page.indexOf('function renderAgents'));
  assert.match(block, /row\.setAttribute\('role', 'img'\);\n  row\.setAttribute\('aria-label', `\$\{n\} in \$\{label\}`\);/);
  assert.match(block, /courtRow\(a\.open_from \?\? 0, 'mine', 'your court'\), courtRow\(a\.open_to \?\? 0, 'theirs', `\$\{displayName\(a\.name\)\}'s court`\)/);
  assert.match(block, /el\('span', \{ className: h\.running \? 'state on' : 'state', title: h\.running \? `At work since \$\{age\(h\.started\)\}` : `Done \$\{age\(h\.ended\)\}` \}\)/);
  assert.match(block, /el\('li', \{ className: h\.running \? 'on' : 'done' \}/);
  assert.match(block, /\.\.\.list\.map\(helperChip\)/);
  assert.match(block, /courtsView\(a\), usageView\(a, el\), helpersView\(a\), a\.blocked \? blockedView\(a, runAgent\) : ''/);
  for (const word of ['a.status', 'nowText', 'memoTitle']) assert.ok(!block.includes(word), `the card must not use ${word}`);
  // A blocked agent: the red card with the box of ui/blocked.js, which sends the same request as the Agents page.
  assert.match(page, /import \{ blockedView \} from '\/ui\/blocked\.js'/);
  assert.match(block, /a\.blocked \? blockedView\(a, runAgent\) : ''/);
  assert.match(block, /className: a\.blocked \? 'card agent-card blocked' : stateWord\(a\) === 'Working' \? 'card agent-card working' : 'card agent-card'/);
  // A working agent's card is green, with the state in words for a screen reader; the Agents page does the same (memo 978).
  assert.match(block, /card\.setAttribute\('aria-label', `\$\{displayName\(a\.name\)\}: \$\{agentState\(a\) \|\| 'done'\}`\);/);
  const agentsPage = (await get('/agents')).text;
  assert.match(agentsPage, /className: word === 'Working' \? 'memo working' : 'memo'/);
  assert.match(agentsPage, /card\.setAttribute\('aria-label', `\$\{displayName\(agent\.name\)\}: \$\{state\(agent\) \|\| 'done'\}`\);/);
  const styles = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  assert.match(styles, /--good-bg: #e2f5ea; --good-ink: #1d6f47;/);
  assert.match(styles, /--good-bg: #15362a; --good-ink: #8fdcb0;/, 'the dark values');
  assert.match(styles, /\.agent-card\.working \{ background: var\(--good-bg\); border-color: var\(--good\); \}/);
  assert.match(styles, /\.agent-card\.working \.agent-state \{ color: var\(--good-ink\)/);
  assert.match(styles, /\.memo\.working \{ background: var\(--good-bg\); border-color: var\(--good\); \}/);
  assert.match(block, /async function runAgent\(path, body\) \{\n  try \{ await api\(path, body\); \} catch \(error\) \{ note\(error\.message\); return; \}\n  await loadAgents\(\);\n\}/);
  // On a phone the head is a button that opens the card; on a wide window the card is open and the head is a div.
  assert.match(page, /const phone = matchMedia\('\(max-width: 52rem\)'\);/);
  assert.match(page, /phone\.addEventListener\('change', renderAgents\);/);
  assert.match(block, /const open = !onPhone \|\| openCards\.has\(a\.name\) \|\| \(Boolean\(a\.blocked\) && !closedCards\.has\(a\.name\)\);/);
  assert.match(block, /el\(onPhone \? 'button' : 'div', \{ className: 'agent-head', \.\.\.\(onPhone \? \{ type: 'button' \} : \{\}\) \}/);
  assert.match(block, /head\.setAttribute\('aria-expanded', String\(open\)\);\n    head\.setAttribute\('aria-controls', bodyId\);/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.agent-strip \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(15rem, 1fr\)\);/);
  assert.match(css, /\.agent-card\.blocked \{ background: var\(--hi-bg\); border-color: var\(--hi-ink\); \}/);
  const phoneRule = css.slice(css.indexOf('@media (max-width: 52rem) {\n'), css.indexOf('@media (max-width: 30rem)'));
  assert.match(phoneRule, /\.agent-strip \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(phoneRule, /button\.agent-head\[aria-expanded="true"\]::after/);
});

test('the Agents page and the Inbox share the box of a blocked agent: ui/blocked.js, with the choices and Cancel', async () => {
  const page = (await get('/agents')).text;
  assert.match(page, /import \{ blockedView \} from '\/ui\/blocked\.js'/);
  assert.match(page, /if \(agent\.blocked\) parts\.push\(blockedView\(agent, run\)\);/);
  assert.ok(!page.includes('function blockedView'));
  const mod = await get('/ui/blocked.js');
  assert.match(mod.type, /javascript/);
  assert.match(mod.text, /export function blockedView\(agent, run\)/);
  assert.match(mod.text, /\['1', '2', '3'\]\.map\(\(k\) => button\(`Choose \$\{k\}`, \(\) => run\('\/api\/agent\/answer', \{ name: agent\.name, key: k \}\)/);
  assert.match(mod.text, /button\('Cancel', \(\) => run\('\/api\/agent\/answer', \{ name: agent\.name, key: 'Escape' \}\)/);
  assert.match(mod.text, /tmux attach -t memo-\$\{agent\.name\}, then type \/login\./);
});

test('the Inbox shows the workstream code of a memo as a small tag', () => {
  const inbox = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  assert.ok(inbox.includes("el('span', { className: 'ws', title: `Memo ${memo.id}` }, memo.code)"), 'the chip');
  assert.equal(inbox.split('wsChip(').length - 1, 4, 'the row, the open memo, the answered memo, and a memo of a thread');
  assert.match(readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8'), /^\.ws \{/m);
});

test('a helper whose label names a memo of the list is a link to it in the agent strip; one that names none stays text (memo 1092)', async () => {
  const { helperMemoId } = await import('../ui/agentstate.js');
  const memos = [{ id: 906, code: null }, { id: 1035, code: 'COMM-3' }, { id: 42, code: 'SYS-42' }];
  assert.equal(helperMemoId('Vault sync, memo 906', memos), 906);
  assert.equal(helperMemoId('#1035 campaign tags', memos), 1035);
  assert.equal(helperMemoId('Memo 906', memos), 906, 'in any case');
  assert.equal(helperMemoId('SYS-42 inbox links', memos), 42, 'a code');
  assert.equal(helperMemoId('sys42-fable-flag', memos), 42, 'a code with no hyphen, in any case');
  assert.equal(helperMemoId('comm-3 check', memos), 1035);
  assert.equal(helperMemoId('Vault sync', memos), null, 'no memo in the label');
  assert.equal(helperMemoId('memo 777', memos), null, 'a memo that the list does not have');
  assert.equal(helperMemoId('covid-19 notes', memos), null, 'a code that no memo has');
  assert.equal(helperMemoId('asana-A', memos), null);
  assert.equal(helperMemoId('voice-gpt', []), null);
  assert.equal(helperMemoId('', memos), null);
  assert.equal(helperMemoId(undefined, undefined), null);
  const page = (await get('/inbox')).text;
  const block = page.slice(page.indexOf('const DOTS_MAX'), page.indexOf('function renderAgents'));
  // The link opens the memo in the page, as a link from the Agents page does; a label with no memo is text.
  assert.match(block, /const id = helperMemoId\(h\.label, \[\.\.\.memos, \.\.\.answered\]\);\n  if \(id === null\) return h\.label;/);
  assert.match(block, /el\('a', \{ href: `#memo-\$\{id\}`, title: `Open memo \$\{id\}` \}, h\.label\)/);
  assert.match(block, /link\.addEventListener\('click', \(event\) => \{ event\.preventDefault\(\); goToMemo\(id\); \}\);/);
  assert.match(block, /helperName\(h\), el\('span', \{ className: 'model' \}, h\.model\)\)/);
  // A memo of the queue opens there; an answered one in the Answered view. The chips follow the list.
  assert.match(block, /if \(memos\.some\(\(m\) => m\.id === id\)\) \{ if \(otherMode\(\)\) \{ scheduledMode = false; setAnswered\(false\); \} return openMemo\(id\); \}/);
  assert.match(block, /if \(!answeredMode\) setAnswered\(true\);/);
  assert.match(page, /if \(changed\) \{ render\(\); if \(agents\.length\) renderAgents\(\); \} else renderHero\(\);/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.agent-helpers li a \{ color: inherit; text-decoration: underline dotted;/);
});

test('the capture form says its automatic pick and the rule in a line under the field, on every screen size (memo 1090)', async () => {
  const { pickAgent, pickWords, PICK_HINT } = await import('../ui/agentstate.js');
  // The same Sunday morning as the pick test: the session resets in 4 hours 12 minutes, the week on Tuesday at 10.
  const now = new Date('2026-11-08T18:00:00Z');
  const S = '2026-11-08T22:12:00Z';
  const W = '2026-11-10T18:00:00Z';
  const use = (session, week, { fable, at = '2026-11-08T17:57:00Z', sReset = S, wReset = W } = {}) => ({
    at, error: null, session: { percent: session, resets_at: sReset }, week: { percent: week, resets_at: wReset },
    models: fable === undefined ? [] : [{ name: 'Fable', percent: fable, resets_at: wReset }],
  });
  const agent = (name, activity, usage) => ({ name, kind: 'long', running: true, activity, usage });
  const words = (agents, task = '') => pickWords(agents, { now, task });
  // The name, then the rule that put it before the second, in a few words.
  assert.equal(words([agent('main', 'blocked', use(10, 20)), agent('second', 'working', use(10, 80))]), 'Auto: Darkness · Peeve is blocked');
  assert.equal(words([{ ...agent('main', 'idle', use(10, 10)), running: false }, agent('second', 'working', use(10, 90))]), 'Auto: Darkness · Peeve is stopped');
  assert.equal(words([agent('main', 'idle', null), agent('second', 'working', use(10, 90))]), 'Auto: Darkness · Peeve has no fresh figures');
  assert.equal(words([agent('main', 'idle', use(96, 20)), agent('second', 'working', use(10, 20))]), 'Auto: Darkness · Peeve is at its limit');
  assert.equal(words([agent('main', 'idle', use(96, 20)), agent('second', 'idle', use(10, 97))]), 'Auto: Peeve · every agent is at its limit, it resets first');
  assert.equal(words([agent('main', 'idle', use(10, 20, { fable: 80 })), agent('second', 'idle', use(10, 20, { fable: 20 }))], 'OPS: pay the invoice'), 'Auto: Darkness · more Fable room');
  assert.equal(words([agent('main', 'idle', use(10, 20, { fable: 80 })), agent('second', 'idle', use(10, 20))], 'OPS: pay the invoice'), 'Auto: Peeve · Darkness has no Fable figure');
  assert.equal(words([agent('main', 'working', use(10, 20)), agent('second', 'idle', use(10, 90))]), 'Auto: Peeve · more room');
  assert.equal(words([agent('main', 'working', use(10, 20)), agent('second', 'idle', use(10, 25))]), 'Auto: Darkness · idle', 'a gap under 15 points is a tie: idle first');
  assert.equal(words([agent('main', 'idle', use(10, 20)), agent('second', 'idle', use(10, 25))]), 'Auto: Peeve · a tie, the first of the list');
  assert.equal(words([agent('main', 'idle', use(10, 20))]), 'Auto: Peeve', 'one candidate: no rule to say');
  assert.equal(words([]), '', 'no agents: no line');
  assert.equal(pickAgent([agent('main', 'blocked', use(10, 20)), agent('second', 'working', use(10, 80))], { now }).why, 'Peeve is blocked');
  assert.deepEqual(pickAgent([], { now }), { name: '', hint: PICK_HINT }, 'with no agents, as before');
  // The page: the line under the field, filled with each pick, with each change of the select, and with each key in
  // the task. After a pick by hand it says so.
  const page = (await get('/inbox')).text;
  assert.match(page, /<small id="pick" class="pick" hidden><\/small>/);
  assert.match(page, /function showPick\(byHand = handPicked\) \{\n  const to = capture\.elements\.to\.value;\n  const words = !agents\.length \? '' : byHand && to \? `Your pick: \$\{displayName\(to\)\} · automatic again after this task` : pickWords\(agents, \{ task: capture\.elements\.text\.value \}\);\n  pickLine\.textContent = words;\n  pickLine\.hidden = !words;\n\}/);
  assert.match(page, /capture\.elements\.to\.addEventListener\('change', \(\) => showPick\(true\)\);/);
  assert.match(page, /capture\.elements\.text\.addEventListener\('input', \(\) => showPick\(\)\);/);
  assert.match(page, /chooseAgent\(\);\n    showPick\(\);\n    renderAgents\(\);/);
  // The line comes before the code of the pick, so a change of the select says the pick by hand before the pick code marks it.
  assert.ok(page.indexOf('function showPick') < page.indexOf('let handPicked = false;'));
  // On its own row under the field, at every width: the rule is outside the phone media queries.
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /#capture \.pick \{ flex: 1 1 100%;/);
  assert.ok(css.indexOf('#capture .pick') < css.indexOf('@media (max-width: 52rem)'));
});

test('the usage lines of an agent: percent left, the countdown, the pace or the forecast, and the state (memos 971, 976 and 1047)', async () => {
  const { usageFigures, resetText, usageView, tickCountdowns, startCountdowns, STALE_MS, TICK_MS, PACE_KEY } = await import('../ui/usage.js');
  // Sunday at 10 in the morning in Los Angeles; the week resets Tuesday at 10.
  const now = new Date('2026-11-08T18:00:00Z');
  const zone = { now, timeZone: 'America/Los_Angeles' };
  assert.equal(resetText('2026-11-08T22:12:00Z', zone), 'today at 2:12 PM PST');
  assert.equal(resetText('2026-11-10T18:00:00Z', zone), 'Nov 10 at 10:00 AM PST');
  assert.equal(resetText('2026-11-10T18:00:00Z', { ...zone, long: true }), 'November 10 at 10:00 AM PST');
  assert.equal(resetText(null, zone), '');
  assert.equal(resetText('no date', zone), '');
  assert.deepEqual([STALE_MS, TICK_MS], [900000, 60000]);
  const usage = { at: '2026-11-08T17:57:00Z', tried: '2026-11-08T17:57:00Z', error: null,
    session: { percent: 6, resets_at: '2026-11-08T22:12:00Z', rate: 2 }, week: { percent: 63, resets_at: '2026-11-10T18:00:00Z', rate: 0.5 },
    models: [{ name: 'Fable', percent: 93, resets_at: '2026-11-10T18:00:00Z', rate: 1 }] };
  const f = usageFigures(usage, zone);
  assert.equal(f.stale, false);
  assert.deepEqual(f.rows.map((r) => r.text), [
    'Session: 94 percent left, resets in 4 hours 12 minutes. 10 points ahead of pace.',
    'Week: 37 percent left, resets in 2 days 0 hours. 8 points ahead of pace.',
    'Fable: 7 percent left, resets in 2 days 0 hours. Runs out about 5 this afternoon at this rate.',
  ]);
  assert.deepEqual(f.rows.map((r) => [r.key, r.label, r.left, r.level]), [['session', 'Session', 94, 'ok'], ['week', 'Week', 37, 'ok'], ['model-Fable', 'Fable', 7, 'amber']]);
  assert.equal(f.rows[0].title, 'Resets today at 2:12 PM PST', 'the clock time on hover');
  assert.equal(f.rows[0].clock, 'today at 2:12 PM PST', 'and for a screen reader, after the countdown');
  assert.equal(f.rows[1].clock, 'November 10 at 10:00 AM PST');
  assert.equal(f.rows[1].countdown, 'resets in 2 days 0 hours');
  assert.equal(f.rows[2].tail, 'Runs out about 5 this afternoon at this rate.');
  assert.deepEqual([f.state, f.account, f.ago], ['On pace', 'Account: on pace. Figures from 3 minutes ago.', '3 minutes ago']);
  assert.doesNotMatch(f.rows.map((r) => r.text).join(' ') + f.account, /%/, 'no percent signs');
  // Fable with plenty of headroom says what would reset unused; at the limit the row is red and the account says so.
  const spare = usageFigures({ ...usage, models: [{ name: 'Fable', percent: 20, resets_at: '2026-11-10T18:00:00Z', rate: 0.1 }] }, zone);
  assert.equal(spare.rows[2].text, 'Fable: 80 percent left, resets in 2 days 0 hours. To spare: about 51 points reset unused Tuesday.');
  const limit = usageFigures({ ...usage, session: { percent: 96, resets_at: '2026-11-08T22:12:00Z', rate: 0.5 } }, zone);
  assert.equal(limit.rows[0].text, 'Session: 4 percent left, resets in 4 hours 12 minutes. 80 points behind pace.');
  assert.deepEqual([limit.rows[0].level, limit.state, limit.account], ['red', 'At limit', 'Account: at limit. Figures from 3 minutes ago.']);
  const tight = usageFigures({ ...usage, week: { percent: 85, resets_at: '2026-11-10T18:00:00Z', rate: 0.1 } }, zone);
  assert.deepEqual([tight.rows[1].level, tight.state], ['amber', 'Tight']);
  // No reset time, a reset that passed, no rate.
  assert.equal(usageFigures({ ...usage, session: { percent: 6, resets_at: null } }, zone).rows[0].text, 'Session: 94 percent left.');
  assert.equal(usageFigures({ ...usage, session: { percent: 6, resets_at: null } }, zone).rows[0].title, 'No reset time');
  const passed = usageFigures({ ...usage, session: { percent: 6, resets_at: '2026-11-08T17:00:00Z' } }, zone);
  assert.equal(passed.rows[0].text, 'Session: 94 percent left, reset passed, waiting for new figures.');
  assert.equal(passed.account, 'Account: not known. Figures from 3 minutes ago.');
  assert.equal(usageFigures({ ...usage, session: { percent: 6, resets_at: '2026-11-08T22:12:00Z' } }, zone).rows[0].text, 'Session: 94 percent left, resets in 4 hours 12 minutes. 10 points ahead of pace.', 'no rate: no forecast, the pace alone');
  // Stale: figures from more than 15 minutes ago, or none yet.
  const old = usageFigures({ ...usage, at: '2026-11-08T17:40:00Z', error: 'claude ended with code 1' }, zone);
  assert.equal(old.stale, true);
  assert.equal(old.ago, '20 minutes ago');
  assert.equal(old.account, 'Account: on pace. Figures from 20 minutes ago.');
  assert.equal(old.error, 'claude ended with code 1');
  assert.equal(usageFigures({ ...usage, at: null }, zone).stale, true);
  assert.equal(usageFigures(null, zone), null);
  // The lines of the card, with a small fake of el: plain text, the countdown in a span with its reset time for the
  // tick, the clock time in a hidden span for a screen reader, then the account line.
  const el = (tag, props = {}, ...children) => {
    const node = { tag, ...props, attrs: {}, children: [...children], setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, append(...c) { this.children.push(...c); } };
    return node;
  };
  const box = usageView({ name: 'main', usage }, el, zone);
  assert.equal(box.className, 'usage');
  assert.deepEqual(box.attrs, { role: 'group', 'aria-label': 'Usage of the Claude account of Peeve' });
  assert.equal(box.children.length, 5, 'three lines, the line of resets, and the account line');
  const [session, , fable, resets, account] = box.children;
  // The line of resets under the bars, outside Details (memo 1320): the session and the week, not Fable, in short
  // words, each with the clock time on hover and for a screen reader, and the reset time for the tick.
  const said = (n) => (typeof n === 'string' ? n : n.children.map(said).join(''));
  assert.equal(resets.className, 'usage-resets');
  assert.deepEqual(resets.children.map(said), ['Session resets in 4 h 12 min, today at 2:12 PM PST', 'Week resets in 2 days 0 h, November 10 at 10:00 AM PST']);
  assert.deepEqual(resets.children.map((c) => c.title), ['Resets today at 2:12 PM PST', 'Resets Nov 10 at 10:00 AM PST']);
  assert.deepEqual(resets.children[0].children[1].attrs, { 'data-reset': '2026-11-08T22:12:00Z', 'data-short': '1' });
  assert.equal(resets.children[0].children[2].className, 'visually-hidden');
  assert.equal(usageView({ name: 'main', usage: { ...usage, session: { percent: 6 }, week: { percent: 63 } } }, el, zone).children.some((c) => c.className === 'usage-resets'), false, 'no reset times: no line');
  assert.equal(session.tag, 'div');
  assert.equal(session.className, 'use ok');
  assert.equal(session.title, 'Resets today at 2:12 PM PST');
  assert.equal(session.children[0].children[1].children[0], '94% left');
  assert.equal(session.children[1].attrs.role, 'progressbar');
  assert.equal(session.children[1].attrs['aria-valuenow'], '94');
  assert.equal(session.children[1].children[0].style, 'width:94%');
  // The line at the time left to the reset (memo 1407): the session has 4 hours 12 minutes of its 5 hours, so the
  // line is at 84 percent; the fill goes past it, 10 points ahead of pace, the same headroom as the pick of the agent.
  assert.deepEqual(f.rows.map((r) => [r.timeLeft, r.pace]), [[84, '10 points ahead of pace'], [29, '8 points ahead of pace'], [29, '22 points behind pace']]);
  assert.deepEqual(session.children[1].children.slice(1).map((c) => [c.tag, c.className, c.style]), [['i', 'use-now', 'left:84%']]);
  assert.equal(session.children[1].title, '94 percent left with 84 percent of the time left: 10 points ahead of pace. Resets today at 2:12 PM PST.');
  assert.equal(session.children[1].attrs['aria-valuetext'], '94 percent left, 84 percent of the time left, 10 points ahead of pace');
  // Fable is behind pace: 7 percent left with 29 percent of the week to run. The gap between the two is striped.
  assert.deepEqual(fable.children[1].children.slice(1).map((c) => [c.className, c.style]), [['use-gap', 'left:7%;width:22%'], ['use-now', 'left:29%']]);
  assert.equal(account.children.at(-2).children[0], PACE_KEY);
  assert.match(PACE_KEY, /^The line on a bar is the time left to its reset\./);
  assert.equal(session.children[2].className, 'countdown');
  assert.deepEqual(session.children[2].attrs, { 'data-reset': '2026-11-08T22:12:00Z' });
  assert.equal(account.tag, 'details');
  assert.equal(account.children[0].children[0], 'Details');
  assert.equal(account.children.at(-1).className, 'account');
  for (const [used, color] of [[0, 'ok'], [74, 'ok'], [75, 'amber'], [89, 'amber'], [90, 'red'], [100, 'red']]) {
    const rendered = usageView({ name: 'main', usage: { ...usage, session: { percent: used } } }, el, zone);
    assert.equal(rendered.children[0].className, `use ${color}`);
  }
  const stale = usageView({ name: 'main', usage: { ...usage, at: '2026-11-08T17:30:00Z' } }, el, zone);
  assert.equal(stale.children[0].children[1].className, 'use-bar is-stale');
  assert.equal(stale.children[0].children[1].children.length, 1, 'a stale reading has no line: the time moved on, the figures did not');
  assert.equal(usageView({ name: 'main', usage: { ...usage, session: { percent: 6 } } }, el, zone).children[0].children[1].children.length, 1, 'no reset time: no line');
  assert.equal(stale.children.at(-1).children[0], 'Stale usage data');
  const desktop = usageView({ name: 'gpt', runtime: 'codex-desktop', online: false }, el, zone);
  assert.equal(desktop.children[0], 'Usage unavailable');
  const gpt = usageView({ name: 'gpt', runtime: 'codex-desktop', usage: { provider: 'openai', at: usage.at, windows: [{ key: 'codex-primary', label: 'Session', percent: 20, resets_at: '2026-11-08T22:12:00Z' }] } }, el, zone);
  assert.equal(gpt.attrs['aria-label'], 'Usage of the OpenAI account of Landon');
  assert.equal(gpt.children[0].children[1].attrs['aria-valuenow'], '80');
  assert.equal(gpt.children[0].children[1].children.length, 1, 'an OpenAI window has no known length, so no line');
  assert.equal(usageView({ name: 'liaison', usage: null }, el, zone), '');
  assert.equal(usageView({ name: 'main' }, el, zone), '');
  const none = usageView({ name: 'main', usage: { at: null, tried: null, session: null, week: null, models: [], error: null } }, el, zone);
  assert.equal(none.children[0].children[0], 'Usage: not known yet');
  assert.equal(usageView({ name: 'main', usage: { at: '2026-11-08T17:57:00Z', session: null, week: null, models: [], error: null } }, el, zone).children[0].children[0], 'Usage: no limits reported');
  // The tick: each minute the countdowns get the words for now.
  const root = { querySelectorAll: () => [session.children[2]] };
  tickCountdowns(root, new Date('2026-11-08T19:00:00Z'));
  assert.equal(session.children[2].textContent, 'resets in 3 hours 12 minutes');
  tickCountdowns({ querySelectorAll: () => [resets.children[0].children[1]] }, new Date('2026-11-08T19:00:00Z'));
  assert.equal(resets.children[0].children[1].textContent, 'resets in 3 h 12 min', 'the line of resets ticks in short words');
  const timer = startCountdowns(root, { every: 1, now: () => new Date('2026-11-08T22:00:00Z') });
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  assert.equal(session.children[2].textContent, 'resets in 12 minutes');
  // Both pages show the lines from ui/usage.js, which the server gives, and start the tick.
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /import \{ usageView, startCountdowns \} from '\/ui\/usage\.js'/);
  assert.match(inbox, /courtsView\(a\), usageView\(a, el\), helpers/);
  assert.match(inbox, /^startCountdowns\(document\);$/m);
  const agents = (await get('/agents')).text;
  assert.match(agents, /import \{ usageView, startCountdowns \} from '\/ui\/usage\.js'/);
  assert.match(agents, /if \(agent\.kind === 'long'\) parts\.push\(usageView\(agent, el\)\);/);
  assert.match(agents, /^startCountdowns\(document\);$/m);
  assert.match((await get('/ui/usage.js')).type, /javascript/);
  assert.match((await get('/ui/pacing.js')).type, /javascript/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /\.usage \.use\.amber, \.usage \.use\.amber b \{ color: var\(--mid-ink\); \}/);
  assert.match(css, /\.usage \.use\.red, \.usage \.use\.red b \{ color: var\(--hi-ink\); \}/);
  assert.match(css, /\.use-bar/, 'remaining-capacity bars');
  assert.match(css, /^\.use-bar > \.use-now \{ position: absolute;/m);
  assert.match(css, /^\.use-bar > \.use-gap \{ position: absolute;/m);
});

test('both pages show the status line of an agent with its age; the Inbox strip has it under the head, also with the card closed (memo 1190)', async () => {
  const { statusLine } = await import('../ui/agentstate.js');
  const age = (iso) => (iso === '2026-11-09T18:00:00Z' ? '6 min ago' : 'never');
  assert.deepEqual(statusLine({ kind: 'long', status: 'SYS-62, review of my last 50 drafts', updated: '2026-11-09T18:00:00Z' }, age), { text: 'SYS-62, review of my last 50 drafts', when: '6 min ago' });
  assert.deepEqual(statusLine({ kind: 'remote', status: ' Vault sync ', updated: null }, age), { text: 'Vault sync', when: 'never' }, 'trimmed; no time is "never"');
  assert.equal(statusLine({ kind: 'long', status: '', updated: '2026-11-09T18:00:00Z' }, age), null, 'no status line');
  assert.equal(statusLine({ kind: 'long' }, age), null);
  assert.equal(statusLine({ kind: 'short', status: 'Ran', updated: '2026-11-09T18:00:00Z' }, age), null, 'a short agent has no status line');
  assert.equal(statusLine(null, age), null);
  // The Agents page: "<text>, <when>", or "No status line." as before.
  const agents = (await get('/agents')).text;
  assert.match(agents, /import \{ stateWord, waitingLists, statusLine, helperGroups, finishedWords \} from '\/ui\/agentstate\.js'/);
  assert.match(agents, /const line = statusLine\(agent, age\);\n    parts\.push\(el\('p', \{ className: 'text' \}, line \? `\$\{line\.text\}, \$\{line\.when\}` : 'No status line\.'\)\);/);
  // The Inbox: the same words in a line of plain text between the head and the body of the card, so a phone shows it
  // with the card closed. A screen reader hears "Now: " first; no color carries the meaning.
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /import \{ stateWord, pickAgent, fableShortNote, pickWords, helperMemoId, statusLine, helperGroups, finishedWords \} from '\/ui\/agentstate\.js'/);
  const block = inbox.slice(inbox.indexOf('function statusView'), inbox.indexOf('// The helpers of the agent'));
  assert.match(block, /const line = statusLine\(a, age\);\n  if \(!line\) return '';/);
  assert.match(block, /el\('p', \{ className: 'agent-status' \}, el\('span', \{ className: 'visually-hidden' \}, 'Now: '\), line\.text, el\('span', \{ className: 'when' \}, `, \$\{line\.when\}`\)\)/);
  assert.match(inbox, /\}, head, statusView\(a\), feelingLine\(pet\.feeling\), body\);/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /^\.agent-status \{ [^\n]*overflow-wrap: anywhere; \}$/m, 'long words wrap: no sideways scroll on a phone');
  assert.match(css, /^\.agent-status \.when \{ color: var\(--dim\); white-space: nowrap; \}$/m);
});

test('the helpers that run show by default; the finished ones are inside a closed details, "3 finished helpers" (memo 1190)', async () => {
  const { helperGroups, finishedWords } = await import('../ui/agentstate.js');
  const run = { label: 'A', running: true }; const done1 = { label: 'B', running: false }; const done2 = { label: 'C', running: false };
  assert.deepEqual(helperGroups([run, done1, done2]), { running: [run], done: [done1, done2] });
  assert.deepEqual(helperGroups([]), { running: [], done: [] });
  assert.deepEqual(helperGroups(undefined), { running: [], done: [] }, 'an older server gives no helpers');
  assert.equal(finishedWords(3), '3 finished helpers');
  assert.equal(finishedWords(1), '1 finished helper');
  // The Agents page: the running items, then the details with the done ones; the head line counts the running ones only.
  const agents = (await get('/agents')).text;
  const view = agents.slice(agents.indexOf('function helpersView'), agents.indexOf('// The open memos of an agent'));
  assert.match(view, /const \{ running, done \} = helperGroups\(agent\.helpers\);/);
  assert.match(view, /el\('b', \{\}, 'Helpers'\), ` · \$\{running\.length\} running`\)/);
  assert.match(view, /\.\.\.running\.map\(helperItem\)/);
  assert.match(view, /done\.length \? finishedHelpers\(agent\.name, done, helperItem\) : ''/);
  assert.doesNotMatch(view, /done`/, 'the old "2 running, 3 done" words are gone');
  const fin = agents.slice(agents.indexOf('function finishedHelpers'), agents.indexOf('function helpersView'));
  assert.match(fin, /el\('details', \{ className: 'helpers-done', open: openDone\.has\(name\) \}, el\('summary', \{\}, finishedWords\(done\.length\)\), \.\.\.done\.map\(item\)\)/);
  // The page loads itself again each 5 seconds: an open details stays open.
  assert.match(fin, /box\.addEventListener\('toggle', \(\) => \{ if \(box\.open\) openDone\.add\(name\); else openDone\.delete\(name\); \}\);/);
  // The Inbox strip: the running chips, then the details with the done chips, each list with its label for a reader.
  const inbox = (await get('/inbox')).text;
  const strip = inbox.slice(inbox.indexOf('function helpersView'), inbox.indexOf('// Sends an answer to a blocked agent'));
  assert.match(strip, /const \{ running, done \} = helperGroups\(a\.helpers\);\n  if \(!running\.length && !done\.length\) return '';/);
  assert.match(strip, /if \(running\.length\) parts\.push\(helperList\(a\.name, running\)\);/);
  assert.match(strip, /el\('details', \{ className: 'helpers-done', open: openDone\.has\(a\.name\) \}, el\('summary', \{\}, finishedWords\(done\.length\)\), helperList\(a\.name, done\)\)/);
  assert.match(strip, /box\.addEventListener\('toggle', \(\) => \{ if \(box\.open\) openDone\.add\(a\.name\); else openDone\.delete\(a\.name\); \}\);/);
  assert.match(inbox, /ul\.setAttribute\('aria-label', `Helpers of \$\{displayName\(name\)\}`\)/);
  assert.match(inbox, /courtsView\(a\), usageView\(a, el\), helpersView\(a\), a\.blocked \? blockedView\(a, runAgent\) : ''\)/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /^\.helpers-box \.helpers-done summary \{ font-size: \.78rem; \}$/m);
  assert.match(css, /^\.helpers \.helpers-done summary \{ font-size: \.8rem; \}$/m);
});

test('the marks of the memos she fired off last: one green, the next gold, about 12% of the view, at least one (memo 1236)', () => {
  assert.equal(RECENT_SHARE, 0.12);
  // round(12% of n), at least 1: 1 for 1 to 12 memos, 2 for 13 to 20, 3 for 21 to 29, 0 for an empty view.
  assert.deepEqual([0, 1, 4, 8, 12, 13, 20, 21, 29, 30, 50].map((n) => markCount(n)), [0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6]);
  const memos = Array.from({ length: 20 }, (_, i) => ({ id: i + 1 }));
  const fired = { 3: '2026-11-09T12:08:00.000Z', 7: '2026-11-09T12:30:00.000Z', 12: '2026-11-09T09:00:00.000Z', 15: '2026-11-09T12:08:00.000Z' };
  // 20 memos: 2 marks. The latest time is green; the next is gold. An equal time: the higher id goes first.
  assert.deepEqual([...recentMarks(memos, fired)], [[7, 'latest'], [15, 'recent']]);
  // A smaller view, the filter on: 1 mark, for the latest among the memos shown.
  assert.deepEqual([...recentMarks(memos.filter((m) => m.id !== 7).slice(0, 10), fired)], [[3, 'latest']]);
  // Fewer memos with a time than marks: only those get one. No time at all: no mark. An odd fired value: no mark.
  assert.deepEqual([...recentMarks(memos, { 12: fired[12] })], [[12, 'latest']]);
  assert.deepEqual([...recentMarks(memos, {})], []);
  assert.deepEqual([...recentMarks(memos, null)], []);
  assert.deepEqual([...recentMarks([], fired)], []);
  assert.deepEqual([...recentMarks(memos, { 3: 5, 7: '' })], []);
  // The order of the memos does not matter.
  assert.deepEqual([...recentMarks([...memos].reverse(), fired)], [[7, 'latest'], [15, 'recent']]);
  // The words: a visible label and a longer title, for the tooltip and the reader.
  assert.equal(MARK_WORDS.latest.label, 'Latest');
  assert.equal(MARK_WORDS.recent.label, 'Recent');
  assert.match(MARK_WORDS.latest.title, /fired off/);
});

test('the Inbox marks the rows with the class and the word, reads fired from the queue, and styles both themes (memo 1236)', async () => {
  const inbox = (await get('/inbox')).text;
  assert.match(inbox, /import \{ recentMarks, MARK_WORDS \} from '\/ui\/recent\.js';/);
  // The server serves the module (the allowlist of src/app.js).
  assert.match((await get('/ui/recent.js')).type, /javascript/);
  // The marks follow the view: computed from the shown list at each render, before the rows are made.
  assert.match(inbox, /marks = recentMarks\(list, fired\);\n  queue\.replaceChildren\(\.\.\.list\.map\(\(m\) => view\(m\)\)\);/);
  // The row gets the class, and the word in its sub line; the open memo gets the class and the word in its head.
  assert.match(inbox, /className: `memo brief\$\{isSelected \? ' selected' : ''\}\$\{mark \? ` \$\{mark\}` : ''\}`/);
  assert.match(inbox, /el\('div', \{ className: 'sub' \}, mark \? markChip\(memo\) : '', /);
  assert.match(inbox, /className: `memo\$\{memo\.id === selected \? ' selected' : ''\}\$\{mark \? ` \$\{mark\}` : ''\}`/);
  assert.match(inbox, /facts\), markChip\(memo\), ughChip\(memo\), tag\)/);
  // The chip is text: the label, with the longer words and the age of her action in the title.
  assert.match(inbox, /el\('span', \{ className: `recent-tag \$\{kind\}`, title: `\$\{words\.title\}, \$\{age\(fired\[memo\.id\]\)\}` \}, words\.label\)/);
  // A change of the times alone makes the list render again.
  assert.match(inbox, /JSON\.stringify\(\[next, nextTicks, data\.postponed, nextFired\]\) !== JSON\.stringify\(\[memos, ticks, postponedCount, fired\]\)/);
  // The Answered view gets no mark.
  assert.match(inbox, /const mark = readOnly \? '' : markOf\(memo\);/);
  const css = (await get('/ui/common.css')).text;
  assert.match(css, /^:root \{ --gold: #c9961a; --gold-bg: #fbf1cf; --gold-ink: #7a5a00; \}$/m);
  assert.match(css, /^@media \(prefers-color-scheme: dark\) \{ :root \{ --gold: #e0b84a; --gold-bg: #3d3214; --gold-ink: #f3d27a; \} \}$/m);
  assert.match(css, /^\.memo\.brief\.latest \{ background: var\(--good-bg\); box-shadow: inset 3px 0 0 var\(--good\); \}$/m);
  assert.match(css, /^\.memo\.brief\.recent \{ background: var\(--gold-bg\); box-shadow: inset 3px 0 0 var\(--gold\); \}$/m);
  assert.match(css, /^\.recent-tag\.latest \{ background: var\(--good-ink\); color: var\(--panel\); \}$/m);
  assert.match(css, /^\.recent-tag\.recent \{ background: var\(--gold-ink\); color: var\(--panel\); \}$/m);
  // The chip never widens a phone row: it is one short word, and the row's title cell may shrink.
  assert.match(css, /\.recent-tag \{ [^\n]*white-space: nowrap; \}/);
});
