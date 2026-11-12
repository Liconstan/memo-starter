import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, ROOT } from './helpers.js';
import { PLACE, MODES, MODE_KEY, NOW_KEY, sunTimes, sunPhase, themeFor, nextMode, validMode, modeWords, startTheme } from '../ui/theme.js';

// Day and night by the sun (memo 1407, ui/theme.js).
const LA = 'America/Los_Angeles';
// The place of these tests: the published sunrise and sunset tables of San Francisco. The place of an installation is
// ui/place.js, or local/place.js, so every call here names its place.
const SF = { lat: 37.77, lon: -122.42, name: 'the San Francisco Bay Area' };
const clock = (t) => new Intl.DateTimeFormat('en-US', { timeZone: LA, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const near = (t, iso, minutes = 3) => assert.ok(Math.abs(t - Date.parse(iso)) <= minutes * 60000, `${new Date(t).toISOString()} is within ${minutes} minutes of ${iso}`);

test('sunTimes gives the sunrise and the sunset of the day at the place, from the NOAA formulas', () => {
  assert.ok(Number.isFinite(PLACE.lat) && Number.isFinite(PLACE.lon) && typeof PLACE.name === 'string' && PLACE.name, 'the place of the installation has a latitude, a longitude and a name');
  // San Francisco, from the published tables: Nov 10 6:45 AM and 5:02 PM PST; Jun 21 5:48 AM and 8:35 PM PDT;
  // Dec 21 7:21 AM and 4:54 PM PST.
  const nov = sunTimes(new Date('2026-11-10T20:00:00Z'), SF.lat, SF.lon);
  near(nov.sunrise, '2026-11-10T14:45:00Z');
  near(nov.sunset, '2026-11-11T01:02:00Z');
  assert.equal(nov.polar, null);
  const jun = sunTimes(new Date('2026-06-21T20:00:00Z'), SF.lat, SF.lon);
  near(jun.sunrise, '2026-06-21T12:48:00Z');
  near(jun.sunset, '2026-06-22T03:35:00Z');
  const dec = sunTimes(new Date('2026-12-21T20:00:00Z'), SF.lat, SF.lon);
  near(dec.sunrise, '2026-12-21T15:21:00Z');
  near(dec.sunset, '2026-12-22T00:54:00Z');
  // The day is that of the place: half past eleven at night there (7:30 UTC of the next date) is still Nov 10.
  assert.deepEqual(sunTimes(new Date('2026-11-11T07:30:00Z'), SF.lat, SF.lon), nov);
  // A different place: London on Jun 21, 4:43 AM and 9:21 PM BST.
  const london = sunTimes(new Date('2026-06-21T12:00:00Z'), 51.5074, -0.1278);
  near(london.sunrise, '2026-06-21T03:43:00Z');
  near(london.sunset, '2026-06-21T20:21:00Z');
  // Beyond the polar circle the sun does not set in June and does not rise in December.
  assert.deepEqual(sunTimes(new Date('2026-06-21T12:00:00Z'), 78, 15), { sunrise: null, sunset: null, polar: 'day' });
  assert.deepEqual(sunTimes(new Date('2026-12-21T12:00:00Z'), 78, 15), { sunrise: null, sunset: null, polar: 'night' });
});

test('sunPhase: light from sunrise to sunset, dark from sunset to sunrise, with the time of the next change', () => {
  const day = sunPhase(new Date('2026-11-10T20:00:00Z'), SF);
  assert.deepEqual([day.theme, day.event, clock(day.next)], ['light', 'sunset', '5:02 PM']);
  const evening = sunPhase(new Date('2026-11-11T02:00:00Z'), SF);
  assert.deepEqual([evening.theme, evening.event], ['dark', 'sunrise']);
  near(evening.next, '2026-11-11T14:46:00Z');
  const early = sunPhase(new Date('2026-11-10T13:00:00Z'), SF);
  assert.deepEqual([early.theme, early.event, clock(early.next)], ['dark', 'sunrise', '6:44 AM']);
  // The change is at the minute: a second before the sunset is light, the sunset itself is dark.
  assert.equal(sunPhase(day.next - 1000, SF).theme, 'light');
  assert.equal(sunPhase(day.next, SF).theme, 'dark');
  assert.deepEqual(sunPhase(new Date('2026-06-21T12:00:00Z'), { lat: 78, lon: 15 }), { theme: 'light', next: null, event: null });
  assert.deepEqual(sunPhase(new Date('2026-12-21T12:00:00Z'), { lat: 78, lon: 15 }), { theme: 'dark', next: null, event: null });
});

test('the choice of the owner: auto follows the sun, light and dark hold; the button says which', () => {
  const noon = new Date('2026-11-10T20:00:00Z');
  const night = new Date('2026-11-11T06:00:00Z');
  assert.deepEqual(MODES, ['auto', 'light', 'dark']);
  assert.deepEqual([themeFor('auto', noon, SF), themeFor('auto', night, SF)], ['light', 'dark']);
  assert.deepEqual([themeFor('dark', noon, SF), themeFor('light', night, SF)], ['dark', 'light'], 'a choice by hand wins over the sun');
  assert.deepEqual([validMode('dark'), validMode(null), validMode('purple')], ['dark', 'auto', 'auto']);
  assert.equal(themeFor('purple', noon, SF), 'light', 'an unknown choice is auto');
  assert.deepEqual([nextMode('auto'), nextMode('light'), nextMode('dark')], ['light', 'dark', 'auto']);
  assert.deepEqual(modeWords('auto', { now: noon, place: SF, timeZone: LA }), { label: 'Theme: Auto (day)',
    title: 'Follows the sun in the San Francisco Bay Area: light until sunset at 5:02 PM. Click for always light.' });
  assert.deepEqual(modeWords('auto', { now: night, place: SF, timeZone: LA }), { label: 'Theme: Auto (night)',
    title: 'Follows the sun in the San Francisco Bay Area: dark until sunrise at 6:46 AM. Click for always light.' });
  assert.deepEqual(modeWords('light'), { label: 'Theme: Light', title: 'Always light, whatever the sun does. Click for always dark.' });
  assert.deepEqual(modeWords('dark'), { label: 'Theme: Dark', title: 'Always dark, whatever the sun does. Click for the sun again.' });
});

// A small document: the root with its attributes, a side bar with the owner block, and the listeners.
function fakeDoc() {
  const node = (tag) => ({ tag, attrs: {}, children: [], listeners: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
    addEventListener(k, f) { this.listeners[k] = f; } });
  const owner = node('div');
  const side = { ...node('aside'), querySelector: () => owner, insertBefore(n, before) { this.children.splice(this.children.indexOf(before), 0, n); } };
  side.children.push(owner);
  const events = [];
  const doc = { documentElement: node('html'), createElement: node, querySelector: (q) => (q === '.side' ? side : null), listeners: {},
    addEventListener(k, f) { this.listeners[k] = f; }, visibilityState: 'visible', defaultView: { dispatchEvent: (e) => events.push(e.type) } };
  return { doc, side, owner, events };
}
function fakeStorage(start = {}) {
  const data = { ...start };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); } };
}

test('startTheme sets the theme of the page, checks the sun again, and keeps a choice by hand', () => {
  const { doc, side, owner, events } = fakeDoc();
  const storage = fakeStorage();
  let time = new Date('2026-11-10T20:00:00Z');
  const started = startTheme({ place: SF, doc, storage, now: () => time, every: 3600000 });
  clearInterval(started.timer);
  assert.equal(doc.documentElement.attrs['data-theme'], 'light');
  assert.deepEqual(side.children, [started.toggle, owner], 'the button is in the side bar, over the owner');
  assert.deepEqual([started.toggle.type, started.toggle.className, started.toggle.textContent], ['button', 'theme-toggle', 'Theme: Auto (day)']);
  // What the small script in the head reads at the next visit: the theme, and the time it holds until.
  const [theme, until] = storage.data[NOW_KEY].split('|');
  assert.equal(theme, 'light');
  assert.equal(clock(Number(until)), '5:02 PM');
  assert.deepEqual(events, ['memo-theme']);
  // The sun sets: the next check turns the page dark, with no click.
  time = new Date('2026-11-11T01:30:00Z');
  assert.equal(started.apply(), 'dark');
  assert.equal(doc.documentElement.attrs['data-theme'], 'dark');
  assert.equal(started.toggle.textContent, 'Theme: Auto (night)');
  assert.deepEqual(events, ['memo-theme', 'memo-theme']);
  started.apply();
  assert.equal(events.length, 2, 'no event with no change');
  // A click holds the page light, whatever the sun does, and the browser keeps the choice.
  started.toggle.listeners.click();
  assert.deepEqual([doc.documentElement.attrs['data-theme'], storage.data[MODE_KEY], storage.data[NOW_KEY], started.toggle.textContent], ['light', 'light', 'light|0', 'Theme: Light']);
  started.toggle.listeners.click();
  assert.deepEqual([doc.documentElement.attrs['data-theme'], storage.data[MODE_KEY]], ['dark', 'dark']);
  started.toggle.listeners.click();
  assert.deepEqual([storage.data[MODE_KEY], started.toggle.textContent], ['auto', 'Theme: Auto (night)']);
  // A choice made on a different page of the same browser counts when this page comes to the front.
  storage.data[MODE_KEY] = 'light';
  doc.listeners.visibilitychange();
  assert.equal(doc.documentElement.attrs['data-theme'], 'light');
  // A page of a later visit starts with the kept choice; a browser with no storage follows the sun.
  const again = fakeDoc();
  clearInterval(startTheme({ place: SF, doc: again.doc, storage: fakeStorage({ [MODE_KEY]: 'dark' }), now: () => new Date('2026-11-10T20:00:00Z') }).timer);
  assert.equal(again.doc.documentElement.attrs['data-theme'], 'dark');
  const bare = fakeDoc();
  clearInterval(startTheme({ place: SF, doc: bare.doc, storage: { getItem() { throw new Error('no storage'); }, setItem() { throw new Error('no storage'); } }, now: () => new Date('2026-11-10T20:00:00Z') }).timer);
  assert.equal(bare.doc.documentElement.attrs['data-theme'], 'light');
});

test('the style sheet has the two themes by the attribute, with the same colors as the rules of the device setting', () => {
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const vars = (block) => Object.fromEntries([...block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const themed = (name) => vars(new RegExp(`^:root\\[data-theme="${name}"\\] \\{([^}]*)\\}`, 'm').exec(css)[1]);
  // The colors of the device setting: every plain :root rule for light, every :root rule in a dark media query for dark.
  const light = {};
  for (const m of css.matchAll(/^:root \{([^}]*)\}/gm)) Object.assign(light, vars(m[1]));
  const dark = {};
  for (const m of css.matchAll(/^@media \(prefers-color-scheme: dark\) \{\s*:root \{([^}]*)\}/gm)) Object.assign(dark, vars(m[1]));
  delete light['--serif'];
  assert.ok(Object.keys(dark).length >= 25 && dark['--gold'] && dark['--bad'], 'the dark rules are all found');
  assert.deepEqual(themed('dark'), dark);
  assert.deepEqual(themed('light'), Object.fromEntries(Object.keys(dark).map((k) => [k, light[k]])), 'light restates each color that dark changes');
  assert.match(css, /^:root\[data-theme="light"\] \{\n  color-scheme: light;/m);
  assert.match(css, /^:root\[data-theme="dark"\] \{\n  color-scheme: dark;/m);
  assert.match(css, /^\.theme-toggle \{/m);
});

test('each page sets the theme before its first paint and starts the theme; the server gives the file', async () => {
  const { app } = makeApp();
  const file = await app.request('/ui/theme.js');
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /javascript/);
  for (const path of ['/inbox', '/agents', '/system']) {
    const page = await (await app.request(path)).text();
    assert.match(page, /<script>try\{var t=\(localStorage\.getItem\('memo-theme-now'\)\|\|''\)\.split\('\|'\);/, `${path} has the script in its head`);
    assert.ok(page.indexOf("localStorage.getItem('memo-theme-now')") < page.indexOf('<body>'), `${path} sets the theme before the body`);
    assert.match(page, /^import\('\/ui\/theme\.js'\)\.then\(\(m\) => m\.startTheme\(\)\)\.catch\(\(\) => \{\}\);$/m, `${path} starts the theme`);
  }
  // No question for the place of the device, and no request to a service.
  const source = readFileSync(join(ROOT, 'ui', 'theme.js'), 'utf8');
  assert.doesNotMatch(source, /navigator|fetch\(/);
  // The frames of html blocks hold the colors of their theme, so the Inbox draws the list again after a change.
  assert.match(await (await app.request('/inbox')).text(), /\|\| !queue\.children\.length \|\| theme !== drawnTheme;/);
});
