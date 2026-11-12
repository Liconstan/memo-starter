// The pacing of a Claude account (memo 1047): how much of a window is left against how much of its time is left, in
// plain words for the card and in numbers for the pick of the capture form. No DOM code, so a test and the server
// (src/handover.js) can import it. The figures come from src/usage.js: each window has `percent` used, `resets_at`,
// and `rate`, the points used per hour over the last hour of samples.
//
// The measure is headroom, in points: the percent left minus the share of the window still to run, times 100. Zero
// means on pace to use everything by the reset. Positive means spend freely. Negative means ration. The window is
// 5 hours for the session and 7 days for the week and for each model with its own limit (Fable).
export const WINDOW_MS = { session: 5 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 };
// The four states, from the lower headroom of the session and the week: Spare above plus 15, On pace down to minus 10,
// Tight below that, and At limit with 5 points or fewer left in the session or the week (the limit of the handover
// job, LIMIT_AT in ui/agentstate.js, is the same 95 percent).
export const SPARE_ABOVE = 15;
export const TIGHT_BELOW = -10;
export const LIMIT_LEFT = 5;
// Above this Fable headroom the card says how many points would reset unused.
export const FABLE_SPARE_ABOVE = 30;
// Figures older than this count as unknown for the pick: the server gets new ones each 5 minutes.
export const FRESH_MS = 20 * 60 * 1000;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const percentOf = (w) => (w && Number.isFinite(Number(w.percent)) ? Number(w.percent) : null);
const resetOf = (w) => { const t = Date.parse(w?.resets_at ?? ''); return Number.isNaN(t) ? null : t; };
const ms = (now) => (now instanceof Date ? now.getTime() : Number(now));

// The points left in a window: 100 minus the percent used, never below 0; null when the percent is not known.
export const pointsLeft = (w) => { const p = percentOf(w); return p === null ? null : Math.max(0, 100 - p); };

// The share of the window still to run, from 0 to 1; null when the reset time is not known or has passed (then the
// figures are from before the reset, and nothing can be said until new ones come).
export function shareLeft(w, windowMs, now = new Date()) {
  const reset = resetOf(w);
  if (reset === null || reset < ms(now)) return null;
  return Math.min(1, (reset - ms(now)) / windowMs);
}

// The headroom of a window in points, or null when the percent or the reset time is not known.
export function headroom(w, windowMs, now = new Date()) {
  const left = pointsLeft(w);
  const share = shareLeft(w, windowMs, now);
  return left === null || share === null ? null : left - share * 100;
}

// The headroom that binds an account: the lower of the session and the week. null when neither is known.
export function bindingHeadroom(usage, now = new Date()) {
  const s = headroom(usage?.session, WINDOW_MS.session, now);
  const w = headroom(usage?.week, WINDOW_MS.week, now);
  if (s === null) return w;
  if (w === null) return s;
  return Math.min(s, w);
}

// The earliest reset of the session and the week, in milliseconds since the epoch, or null.
export function nextReset(usage) {
  const times = [resetOf(usage?.session), resetOf(usage?.week)].filter((t) => t !== null);
  return times.length ? Math.min(...times) : null;
}

// Does the window reset within the next `within` milliseconds? False with no reset time or a reset that passed.
export function resetWithin(w, within, now = new Date()) {
  const reset = resetOf(w);
  return reset !== null && reset >= ms(now) && reset - ms(now) <= within;
}

// Is the account at its limit: 5 points or fewer left in the session or the week?
export const atLimitLeft = (usage) => [usage?.session, usage?.week].some((w) => { const l = pointsLeft(w); return l !== null && l <= LIMIT_LEFT; });

// Did the reset of the session or the week pass? Then the figures are from before it, and nothing can be said until
// new ones come.
export const resetPassed = (usage, now = new Date()) => [usage?.session, usage?.week].some((w) => { const r = resetOf(w); return r !== null && r < ms(now); });

// The state of an account: { word, headroom }. word: 'At limit', 'Tight', 'On pace', 'Spare', or 'Not known'.
export function stateOf(usage, now = new Date()) {
  const h = resetPassed(usage, now) ? null : bindingHeadroom(usage, now);
  if (h !== null && atLimitLeft(usage)) return { word: 'At limit', headroom: h };
  if (h === null) return { word: 'Not known', headroom: null };
  if (h > SPARE_ABOVE) return { word: 'Spare', headroom: h };
  if (h >= TIGHT_BELOW) return { word: 'On pace', headroom: h };
  return { word: 'Tight', headroom: h };
}

// Are the figures of an account fresh and usable: from the last 20 minutes, with no reset passed, and with a headroom?
export function usageKnown(usage, now = new Date()) {
  const age = ms(now) - Date.parse(usage?.at ?? '');
  if (Number.isNaN(age) || age > FRESH_MS || resetPassed(usage, now)) return false;
  return bindingHeadroom(usage, now) !== null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "resets in 2 days 0 hours", "resets in 4 hours 12 minutes", "resets in 6 minutes", "resets in under a minute";
// "reset passed, waiting for new figures" when the time is in the past; '' with no time.
export function countdownWords(iso, now = new Date()) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const left = t - ms(now);
  if (left < 0) return 'reset passed, waiting for new figures';
  if (left < MINUTE) return 'resets in under a minute';
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  if (days > 0) return `resets in ${plural(days, 'day')} ${plural(hours, 'hour')}`;
  if (hours > 0) return `resets in ${plural(hours, 'hour')} ${plural(minutes, 'minute')}`;
  return `resets in ${plural(minutes, 'minute')}`;
}

// The countdown in short, for the one line of resets under the bars (memo 1320): "resets in 4 h 12 min", "resets in
// 2 days 0 h", "resets in 6 min", "resets in under a minute"; "reset passed" when the time is in the past; '' with no
// time. The words are those of countdownWords, with the units cut.
export function countdownShort(iso, now = new Date()) {
  const words = countdownWords(iso, now);
  if (words.startsWith('reset passed')) return 'reset passed';
  return words.replace(/(\d+) hours?/, '$1 h').replace(/(\d+) minutes?/, '$1 min');
}

// "8 points ahead of pace", "22 points behind pace", or "on pace" within a point.
export function paceWords(h) {
  if (h === null || h === undefined || !Number.isFinite(h)) return '';
  const n = Math.round(h);
  if (n === 0) return 'on pace';
  return `${plural(Math.abs(n), 'point')} ${n > 0 ? 'ahead of' : 'behind'} pace`;
}

const parts = (date, timeZone, options) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(date).map((p) => [p.type, p.value]));
const ymd = (date, timeZone) => { const p = parts(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
const daysAhead = (date, now, timeZone) => Math.round((ymd(date, timeZone) - ymd(new Date(ms(now)), timeZone)) / DAY);

// The day of a time in words: "today", "tomorrow", a weekday within the week ("Tuesday"), else "Nov 20".
export function dayWords(iso, { now = new Date(), timeZone } = {}) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const date = new Date(t);
  const days = daysAhead(date, now, timeZone);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return parts(date, timeZone, { weekday: 'long' }).weekday;
  const d = parts(date, timeZone, { month: 'short', day: 'numeric' });
  return `${d.month} ${d.day}`;
}

const period = (h) => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : h >= 18 && h < 22 ? 'evening' : 'night');

// The day and the part of the day in words: "this afternoon", "tonight", "tomorrow morning", "Tuesday morning",
// "Nov 20 in the morning".
export function dayPeriodWords(iso, { now = new Date(), timeZone } = {}) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const day = dayWords(iso, { now, timeZone });
  const part = period(Number(parts(new Date(t), timeZone, { hour: 'numeric', hour12: false }).hour) % 24);
  if (day === 'today') return part === 'night' ? 'tonight' : `this ${part}`;
  if (day === 'tomorrow' || /^[A-Z][a-z]+day$/.test(day)) return `${day} ${part}`;
  return `${day} ${part === 'night' ? 'at night' : `in the ${part}`}`;
}

// A time in plain words, to the nearest hour: "about 5 this afternoon", "about noon today", "about 11 tonight",
// "Monday about 4 in the afternoon", "Nov 20 about 10 in the morning".
export function hourWords(iso, { now = new Date(), timeZone } = {}) {
  const t = Date.parse(iso ?? '');
  if (Number.isNaN(t)) return '';
  const date = new Date(t);
  const p = parts(date, timeZone, { hour: 'numeric', minute: '2-digit', hour12: false });
  let hour = (Number(p.hour) % 24) + (Number(p.minute) >= 30 ? 1 : 0);
  // Half past 11 at night rounds to midnight of the next day.
  const rolled = hour === 24;
  if (rolled) hour = 0;
  const day = dayWords(iso, { now: ms(now) - (rolled ? DAY : 0), timeZone });
  const today = day === 'today';
  const when = hour === 0 ? 'midnight' : hour === 12 ? 'noon' : String(hour % 12);
  if (hour === 0 || hour === 12) return today ? `about ${when} ${hour === 0 ? 'tonight' : 'today'}` : `${day} about ${when}`;
  const part = period(hour);
  if (today) return `about ${when} ${part === 'night' ? 'tonight' : `this ${part}`}`;
  return `${day} about ${when} ${part === 'night' ? 'at night' : `in the ${part}`}`;
}

// When a window runs out at its current rate, in milliseconds since the epoch; null with no rate, with no burn, or
// when the window lasts to its reset.
export function runsOutAt(w, now = new Date()) {
  const left = pointsLeft(w);
  const rate = Number(w?.rate);
  const reset = resetOf(w);
  if (left === null || !Number.isFinite(rate) || rate <= 0 || reset === null) return null;
  const at = ms(now) + (left / rate) * HOUR;
  return at < reset ? at : null;
}

// "runs out about 5 this afternoon at this rate", or '' when the window lasts to its reset.
export function forecastWords(w, { now = new Date(), timeZone } = {}) {
  const at = runsOutAt(w, now);
  return at === null ? '' : `runs out ${hourWords(new Date(at).toISOString(), { now, timeZone })} at this rate`;
}

// "5 minutes ago", "1 minute ago", "under a minute ago"; '' with no time.
export function agoWords(iso, now = new Date()) {
  const age = ms(now) - Date.parse(iso ?? '');
  if (Number.isNaN(age)) return '';
  const minutes = Math.round(age / MINUTE);
  return minutes < 1 ? 'under a minute ago' : `${plural(minutes, 'minute')} ago`;
}
