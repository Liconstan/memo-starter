import test from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_MS, SPARE_ABOVE, TIGHT_BELOW, LIMIT_LEFT, FRESH_MS, pointsLeft, shareLeft, headroom, bindingHeadroom, nextReset, resetWithin, resetPassed, stateOf, usageKnown, countdownWords, countdownShort, paceWords, dayWords, dayPeriodWords, hourWords, runsOutAt, forecastWords, agoWords } from '../ui/pacing.js';

// The worked example of memo 1047: Sunday at 10 in the morning in Los Angeles, the week resets Tuesday at 10.
const now = new Date('2026-11-08T18:00:00Z');
const zone = { now, timeZone: 'America/Los_Angeles' };
const TUE = '2026-11-10T18:00:00Z';
const session = { percent: 6, resets_at: '2026-11-08T22:12:00Z', rate: 2 };
const week = { percent: 63, resets_at: TUE, rate: 0.5 };
const fable = { name: 'Fable', percent: 93, resets_at: TUE, rate: 1 };

test('headroom: the percent left minus the share of the window left, in points', () => {
  assert.deepEqual([WINDOW_MS.session, WINDOW_MS.week], [5 * 3600000, 7 * 86400000]);
  assert.equal(pointsLeft(week), 37);
  assert.equal(pointsLeft({ percent: 120 }), 0, 'never below zero');
  assert.equal(pointsLeft(null), null);
  assert.equal(Math.round(shareLeft(week, WINDOW_MS.week, now) * 1000), 286, 'two of seven days');
  assert.equal(shareLeft({ percent: 1, resets_at: '2026-11-08T17:00:00Z' }, WINDOW_MS.week, now), null, 'a reset that passed');
  assert.equal(shareLeft({ percent: 1 }, WINDOW_MS.week, now), null, 'no reset time');
  assert.equal(shareLeft({ percent: 1, resets_at: '2026-12-08T17:00:00Z' }, WINDOW_MS.week, now), 1, 'a reset beyond the window: all of it');
  assert.equal(Math.round(headroom(week, WINDOW_MS.week, now)), 8, '37 left minus 28.6 of the week left');
  assert.equal(Math.round(headroom(fable, WINDOW_MS.week, now)), -22);
  assert.equal(Math.round(headroom(session, WINDOW_MS.session, now)), 10, '94 left minus 84 of the session left');
  assert.equal(headroom({ percent: 6 }, WINDOW_MS.session, now), null);
  assert.equal(headroom(null, WINDOW_MS.session, now), null);
  assert.equal(Math.round(bindingHeadroom({ session, week }, now)), 8, 'the lower of the two');
  assert.equal(Math.round(bindingHeadroom({ session }, now)), 10, 'one window: that one');
  assert.equal(bindingHeadroom({}, now), null);
  assert.equal(nextReset({ session, week }), Date.parse(session.resets_at));
  assert.equal(nextReset({ week }), Date.parse(TUE));
  assert.equal(nextReset({}), null);
  assert.equal(resetWithin(session, 15 * 60000, now), false);
  assert.equal(resetWithin({ resets_at: '2026-11-08T18:10:00Z' }, 15 * 60000, now), true);
  assert.equal(resetWithin({ resets_at: '2026-11-08T17:50:00Z' }, 15 * 60000, now), false, 'passed is not within');
  assert.equal(resetPassed({ session: { percent: 1, resets_at: '2026-11-08T17:50:00Z' }, week }, now), true);
  assert.equal(resetPassed({ session, week }, now), false);
});

test('the four states, from the lower headroom of the session and the week', () => {
  assert.deepEqual([SPARE_ABOVE, TIGHT_BELOW, LIMIT_LEFT], [15, -10, 5]);
  const w = (percent) => ({ percent, resets_at: TUE });
  const s = (percent) => ({ percent, resets_at: session.resets_at });
  assert.equal(stateOf({ session: s(6), week: w(63) }, now).word, 'On pace', 'headroom 8');
  assert.equal(stateOf({ session: s(6), week: w(40) }, now).word, 'On pace', 'the week has 31, but the session binds at 10');
  assert.equal(stateOf({ session: s(0), week: w(40) }, now).word, 'Spare', 'headroom 16');
  assert.equal(stateOf({ session: s(6), week: w(85) }, now).word, 'Tight', 'headroom minus 14');
  assert.equal(stateOf({ session: s(6), week: w(80) }, now).word, 'On pace', 'headroom minus 9');
  assert.equal(stateOf({ session: s(90), week: w(40) }, now).word, 'Tight', 'the session binds: headroom minus 74');
  assert.equal(stateOf({ session: s(95), week: w(40) }, now).word, 'At limit', '5 points left');
  assert.equal(stateOf({ session: s(6), week: w(96) }, now).word, 'At limit');
  assert.equal(stateOf({ session: { percent: 96 }, week: null }, now).word, 'Not known', 'no reset time, no headroom');
  assert.equal(stateOf({ session: { percent: 96, resets_at: '2026-11-08T17:00:00Z' }, week: w(40) }, now).word, 'Not known', 'a reset passed: the figures are from before it');
  assert.equal(stateOf(null, now).word, 'Not known');
  // Known for the pick: fresh figures, no reset passed, a headroom.
  assert.equal(FRESH_MS, 20 * 60000);
  assert.equal(usageKnown({ at: '2026-11-08T17:41:00Z', session, week }, now), true);
  assert.equal(usageKnown({ at: '2026-11-08T17:39:00Z', session, week }, now), false, 'older than 20 minutes');
  assert.equal(usageKnown({ at: null, session, week }, now), false);
  assert.equal(usageKnown({ at: '2026-11-08T17:59:00Z', session: { percent: 6, resets_at: '2026-11-08T17:00:00Z' }, week }, now), false, 'a reset passed');
  assert.equal(usageKnown({ at: '2026-11-08T17:59:00Z', session: { percent: 6 }, week: null }, now), false, 'no headroom');
  assert.equal(usageKnown(null, now), false);
});

test('the countdown and the pace in words', () => {
  assert.equal(countdownWords(TUE, now), 'resets in 2 days 0 hours');
  assert.equal(countdownWords(session.resets_at, now), 'resets in 4 hours 12 minutes');
  assert.equal(countdownWords('2026-11-09T19:00:00Z', now), 'resets in 1 day 1 hour');
  assert.equal(countdownWords('2026-11-08T19:01:00Z', now), 'resets in 1 hour 1 minute');
  assert.equal(countdownWords('2026-11-08T18:06:00Z', now), 'resets in 6 minutes');
  assert.equal(countdownWords('2026-11-08T18:00:30Z', now), 'resets in under a minute');
  assert.equal(countdownWords('2026-11-08T17:00:00Z', now), 'reset passed, waiting for new figures');
  assert.equal(countdownWords(null, now), '');
  assert.equal(countdownWords('no date', now), '');
  // The short countdown of the line of resets under the bars (memo 1320): the same words with the units cut.
  assert.equal(countdownShort(TUE, now), 'resets in 2 days 0 h');
  assert.equal(countdownShort(session.resets_at, now), 'resets in 4 h 12 min');
  assert.equal(countdownShort('2026-11-09T19:00:00Z', now), 'resets in 1 day 1 h');
  assert.equal(countdownShort('2026-11-08T19:01:00Z', now), 'resets in 1 h 1 min');
  assert.equal(countdownShort('2026-11-08T18:06:00Z', now), 'resets in 6 min');
  assert.equal(countdownShort('2026-11-08T18:00:30Z', now), 'resets in under a minute');
  assert.equal(countdownShort('2026-11-08T17:00:00Z', now), 'reset passed');
  assert.equal(countdownShort(null, now), '');
  assert.equal(countdownShort('no date', now), '');
  assert.equal(paceWords(8.4), '8 points ahead of pace');
  assert.equal(paceWords(-22), '22 points behind pace');
  assert.equal(paceWords(1.2), '1 point ahead of pace');
  assert.equal(paceWords(0.4), 'on pace');
  assert.equal(paceWords(null), '');
  assert.equal(agoWords('2026-11-08T17:57:00Z', now), '3 minutes ago');
  assert.equal(agoWords('2026-11-08T17:59:00Z', now), '1 minute ago');
  assert.equal(agoWords('2026-11-08T17:59:50Z', now), 'under a minute ago');
  assert.equal(agoWords(null, now), '');
});

test('the forecast from the burn rate, in words', () => {
  // Fable at 1 point an hour with 7 left runs out in 7 hours: 5 in the afternoon in Los Angeles, before Tuesday.
  assert.equal(runsOutAt(fable, now), Date.parse('2026-11-09T01:00:00Z'));
  assert.equal(forecastWords(fable, zone), 'runs out about 5 this afternoon at this rate');
  assert.equal(forecastWords(week, zone), '', '37 left at half a point an hour lasts 74 hours, past the reset');
  assert.equal(forecastWords({ ...fable, rate: 0 }, zone), '', 'no burn');
  assert.equal(forecastWords({ ...fable, rate: null }, zone), '', 'no rate yet');
  assert.equal(forecastWords({ ...fable, resets_at: null }, zone), '', 'no reset to run out before');
  assert.equal(forecastWords({ ...fable, rate: 0.2 }, zone), 'runs out tomorrow about 9 in the evening at this rate', '35 hours');
  assert.equal(forecastWords({ ...fable, rate: 0.1, resets_at: '2026-11-14T18:00:00Z' }, { now: new Date('2026-11-06T18:00:00Z'), timeZone: 'America/Los_Angeles' }), 'runs out Monday about 8 in the morning at this rate', 'another day names the day: 70 hours from Friday');
  // The hour in words: to the nearest hour, with the part of the day; a later day names the day first.
  assert.equal(hourWords('2026-11-08T20:10:00Z', zone), 'about noon today');
  assert.equal(hourWords('2026-11-08T18:40:00Z', zone), 'about 11 this morning');
  assert.equal(hourWords('2026-11-09T04:00:00Z', zone), 'about 8 this evening');
  assert.equal(hourWords('2026-11-09T07:00:00Z', zone), 'about 11 tonight');
  assert.equal(hourWords('2026-11-09T07:40:00Z', zone), 'tomorrow about midnight', 'half past 11 at night rounds to midnight of the next day');
  assert.equal(hourWords('2026-11-09T23:40:00Z', zone), 'tomorrow about 4 in the afternoon');
  assert.equal(hourWords('2026-11-11T10:00:00Z', zone), 'Wednesday about 2 at night');
  assert.equal(hourWords('2026-11-20T18:00:00Z', zone), 'Nov 20 about 10 in the morning');
  assert.equal(hourWords(null, zone), '');
  // The day in words, and the day with its part.
  assert.equal(dayWords('2026-11-08T22:00:00Z', zone), 'today');
  assert.equal(dayWords('2026-11-09T18:00:00Z', zone), 'tomorrow');
  assert.equal(dayWords(TUE, zone), 'Tuesday');
  assert.equal(dayWords('2026-11-14T18:00:00Z', zone), 'Saturday', 'six days ahead');
  assert.equal(dayWords('2026-11-15T18:00:00Z', zone), 'Nov 15', 'a week ahead: the weekday would be ambiguous');
  assert.equal(dayPeriodWords(TUE, zone), 'Tuesday morning');
  assert.equal(dayPeriodWords('2026-11-08T22:00:00Z', zone), 'this afternoon');
  assert.equal(dayPeriodWords('2026-11-09T06:00:00Z', zone), 'tonight');
  assert.equal(dayPeriodWords('2026-11-09T18:00:00Z', zone), 'tomorrow morning');
  assert.equal(dayPeriodWords('2026-11-20T18:00:00Z', zone), 'Nov 20 in the morning');
  assert.equal(dayPeriodWords(null, zone), '');
});
