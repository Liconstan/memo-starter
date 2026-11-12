import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { eventsOn } from '../src/ical.js';
import { calendarOwner, pageCalendars, envCalendars } from '../src/app.js';
import { createFollowups, followupsOn, followupDelay, followupDomain, followupWhen, FOLLOWUP_DOMAIN, FOLLOWUP_REQUEST, FOLLOWUP_WINDOW_MS, HOLD } from '../src/followups.js';
import { WORKSTREAMS } from './helpers.js';

// The meeting follow-up trigger: main gets one memo 30 minutes after a meeting of the owner ends.
// Now is 19:00 UTC on Tue Nov 10, 11:00 AM Pacific. The owner of the calendar is owner@example.com.
const NAMES = ['cam', 'discord', 'main', 'second', 'liaison'];
const URL = 'https://calendar.google.com/calendar/ical/owner%40example.com/private-abc/basic.ics';
const MIN = 60000;
const HOUR = 60 * MIN;
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work', 'X-WR-TIMEZONE:America/Los_Angeles',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const ME = 'ATTENDEE;CN=Cam;PARTSTAT=ACCEPTED:mailto:owner@example.com';
const SAM = 'ATTENDEE;CN=Sam Lee;PARTSTAT=ACCEPTED:mailto:sam@example.com';
// An event of Nov 10 in UTC times: from and to are 'HHMM'.
const event = (uid, from, to, title, ...lines) => [`UID:${uid}`, `DTSTART:20261110T${from}00Z`, `DTEND:20261110T${to}00Z`, `SUMMARY:${title}`, ...lines];
// The weekly sync: 10:00 to 10:30 AM Pacific, with Sam and with Ana, who has no name on her line.
const SYNC = event('sync@example.com', '1800', '1830', 'Weekly sync', ME, SAM, 'ATTENDEE;PARTSTAT=DECLINED:mailto:ana@example.org');

function setup({ text = cal(SYNC), urls = [URL], at = '2026-11-10T19:00:00Z', path, ...options } = {}) {
  let t = Date.parse(at);
  const now = () => new Date(t);
  const db = openDb(path);
  const store = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'], now, workstreams: WORKSTREAMS, timeZone: 'America/Los_Angeles' });
  const state = { text, fetches: 0, fail: false };
  const getCalendar = async () => {
    state.fetches += 1;
    if (state.fail) throw new Error(`fetch failed for ${URL}`);
    return state.text;
  };
  const nudged = [];
  const lines = [];
  const job = createFollowups({ db, store, owner: 'cam', urls, getCalendar, selfOf: () => 'owner@example.com', arrived: (n) => nudged.push(n), now, log: (l) => lines.push(l), ...options });
  const later = (ms) => { t += ms; };
  return { db, store, job, state, nudged, lines, later };
}

test('main gets one memo 30 minutes after the meeting ends, with the time in the zone of the owner and the other people', async () => {
  const { db, store, job, nudged, lines, later } = setup({ at: '2026-11-10T18:59:00Z' });
  assert.equal(job.active, true);
  assert.deepEqual(await job.run(), [], '29 minutes after the end: not yet');
  assert.deepEqual(store.list('main'), []);
  later(MIN); // 19:00, 30 minutes after the end
  const sent = await job.run();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'Weekly sync');
  const memos = store.list('main');
  assert.equal(memos.length, 1);
  const memo = memos[0];
  assert.equal(memo.sender, 'cam');
  assert.equal(memo.recipient, 'main');
  assert.equal(memo.ws, 'PROG');
  assert.equal(memo.title, 'Follow-up: Weekly sync');
  assert.equal(memo.text, [
    'Meeting ended. Draft the follow-ups: per scripts/meeting-followups.md in the vault.',
    '',
    'Event: Weekly sync',
    'Time: Tue, Nov 10, 10:00 AM to 10:30 AM PST',
    'Attendees:',
    '- Sam Lee, sam@example.com',
    '- ana@example.org, declined',
  ].join('\n'));
  assert.ok(memo.text.startsWith(FOLLOWUP_REQUEST));
  assert.doesNotMatch(memo.text, /owner@example\.com/, 'the owner is not in the list of the other people');
  assert.doesNotMatch(memo.text, /[()]/);
  assert.deepEqual(nudged, ['main']);
  assert.deepEqual(store.list('cam'), [], 'the owner gets nothing');
  assert.deepEqual(store.list('second'), []);
  assert.match(lines[0], /^followups: memo \d+ to main for the meeting that ended at 2026-11-10T18:30:00\.000Z\.$/);
  const row = db.prepare('SELECT * FROM followups_sent').get();
  assert.equal(row.event_key, 'sync@example.com|2026-11-10T18:00:00.000Z');
  assert.equal(row.title, 'Weekly sync');
  assert.equal(row.ends, '2026-11-10T18:30:00.000Z');
  assert.equal(row.memo_id, memo.id);
});

test('never twice for the same meeting: a later pass, a restart of the server, and the same event on a second calendar', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'memo-followups-')), 'memo.db');
  // The same event is on two calendars: one memo.
  const first = setup({ path, urls: [URL, `${URL}?second`] });
  assert.equal((await first.job.run()).length, 1);
  assert.equal((await first.job.run()).length, 0, 'the same pass again');
  first.later(HOUR);
  assert.equal((await first.job.run()).length, 0, 'an hour later, with the calendar read again');
  assert.equal(first.store.list('main').length, 1);
  // The agent closes the memo: the meeting still gets no second memo.
  first.store.close(first.store.list('main')[0].id, 'Drafted.', 'main');
  assert.equal((await first.job.run()).length, 0);
  first.db.close();
  // The server starts again on the same database.
  const again = setup({ path, at: '2026-11-10T20:30:00Z' });
  assert.equal((await again.job.run()).length, 0, 'the row of the meeting survives the restart');
  assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM followups_sent').get().n, 1);
  assert.deepEqual(again.store.list('main'), []);
  again.db.close();
});

test('two passes at the same time send one memo', async () => {
  const { store, job } = setup();
  const both = await Promise.all([job.run(), job.run()]);
  assert.equal(both[0].length + both[1].length, 1);
  assert.equal(store.list('main').length, 1);
});

test('each occurrence of a repeated event gets its own memo, and a cancelled occurrence gets none', async () => {
  const daily = ['UID:daily@example.com', 'DTSTART:20261108T180000Z', 'DTEND:20261108T183000Z', 'RRULE:FREQ=DAILY', 'EXDATE:20261111T180000Z', 'SUMMARY:Standup', ME, SAM];
  const { db, store, job, later } = setup({ text: cal(daily) });
  // Tue 19:00: the meetings of Mon 18:00 (ended 24 hours 30 minutes ago) and of Tue 18:00. Only Tue is in the window.
  assert.equal((await job.run()).length, 1);
  later(24 * HOUR); // Wed 19:00: the occurrence of Wed is an EXDATE
  assert.equal((await job.run()).length, 0);
  later(24 * HOUR); // Thu 19:00
  assert.equal((await job.run()).length, 1);
  assert.deepEqual(db.prepare('SELECT event_key FROM followups_sent ORDER BY event_key').all().map((r) => r.event_key),
    ['daily@example.com|2026-11-10T18:00:00.000Z', 'daily@example.com|2026-11-12T18:00:00.000Z']);
  assert.equal(store.list('main').length, 2);
});

test('no memo for an event with only the owner, a declined or unanswered event, an all-day event, a cancelled event, or a hold', async () => {
  const text = cal(
    event('solo@x', '1700', '1730', 'Write the report'),
    event('own@x', '1700', '1730', 'Plan my week', 'ORGANIZER;CN=Cam:mailto:owner@example.com', ME),
    event('room@x', '1700', '1730', 'Desk time', ME, 'ATTENDEE;CUTYPE=RESOURCE;CN=Room 4:mailto:room4@example.com'),
    event('declined@x', '1700', '1730', 'Vendor pitch', 'ATTENDEE;PARTSTAT=DECLINED:mailto:owner@example.com', SAM),
    event('unanswered@x', '1700', '1730', 'Webinar', 'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:owner@example.com', SAM),
    ['UID:allday@x', 'DTSTART;VALUE=DATE:20261109', 'DTEND;VALUE=DATE:20261110', 'SUMMARY:Offsite', ME, SAM],
    event('cancelled@x', '1700', '1730', 'Budget review', 'STATUS:CANCELLED', ME, SAM),
    event('focus@x', '1700', '1730', 'Focus time with Sam', ME, SAM),
    event('hold@x', '1700', '1730', 'HOLD: board dinner', ME, SAM),
    event('block@x', '1700', '1730', 'Block for travel', ME, SAM),
    event('real@x', '1700', '1730', 'Blockchain call', ME, SAM),
  );
  const { store, job } = setup({ text });
  const sent = await job.run();
  assert.deepEqual(sent.map((s) => s.title), ['Blockchain call'], 'a title that only starts with the letters of Block is a meeting');
  assert.equal(store.list('main').length, 1);
  for (const title of ['Focus time', 'focus', 'Hold', 'HOLD: dinner', 'Block', ' block: writing']) assert.match(title, HOLD);
  for (const title of ['Blockchain call', 'Holding review', 'Focused work session', 'On hold']) assert.doesNotMatch(title, HOLD);
});

test('nothing without a calendar, and nothing with MEMO_FOLLOWUPS=0', async () => {
  const none = setup({ urls: [] });
  assert.equal(none.job.active, false);
  assert.deepEqual(await none.job.run(), []);
  none.job.start(); // no timer
  assert.equal(none.state.fetches, 0);
  assert.deepEqual(none.store.list('main'), []);
  const off = setup({ on: followupsOn('0') });
  assert.equal(off.job.active, false);
  assert.deepEqual(await off.job.run(), []);
  assert.equal(off.state.fetches, 0, 'the calendar is not read');
  assert.deepEqual(off.store.list('main'), []);
  // The setting: on by default.
  for (const v of [undefined, '', '1', 'on', 'yes']) assert.equal(followupsOn(v), true);
  for (const v of ['0', 'false', 'off', 'no', ' OFF ']) assert.equal(followupsOn(v), false);
});

// The calendars as the server gives them: those of MEMO_CALENDAR_ICS (env), then those of data/calendars.json (the
// Inbox page), read with the code of the Today card. The owner of a calendar comes from its address, and only a
// calendar on the work domain counts. URL is the work calendar of owner@example.com.
const address = (who, domain) => `${who}@${domain}`;
const PERSONAL = 'https://calendar.google.com/calendar/ical/cam%40gmail.com/private-def/basic.ics';
const TEAM = 'https://calendar.google.com/calendar/ical/team%40example.com/private-ghi/basic.ics';
const DINNER = event('dinner@example.com', '1700', '1800', 'Dinner', `ATTENDEE;CN=Cam;PARTSTAT=ACCEPTED:mailto:${address('cam', 'gmail.com')}`, SAM);
const PLANNING = event('planning@example.com', '1600', '1700', 'Planning', 'ATTENDEE;CN=Team;PARTSTAT=ACCEPTED:mailto:team@example.com', SAM);
function world({ env = '', page, setting, ...options } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'memo-followups-'));
  const savePage = (urls) => writeFileSync(join(dir, 'calendars.json'), `${JSON.stringify({ urls })}\n`);
  if (page) savePage(page);
  const texts = new Map([[URL, cal(SYNC)], [PERSONAL, cal(DINNER)], [TEAM, cal(PLANNING)]]);
  const fetched = [];
  const getCalendar = async (url) => { fetched.push(url); return texts.get(url); };
  const all = setup({ urls: () => [...envCalendars(env), ...pageCalendars(dir)], getCalendar, selfOf: calendarOwner, domain: (owners) => followupDomain(setting, owners), ...options });
  return { ...all, fetched, savePage };
}
const noAddress = (lines) => lines.every((l) => !/calendar\.google\.com|private-|@|%40/.test(l));

test('the calendars added on the Inbox page are used, and one added later counts after 5 minutes with no restart', async () => {
  const { store, job, lines, later, fetched, savePage } = world();
  assert.equal(job.active, true, 'the job runs with no calendar yet');
  assert.deepEqual(await job.run(), []);
  savePage([URL]); // the owner adds her work calendar on the page
  later(4 * MIN);
  assert.deepEqual(await job.run(), [], 'the list is read again only after 5 minutes');
  assert.deepEqual(fetched, []);
  later(MIN);
  const sent = await job.run();
  assert.deepEqual(sent.map((s) => s.title), ['Weekly sync']);
  assert.equal(store.list('main').length, 1);
  assert.deepEqual(fetched, [URL]);
  assert.deepEqual(job.watching(), { total: 1, used: 1, domain: 'example.com' });
  assert.ok(lines.includes('followups: 1 of 1 calendars on the work domain example.com now.'));
  assert.ok(noAddress(lines), 'no line of the log has a calendar address');
  // A calendar on the page from the start counts at the first pass.
  const first = world({ page: [URL] });
  assert.equal((await first.job.run()).length, 1);
  // The page removes it: after 5 minutes the job reads no calendar.
  first.savePage([]);
  first.later(5 * MIN);
  await first.job.run();
  assert.deepEqual(first.fetched, [URL]);
  assert.deepEqual(first.job.watching(), { total: 0, used: 0, domain: FOLLOWUP_DOMAIN });
});

test('a personal calendar never gives a memo: only a calendar whose owner is on the work domain is read', async () => {
  const { store, job, fetched, lines } = world({ page: [PERSONAL, URL] });
  assert.deepEqual(job.watching(), { total: 2, used: 1, domain: 'example.com' });
  assert.deepEqual((await job.run()).map((s) => s.title), ['Weekly sync'], 'the dinner of the personal calendar gets no memo');
  assert.equal(store.list('main').length, 1);
  assert.deepEqual(fetched, [URL], 'the personal calendar is not read at all');
  assert.ok(noAddress(lines));
  // Only the personal calendar: the work domain is the default, and nothing goes.
  const alone = world({ page: [PERSONAL] });
  assert.deepEqual(alone.job.watching(), { total: 1, used: 0, domain: FOLLOWUP_DOMAIN });
  assert.deepEqual(await alone.job.run(), []);
  assert.deepEqual(alone.fetched, []);
  // A calendar with no owner (a group calendar) is on no domain.
  const group = world({ page: ['https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-jkl/basic.ics'], setting: 'example.com' });
  assert.deepEqual(await group.job.run(), []);
  assert.deepEqual(group.fetched, []);
  // The message for a calendar that does not load has its place in the whole list, as the Inbox page names it.
  const down = world({ page: [PERSONAL, URL], getCalendar: async () => { throw new Error(`fetch failed for ${URL}`); } });
  assert.deepEqual(await down.job.run(), []);
  assert.deepEqual(down.lines, ['followups: calendar 2 did not load. The next pass tries again.']);
  // MEMO_FOLLOWUP_DOMAIN wins over the calendars; "@" and capital letters read the same.
  assert.equal(followupDomain(' @Example.ORG ', [address('owner', 'example.com')]), 'example.org');
  const other = world({ page: [PERSONAL, URL], setting: 'example.org' });
  assert.deepEqual(other.job.watching(), { total: 2, used: 0, domain: 'example.org' });
  assert.deepEqual(await other.job.run(), []);
  // The default: the first calendar that is not at a personal mail service, or else a name that no calendar is on.
  assert.equal(followupDomain(undefined, ['', address('cam', 'gmail.com'), address('Owner', 'Example.com'), address('x', 'example.net')]), 'example.com');
  assert.equal(followupDomain('', [address('cam', 'gmail.com'), '']), FOLLOWUP_DOMAIN);
  assert.equal(followupDomain(undefined), FOLLOWUP_DOMAIN);
});

test('the calendars of MEMO_CALENDAR_ICS and of the page count together, each address once', async () => {
  const { store, job, fetched, lines } = world({ env: `${URL}, ${PERSONAL}`, page: [TEAM, URL, PERSONAL] });
  assert.deepEqual(job.watching(), { total: 3, used: 2, domain: 'example.com' });
  const sent = await job.run();
  assert.deepEqual(sent.map((s) => s.title), ['Planning', 'Weekly sync'], 'one from the page calendar, one from the calendar of .env');
  assert.equal(store.list('main').length, 2);
  assert.deepEqual(fetched, [URL, TEAM], 'those of .env first, and the personal calendar never');
  assert.deepEqual(await job.run(), []);
  assert.ok(noAddress(lines));
});

test('nothing with no calendar in MEMO_CALENDAR_ICS and none on the page', async () => {
  const { store, job, fetched, lines, later } = world();
  assert.deepEqual(job.watching(), { total: 0, used: 0, domain: FOLLOWUP_DOMAIN });
  assert.deepEqual(await job.run(), []);
  later(6 * MIN);
  assert.deepEqual(await job.run(), []);
  assert.deepEqual(fetched, []);
  assert.deepEqual(store.list('main'), []);
  assert.deepEqual(lines, []);
  job.start(1000000);
  job.stop();
  // MEMO_FOLLOWUPS=0 still turns the job off, with calendars on the page too.
  const off = world({ page: [URL], on: followupsOn('0') });
  assert.equal(off.job.active, false);
  assert.deepEqual(await off.job.run(), []);
  assert.deepEqual(off.fetched, []);
});

test('only a meeting that ended in the last 24 hours: a start after days off does not send the old meetings', async () => {
  const text = cal(
    ['UID:old@x', 'DTSTART:20261109T180000Z', 'DTEND:20261109T185900Z', 'SUMMARY:Yesterday, too old', ME, SAM], // ended 24 hours 1 minute ago
    ['UID:edge@x', 'DTSTART:20261109T180000Z', 'DTEND:20261109T190100Z', 'SUMMARY:Yesterday, in time', ME, SAM], // ended 23 hours 59 minutes ago
    ['UID:week@x', 'DTSTART:20261103T180000Z', 'DTEND:20261103T183000Z', 'SUMMARY:Last week', ME, SAM],
    SYNC,
    event('soon@x', '1830', '1845', 'Just ended', ME, SAM), // 15 minutes ago: not yet
    event('future@x', '2200', '2230', 'This afternoon', ME, SAM),
  );
  const { store, job, later } = setup({ text });
  assert.equal(FOLLOWUP_WINDOW_MS, 24 * HOUR);
  const sent = await job.run();
  assert.deepEqual(sent.map((s) => s.title), ['Yesterday, in time', 'Weekly sync'], 'oldest end first');
  later(15 * MIN); // 19:15
  assert.deepEqual((await job.run()).map((s) => s.title), ['Just ended']);
  later(10 * HOUR);
  assert.deepEqual((await job.run()).map((s) => s.title), ['This afternoon']);
  assert.equal(store.list('main').length, 4);
});

test('the delay is a setting: MEMO_FOLLOWUP_DELAY_MIN', async () => {
  assert.equal(followupDelay(undefined), 30);
  assert.equal(followupDelay(''), 30);
  assert.equal(followupDelay('abc'), 30);
  assert.equal(followupDelay('-5'), 30);
  assert.equal(followupDelay('45'), 45);
  assert.equal(followupDelay('0'), 0);
  const slow = setup({ delayMin: followupDelay('45') }); // 30 minutes after the end
  assert.equal((await slow.job.run()).length, 0);
  slow.later(15 * MIN);
  assert.equal((await slow.job.run()).length, 1);
  const fast = setup({ at: '2026-11-10T18:35:00Z', delayMin: 5 });
  assert.equal((await fast.job.run()).length, 1);
});

test('a calendar that does not load sends nothing, says so once with no address, and the next pass tries again', async () => {
  const { store, job, state, lines } = setup();
  state.fail = true;
  assert.deepEqual(await job.run(), []);
  assert.deepEqual(await job.run(), []);
  assert.deepEqual(lines, ['followups: calendar 1 did not load. The next pass tries again.']);
  assert.equal(state.fetches, 2);
  state.fail = false;
  assert.equal((await job.run()).length, 1);
  assert.equal(store.list('main').length, 1);
  assert.ok(lines.every((l) => !l.includes('calendar.google.com')));
  // The calendar is read again only after 5 minutes.
  await job.run();
  assert.equal(state.fetches, 3);
});

test('a memo that the store refuses leaves no row, so a later pass sends it', async () => {
  const { db, job, lines } = setup({ to: 'nobody' });
  assert.deepEqual(await job.run(), []);
  assert.deepEqual(await job.run(), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM followups_sent').get().n, 0);
  assert.equal(lines.length, 1, 'the log says it once');
  assert.match(lines[0], /^followups memo: /);
});

test('the time of the memo follows the zone of the owner, and a long title fits the title of the memo', async () => {
  assert.equal(followupWhen('2026-11-10T18:00:00.000Z', '2026-11-10T18:30:00.000Z', 'America/New_York'), 'Tue, Nov 10, 1:00 PM to 1:30 PM EST');
  assert.equal(followupWhen('2026-11-11T07:30:00.000Z', '2026-11-11T08:30:00.000Z', 'America/Los_Angeles'), 'Tue, Nov 10, 11:30 PM to Wed, Nov 11, 12:30 AM PST');
  let zone = 'America/New_York';
  const long = event('long@x', '1800', '1830', 'Quarterly planning with the whole programs team and the board liaison', ME, SAM);
  const { store, job } = setup({ text: cal(long), timeZone: () => zone });
  await job.run();
  const memo = store.list('main')[0];
  assert.equal(memo.title, 'Follow-up: Quarterly planning with the whole programs team a');
  assert.equal(memo.title.length, 60);
  assert.match(memo.text, /^Event: Quarterly planning with the whole programs team and the board liaison$/m);
  assert.match(memo.text, /^Time: Tue, Nov 10, 1:00 PM to 1:30 PM EST$/m);
});

test('eventsOn gives the UID only when asked, so the Today card stays as it was', () => {
  const [plain] = eventsOn(cal(SYNC), '2026-11-10', 'America/Los_Angeles', { self: 'owner@example.com' });
  assert.equal('uid' in plain, false);
  const [withUid] = eventsOn(cal(SYNC), '2026-11-10', 'America/Los_Angeles', { self: 'owner@example.com', uid: true });
  assert.equal(withUid.uid, 'sync@example.com');
});
