import { LIMIT_AT, RESET_SOON_MS, atLimit, memoTitle } from '../ui/agentstate.js';

// The handover job (memo 982). When the Claude account of a long agent reaches its limit (the session or the week at
// 95 percent or more), the memos that the owner sent to that agent and that it never got go to the other long agent,
// when that one is below its limit. Then the owner gets one short memo for each batch.
//
// "Never got" is the delivery marker of src/memos.js: an agent sees its memos only through memo list and memo wait,
// and both mark each memo they show. A memo with no marker was never on the screen of the agent, so the agent cannot
// be working on it. A memo that the agent holds with memo wait --hold was shown first, so it has the marker too.
//
// The job leaves these memos alone: memos from an agent or from Discord (only memos from the owner move), memos to the
// liaison or a remote agent (only long agents take part), memos that the agent got, and the scheduled memos that go to
// one agent by design (PINNED). A memo that moved does not move again before the reset of the limit that moved it, so
// no memo goes back and forth. Each move goes to the log of the server and to the handovers table. A limit whose reset
// is within 15 minutes moves nothing: the agent is about to get its window back (memo 1047).

// The scheduled memos (local/schedule.json): the launchd jobs memo.daily-review and memo.vault-sync send them to second,
// and they must stay with second. They are known by the start of their text.
export const PINNED = [/^\s*Daily review\b/i, /^\s*Nightly vault sync\b/i];
// Usage figures older than this are too old to act on: the server gets new ones each 5 minutes.
const FRESH_MS = 20 * 60 * 1000;
// When the reset time of the limit is not known, a moved memo stays put for 5 hours, the length of a session.
const HOLD_MS = 5 * 60 * 60 * 1000;
export const HANDOVER_EVERY_MS = 60000;

// The window that is at the limit: { which: 'session' | 'week', percent, resets_at }, or null.
function limitOf(usage) {
  for (const which of ['session', 'week']) {
    const w = usage?.[which];
    if (w && Number(w.percent) >= LIMIT_AT) return { which, percent: Math.round(Number(w.percent)), resets_at: w.resets_at || null };
  }
  return null;
}

// store: src/memos.js. agents(): the agents as GET /api/agents gives them, with activity and usage. arrived(name): the
// nudge of src/agents.js, for an agent that sits idle at its prompt. log(line): the log of the server.
export function createHandover({ db, store, owner, agents, arrived = () => {}, now = () => new Date(), log = console.log, timeZone = store.timeZone }) {
  // The figures of an account when they are recent. A failed fetch keeps the last good figures with their time (at).
  const fresh = (u) => (u && u.at && now().getTime() - Date.parse(u.at) < FRESH_MS ? u : null);
  const clock = (iso) => {
    const t = Date.parse(iso || '');
    if (Number.isNaN(t)) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
  };
  const held = (id) => Boolean(db.prepare('SELECT 1 FROM handovers WHERE memo_id = ? AND hold_until > ?').get(id, now().toISOString()));
  const pinned = (m) => PINNED.some((p) => p.test(m.text || ''));
  const label = (m) => (m.code ? m.code : `Memo ${m.id}`);

  // One pass: gives the batches it moved, [{ from, to, reason, memos }].
  function run() {
    const list = agents().filter((a) => a.kind === 'long');
    const batches = [];
    for (const src of list) {
      const usage = fresh(src.usage);
      const limit = limitOf(usage);
      if (!limit) continue;
      if (limit.resets_at && Date.parse(limit.resets_at) >= now().getTime() && Date.parse(limit.resets_at) - now().getTime() <= RESET_SOON_MS) continue;
      // The other agent must run, wait or work (not stopped, stopping or blocked), and be below its limit with
      // figures that are fresh. The one with the most of its week left takes the memos.
      const targets = list.filter((a) => a.name !== src.name && ['idle', 'working'].includes(a.activity) && fresh(a.usage) && !atLimit(a.usage))
        .sort((x, y) => (Number(x.usage.week?.percent) || 0) - (Number(y.usage.week?.percent) || 0));
      const target = targets[0];
      if (!target) continue;
      const memos = store.undelivered(src.name).filter((m) => !pinned(m) && !held(m.id));
      if (!memos.length) continue;
      const reason = `${limit.which} at ${limit.percent} percent`;
      const holdUntil = limit.resets_at && Date.parse(limit.resets_at) > now().getTime()
        ? new Date(Date.parse(limit.resets_at)).toISOString() : new Date(now().getTime() + HOLD_MS).toISOString();
      const moved = [];
      for (const m of memos) {
        if (!store.move(m.id, src.name, target.name)) continue;
        db.prepare('INSERT INTO handovers (memo_id, from_agent, to_agent, reason, at, hold_until) VALUES (?, ?, ?, ?, ?, ?)')
          .run(m.id, src.name, target.name, reason, now().toISOString(), holdUntil);
        log(`handover: ${label(m)} moved from ${src.name} to ${target.name}, ${reason}.`);
        moved.push(m);
      }
      if (!moved.length) continue;
      batches.push({ from: src.name, to: target.name, reason, memos: moved });
      tell(src.name, target.name, limit, moved);
      // memo wait of the target gets the memo with its next request, in 30 seconds or less. An agent that sits idle at
      // its prompt gets a nudge.
      arrived(target.name);
    }
    return batches;
  }

  // One short memo to the owner for the batch. Plain short sentences with no parentheses: she uses a screen reader.
  function tell(from, to, limit, memos) {
    const when = clock(limit.resets_at);
    const n = memos.length;
    const lines = [
      `${from} reached its ${limit.which} limit. It is at ${limit.percent} percent${when ? ` until ${when}` : ''}.`,
      `So ${n === 1 ? 'one memo' : `${n} memos`} you sent ${from} went to ${to}. ${from} had not started ${n === 1 ? 'it' : 'them'}, and ${to} is below its limit.`,
      '',
      ...memos.map((m) => `- ${label(m)}: ${memoTitle({ ...m, line: String(m.text || '').split('\n').find((l) => l.trim()) || '' }).slice(0, 80)}`),
      '',
      `${to} will do ${n === 1 ? 'it' : 'them'}. Nothing is needed from you.`,
    ];
    const ws = store.workstreams && Object.hasOwn(store.workstreams, 'SYS') ? 'SYS' : undefined;
    try {
      store.send({ from: to, to: owner, impact: 1, effort: 'micro', ws, title: `Handover from ${from} to ${to}`.slice(0, 60), text: lines.join('\n') });
    } catch (err) { log(`handover memo: ${err.message}`); }
  }

  let timer = null;
  function start(everyMs = HANDOVER_EVERY_MS) {
    timer = setInterval(() => { try { run(); } catch (err) { log(`handover: ${err.message}`); } }, everyMs);
    timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  return { run, start, stop };
}
