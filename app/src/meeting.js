// The meetings of the time block of the Inbox (memo 1422; docs/command-center-plan.md, section 3.7): the next meeting
// with what exists as a brief for it, and the last meeting with the state of its follow-up. No model and no connector:
// the calendar the server already reads, two files of the vault, and the memos.
//
// The brief of a meeting is what exists already:
//   - the prep notes in the description of the calendar event (the "Claude" block of the nightly sync, step 7b);
//   - the card of the meeting in summaries/context-sheet.md of the vault.
// With none of the two, she can ask for one: a memo to the agent, sent as src/followups.js sends its memo (the store,
// then the nudge), once per occurrence (the table briefs_asked).
//
// The follow-up of a meeting is the work of the agent main (scripts/meeting-followups.md of the vault): the trigger memo
// of src/followups.js, then one memo to the owner with the text under "THE DRAFT". The Inbox shows that draft, she
// edits it, and Send is a reply on that memo with fixed first words (ui/meeting.js SEND_LINE): her explicit go-ahead.
// The server holds no Slack or mail key and sends nothing itself; the agent sends, on its connectors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eventsOn, validZone } from './ical.js';
import { MemoError } from './memos.js';
import { followupText, followupWhen, FOLLOWUP_DELAY_MIN } from './followups.js';
import { meetingsAt, draftOf, sendText } from '../ui/meeting.js';

const MAX_TITLE = 60; // as in src/memos.js
const MAX_PART = 6000; // a part of a brief, in characters
export const BRIEF_REQUEST = 'Meeting brief, asked from the Inbox. Prepare a short brief for this meeting, per the meeting prep rule of your charter: what I should raise (people/_to-cover.md), where things stood at the last meeting with these people, and the open tasks. Each line with its source link. Send it to me as one memo.';

const dateIn = (ms, zone) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const clip = (text) => (text.length > MAX_PART ? `${text.slice(0, MAX_PART).trimEnd()}\n…` : text);

// The text of an invite as plain lines: Google gives a description as HTML.
export function plainText(description) {
  return String(description ?? '').replace(/<br\s*\/?>|<\/(p|div|ul|ol|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => (label.includes(href) || !label.trim() ? href : `${label} (${href})`))
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
// The description of an event in two parts: { prep, invite }. prep is the block of the agents, from the first line
// that names Claude ("Claude prep notes of 2026-11-07", "Context from Claude, ...") to the end; invite is what is
// before it. Each is '' when it is not there.
export function prepOf(description) {
  const lines = plainText(description).split('\n');
  const at = lines.findIndex((l) => /\bclaude\b/i.test(l) && /\b(prep|context|notes?)\b/i.test(l));
  if (at === -1) return { prep: '', invite: lines.join('\n').trim() };
  return { prep: lines.slice(at).join('\n').trim(), invite: lines.slice(0, at).join('\n').trim() };
}
// The card of a meeting in the context sheet: the section whose heading starts with the title of the event,
// "## <title> | 2026-11-10 11:30 PT | ...". The card of the day of the event wins; else the newest earlier one.
// { heading, text, date, exact } or null.
export function cardOf(sheet, title, day) {
  const want = String(title ?? '').trim().toLowerCase();
  if (!want) return null;
  const cards = [];
  let now = null;
  for (const line of String(sheet ?? '').split('\n')) {
    if (/^## /.test(line)) {
      const heading = line.slice(3).trim();
      const name = heading.split('|')[0].trim().toLowerCase();
      now = name === want ? { heading, date: /\b(\d{4}-\d{2}-\d{2})\b/.exec(heading)?.[1] || '', lines: [] } : null;
      if (now) cards.push(now);
    } else if (/^# /.test(line)) now = null;
    else if (now) now.lines.push(line);
  }
  const usable = cards.filter((c) => !c.date || c.date <= day).sort((a, b) => (b.date === day) - (a.date === day) || b.date.localeCompare(a.date));
  const best = usable[0];
  return best ? { heading: best.heading, text: clip(best.lines.join('\n').trim()), date: best.date, exact: best.date === day } : null;
}

// db, store, owner: as in src/followups.js. vault: the vault of notes, for the context sheet. arrived(name): the nudge.
// agentNames: () => the names of the agents, so a memo of an agent can be told from one of a person. briefTo and
// followupTo: the agents that get the two requests. delayMin: the minutes after which the follow-up job asks by itself.
export function createMeetings({ db, store, owner, vault, arrived = () => {}, agentNames = () => [], briefTo = 'main', followupTo = 'main', delayMin = FOLLOWUP_DELAY_MIN, now = () => new Date() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS briefs_asked (
      event_key TEXT PRIMARY KEY,           -- '<UID>|<start of the occurrence, ISO, UTC>', as followups_sent
      title TEXT NOT NULL,
      memo_id INTEGER,                      -- the memo that asked the agent
      at TEXT NOT NULL
    );
  `);
  const sheet = () => { try { return readFileSync(join(vault, 'summaries', 'context-sheet.md'), 'utf8'); } catch { return ''; } };
  const keyOf = (e) => `${e.uid || `no-uid:${e.title}`}|${e.start}`;
  const people = (e) => (e.attendees || []).map((p) => p.name || p.email).filter(Boolean);
  // The newest memo of an agent to the owner in the thread of a memo, after it: the answer to a request.
  function answerTo(memoId) {
    let thread;
    try { thread = store.thread(memoId); } catch { return null; }
    const agents = agentNames();
    return thread.memos.filter((m) => m.id > memoId && m.recipient === owner && agents.includes(m.sender)).at(-1) || null;
  }
  const exists = (id) => { try { store.get(id); return true; } catch { return false; } };

  function briefOf(e, zone) {
    const { prep, invite } = prepOf(e.description);
    const asked = db.prepare('SELECT memo_id FROM briefs_asked WHERE event_key = ?').get(keyOf(e));
    const answer = asked?.memo_id && exists(asked.memo_id) ? answerTo(asked.memo_id) : null;
    return {
      prep: clip(prep), invite: clip(invite), card: cardOf(sheet(), e.title, dateIn(Date.parse(e.start), zone)),
      asked: asked?.memo_id ? { memo: asked.memo_id, to: briefTo, answer: answer ? { id: answer.id, title: answer.title || '', text: answer.text, state: answer.state } : null } : null,
    };
  }
  // The state of the follow-up of a meeting that ended:
  //   waiting:  the agent has no request yet; `due` is when the job of the server asks (for a work calendar).
  //   asked:    the agent has the request and has not answered.
  //   drafted:  the memo of the agent is open in the Inbox: its text, and the draft in it.
  //   answered: she answered or closed that memo already.
  function followupOf(e) {
    const sent = db.prepare('SELECT memo_id FROM followups_sent WHERE event_key = ?').get(keyOf(e));
    if (!sent?.memo_id || !exists(sent.memo_id)) return { state: 'waiting', due: new Date(Date.parse(e.end) + delayMin * 60000).toISOString(), to: followupTo };
    const answer = answerTo(sent.memo_id);
    if (!answer) return { state: 'asked', memo: sent.memo_id, to: followupTo };
    const base = { memo: sent.memo_id, to: answer.sender, answer: { id: answer.id, title: answer.title || '', text: answer.text } };
    return answer.state === 'open' ? { state: 'drafted', ...base, ...draftOf(answer.text) } : { state: 'answered', ...base };
  }
  const shape = (e) => ({ key: keyOf(e), title: e.title, start: e.start, end: e.end, people: people(e), link: e.link || '', hasOthers: true, attendees: e.attendees, allDay: false });

  // The events of today and yesterday of the calendars, one for each occurrence. cals: [{ cal, self }], as the Today card has them.
  function eventsNear(cals, zone) {
    const t = now().getTime();
    const seen = new Map();
    for (const { cal, self } of cals) {
      for (const date of new Set([dateIn(t - 86400000, zone), dateIn(t, zone), dateIn(t + 86400000, zone)])) {
        for (const e of eventsOn(cal, date, zone, { self, uid: true, description: true })) {
          const key = `${e.title}|${e.start}|${e.end}`;
          // The same event on two calendars: the copy with a description wins.
          if (!seen.has(key) || (!seen.get(key).description && e.description)) seen.set(key, e);
        }
      }
    }
    return [...seen.values()];
  }
  // What the time block shows: { now, timeZone, current, next, last }. A meeting that runs or comes has `brief`; the
  // last one has `followup`.
  function view(cals, zone) {
    const z = validZone(zone) ? zone : store.timeZone;
    const events = eventsNear(cals, z);
    const { current, next, last } = meetingsAt(events, now().getTime());
    const withBrief = (e) => (e ? { ...shape(e), brief: briefOf(e, z) } : null);
    return { now: now().toISOString(), timeZone: z, current: withBrief(current), next: withBrief(next), last: last ? { ...shape(last), followup: followupOf(last) } : null };
  }
  const find = (cals, zone, key) => {
    const z = validZone(zone) ? zone : store.timeZone;
    const e = eventsNear(cals, z).find((x) => keyOf(x) === key);
    if (!e) throw new MemoError(404, 'That meeting is not on the calendar of today or yesterday.');
    return { e, z };
  };
  const titleFor = (word, e) => `${word}: ${e.title}`.replace(/\s+/g, ' ').slice(0, MAX_TITLE).trim();
  const ws = () => (store.workstreams && Object.hasOwn(store.workstreams, 'PROG') ? 'PROG' : undefined);

  // She asks for a brief of a meeting: one memo to the agent, once per occurrence.
  function askBrief(cals, zone, key) {
    const { e, z } = find(cals, zone, key);
    const claim = db.prepare('INSERT OR IGNORE INTO briefs_asked (event_key, title, at) VALUES (?, ?, ?)').run(key, e.title, now().toISOString());
    if (!claim.changes) return { asked: false, memo: db.prepare('SELECT memo_id FROM briefs_asked WHERE event_key = ?').get(key)?.memo_id ?? null };
    let memo;
    try {
      // The lines of the event are those of the follow-up memo, under the request of the brief.
      const text = [BRIEF_REQUEST, '', ...followupText(e, z).split('\n').slice(2)].join('\n');
      memo = store.send({ from: owner, to: briefTo, ws: ws(), title: titleFor('Brief', e), text }).memo;
    } catch (err) {
      db.prepare('DELETE FROM briefs_asked WHERE event_key = ?').run(key);
      throw err;
    }
    db.prepare('UPDATE briefs_asked SET memo_id = ? WHERE event_key = ?').run(memo.id, key);
    arrived(briefTo);
    return { asked: true, memo: memo.id };
  }
  // She asks for the follow-up of a meeting now, before the job does: the same memo and the same row as the job, so
  // the job sends no second one.
  function askFollowup(cals, zone, key) {
    const { e, z } = find(cals, zone, key);
    if (Date.parse(e.end) > now().getTime()) throw new MemoError(409, 'That meeting did not end yet.');
    const claim = db.prepare('INSERT OR IGNORE INTO followups_sent (event_key, title, ends, at) VALUES (?, ?, ?, ?)').run(key, e.title, e.end, now().toISOString());
    if (!claim.changes) return { asked: false, memo: db.prepare('SELECT memo_id FROM followups_sent WHERE event_key = ?').get(key)?.memo_id ?? null };
    let memo;
    try {
      memo = store.send({ from: owner, to: followupTo, ws: ws(), impact: 3, effort: 'short', title: titleFor('Follow-up', e), text: followupText(e, z) }).memo;
    } catch (err) {
      db.prepare('DELETE FROM followups_sent WHERE event_key = ?').run(key);
      throw err;
    }
    db.prepare('UPDATE followups_sent SET memo_id = ? WHERE event_key = ?').run(memo.id, key);
    arrived(followupTo);
    return { asked: true, memo: memo.id };
  }
  // Send: her edited text goes to the agent as her reply on its follow-up memo, with the fixed first words. Only a
  // memo of an agent to the owner that answers a follow-up request can be sent this way.
  function send(memoId, text) {
    const id = Number(memoId);
    const draft = typeof text === 'string' ? text.trim() : '';
    if (!draft) throw new MemoError(400, 'The follow-up has no text.');
    const memo = store.get(id);
    if (memo.recipient !== owner || !agentNames().includes(memo.sender)) throw new MemoError(400, 'Only a follow-up memo of an agent can be sent from here.');
    const asked = db.prepare('SELECT memo_id FROM followups_sent WHERE memo_id IS NOT NULL ORDER BY at DESC LIMIT 60').all().some((r) => answerTo(r.memo_id)?.id === memo.id);
    if (!asked) throw new MemoError(400, `Memo ${memo.id} is not the answer to a follow-up request.`);
    const replied = store.reply(memo.id, sendText(draft), owner);
    arrived(memo.sender);
    return { memo: replied.id, to: memo.sender };
  }

  return { view, askBrief, askFollowup, send };
}
