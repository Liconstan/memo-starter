import test from 'node:test';
import assert from 'node:assert/strict';
import { unfold, parseCalendar, parseRule, zonedToUtc, eventsOn, validZone } from '../src/ical.js';

const NY = 'America/New_York';
// A calendar in the form that Google Calendar gives at the secret iCal address, with CRLF line ends.
const cal = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'X-WR-CALNAME:owner@example.com', 'X-WR-TIMEZONE:America/New_York',
  'BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE',
  ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const titles = (text, date, zone = NY) => eventsOn(text, date, zone).map((e) => e.title);

test('unfold joins a folded line, and the parser reads escaped text, parameters, and alarms', () => {
  assert.equal(unfold('SUMMARY:Lunch with\r\n  Sam\r\nX:1'), 'SUMMARY:Lunch with Sam\nX:1');
  const text = cal(['UID:a', 'DTSTART;TZID=America/New_York:20261021T130000', 'DTEND;TZID=America/New_York:20261021T133000',
    'SUMMARY:Sam and\r\n  Andrea\\, weekly', 'LOCATION:Room 4\\; floor 2', 'ATTENDEE;CN="Sam: S";ROLE=REQ-PARTICIPANT:mailto:sam@example.com',
    'ATTENDEE:mailto:owner@example.com', 'BEGIN:VALARM', 'SUMMARY:alarm text', 'END:VALARM']);
  const parsed = parseCalendar(text);
  assert.equal(parsed.name, 'owner@example.com');
  assert.equal(parsed.timeZone, NY);
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].ATTENDEE[0].params.CN, 'Sam: S');
  assert.deepEqual(eventsOn(text, '2026-10-21', NY), [{
    title: 'Sam and Andrea, weekly', location: 'Room 4; floor 2', hasOthers: true,
    attendees: [{ name: 'Sam: S', email: 'sam@example.com', status: '' }], organizer: null, link: '',
    start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T17:30:00.000Z', allDay: false,
  }]);
});

test('an event gives its people and its video link, for the detail in the Today card', () => {
  const on = (uid, h, title, ...lines) => [`UID:${uid}`, `DTSTART;TZID=America/New_York:20261022T${h}0000`, `DTEND;TZID=America/New_York:20261022T${h}3000`, `SUMMARY:${title}`, ...lines];
  const text = cal(
    on('m', 13, 'Sync', 'ORGANIZER;CN=Sam Lee:mailto:sam@example.com', 'ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=ACCEPTED;CN=Sam Lee:mailto:sam@example.com',
      'ATTENDEE;PARTSTAT=TENTATIVE;CN=Andrea:mailto:andrea@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:Owner@Example.com',
      'ATTENDEE;CUTYPE=ROOM;CN=Room 4:mailto:room4@resource.calendar.google.com',
      'DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij\\nDial in: 1 234', 'X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij'),
    on('z', 15, 'Zoom', 'LOCATION:https://zoom.us/j/123?pwd=x.'),
    on('d', 16, 'In the text', 'DESCRIPTION:Call: https://teams.microsoft.com/l/x\\, then lunch'),
    on('n', 17, 'Walk'),
    on('o', 18, 'Mine', 'ORGANIZER;CN=Me:mailto:Owner@Example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@example.com', 'ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=Sam Lee:mailto:sam@example.com'),
  );
  const [sync, zoom, inText, walk, mine] = eventsOn(text, '2026-10-22', NY);
  assert.deepEqual(sync.organizer, { name: 'Sam Lee', email: 'sam@example.com' });
  // The room is a place, not a person. The owner is not in the list: her address is part of the secret address.
  assert.deepEqual(sync.attendees, [
    { name: 'Sam Lee', email: 'sam@example.com', status: 'accepted' },
    { name: 'Andrea', email: 'andrea@example.com', status: 'tentative' },
  ]);
  assert.equal(sync.link, 'https://meet.google.com/abc-defg-hij');
  assert.equal(zoom.link, 'https://zoom.us/j/123?pwd=x', 'a web address in the location, without the point at its end');
  assert.equal(inText.link, 'https://teams.microsoft.com/l/x', 'a web address in the description');
  assert.deepEqual([walk.attendees, walk.organizer, walk.link], [[], null, '']);
  // The owner organizes: no organizer, and only the others in the list.
  assert.deepEqual([mine.organizer, mine.attendees], [null, [{ name: 'Sam Lee', email: 'sam@example.com', status: 'needs-action' }]]);
  assert.ok(!JSON.stringify(eventsOn(text, '2026-10-22', NY)).includes('owner@'), 'the address of the owner is in no event');
});

test('Intl converts a TZID time to UTC, also across the change to and from summer time', () => {
  assert.equal(new Date(zonedToUtc({ y: 2026, mo: 7, d: 1, h: 9 }, NY)).toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(new Date(zonedToUtc({ y: 2026, mo: 12, d: 1, h: 9 }, NY)).toISOString(), '2026-12-01T14:00:00.000Z');
  assert.equal(new Date(zonedToUtc({ y: 2026, mo: 10, d: 21, h: 9 }, 'Asia/Kolkata')).toISOString(), '2026-10-21T03:30:00.000Z');
  // 2:30 AM on 2026-03-08 is not on the clock in New York: it becomes 3:30 AM EDT.
  assert.equal(new Date(zonedToUtc({ y: 2026, mo: 3, d: 8, h: 2, mi: 30 }, NY)).toISOString(), '2026-03-08T07:30:00.000Z');
  // 1:30 AM on 2026-11-01 comes twice: the first one, EDT.
  assert.equal(new Date(zonedToUtc({ y: 2026, mo: 11, d: 1, h: 1, mi: 30 }, NY)).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(validZone(NY), true);
  assert.equal(validZone('Not/AZone'), false);
});

test('UTC times, all-day events, and the day in the zone of the browser', () => {
  const text = cal(
    ['UID:u', 'DTSTART:20261021T230000Z', 'DTEND:20261022T000000Z', 'SUMMARY:Late call'],
    ['UID:d', 'DTSTART;VALUE=DATE:20261021', 'DTEND;VALUE=DATE:20261023', 'SUMMARY:Conference'],
    ['UID:x', 'DTSTART;VALUE=DATE:20261023', 'SUMMARY:One day, no end'],
  );
  // 23:00 UTC is 7 PM in New York on the 21st, and 8 AM on the 22nd in Tokyo.
  assert.deepEqual(titles(text, '2026-10-21'), ['Conference', 'Late call']);
  assert.deepEqual(titles(text, '2026-10-22', 'Asia/Tokyo'), ['Conference', 'Late call']);
  assert.deepEqual(titles(text, '2026-10-22'), ['Conference']);
  assert.deepEqual(titles(text, '2026-10-23'), ['One day, no end']);
  const conf = eventsOn(text, '2026-10-22', NY)[0];
  assert.deepEqual([conf.allDay, conf.start, conf.end, conf.hasOthers], [true, '2026-10-21', '2026-10-23', false]);
});

test('an event across midnight shows on the two days', () => {
  const text = cal(['UID:n', 'DTSTART;TZID=America/New_York:20261021T230000', 'DTEND;TZID=America/New_York:20261022T010000', 'SUMMARY:Night flight']);
  assert.deepEqual(titles(text, '2026-10-21'), ['Night flight']);
  assert.deepEqual(titles(text, '2026-10-22'), ['Night flight']);
  assert.deepEqual(titles(text, '2026-10-23'), []);
});

test('RRULE: DAILY with INTERVAL and COUNT, and WEEKLY with BYDAY and UNTIL', () => {
  const text = cal(
    ['UID:d', 'DTSTART;TZID=America/New_York:20261001T080000', 'DTEND;TZID=America/New_York:20261001T081500', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5', 'SUMMARY:Pills'],
    ['UID:w', 'DTSTART;TZID=America/New_York:20261005T100000', 'DTEND;TZID=America/New_York:20261005T103000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261021T035959Z', 'SUMMARY:Standup'],
  );
  // Pills: Oct 1, 3, 5, 7, 9 only.
  assert.deepEqual(titles(text, '2026-10-09'), ['Pills']);
  assert.deepEqual(titles(text, '2026-10-10'), []);
  assert.deepEqual(titles(text, '2026-10-11'), []);
  // Standup: Mondays and Wednesdays until the end of Oct 20.
  assert.deepEqual(titles(text, '2026-10-14'), ['Standup']);
  assert.deepEqual(titles(text, '2026-10-15'), []);
  assert.deepEqual(titles(text, '2026-10-19'), ['Standup']);
  assert.deepEqual(titles(text, '2026-10-21'), []);
});

test('a weekly event keeps its wall-clock time after the change from summer time', () => {
  const text = cal(['UID:w', 'DTSTART;TZID=America/New_York:20261005T090000', 'DTEND;TZID=America/New_York:20261005T100000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekly']);
  assert.equal(eventsOn(text, '2026-10-26', NY)[0].start, '2026-10-26T13:00:00.000Z');
  assert.equal(eventsOn(text, '2026-11-02', NY)[0].start, '2026-11-02T14:00:00.000Z');
  // Years later, with no end.
  assert.equal(eventsOn(text, '2031-06-02', NY)[0].start, '2031-06-02T13:00:00.000Z');
});

test('RRULE: MONTHLY with BYMONTHDAY, with BYDAY and an ordinal, and YEARLY', () => {
  const text = cal(
    ['UID:m1', 'DTSTART;VALUE=DATE:20260115', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15,-1', 'SUMMARY:Pay day'],
    ['UID:m2', 'DTSTART;TZID=America/New_York:20260113T180000', 'DTEND;TZID=America/New_York:20260113T190000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Board'],
    ['UID:m3', 'DTSTART;TZID=America/New_York:20260130T120000', 'DTEND;TZID=America/New_York:20260130T130000', 'RRULE:FREQ=MONTHLY;INTERVAL=3;BYDAY=-1FR', 'SUMMARY:Review'],
    ['UID:m4', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY', 'SUMMARY:Day 31'],
    ['UID:y', 'DTSTART;VALUE=DATE:20200229', 'RRULE:FREQ=YEARLY', 'SUMMARY:Leap'],
    ['UID:y2', 'DTSTART;VALUE=DATE:20241021', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'],
  );
  assert.deepEqual(titles(text, '2026-10-15'), ['Pay day']);
  assert.deepEqual(titles(text, '2026-10-31'), ['Day 31', 'Pay day']);
  assert.deepEqual(titles(text, '2026-11-30'), ['Pay day']);
  assert.deepEqual(titles(text, '2026-10-13'), ['Board']);
  assert.deepEqual(titles(text, '2026-10-06'), []);
  // The last Friday of January, April, July, October.
  assert.deepEqual(titles(text, '2026-10-30'), ['Review']);
  assert.deepEqual(titles(text, '2026-11-27'), []);
  assert.deepEqual(titles(text, '2028-02-29'), ['Leap', 'Pay day']); // also the last day of the month
  assert.ok(!titles(text, '2027-02-28').includes('Leap'));
  assert.deepEqual(titles(text, '2026-10-21'), ['Birthday']);
});

test('EXDATE, RECURRENCE-ID overrides, and STATUS:CANCELLED', () => {
  const text = cal(
    ['UID:s', 'DTSTART;TZID=America/New_York:20261005T100000', 'DTEND;TZID=America/New_York:20261005T103000', 'RRULE:FREQ=DAILY',
      'EXDATE;TZID=America/New_York:20261007T100000,20261008T100000', 'EXDATE;TZID=America/New_York:20261009T100000', 'SUMMARY:Sync'],
    // The occurrence of Oct 12 moves to 3 PM with a new name; that of Oct 13 is cancelled.
    ['UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261012T100000', 'DTSTART;TZID=America/New_York:20261012T150000', 'DTEND;TZID=America/New_York:20261012T153000', 'SUMMARY:Sync (moved)'],
    ['UID:s', 'RECURRENCE-ID;TZID=America/New_York:20261013T100000', 'DTSTART;TZID=America/New_York:20261013T100000', 'DTEND;TZID=America/New_York:20261013T103000', 'STATUS:CANCELLED', 'SUMMARY:Sync'],
    ['UID:c', 'DTSTART;TZID=America/New_York:20261012T090000', 'DTEND;TZID=America/New_York:20261012T093000', 'STATUS:CANCELLED', 'SUMMARY:Gone'],
  );
  assert.deepEqual(titles(text, '2026-10-06'), ['Sync']);
  for (const date of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-13']) assert.deepEqual(titles(text, date), [], date);
  const moved = eventsOn(text, '2026-10-12', NY);
  assert.deepEqual(moved.map((e) => [e.title, e.start]), [['Sync (moved)', '2026-10-12T19:00:00.000Z']]);
  assert.deepEqual(titles(text, '2026-10-14'), ['Sync']);
});

test('an event the owner declined or has not answered is left out; accepted, tentative, no line, and the organizer stay', () => {
  const at = (email, partstat) => `ATTENDEE;CN=x${partstat ? `;PARTSTAT=${partstat}` : ''}:mailto:${email}`;
  const on = (uid, title, ...lines) => [`UID:${uid}`, 'DTSTART;TZID=America/New_York:20261022T130000', 'DTEND;TZID=America/New_York:20261022T133000', `SUMMARY:${title}`, ...lines];
  const text = cal(
    on('a', 'Team Lunch', at('sam@example.com', 'ACCEPTED'), at('owner@example.com', 'DECLINED')),
    on('b', 'Robin meeting', at('robin@example.com', 'ACCEPTED'), at('owner@example.com', 'NEEDS-ACTION')),
    on('c', 'Accepted', at('sam@example.com', 'ACCEPTED'), at('owner@example.com', 'ACCEPTED')),
    on('d', 'Tentative', at('sam@example.com', 'ACCEPTED'), at('owner@example.com', 'TENTATIVE')),
    on('e', 'Hold', 'ATTENDEE:mailto:sam@example.com'),
    on('f', 'Organizer', 'ORGANIZER:mailto:owner@example.com', at('owner@example.com', 'ACCEPTED'), at('sam@example.com', 'NEEDS-ACTION')),
    // The address of the calendar is lowercase; Google may write it with capitals on the ATTENDEE line.
    on('g', 'Capitals declined', at('Owner@Example.com', 'DECLINED')),
    on('h', 'Capitals accepted', at('OWNER@EXAMPLE.COM', 'ACCEPTED')),
  );
  assert.deepEqual(titles(text, '2026-10-22'), ['Accepted', 'Capitals accepted', 'Hold', 'Organizer', 'Tentative']);
});

test('a declined override of a weekly accepted event hides that day only', () => {
  const text = cal(
    ['UID:w', 'DTSTART;TZID=America/New_York:20261001T100000', 'DTEND;TZID=America/New_York:20261001T103000', 'RRULE:FREQ=WEEKLY', 'SUMMARY:Weekly',
      'ATTENDEE;PARTSTAT=ACCEPTED:mailto:owner@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.com'],
    ['UID:w', 'RECURRENCE-ID;TZID=America/New_York:20261022T100000', 'DTSTART;TZID=America/New_York:20261022T100000', 'DTEND;TZID=America/New_York:20261022T103000', 'SUMMARY:Weekly',
      'ATTENDEE;PARTSTAT=DECLINED:mailto:owner@example.com', 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.com'],
  );
  assert.deepEqual(titles(text, '2026-10-15'), ['Weekly']);
  assert.deepEqual(titles(text, '2026-10-22'), []);
  assert.deepEqual(titles(text, '2026-10-29'), ['Weekly']);
});

test('a calendar whose name is not an address shows every event', () => {
  const text = cal(['UID:a', 'DTSTART;TZID=America/New_York:20261022T130000', 'DTEND;TZID=America/New_York:20261022T133000', 'SUMMARY:Team Lunch',
    'ATTENDEE;PARTSTAT=DECLINED:mailto:owner@example.com']).replace('X-WR-CALNAME:owner@example.com', 'X-WR-CALNAME:Work');
  assert.deepEqual(titles(text, '2026-10-22'), ['Team Lunch']);
});

test('the self option names the owner when the calendar name is not an address, and wins over the name', () => {
  const ev = (uid, title, partstat) => [`UID:${uid}`, 'DTSTART;TZID=America/New_York:20261022T130000', 'DTEND;TZID=America/New_York:20261022T133000', `SUMMARY:${title}`,
    `ATTENDEE;PARTSTAT=${partstat}:mailto:owner@example.com`, 'ATTENDEE;PARTSTAT=ACCEPTED:mailto:sam@example.com'];
  const named = cal(ev('a', 'Team Lunch', 'DECLINED'), ev('b', 'Standup', 'ACCEPTED')).replace('X-WR-CALNAME:owner@example.com', 'X-WR-CALNAME:Cam - Work');
  const on = (text, opts) => eventsOn(text, '2026-10-22', NY, opts);
  assert.deepEqual(on(named).map((e) => e.title), ['Standup', 'Team Lunch'], 'without self the name cannot tell');
  const withSelf = on(named, { self: 'Owner@Example.com' });
  assert.deepEqual(withSelf.map((e) => e.title), ['Standup']);
  assert.equal(withSelf[0].hasOthers, true, 'hasOthers counts the others, not the owner');
  // self wins over a name that is an address.
  const other = cal(ev('a', 'Team Lunch', 'DECLINED')).replace('X-WR-CALNAME:owner@example.com', 'X-WR-CALNAME:someone@example.com');
  assert.deepEqual(on(other).map((e) => e.title), ['Team Lunch']);
  assert.deepEqual(on(other, { self: 'owner@example.com' }).map((e) => e.title), []);
  // An empty self falls back to the name.
  assert.deepEqual(on(cal(ev('a', 'Team Lunch', 'DECLINED')), { self: '' }).map((e) => e.title), []);
});

test('parseRule reads the parts of a rule', () => {
  assert.deepEqual(parseRule('FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR,2TU;COUNT=4;WKST=SU'), {
    freq: 'MONTHLY', interval: 2, count: 4, until: null, byday: [{ n: -1, wd: 5 }, { n: 2, wd: 2 }], bymonthday: [], bymonth: [], bysetpos: [], wkst: 0,
  });
});
