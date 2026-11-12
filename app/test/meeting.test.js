import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { parseCalendar } from '../src/ical.js';
import { createFollowups, FOLLOWUP_REQUEST } from '../src/followups.js';
import { createMeetings, plainText, prepOf, cardOf, BRIEF_REQUEST } from '../src/meeting.js';
import { isMeeting, meetingsAt, countdown, since, clockText, dateText, rangeText, nextLine, draftOf, firstLine, sendText, SEND_LINE, LAST_MS } from '../ui/meeting.js';
import { makeApp, call, LIAISON_TOKEN, WORKSTREAMS, ROOT } from './helpers.js';

// The time block of the Inbox (memo 1422): the clock, the next meeting with the time until it, the brief before a
// meeting, and the follow-up after it. Now is Tue Nov 10, 2026, 8:41 PM Pacific (04:41 UTC on Nov 11), as in her mockup.
const ZONE = 'America/Los_Angeles';
const MIN = 60000;
const NOW = Date.parse('2026-11-11T04:41:00Z');
const ev = (title, start, end, more = {}) => ({ title, start, end, allDay: false, hasOthers: true, attendees: [{ name: 'Robin', email: 'robin@example.com', status: 'accepted' }], ...more });
const ANDREW = ev('Robin <> the owner', '2026-11-11T06:00:00.000Z', '2026-11-11T06:30:00.000Z'); // 10:00 to 10:30 PM

test('the time until the next meeting: whole minutes, rounded up, "now" when it started', () => {
  assert.equal(countdown(79 * MIN), 'in 1 h 19 m');
  assert.equal(countdown(Date.parse(ANDREW.start) - NOW), 'in 1 h 19 m');
  assert.equal(countdown(19 * MIN), 'in 19 m');
  assert.equal(countdown(120 * MIN), 'in 2 h');
  assert.equal(countdown(18 * MIN + 1000), 'in 19 m', 'a started minute counts: never "in 0 m" before the start');
  assert.equal(countdown(1), 'in 1 m');
  assert.equal(countdown(0), 'now');
  assert.equal(countdown(-5 * MIN), 'now');
  assert.equal(countdown(25 * 60 * MIN + 30 * MIN), 'in 25 h 30 m');
  assert.equal(since(12 * MIN + 30000), '12 m ago');
  assert.equal(since(65 * MIN), '1 h 5 m ago');
  assert.equal(since(20000), 'just now');
});

test('the clock, the date with its weekday, and the time range of a meeting, in the zone of the owner', () => {
  assert.equal(clockText(NOW, ZONE), '8:41 PM');
  assert.equal(clockText(NOW, 'America/New_York'), '11:41 PM');
  assert.equal(dateText(NOW, ZONE), 'Tuesday, Nov 10');
  assert.equal(dateText(NOW, 'Europe/London'), 'Wednesday, Nov 11');
  assert.equal(rangeText(ANDREW.start, ANDREW.end, ZONE), '10:00 – 10:30 PM');
  assert.equal(rangeText('2026-11-10T19:30:00Z', '2026-11-10T20:15:00Z', ZONE), '11:30 AM – 12:15 PM');
});

test('a meeting is an event with a time and another person that is not a hold', () => {
  assert.equal(isMeeting(ANDREW), true);
  assert.equal(isMeeting({ ...ANDREW, allDay: true }), false);
  assert.equal(isMeeting({ ...ANDREW, hasOthers: false, attendees: [] }), false, 'her own event');
  assert.equal(isMeeting({ ...ANDREW, attendees: [] }), false, 'only a room');
  assert.equal(isMeeting(ev('Focus time', ANDREW.start, ANDREW.end)), false);
  assert.equal(isMeeting(ev('Hold: travel', ANDREW.start, ANDREW.end)), false);
  assert.equal(isMeeting(ev('Blockchain call', ANDREW.start, ANDREW.end)), true);
  assert.equal(isMeeting(null), false);
});

test('the meeting that runs, the next one, and the last one that ended, at a moment', () => {
  const morning = ev('Weekly 1:1', '2026-11-10T19:30:00.000Z', '2026-11-10T20:00:00.000Z');
  const noon = ev('Team sync', '2026-11-10T22:00:00.000Z', '2026-11-10T22:30:00.000Z');
  const hold = ev('Focus time', '2026-11-11T05:00:00.000Z', '2026-11-11T05:30:00.000Z');
  const solo = ev('Gym', '2026-11-11T05:00:00.000Z', '2026-11-11T05:45:00.000Z', { hasOthers: false, attendees: [] });
  const tomorrow = ev('Standup', '2026-11-11T17:00:00.000Z', '2026-11-11T17:15:00.000Z');
  const list = [tomorrow, ANDREW, hold, solo, noon, morning];
  assert.deepEqual(meetingsAt(list, NOW), { current: null, next: ANDREW, last: noon });
  // At 10:10 PM the meeting runs; the next one is tomorrow's.
  assert.deepEqual(meetingsAt(list, Date.parse('2026-11-11T06:10:00Z')), { current: ANDREW, next: tomorrow, last: noon });
  // At its last minute it still runs; at the minute it ends, it is the last one.
  assert.equal(meetingsAt(list, Date.parse(ANDREW.end) - 1).current, ANDREW);
  assert.deepEqual(meetingsAt(list, Date.parse(ANDREW.end)), { current: null, next: tomorrow, last: ANDREW });
  // A meeting that ended more than 24 hours ago has no Follow-up button any more.
  assert.equal(meetingsAt([morning], Date.parse(morning.end) + LAST_MS).last, morning);
  assert.equal(meetingsAt([morning], Date.parse(morning.end) + LAST_MS + 1).last, null);
  assert.deepEqual(meetingsAt([], NOW), { current: null, next: null, last: null });
  assert.deepEqual(meetingsAt([hold, solo], NOW), { current: null, next: null, last: null });
  // Two that start at the same minute: the same one each time.
  const twin = ev('A sync', ANDREW.start, ANDREW.end);
  assert.equal(meetingsAt([ANDREW, twin], NOW).next, twin);
  assert.equal(meetingsAt([twin, ANDREW], NOW).next, twin);
});

test('the line under the clock: the next meeting of today with the time until it, the meeting that runs, or quietly none', () => {
  assert.deepEqual(nextLine({ current: null, next: ANDREW }, NOW, ZONE), { head: 'Next: in 1 h 19 m', detail: '10:00 – 10:30 PM · Robin <> the owner' });
  // The words follow the clock between two answers of the server.
  assert.equal(nextLine({ current: null, next: ANDREW }, NOW + 60 * MIN, ZONE).head, 'Next: in 19 m');
  assert.equal(nextLine({ current: null, next: ANDREW }, Date.parse(ANDREW.start), ZONE).head, 'Next: now');
  // The next meeting is tomorrow: none today, said quietly, with no head.
  const tomorrow = ev('Standup', '2026-11-11T17:00:00.000Z', '2026-11-11T17:15:00.000Z');
  assert.deepEqual(nextLine({ current: null, next: tomorrow }, NOW, ZONE), { head: '', detail: 'No more meetings today.' });
  assert.deepEqual(nextLine({ current: null, next: null }, NOW, ZONE), { head: '', detail: 'No more meetings today.' });
  // The same meeting is today in a zone where it is still the same date.
  assert.equal(nextLine({ current: null, next: tomorrow }, NOW, 'Europe/London').head, 'Next: in 12 h 19 m');
  // A meeting runs.
  assert.deepEqual(nextLine({ current: ANDREW, next: tomorrow }, Date.parse('2026-11-11T06:10:00Z'), ZONE), { head: 'Now: Robin <> the owner', detail: 'until 10:30 PM' });
  const soon = ev('Debrief', '2026-11-11T06:45:00.000Z', '2026-11-11T07:00:00.000Z');
  assert.equal(nextLine({ current: ANDREW, next: soon }, Date.parse('2026-11-11T06:10:00Z'), ZONE).detail, 'until 10:30 PM · next in 35 m: Debrief');
});

test('the draft of a follow-up memo is the part under THE DRAFT, up to the next heading in capitals', () => {
  const memo = ['**Follow-ups for today\'s Robin 1:1 are drafted in your Slack DM with Robin. Review and send.**', '', 'Where: Slack, your DM with Robin.', '',
    'THE DRAFT', 'Our 1:1 today: your next steps', 'Today, Gemini first', '- Pick the best examples', 'Thanks for the earbuds!', '', 'LEFT OUT', '- Her afternoon appointment.', '', 'NOT SURE FROM THE TRANSCRIPT', '- The model names.'].join('\n');
  assert.deepEqual(draftOf(memo), { draft: 'Our 1:1 today: your next steps\nToday, Gemini first\n- Pick the best examples\nThanks for the earbuds!', found: true });
  assert.ok(!draftOf(memo).draft.includes('appointment'), 'what is only for her never goes into the box');
  const mail = 'Draft: a link\n\nTHE DRAFT\nSubject: Link\n\nHi Lee,\n\nBest,\nthe owner\n\nYOURS, NOT IN THE DRAFT\n- Think about a writer.';
  assert.equal(draftOf(mail).draft, 'Subject: Link\n\nHi Lee,\n\nBest,\nthe owner');
  // A draft to the end of the memo, and a memo with no such part: then the whole memo, marked.
  assert.deepEqual(draftOf('Intro\nTHE DRAFT\nOne line'), { draft: 'One line', found: true });
  assert.deepEqual(draftOf('No notes exist for this meeting.\n'), { draft: 'No notes exist for this meeting.', found: false });
  assert.deepEqual(draftOf('The draft is in Slack.'), { draft: 'The draft is in Slack.', found: false }, 'a sentence is not the heading');
  assert.equal(firstLine(memo), "Follow-ups for today's Robin 1:1 are drafted in your Slack DM with Robin. Review and send.");
  assert.equal(sendText('  Hello\n'), `${SEND_LINE}\n\nHello`);
  assert.match(SEND_LINE, /explicit go-ahead to send/);
});

test('the brief that exists: the prep notes in the invite, and the card of the context sheet', () => {
  const html = 'Agenda: <a href="https://docs.example.com/a">the doc</a><br><br><b>Claude prep notes of 2026-11-07</b><br>TO COVER: the photo<ul><li>LIKELY: the benchmark</li></ul>Private items for this meeting: 0.';
  assert.equal(plainText(html), 'Agenda: the doc (https://docs.example.com/a)\n\nClaude prep notes of 2026-11-07\nTO COVER: the photo\n- LIKELY: the benchmark\nPrivate items for this meeting: 0.');
  assert.deepEqual(prepOf(html), { prep: 'Claude prep notes of 2026-11-07\nTO COVER: the photo\n- LIKELY: the benchmark\nPrivate items for this meeting: 0.', invite: 'Agenda: the doc (https://docs.example.com/a)' });
  assert.deepEqual(prepOf('Bring the slides.'), { prep: '', invite: 'Bring the slides.' });
  assert.deepEqual(prepOf(''), { prep: '', invite: '' });
  assert.deepEqual(prepOf('We use Claude a lot.'), { prep: '', invite: 'We use Claude a lot.' }, 'a mention is not the block');
  const sheet = ['# Context sheet, 2026-11-07', '', '## Weekly 1:1 - Robin <> Sam | 2026-11-10 11:30 PT | granola c0bc', '- Calendar: organiser the owner.', '- Open Asana tasks: 2FA.', '',
    '## Kim <> the owner 1:1 | 2026-11-06 14:00 PT', '- Status: examples sent.', '', '## Weekly 1:1 - Robin <> Sam | 2026-11-03 11:30 PT', '- Older card.', '', '# Older', '- not part of a card'].join('\n');
  assert.deepEqual(cardOf(sheet, 'Weekly 1:1 - Robin <> Sam', '2026-11-10'),
    { heading: 'Weekly 1:1 - Robin <> Sam | 2026-11-10 11:30 PT | granola c0bc', text: '- Calendar: organiser the owner.\n- Open Asana tasks: 2FA.', date: '2026-11-10', exact: true });
  // The meeting of next week has no card of its own yet: the newest earlier card, marked as earlier.
  assert.deepEqual(cardOf(sheet, 'weekly 1:1 - robin <> sam', '2026-11-17'), { heading: 'Weekly 1:1 - Robin <> Sam | 2026-11-10 11:30 PT | granola c0bc', text: '- Calendar: organiser the owner.\n- Open Asana tasks: 2FA.', date: '2026-11-10', exact: false });
  assert.equal(cardOf(sheet, 'Weekly 1:1 - Robin <> Sam', '2026-11-05').text, '- Older card.', 'never a card of a later day');
  assert.equal(cardOf(sheet, 'Weekly 1:1', '2026-11-10'), null, 'the whole title, not a part of it');
  assert.equal(cardOf(sheet, 'Kim <> the owner 1:1', '2026-11-06').text, '- Status: examples sent.');
  assert.equal(cardOf('', 'Anything', '2026-11-10'), null);
});

// ---------- the server part, with a calendar and the memos ----------
const NAMES = ['cam', 'discord', 'main', 'second', 'liaison'];
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work', 'X-WR-TIMEZONE:America/Los_Angeles',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const ME = 'ATTENDEE;CN=Cam;PARTSTAT=ACCEPTED:mailto:owner@example.com';
const SAM = 'ATTENDEE;CN=Sam Lee;PARTSTAT=ACCEPTED:mailto:sam@example.com';
// Nov 10 Pacific: a sync that ended at 2:30 PM, a hold, and Robin at 10:00 PM with prep notes in the invite.
const SYNC = ['UID:sync@example.com', 'DTSTART:20261110T220000Z', 'DTEND:20261110T223000Z', 'SUMMARY:Team sync', ME, SAM];
const FOCUS = ['UID:focus@example.com', 'DTSTART:20261111T050000Z', 'DTEND:20261111T053000Z', 'SUMMARY:Focus time', ME, SAM];
const TALK = ['UID:robin@example.com', 'DTSTART:20261111T060000Z', 'DTEND:20261111T063000Z', 'SUMMARY:Robin <> the owner', ME, 'ATTENDEE;CN=Robin;PARTSTAT=ACCEPTED:mailto:robin@example.com',
  'DESCRIPTION:Agenda in the doc.\\n\\nClaude prep notes of 2026-11-09\\nTO COVER: the budget split'];
const SYNC_KEY = 'sync@example.com|2026-11-10T22:00:00.000Z';
const TALK_KEY = 'robin@example.com|2026-11-11T06:00:00.000Z';

function setup({ at = '2026-11-11T04:41:00Z', events = [SYNC, FOCUS, TALK], sheet = '' } = {}) {
  let t = Date.parse(at);
  const now = () => new Date(t);
  const db = openDb();
  const store = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main', 'second'], now, workstreams: WORKSTREAMS, timeZone: ZONE });
  const vault = mkdtempSync(join(tmpdir(), 'memo-vault-'));
  mkdirSync(join(vault, 'summaries'));
  if (sheet) writeFileSync(join(vault, 'summaries', 'context-sheet.md'), sheet);
  const nudged = [];
  const meetings = createMeetings({ db, store, owner: 'cam', vault, arrived: (n) => nudged.push(n), agentNames: () => ['main', 'second', 'liaison'], now });
  const cals = [{ cal: parseCalendar(cal(...events)), self: 'owner@example.com' }];
  return { db, store, meetings, cals, nudged, now, later: (ms) => { t += ms; } };
}

test('the block of the evening: the next meeting with the brief that exists, and the last meeting with its follow-up not asked yet', () => {
  const { meetings, cals } = setup({ sheet: '## Robin <> the owner | 2026-11-03 22:00 PT\n- Last time: the budget.\n' });
  const v = meetings.view(cals, ZONE);
  assert.equal(v.now, '2026-11-11T04:41:00.000Z');
  assert.equal(v.timeZone, ZONE);
  assert.equal(v.current, null);
  assert.equal(v.next.key, TALK_KEY);
  assert.equal(v.next.title, 'Robin <> the owner');
  assert.deepEqual(v.next.people, ['Robin']);
  assert.deepEqual(v.next.brief, {
    prep: 'Claude prep notes of 2026-11-09\nTO COVER: the budget split', invite: 'Agenda in the doc.',
    card: { heading: 'Robin <> the owner | 2026-11-03 22:00 PT', text: '- Last time: the budget.', date: '2026-11-03', exact: false }, asked: null,
  });
  assert.equal(v.next.description, undefined, 'the raw invite text is not in the answer');
  assert.equal(nextLine(v, Date.parse(v.now), ZONE).head, 'Next: in 1 h 19 m');
  // The hold at 9:00 PM is not a meeting, so the last meeting is the sync of the afternoon.
  assert.equal(v.last.key, SYNC_KEY);
  assert.deepEqual(v.last.followup, { state: 'waiting', due: '2026-11-10T23:00:00.000Z', to: 'main' });
  // A zone that is not one falls back to the zone of the store.
  assert.equal(meetings.view(cals, 'Not/AZone').timeZone, ZONE);
});

test('with no brief she can ask for one: one memo to the agent, once per meeting, and its answer shows as the brief', () => {
  const { meetings, cals, store, nudged } = setup({ events: [SYNC, ['UID:robin@example.com', 'DTSTART:20261111T060000Z', 'DTEND:20261111T063000Z', 'SUMMARY:Robin <> the owner', ME, 'ATTENDEE;CN=Robin;PARTSTAT=ACCEPTED:mailto:robin@example.com']] });
  assert.deepEqual(meetings.view(cals, ZONE).next.brief, { prep: '', invite: '', card: null, asked: null });
  const first = meetings.askBrief(cals, ZONE, TALK_KEY);
  assert.equal(first.asked, true);
  const memo = store.get(first.memo);
  assert.equal(memo.sender, 'cam');
  assert.equal(memo.recipient, 'main');
  assert.equal(memo.title, 'Brief: Robin <> the owner');
  assert.equal(memo.ws, 'PROG');
  assert.equal(memo.text, `${BRIEF_REQUEST}\n\nEvent: Robin <> the owner\nTime: Tue, Nov 10, 10:00 PM to 10:30 PM PST\nAttendees:\n- Robin, robin@example.com`);
  assert.deepEqual(nudged, ['main'], 'the nudge of the follow-up job');
  assert.deepEqual(meetings.askBrief(cals, ZONE, TALK_KEY), { asked: false, memo: first.memo }, 'a second press sends nothing');
  assert.equal(store.list('main').length, 1);
  assert.deepEqual(meetings.view(cals, ZONE).next.brief.asked, { memo: first.memo, to: 'main', answer: null });
  // The agent answers with a memo that names the request.
  const answer = store.send({ from: 'main', to: 'cam', impact: 3, effort: 'short', re: String(first.memo), title: 'Brief: Robin', text: 'TO COVER: the budget.' }).memo;
  assert.deepEqual(meetings.view(cals, ZONE).next.brief.asked.answer, { id: answer.id, title: 'Brief: Robin', text: 'TO COVER: the budget.', state: 'open' });
  assert.throws(() => meetings.askBrief(cals, ZONE, 'nothing|2026-11-11T06:00:00.000Z'), { status: 404 });
});

test('the follow-up: asked by the job or by her, then the draft of the agent to edit, and Send as her reply with the go-ahead', async () => {
  const { meetings, cals, store, db, nudged, now } = setup();
  assert.throws(() => meetings.askFollowup(cals, ZONE, TALK_KEY), { status: 409, message: /did not end yet/ });
  // She asks now: the same memo as the job sends, and the row of the job, so the job sends no second one.
  const asked = meetings.askFollowup(cals, ZONE, SYNC_KEY);
  assert.equal(asked.asked, true);
  const trigger = store.get(asked.memo);
  assert.equal(trigger.recipient, 'main');
  assert.equal(trigger.title, 'Follow-up: Team sync');
  assert.ok(trigger.text.startsWith(`${FOLLOWUP_REQUEST}\n\nEvent: Team sync\nTime: Tue, Nov 10, 2:00 PM to 2:30 PM PST`));
  assert.deepEqual(nudged, ['main']);
  assert.deepEqual(meetings.askFollowup(cals, ZONE, SYNC_KEY), { asked: false, memo: asked.memo });
  const job = createFollowups({ db, store, owner: 'cam', urls: ['u'], getCalendar: async () => cal(SYNC, FOCUS, TALK), selfOf: () => 'owner@example.com', now, log: () => {} });
  assert.deepEqual(await job.run(), [], 'the job finds its row and sends nothing');
  assert.equal(store.list('main').length, 1);
  assert.deepEqual(meetings.view(cals, ZONE).last.followup, { state: 'asked', memo: asked.memo, to: 'main' });
  // The agent sends its memo, as scripts/meeting-followups.md says, and closes the request.
  const text = '**Follow-ups for Team sync are drafted; review and send**\n\nWhere: Slack, #team.\n\nTHE DRAFT\n*Decided*\n- We ship on Friday.\n@Sam\n- Send the list today.\n\nLEFT OUT\n- A remark about pay.';
  const result = store.send({ from: 'main', to: 'cam', impact: 3, effort: 'short', re: String(asked.memo), title: 'Follow-ups: Team sync', text }).memo;
  store.close(asked.memo, 'Drafted.', 'main');
  const f = meetings.view(cals, ZONE).last.followup;
  assert.equal(f.state, 'drafted');
  assert.equal(f.to, 'main');
  assert.deepEqual(f.answer, { id: result.id, title: 'Follow-ups: Team sync', text });
  assert.equal(f.draft, '*Decided*\n- We ship on Friday.\n@Sam\n- Send the list today.');
  assert.equal(f.found, true);
  // Send needs a text, and works only on the answer to a follow-up request.
  assert.throws(() => meetings.send(result.id, '   '), { status: 400 });
  const other = store.send({ from: 'main', to: 'cam', impact: 2, effort: 'micro', text: 'Something else.' }).memo;
  assert.throws(() => meetings.send(other.id, 'Post this.'), { status: 400, message: /not the answer to a follow-up request/ });
  assert.throws(() => meetings.send(asked.memo, 'Post this.'), { status: 400 }, 'her own request is not a draft');
  // She edits the draft and presses Send: her reply on the memo of the agent, with the fixed first words.
  nudged.length = 0;
  const edited = '*Decided*\n- We ship on Monday.\n@Sam\n- Send the list today.';
  assert.deepEqual(meetings.send(result.id, `${edited}\n`), { memo: result.id, to: 'main' });
  const sent = store.get(result.id);
  assert.equal(sent.state, 'replied');
  assert.equal(sent.reply, `${SEND_LINE}\n\n${edited}`);
  assert.ok(!sent.reply.includes('pay'), 'what was left out as sensitive is not in what she sends');
  assert.deepEqual(nudged, ['main']);
  // The reply is hers in the event log, as a reply from the Inbox is.
  const event = db.prepare("SELECT actor, kind FROM events WHERE memo_id = ? AND kind = 'reply'").get(result.id);
  assert.deepEqual({ ...event }, { actor: 'cam', kind: 'reply' });
  assert.equal(meetings.view(cals, ZONE).last.followup.state, 'answered');
  assert.throws(() => meetings.send(result.id, edited), { status: 409 }, 'not a second time');
});

test('the routes of the block: the owner only, the calendar of the Today card, and nothing of it in the ledger', async () => {
  const getCalendar = async () => cal(SYNC, FOCUS, TALK);
  const now = () => new Date('2026-11-11T04:41:00Z');
  const url = 'https://calendar.google.com/calendar/ical/owner%40example.com/private-abc/basic.ics';
  const bare = makeApp({ calendarUrl: url, getCalendar, now });
  assert.equal((await call(bare.app, '/api/meeting')).status, 503);
  const made = makeApp({ calendarUrl: url, getCalendar, now, config: [{ name: 'main', kind: 'long', dir: '~/p', model: 'm' }, { name: 'liaison', kind: 'short', dir: '~/p', model: 'm' }],
    meetings: ({ db, store, agents }) => createMeetings({ db, store, owner: 'cam', vault: mkdtempSync(join(tmpdir(), 'memo-vault-')), arrived: (n) => agents.arrived(n), agentNames: () => ['main', 'liaison'], now }) });
  assert.equal((await call(made.app, '/api/meeting', null, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(made.app, '/api/meeting/send', { memo: 1, text: 'x' }, LIAISON_TOKEN)).status, 403);
  assert.equal((await call(made.app, '/api/meeting?tz=Nope')).status, 400);
  const got = await call(made.app, `/api/meeting?tz=${encodeURIComponent(ZONE)}`);
  assert.equal(got.status, 200);
  assert.equal(got.data.configured, true);
  assert.equal(got.data.next.key, TALK_KEY);
  assert.equal(got.data.next.brief.prep, 'Claude prep notes of 2026-11-09\nTO COVER: the budget split');
  assert.equal(got.data.last.followup.state, 'waiting');
  assert.ok(!JSON.stringify(got.data).includes('owner@example.com'), 'the address of the owner is in no answer');
  const asked = await call(made.app, '/api/meeting/followup', { key: SYNC_KEY, tz: ZONE });
  assert.equal(asked.data.asked, true);
  const result = made.store.send({ from: 'main', to: 'cam', impact: 3, effort: 'short', re: String(asked.data.memo), text: 'THE DRAFT\nHello Sam' }).memo;
  assert.equal((await call(made.app, `/api/meeting?tz=${encodeURIComponent(ZONE)}`)).data.last.followup.draft, 'Hello Sam');
  assert.deepEqual((await call(made.app, '/api/meeting/send', { memo: result.id, text: 'Hello Sam!' })).data, { memo: result.id, to: 'main' });
  assert.equal(made.store.get(result.id).reply, `${SEND_LINE}\n\nHello Sam!`);
  assert.equal((await call(made.app, '/api/meeting/brief', { key: TALK_KEY, tz: ZONE })).data.asked, true);
  // With no calendar the block has only the clock.
  const none = makeApp({ meetings: ({ db, store }) => createMeetings({ db, store, owner: 'cam', vault: tmpdir() }) });
  assert.deepEqual((await call(none.app, '/api/meeting')).data, { configured: false });
  // A brief can hold her prep notes: the GitHub copy of the Inbox never reads it.
  assert.ok(!readFileSync(join(ROOT, 'src', 'ledger.js'), 'utf8').includes('/api/meeting'));
});

test('the Inbox has the time block and loads its rules by itself, so a server from before them still gives the page', async () => {
  const page = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  for (const file of ['meeting.js', 'dash.js']) {
    assert.ok(!new RegExp(`^import [^\\n]*/ui/${file.replace('.', '\\.')}`, 'm').test(page), `no import of ${file} that stops the page`);
    assert.match(page, new RegExp(`^import\\('/ui/${file.replace('.', '\\.')}'\\)\\.then\\([^\\n]*\\)\\.catch\\(\\(\\) => \\{\\}\\);$`, 'm'));
    assert.match((await makeApp().app.request(`/ui/${file}`)).headers.get('content-type'), /javascript/);
  }
  // The clock is the largest thing; the date is under it with its weekday; then the next meeting.
  assert.match(page, /getElementById\('hero-clock'\)\.textContent = now\.toLocaleTimeString\('en-US', \{ hour: 'numeric', minute: '2-digit', timeZone: browserZone \}\);/);
  assert.match(page, /getElementById\('hero-date'\)\.textContent = now\.toLocaleDateString\('en-US', \{ weekday: 'long', month: 'short', day: 'numeric', timeZone: browserZone \}\);/);
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const size = (rule) => Number(new RegExp(`\\.${rule} \\{[^}]*font: \\d+ ([\\d.]+)rem`).exec(css)[1]);
  assert.ok(size('hero-clock') > 2 * size('next-head'), 'the clock is the largest element');
  assert.match(css, /\.hero \.hero-date \{[^}]*color: var\(--dim\); font: \.95rem/);
  // The words tick with the clock, and the meetings are asked again each minute.
  assert.match(page, /setInterval\(renderHero, 10000\);\nsetInterval\(loadMeeting, 60000\);/);
  assert.match(page, /meet\.nextLine\(\{ current: meeting\.current, next: meeting\.next \}, Date\.now\(\), browserZone\)/);
  // Send is her press on a button; nothing sends by itself, and not on the GitHub copy.
  assert.match(page, /const sendB = button\('Send', \(btn\) => \{/);
  assert.match(page, /act\(btn, '\/api\/meeting\/send', \{ memo: id, text: area\.value \}/);
  assert.equal(page.split("'/api/meeting/send'").length, 2, 'one place sends');
  assert.match(page, /async function loadMeeting\(\) \{\n  if \(!meet \|\| globalThis\.MEMO_LEDGER\) return;/);
});
