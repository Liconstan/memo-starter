import { fableOf } from '../ui/agentstate.js';
import { WINDOW_MS, FABLE_SPARE_ABOVE, FRESH_MS, headroom, resetWithin } from '../ui/pacing.js';

// The Fable to spare memo. When the Fable week of an account will end with points unused, the long agent of that
// account gets one memo, with the code SYS, that asks for a model trial: the points do some good before they go. The
// memo goes when the Fable headroom (ui/pacing.js) is above plus 30 points, the Fable reset is within 24 hours, and
// the figures are under 20 minutes old. One memo per Fable window: the window is known by its resets_at, and the
// fable_spare table keeps one row per agent and window, so a restart of the server does not send the memo again.
// The job follows src/handover.js: one pass each minute, the memo through the store, and a nudge for an agent that
// sits idle at its prompt.
export const FABLE_SPARE_EVERY_MS = 60000;
export const RESET_WITHIN_MS = 24 * 60 * 60 * 1000;

// The text of the memo. points: the rounded headroom. when: the reset, in local time.
export function fableSpareText(points, when) {
  return `Fable to spare: about ${points} points will reset unused at ${when}. If you have time, run the model-trial skill on one skill that has no row in skills/model-trials.md yet, using Fable for the candidate run. Never on a task that sends, pays or files. No reply needed.`;
}

// store: src/memos.js. agents(): the agents as GET /api/agents gives them, with usage. arrived(name): the nudge of
// src/agents.js, for an agent that sits idle at its prompt. log(line): the log of the server.
export function createFableSpare({ db, store, owner, agents, arrived = () => {}, now = () => new Date(), log = console.log, timeZone = store.timeZone }) {
  // The figures of an account when they are recent. A failed fetch keeps the last good figures with their time (at).
  const fresh = (u) => (u && u.at && now().getTime() - Date.parse(u.at) < FRESH_MS ? u : null);
  const clock = (iso) => new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.parse(iso)));
  const sent = (agent, resetsAt) => Boolean(db.prepare('SELECT 1 FROM fable_spare WHERE agent = ? AND resets_at = ?').get(agent, resetsAt));

  // One pass: gives the memos it sent, [{ agent, points, resets_at, memo }].
  function run() {
    const out = [];
    for (const a of agents().filter((x) => x.kind === 'long')) {
      const w = fableOf(fresh(a.usage));
      if (!w || !resetWithin(w, RESET_WITHIN_MS, now())) continue;
      const h = headroom(w, WINDOW_MS.week, now());
      if (h === null || h <= FABLE_SPARE_ABOVE) continue;
      const resetsAt = new Date(Date.parse(w.resets_at)).toISOString();
      if (sent(a.name, resetsAt)) continue;
      const points = Math.round(h);
      const ws = store.workstreams && Object.hasOwn(store.workstreams, 'SYS') ? 'SYS' : undefined;
      let memo;
      try {
        memo = store.send({ from: owner, to: a.name, ws, title: 'Fable to spare', text: fableSpareText(points, clock(w.resets_at)) }).memo;
      } catch (err) { log(`fable spare memo: ${err.message}`); continue; }
      db.prepare('INSERT INTO fable_spare (agent, resets_at, points, memo_id, at) VALUES (?, ?, ?, ?, ?)').run(a.name, resetsAt, points, memo.id, now().toISOString());
      log(`fable spare: ${a.name} has about ${points} Fable points to spare until ${resetsAt}; memo ${memo.id} sent.`);
      // memo wait of the agent gets the memo with its next request, in 30 seconds or less. An agent that sits idle at
      // its prompt gets a nudge.
      arrived(a.name);
      out.push({ agent: a.name, points, resets_at: resetsAt, memo });
    }
    return out;
  }

  let timer = null;
  function start(everyMs = FABLE_SPARE_EVERY_MS) {
    timer = setInterval(() => { try { run(); } catch (err) { log(`fable spare: ${err.message}`); } }, everyMs);
    timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  return { run, start, stop };
}
