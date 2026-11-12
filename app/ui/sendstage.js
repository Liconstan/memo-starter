// What happens to a memo between Send and the moment its agent works on it (memo 1407), in the words of the small
// tracker under the capture field. No DOM code, so a test can import it. Every stage is something the server reports
// in GET /api/agents; nothing is a guess and nothing is a timer that pretends progress.
//
// The path of a memo from the owner to a long agent:
// 1. Saved. POST /api/send writes the memo into the database on the Mac (a few milliseconds, no internet). The answer
//    carries its id and its agent, and `nudged` when the server typed a wake-up into a session that sat at its prompt.
// 2. Waiting for the agent. The memo sits in the database: nothing has gone to the cloud, and no model has seen it.
//    The agent finds it by asking: its `memo wait` asks the server for news each 30 seconds (scripts/memo.mjs), so
//    the wait is up to 30 seconds, about 15 on average. `waited` of the agent is the time of its last such question,
//    so the tracker can say when the next one comes. An agent that is stopped, blocked or in the middle of a turn
//    with no `memo wait` gets the memo later, and the tracker says which.
// 3. The agent has it. The answer to that question marks the memo as delivered (`delivered` in `memos_to`), the agent
//    shows as Working, and its card turns green. Only now does the text go to the model in the cloud.
// The page asks for the agents each 3 seconds while it tracks a memo (FAST_POLL_MS) in place of each 15, so the card
// turns green a few seconds after step 3 and not up to 15 seconds after it.
import { stateWord, displayName } from './agentstate.js';

export const WAIT_EVERY_MS = 30 * 1000; // `memo wait` asks for news this often (MEMO_WAIT_INTERVAL_MS in scripts/memo.mjs)
export const FAST_POLL_MS = 3 * 1000; // the agents load this often while a memo is tracked
export const TRACK_MAX_MS = 10 * 60 * 1000; // a memo that still waits after this leaves the tracker; the agent card says the rest
export const DONE_SHOW_MS = 8 * 1000; // how long the last stage stays in view
export const STEPS = ['Saved', 'Waiting', 'Picked up'];
// The answer to "what is happening?", as the tooltip of the tracker.
export const EXPLAIN = 'While a memo waits it is in the database on your Mac: nothing is in the cloud yet and no agent is deciding. The agent asks Memo for news each 30 seconds, so the wait is up to 30 seconds. The model starts when the agent has the memo.';

const ms = (now) => (now instanceof Date ? now.getTime() : Number(now));
const seconds = (n) => `${n} second${n === 1 ? '' : 's'}`;

// The memo of a send that the page tracks: { id, to, at, nudged }, or null when the answer names no memo of the
// server (the GitHub copy of the Inbox gives a temporary id: its memo reaches the Mac later, so there is no stage to show).
export function trackOf(sent, now = new Date()) {
  const id = sent?.memo?.id;
  const to = sent?.memo?.recipient;
  if (!Number.isInteger(id) || typeof to !== 'string' || !to) return null;
  return { id, to, at: ms(now), nudged: sent.nudged === true };
}

// The stage of a tracked memo: { step, key, words, done }. step: 0 saved, 1 waiting, 2 picked up (STEPS). done: the
// tracker can let the memo go. agents: the last answer of GET /api/agents. fresh: that answer is from after the send;
// before it, the page knows only that the server saved the memo.
export function stageOf(track, agents, { now = new Date(), fresh = true } = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const saved = { step: 0, key: 'saved', words: `Memo ${track.id} is saved on your Mac for ${displayName(track.to)}`, done: false };
  if (!fresh) return saved;
  // The handover job can move a memo that its agent never got to the other agent: the tracker follows it.
  const holder = list.find((a) => Array.isArray(a.memos_to) && a.memos_to.some((m) => m.id === track.id));
  if (!holder) {
    // An older server gives no lists: then nothing can be said. With lists, a memo in none of them is closed.
    const known = list.some((a) => Array.isArray(a.memos_to));
    return known ? { step: 2, key: 'closed', words: `${displayName(track.to)} closed memo ${track.id}`, done: true } : { ...saved, done: true };
  }
  // The name the pages show for the agent (memo 1408).
  const name = displayName(holder.name);
  const moved = holder.name !== track.to ? ` (moved from ${displayName(track.to)})` : '';
  const memo = holder.memos_to.find((m) => m.id === track.id);
  const word = stateWord(holder);
  if (memo.delivered) {
    return { step: 2, key: 'picked', words: `${name} has memo ${track.id}${moved}${word === 'Working' ? ' and is working' : ''}`, done: true };
  }
  const wait = (key, words) => ({ step: 1, key, words: `${words}${moved}`, done: false });
  if (holder.runtime === 'codex-desktop') {
    const state = holder.dispatch?.state;
    if (state === 'uncertain') return wait('held', `The wake-up of ${name} was not confirmed: see the Agents page`);
    return wait('waiting', state === 'queued' ? `A wake-up for ${name} is queued in the Codex desktop app` : `Memo is waking ${name} in the Codex desktop app`);
  }
  if (word === 'Offline') return wait('held', `${name} is offline: the memo waits on your Mac until its computer asks for news`);
  if (word.startsWith('Stopped')) return wait('held', `${name} is stopped: the memo waits until you start it on the Agents page`);
  if (word === 'Stopping') return wait('held', `${name} is stopping: the memo waits for its next session`);
  if (word === 'Blocked') return wait('held', `${name} waits on you for a permission or a sign-in, and reads the memo after that`);
  if (word === 'Working') return wait('busy', `${name} is in the middle of a turn and reads its queue when the turn ends`);
  // Idle: the agent sits in `memo wait`, or at its prompt, where the server typed a wake-up (nudged).
  const last = Date.parse(holder.waited ?? '');
  if (Number.isNaN(last)) {
    return wait('waiting', track.nudged ? `Memo typed a wake-up into the session of ${name}; it is starting a turn` : `Waiting for ${name} to ask for news; it asks each 30 seconds`);
  }
  const left = Math.ceil((last + WAIT_EVERY_MS - ms(now)) / 1000);
  return wait('waiting', `Waiting for ${name} to ask for news: it asks each 30 seconds, next ${left > 0 ? `in about ${seconds(left)}` : 'any moment now'}`);
}

// The memos the tracker still shows: a memo leaves DONE_SHOW_MS after its last stage came, or TRACK_MAX_MS after the
// send. doneAt: memo id -> the time its done stage was first seen (the page keeps the map and this fills it).
export function keepTracks(tracks, agents, doneAt, { now = new Date(), fresh = () => true } = {}) {
  const t = ms(now);
  return tracks.filter((track) => {
    if (t - track.at > TRACK_MAX_MS) { doneAt.delete(track.id); return false; }
    if (!stageOf(track, agents, { now, fresh: fresh(track) }).done) { doneAt.delete(track.id); return true; }
    if (!doneAt.has(track.id)) doneAt.set(track.id, t);
    if (t - doneAt.get(track.id) <= DONE_SHOW_MS) return true;
    doneAt.delete(track.id);
    return false;
  });
}
