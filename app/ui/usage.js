// The usage figures of an agent: the three numbers of `/usage` in Claude Code, from `usage` of GET /api/agents
// (src/usage.js): the current session (the 5-hour window), the current week for all models, and the current week
// for each model with its own limit (Fable). The Inbox card and the Agents page show the same lines (memos 971, 976
// and 1047). Compact remaining-capacity bars are shown first; right under them, one small line says when the session
// and the week reset (memo 1320):
//   Session resets in 4 h 12 min · Week resets in 2 days 0 h
// The pacing stays in expandable details, with the same countdowns in full words:
//   Session: 94 percent left, resets in 4 hours 12 minutes. 10 points ahead of pace.
//   Week: 37 percent left, resets in 2 days 0 hours. 8 points ahead of pace.
//   Fable: 7 percent left, resets in 2 days 0 hours. Runs out about 5 this afternoon at this rate.
//   Account: on pace. Figures from 3 minutes ago.
// The countdown ticks in the browser each minute (startCountdowns). The clock time of the reset is on hover, and a
// screen reader hears it after the countdown. The words come from ui/pacing.js.
// Each bar also carries a line at the time left in its window (memo 1407): the bar is the whole window, the fill is
// the capacity left, and the line is the time left to the reset, which moves to the left end as the reset comes. Fill
// past the line is capacity to spare; a fill that stops short of the line is behind pace, and the gap is striped. The
// distance between the two is the headroom in points of ui/pacing.js, the same number that picks the agent.
// usageFigures has no DOM code, so a test can import it; usageView takes `el` of ui/common.js, as markdown.js does.
import { displayName } from './agentstate.js';
import { WINDOW_MS, FABLE_SPARE_ABOVE, LIMIT_LEFT, TIGHT_BELOW, pointsLeft, shareLeft, headroom, stateOf, countdownWords, countdownShort, paceWords, forecastWords, dayWords, agoWords } from './pacing.js';

export const STALE_MS = 15 * 60 * 1000;
export const TICK_MS = 60 * 1000;

const parts = (date, timeZone, options) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, ...options }).formatToParts(date).map((p) => [p.type, p.value]));
const ymd = (date, timeZone) => { const p = parts(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }); return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)); };
const daysAhead = (date, now, timeZone) => Math.round((ymd(date, timeZone) - ymd(now, timeZone)) / 86400000);

// "today at 1:00 PM PST", or "Nov 10 at 10:00 AM PST" (long: "November 10 at 10:00 AM PST", for a screen reader).
// The zone is that of the browser, which is the zone of the owner (memo tz).
export function resetText(iso, { now = new Date(), timeZone, long = false } = {}) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const t = parts(date, timeZone, { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
  const time = `${t.hour}:${t.minute} ${t.dayPeriod} ${t.timeZoneName}`;
  if (daysAhead(date, now, timeZone) === 0) return `today at ${time}`;
  const d = parts(date, timeZone, { month: long ? 'long' : 'short', day: 'numeric' });
  return `${d.month} ${d.day} at ${time}`;
}

const sentence = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}.` : '');

// The rows of the card, one per window: the label, the points left, the countdown, the clock time of the reset for
// hover (title) and for a screen reader (clock), and the tail: the forecast when the window runs out before its
// reset at the current rate, else the pace in points, and for Fable with plenty of headroom the points that would
// reset unused. The level colours the row: red at the limit, amber when tight. Then the state of the account and the
// age of the figures, and whether they are stale: from more than 15 minutes ago, or not there yet.
export function usageFigures(usage, { now = new Date(), timeZone } = {}) {
  if (!usage) return null;
  const row = (key, label, w, windowMs) => {
    const left = pointsLeft(w) ?? 0;
    const h = headroom(w, windowMs, now);
    const forecast = forecastWords(w, { now, timeZone });
    let tail = forecast || paceWords(h);
    if (key.startsWith('model-') && h !== null && h > FABLE_SPARE_ABOVE && !forecast) tail = `to spare: about ${Math.round(h)} points reset unused ${dayWords(w.resets_at, { now, timeZone })}`;
    const level = left <= LIMIT_LEFT ? 'red' : h !== null && h < TIGHT_BELOW ? 'amber' : 'ok';
    const countdown = countdownWords(w.resets_at, now);
    const clock = resetText(w.resets_at, { now, timeZone, long: true });
    const short = resetText(w.resets_at, { now, timeZone });
    const text = `${label}: ${left} percent left${countdown ? `, ${countdown}` : ''}.${tail ? ` ${sentence(tail)}` : ''}`;
    // timeLeft: the percent of the window still to run, for the line on the bar; null with no window or no reset time.
    const share = windowMs ? shareLeft(w, windowMs, now) : null;
    return { key, label, left, countdown, clock, tail: sentence(tail), level, resets_at: w.resets_at || null, title: short ? `Resets ${short}` : 'No reset time', text,
      timeLeft: share === null ? null : Math.round(share * 100), pace: windowMs ? paceWords(h) : '' };
  };
  const rows = [];
  if (usage.session) rows.push(row('session', 'Session', usage.session, WINDOW_MS.session));
  if (usage.week) rows.push(row('week', 'Week', usage.week, WINDOW_MS.week));
  for (const m of Array.isArray(usage.models) ? usage.models : []) rows.push(row(`model-${m.name}`, m.name, m, WINDOW_MS.week));
  for (const w of Array.isArray(usage.windows) ? usage.windows : []) {
    const r = row(w.key, w.label, w, 0);
    r.tail = '';
    rows.push(r);
  }
  const age = usage.at ? now.getTime() - Date.parse(usage.at) : null;
  const stale = age === null || Number.isNaN(age) || age > STALE_MS;
  const ago = age === null || Number.isNaN(age) ? '' : agoWords(usage.at, now);
  const state = stateOf(usage, now);
  const account = rows.length ? `${usage.provider === 'openai' ? 'OpenAI account limits.' : `Account: ${state.word.toLowerCase()}.`}${ago ? ` Figures from ${ago}.` : ''}` : '';
  return { rows, state: state.word, account, stale, ago, error: usage.error || null };
}

// The words on hover over a bar: the capacity left against the time left, and the pace in points.
// "94 percent left with 84 percent of the time left: 10 points ahead of pace. Resets today at 2:12 PM PST."
export const paceTitle = (r) => `${r.left} percent left with ${r.timeLeft} percent of the time left${r.pace ? `: ${r.pace}` : ''}. ${r.title}.`;
// The one line in Details that says how to read the line on a bar.
export const PACE_KEY = 'The line on a bar is the time left to its reset. Fill past the line is capacity to spare; a striped gap is behind pace.';

// The lines of the card. Each row is plain text, so a screen reader hears the same words, with the clock time of
// the reset after the countdown in a hidden span. No usage (a short or remote agent, or an older server) gives nothing.
export function usageView(agent, el, options = {}) {
  const usage = agent.usage;
  if (!usage && agent.runtime === 'codex-desktop') return el('span', { className: 'usage dim', title: 'Resume the desktop chat to process queued tasks.' }, 'Usage unavailable');
  if (!usage) return '';
  const f = usageFigures(usage, options);
  const box = el('div', { className: 'usage' });
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `Usage of the ${usage.provider === 'openai' ? 'OpenAI' : 'Claude'} account of ${displayName(agent.name)}`);
  if (!f.rows.length) {
    const text = f.error ? 'Usage: not known' : usage.at ? 'Usage: no limits reported' : 'Usage: not known yet';
    box.append(el('span', { className: 'dim', title: f.error || '' }, text));
    return box;
  }
  const details = el('details', { className: 'usage-details' }, el('summary', {}, 'Details'));
  for (const r of f.rows) {
    const left = Math.max(0, Math.min(100, r.left));
    const level = left <= 10 ? 'red' : left <= 25 ? 'amber' : 'ok';
    const line = el('div', { className: `use ${level}`, title: r.title });
    const header = el('div', { className: 'use-heading' }, el('span', {}, r.label), el('b', {}, `${left}% left`));
    const bar = el('div', { className: `use-bar${f.stale ? ' is-stale' : ''}` },
      el('span', { style: `width:${left}%` }));
    // The line at the time left, and the striped gap when the fill stops short of it (behind pace).
    const paced = r.timeLeft !== null && !f.stale;
    if (paced) {
      if (r.timeLeft > left) bar.append(el('i', { className: 'use-gap', style: `left:${left}%;width:${r.timeLeft - left}%` }));
      bar.append(el('i', { className: 'use-now', style: `left:${r.timeLeft}%` }));
      bar.title = paceTitle(r);
    }
    for (const [key, value] of Object.entries({ role: 'progressbar', 'aria-label': `${r.label} capacity remaining`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(left), 'aria-valuetext': `${left} percent left${paced ? `, ${r.timeLeft} percent of the time left${r.pace ? `, ${r.pace}` : ''}` : ''}${f.stale ? ', stale reading' : ''}` })) bar.setAttribute(key, value);
    line.append(header, bar);
    if (r.countdown) {
      const countdown = el('span', { className: 'countdown' }, r.countdown);
      countdown.setAttribute('data-reset', r.resets_at);
      line.append(countdown);
      if (r.clock) line.append(el('span', { className: 'visually-hidden' }, `, ${r.clock}`));
    }
    if (r.tail) details.append(el('div', {}, `${r.label}: ${r.tail}`));
    if (r.countdown) {
      const reset = el('span', { className: 'countdown' }, r.countdown);
      reset.setAttribute('data-reset', r.resets_at);
      details.append(el('div', { title: r.title }, `${r.label}: `, reset));
    }
    box.append(line);
  }
  // The resets of the session and the week in one small line, under the bars and outside Details (memo 1320). The
  // windows of a model (Fable) are left out: they are in Details. The clock time is on hover, and a screen reader
  // hears it after the countdown. The dot between the two is in the CSS, so each part wraps whole on a narrow card.
  const timed = f.rows.filter((r) => r.countdown && !r.key.startsWith('model-'));
  if (timed.length) {
    const resets = el('div', { className: 'usage-resets' });
    for (const r of timed) {
      const short = el('span', { className: 'countdown' }, countdownShort(r.resets_at, options.now));
      short.setAttribute('data-reset', r.resets_at);
      short.setAttribute('data-short', '1');
      const part = el('span', { title: r.title }, `${r.label} `, short);
      if (r.clock) part.append(el('span', { className: 'visually-hidden' }, `, ${r.clock}`));
      resets.append(part);
    }
    box.append(resets);
  }
  const account = el('div', { className: 'account' }, f.account);
  if (f.stale) {
    const said = f.ago ? `The usage figures are stale: from ${f.ago}.` : 'The usage figures are stale.';
    const chip = el('span', { className: 'stale', title: f.error ? `${said} ${f.error}` : said }, 'stale');
    chip.setAttribute('role', 'img');
    chip.setAttribute('aria-label', f.error ? `${said} ${f.error}` : said);
    account.append(' ', chip);
  }
  if (f.rows.some((r) => r.timeLeft !== null)) details.append(el('div', { className: 'pace-key' }, PACE_KEY));
  details.append(account);
  if (agent.runtime === 'codex-desktop') details.append(el('div', {}, 'Usage is for the signed-in Codex account, not just Memo. Resume the desktop chat to process queued tasks.'));
  box.append(details);
  if (f.stale) box.append(el('span', { className: 'stale', title: f.error || '' }, 'Stale usage data'));
  return box;
}

// The countdown tick: each minute, every countdown on the page gets the words for now, the short ones in the line of
// resets (data-short). root: the document (a test
// gives its own, with querySelectorAll). Gives the timer, so a test can clear it.
export function tickCountdowns(root, now = new Date()) {
  for (const node of root.querySelectorAll('[data-reset]')) node.textContent = (node.getAttribute('data-short') ? countdownShort : countdownWords)(node.getAttribute('data-reset'), now);
}
export function startCountdowns(root, { every = TICK_MS, now = () => new Date() } = {}) {
  return setInterval(() => tickCountdowns(root, now()), every);
}
