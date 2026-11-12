// Day and night by the sun (memo 1407): the pages are light from sunrise to sunset and dark from sunset to sunrise.
// The browser works the two times out itself, with the solar position formulas of NOAA (the ones of its sunrise and
// sunset spreadsheet): no request to a service, no library, and no question for the location of the device. The place
// is fixed, PLACE (ui/place.js; local/place.js of this installation replaces it, written by `npm run setup`). The owner can hold the pages light or dark with the button in the side
// bar; "Auto" follows the sun again. The choice stays in the browser (localStorage, memo-theme).
// The style sheet (ui/common.css) takes the theme from <html data-theme="light|dark">; with no attribute (no script
// yet) it follows the setting of the device, as before.
// sunTimes, sunPhase, themeFor and modeWords have no DOM code, so a test can import them.

import { PLACE } from './place.js';
export { PLACE };
export const MODES = ['auto', 'light', 'dark'];
export const MODE_KEY = 'memo-theme'; // the choice: auto, light, or dark
export const NOW_KEY = 'memo-theme-now'; // "<theme>|<until, ms>" for the small script in the head of each page (0: no end)
export const CHECK_MS = 60 * 1000;

const DAY = 86400000;
const MINUTE = 60000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const ms = (now) => (now instanceof Date ? now.getTime() : Number(now));

// Sunrise and sunset of the day of `date` at a place, in milliseconds since the epoch: { sunrise, sunset, polar }.
// The day is the solar day of the place (its date by its longitude), so the pair is always the sunrise and the sunset
// of one day there. polar: 'day' when the sun does not set that day and 'night' when it does not rise (then the two
// times are null), else null. Right to about a minute between the polar circles.
export function sunTimes(date, lat = PLACE.lat, lon = PLACE.lon) {
  const offset = (lon / 15) * 3600000;
  const midnight = Math.floor((ms(date) + offset) / DAY) * DAY; // the start of that date, in UTC
  const noonAt = midnight + DAY / 2 - offset; // about the solar noon of the place
  const t = (noonAt / DAY + 2440587.5 - 2451545) / 36525; // Julian centuries since J2000
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  const y = Math.tan(rad(eps / 2)) ** 2;
  // The equation of time, in minutes.
  const eot = 4 * deg(y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m)) + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0))
    - 0.5 * y * y * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(m)));
  // The hour angle of the sunrise, with the sun 0.833 degrees under the horizon (its radius and the refraction).
  const cosH = Math.cos(rad(90.833)) / (Math.cos(rad(lat)) * Math.cos(decl)) - Math.tan(rad(lat)) * Math.tan(decl);
  if (cosH < -1) return { sunrise: null, sunset: null, polar: 'day' };
  if (cosH > 1) return { sunrise: null, sunset: null, polar: 'night' };
  const noon = midnight + (720 - 4 * lon - eot) * MINUTE;
  const half = 4 * deg(Math.acos(cosH)) * MINUTE;
  return { sunrise: Math.round(noon - half), sunset: Math.round(noon + half), polar: null };
}

// Where the sun is now: { theme: 'light' or 'dark', next: the time of the next change in milliseconds (null in a
// polar day or night), event: what happens then, 'sunrise' or 'sunset' }.
export function sunPhase(now = new Date(), place = PLACE) {
  const today = sunTimes(now, place.lat, place.lon);
  if (today.polar) return { theme: today.polar === 'day' ? 'light' : 'dark', next: null, event: null };
  if (ms(now) < today.sunrise) return { theme: 'dark', next: today.sunrise, event: 'sunrise' };
  if (ms(now) < today.sunset) return { theme: 'light', next: today.sunset, event: 'sunset' };
  const tomorrow = sunTimes(ms(now) + DAY, place.lat, place.lon);
  return { theme: 'dark', next: tomorrow.sunrise, event: tomorrow.sunrise === null ? null : 'sunrise' };
}

export const validMode = (mode) => (MODES.includes(mode) ? mode : 'auto');
// The theme of a choice at a time: the choice itself, or the sun for auto.
export const themeFor = (mode, now = new Date(), place = PLACE) => (validMode(mode) === 'auto' ? sunPhase(now, place).theme : mode);
// The choice after a click on the button: auto, light, dark, auto.
export const nextMode = (mode) => MODES[(MODES.indexOf(validMode(mode)) + 1) % MODES.length];

const clock = (t, timeZone) => new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
// The words of the button: { label, title }. "Auto" says what the sun does next, with its clock time.
export function modeWords(mode, { now = new Date(), place = PLACE, timeZone } = {}) {
  const which = validMode(mode);
  const then = `Click for ${nextMode(which) === 'auto' ? 'the sun again' : `always ${nextMode(which)}`}.`;
  if (which !== 'auto') return { label: `Theme: ${which === 'light' ? 'Light' : 'Dark'}`, title: `Always ${which}, whatever the sun does. ${then}` };
  const phase = sunPhase(now, place);
  const until = phase.next === null ? '' : ` until ${phase.event} at ${clock(phase.next, timeZone)}`;
  return { label: `Theme: Auto (${phase.theme === 'light' ? 'day' : 'night'})`, title: `Follows the sun in ${place.name}: ${phase.theme}${until}. ${then}` };
}

// Starts the theme on a page: sets <html data-theme>, checks the sun again each minute and when the page comes to the
// front, and puts the button in the side bar. A change of the theme sends the event "memo-theme" to the window, so a
// page can draw again what holds the old colors (the frames of html blocks).
export function startTheme({ doc = document, storage = globalThis.localStorage, now = () => new Date(), every = CHECK_MS, place = PLACE } = {}) {
  const read = () => { try { return validMode(storage.getItem(MODE_KEY)); } catch { return 'auto'; } };
  const keep = (key, value) => { try { storage.setItem(key, value); } catch { /* a private window: the choice lasts for this page */ } };
  let mode = read();
  const toggle = doc.createElement('button');
  toggle.type = 'button';
  toggle.className = 'theme-toggle';
  function apply() {
    const theme = themeFor(mode, now(), place);
    const root = doc.documentElement;
    const changed = root.getAttribute('data-theme') !== theme;
    root.setAttribute('data-theme', theme);
    keep(NOW_KEY, `${theme}|${mode === 'auto' ? sunPhase(now(), place).next ?? 0 : 0}`);
    const words = modeWords(mode, { now: now(), place });
    toggle.textContent = words.label;
    toggle.title = words.title;
    if (changed) doc.defaultView?.dispatchEvent(new Event('memo-theme'));
    return theme;
  }
  toggle.addEventListener('click', () => { mode = nextMode(mode); keep(MODE_KEY, mode); apply(); });
  const side = doc.querySelector('.side');
  if (side) side.insertBefore(toggle, side.querySelector('.owner'));
  apply();
  const timer = setInterval(apply, every);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') { mode = read(); apply(); } });
  return { apply, timer, toggle };
}
