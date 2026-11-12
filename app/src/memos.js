import { EFFORTS, sortQueue } from './rank.js';
import { setCheckBox } from '../ui/markdown.js';
import { parseCode, codeOf } from './workstreams.js';

export class MemoError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_TEXT = 20000;
const MAX_NOTE = 4000;
// The brief of a memo is one short line for each part, so the compact view of the Inbox fits a phone.
const MAX_TITLE = 60;
const MAX_NEXT = 100;

// A tag is a short lowercase word, for example work, money, or home-repair. A memo has 8 tags or fewer.
const TAG = /^[a-z][a-z0-9-]{0,23}$/;
const MAX_TAGS = 8;
const MAX_RE = 10;      // the origins a memo can name
const THREAD_MAX = 12;  // the memos of a thread
const THREAD_DEPTH = 3; // how many links away a memo of the thread can be
const REPLIES_MS = 24 * 60 * 60 * 1000; // the replies of the owner that go with an agent in counts(), for its pet

// The ids of the memos that a text names: "memo 355", "memos 349 and 355", "memos 12, 13 and 14", "memo #12", "#355".
// A number alone is never one (an amount, a year), and # with one digit is a rank ("#1"), not a memo.
const MEMO_REF = /\bmemos?\s+#?(\d{1,7})((?:\s*(?:,|and|or|&)\s*#?\d{1,7})*)\b/gi;
const HASH_REF = /(?<![\w#$])#(\d{2,7})\b/g;
export function referencedIds(text) {
  const ids = new Set();
  const s = String(text || '');
  for (const m of s.matchAll(MEMO_REF)) for (const n of `${m[1]}${m[2]}`.match(/\d+/g) || []) ids.add(Number(n));
  for (const m of s.matchAll(HASH_REF)) ids.add(Number(m[1]));
  return [...ids];
}
// The memo codes that a text names: "OPS-14", "see REL-2 and FUND-10". Capital letters only, so "covid-19" is none.
// A code that no memo has (ISO-8601) is no link: relink checks each against the memos.
const CODE_REF = /(?<![\w-])([A-Z][A-Z0-9]{1,7})-(\d{1,7})\b/g;
export function referencedCodes(text) {
  const seen = new Set();
  const out = [];
  for (const m of String(text || '').matchAll(CODE_REF)) {
    const code = `${m[1]}-${Number(m[2])}`;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ ws: m[1], n: Number(m[2]) });
  }
  return out;
}
export const POSTPONE_HOUR = 9;
// The kinds of the event log (the events table, src/db.js; README.md, "The event log").
export const EVENT_KINDS = ['send', 'reply', 'close', 'note', 'edit', 'brief', 'compact', 'ack', 'impact', 'tag', 'untag', 'postpone', 'check', 'seen', 'move', 'inbox_load'];
// The actor of an event that no person and no agent did: the handover job, the close of an "agent is blocked" memo.
export const SERVER_ACTOR = 'server';

// The time (ISO, UTC) of 9:00 AM on the date YYYY-MM-DD in the time zone. A postponed memo comes back then.
export function returnTime(date, timeZone) {
  const [y, m, d] = date.split('-').map(Number);
  const wanted = Date.UTC(y, m - 1, d, POSTPONE_HOUR);
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  // The difference between the clock in the zone and UTC at an instant.
  const offsetAt = (ms) => {
    const p = Object.fromEntries(format.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  // The offset at 9:00 UTC can differ from the offset at 9:00 in the zone, when a clock change falls between the two
  // (for example in Los Angeles on the day of the spring change). So the offset is read again at the first answer.
  const first = wanted - offsetAt(wanted);
  return new Date(wanted - offsetAt(first)).toISOString();
}

// forwardTo: the names that memo forward can send to (the long agents).
// owner: the name of the person who owns the queue (MEMO_OWNER). It is one of the names.
// timeZone: the zone of the owner. A postponed memo comes back at 9:00 AM there.
// workstreams: the codes a memo can carry, { OPS: 'Operations', ... } (src/workstreams.js). None: no memo gets a code.
export function createStore(db, { names, owner = 'owner', forwardTo = names.filter((n) => n !== owner && n !== 'discord'), now = () => new Date(), timeZone = 'America/New_York', workstreams = {} }) {
  const ts = () => now().toISOString();
  const plain = (row) => (row ? { ...row } : row);

  // Each change of a memo is one transaction, with its row of the event log in it: a change that fails leaves no
  // event, and an event that fails undoes the change. A change inside a change (the new memo of a compact) is part
  // of the outer transaction.
  let inTx = false;
  function tx(fn) {
    if (inTx || db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    inTx = true;
    try {
      const out = fn();
      db.exec('COMMIT');
      return out;
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* the failed statement ended the transaction already */ }
      throw err;
    } finally { inTx = false; }
  }
  // One row of the event log. The payload starts with the facts of the memo after the change (sender, recipient,
  // code, title, impact, effort), then the facts of the event. The export (src/events.js) leaves out the body
  // texts by default: the keys of its TEXT_KEYS, so a new key that holds memo text must go in that list.
  const putEvent = db.prepare('INSERT INTO events (at, kind, memo_id, actor, payload) VALUES (?, ?, ?, ?, ?)');
  function record(kind, id, actor, facts = {}, at = ts()) {
    const m = id == null ? null : db.prepare('SELECT sender, recipient, ws, ws_n, title, impact, effort FROM memos WHERE id = ?').get(id);
    const memo = m ? { sender: m.sender, recipient: m.recipient, code: codeOf(m), title: m.title, impact: m.impact, effort: m.effort } : {};
    putEvent.run(at, kind, id ?? null, actor, JSON.stringify({ ...memo, ...facts }));
  }
  // The actor of a change. by: the name that the request gives (the Inbox page gives the owner; memo ... --as gives
  // the agent). With no name, the party that the change belongs to, and the event says actor_inferred: the routes
  // have one token for the owner and the agents, so the server cannot tell them apart by itself.
  function who(by, natural) {
    if (by === undefined || by === null || by === '') return { actor: natural, inferred: { actor_inferred: true } };
    if (by !== SERVER_ACTOR) checkParty('by', by, names);
    return { actor: by, inferred: {} };
  }
  // The time the owner took to answer a memo to her, for her reply and her close: the seconds since the memo was
  // sent, since she first had it on her screen (the first 'seen' event; null: never, or before the log began), and
  // since she last loaded the Inbox (the last 'inbox_load' event; null: none yet).
  function answerTimes(c, actor, at) {
    if (actor !== owner || c.recipient !== owner) return {};
    const since = (from) => (from ? Math.max(0, Math.round((Date.parse(at) - Date.parse(from)) / 1000)) : null);
    const seenAt = db.prepare("SELECT at FROM events WHERE kind = 'seen' AND memo_id = ? ORDER BY id LIMIT 1").get(c.id)?.at;
    const loadAt = db.prepare("SELECT at FROM events WHERE kind = 'inbox_load' ORDER BY id DESC LIMIT 1").get()?.at;
    return { seconds_since_sent: since(c.created), seconds_since_first_seen: since(seenAt), seconds_since_inbox_load: since(loadAt) };
  }
  // The owner loaded the Inbox (POST /api/client-tz, which the page sends at each load).
  const inboxLoaded = (facts = {}) => tx(() => record('inbox_load', null, owner, facts));

  function checkText(field, v, required = true) {
    if (v === undefined || v === null || v === '') {
      if (required) throw new MemoError(400, `${field} is necessary.`);
      return null;
    }
    if (typeof v !== 'string') throw new MemoError(400, `${field} must be text.`);
    if (v.length > MAX_TEXT) throw new MemoError(400, `${field} must have ${MAX_TEXT} characters or fewer.`);
    return v;
  }

  function checkParty(field, v, allowed) {
    if (!allowed.includes(v)) throw new MemoError(400, `${field} must be one of: ${allowed.join(', ')}.`);
  }

  function checkDue(v) {
    if (v === undefined || v === null || v === '') return null;
    const ms = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(`${v}T00:00:00Z`) : NaN;
    // The second check refuses a date such as 2026-02-30, which Date.parse moves to March.
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v) {
      throw new MemoError(400, 'due must be a date in the form YYYY-MM-DD.');
    }
    return v;
  }

  // One part of a brief: one line, trimmed. Empty or missing: no value.
  function checkLine(field, v, max) {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') throw new MemoError(400, `${field} must be text.`);
    const line = v.trim();
    if (/[\r\n]/.test(line)) throw new MemoError(400, `${field} must be one line.`);
    if (line.length > max) throw new MemoError(400, `${field} must have ${max} characters or fewer.`);
    return line || null;
  }

  // One tag, or a list of tags, from a request. Gives the clean list, sorted and with no duplicates.
  function checkTags(v) {
    if (v === undefined || v === null || v === '') return [];
    const list = (Array.isArray(v) ? v : [v]).map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : t));
    for (const t of list) {
      if (typeof t !== 'string' || !TAG.test(t)) {
        throw new MemoError(400, 'A tag must be one lowercase word: a-z, 0-9 and "-", 24 characters or fewer, starting with a letter.');
      }
    }
    const tags = [...new Set(list)].sort();
    if (tags.length > MAX_TAGS) throw new MemoError(400, `A memo can have ${MAX_TAGS} tags or fewer.`);
    return tags;
  }

  // The notes of a memo, oldest first. A memo with no notes has no `notes` field, so an old client sees no change.
  // The tags column is text in the database and a list in each answer. code: "OPS-14" from ws and ws_n, or null.
  const notesOf = (id) => db.prepare('SELECT id, author, text, created, read FROM notes WHERE memo_id = ? ORDER BY id').all(id).map(plain);
  function withNotes(row) {
    const notes = notesOf(row.id);
    const memo = { ...row, tags: row.tags ? row.tags.split(',') : [], re: reOf(row), code: codeOf(row) };
    return notes.length ? { ...memo, notes } : memo;
  }
  const reOf = (row) => (row.re ? row.re.split(',').map(Number) : []);
  const exists = (id) => Boolean(db.prepare('SELECT 1 FROM memos WHERE id = ?').get(id));
  // The id of the memo with a code ("OPS-14"), or undefined when no memo has it.
  const idOfCode = ({ ws, n }) => db.prepare('SELECT id FROM memos WHERE ws = ? AND ws_n = ?').get(ws, n)?.id;
  // A memo id from a request: a number (906, "906"), or a code ("OPS-14", any case). Gives the id, or NaN when
  // the value is neither, or names a code that no memo has.
  function idOf(v) {
    const code = parseCode(v);
    if (code) return idOfCode(code) ?? NaN;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  }
  // The origins of a new memo: a list of ids or codes, or 'a,b'. Each must be a memo that exists.
  function checkRe(re) {
    if (re === undefined || re === null || re === '') return [];
    const list = Array.isArray(re) ? re : typeof re === 'string' ? re.split(',') : null;
    if (!list) throw new MemoError(400, 're must be a list of memo ids or codes, or "355,OPS-14".');
    const ids = [];
    for (const v of list) {
      const n = idOf(typeof v === 'string' ? v.trim() : v);
      if (!Number.isInteger(n) || !exists(n)) throw new MemoError(400, `re names memo ${String(v).trim()}, which does not exist.`);
      if (!ids.includes(n)) ids.push(n);
    }
    if (ids.length > MAX_RE) throw new MemoError(400, `re can name ${MAX_RE} memos at most.`);
    return ids;
  }
  // The code of a new memo: a code of workstreams.json, in any case. Nothing: no code. Only a new code is checked
  // here: a memo that has a code keeps it when the code leaves the file (a retired code, GEN), and it is still
  // read, listed, searched and named by its code; see keepWs.
  function checkWs(ws) {
    if (ws === undefined || ws === null || ws === '') return null;
    const code = typeof ws === 'string' ? ws.trim().toUpperCase() : '';
    const known = Object.keys(workstreams);
    if (!known.includes(code)) {
      throw new MemoError(400, known.length ? `ws must be one of: ${known.join(', ')} (workstreams.json).` : 'No workstreams are set up: workstreams.json has no codes.');
    }
    return code;
  }
  // The code of an old memo, kept as it is (compact): it need not be in the file any more.
  const keepWs = (ws) => ws || null;

  // The links of a memo, for its thread: the memos its re names, and the memos that its text, its reply and its
  // notes name (referencedIds). Made again after each change of the memo, so a name that went is no link any more.
  // A memo that does not exist (yet) is no link.
  function relink(id) {
    const row = db.prepare('SELECT id, re, text, reply FROM memos WHERE id = ?').get(id);
    if (!row) return;
    const ids = new Set(reOf(row));
    const texts = [row.text, row.reply, ...db.prepare('SELECT text FROM notes WHERE memo_id = ?').all(id).map((n) => n.text)];
    for (const t of texts) {
      for (const n of referencedIds(t)) ids.add(n);
      // A code in the text ("OPS-14") is a link to the memo that has it, as "memo 906" is.
      for (const code of referencedCodes(t)) { const n = idOfCode(code); if (n) ids.add(n); }
    }
    db.prepare('DELETE FROM links WHERE memo_id = ?').run(id);
    const put = db.prepare('INSERT OR IGNORE INTO links (memo_id, ref_id) VALUES (?, ?)');
    for (const n of ids) if (n !== id && exists(n)) put.run(id, n);
  }
  // At the start, the links of all memos: the memos from before the threads get theirs. A few hundred memos take
  // milliseconds.
  db.exec('BEGIN');
  try { for (const { id } of db.prepare('SELECT id FROM memos').all()) relink(id); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }

  // The thread of a memo: the memos it came from (its origins, and theirs), the memo, and the memos that came from
  // it (the memos that name it), in the order of their ids. At most THREAD_MAX memos, THREAD_DEPTH links away. Each
  // memo is in the form of the Answered view: its text, its notes and its reply. For the Back and Forward buttons
  // of the open memo in the Inbox (ui/inbox.html).
  const transcript = (m) => ({ id: m.id, code: m.code, sender: m.sender, recipient: m.recipient, state: m.state, impact: m.impact, effort: m.effort,
    created: m.created, closed: m.closed, title: m.title, next: m.next, text: m.text, reply: m.reply, re: m.re,
    ...(m.notes ? { notes: m.notes.map(({ author, text, created }) => ({ author, text, created })) } : {}) });
  function thread(id) {
    const c = get(id);
    const seen = new Set([c.id]);
    let ring = [c.id];
    for (let depth = 0; depth < THREAD_DEPTH && ring.length && seen.size < THREAD_MAX; depth += 1) {
      const next = [];
      for (const n of ring) {
        for (const r of db.prepare('SELECT ref_id AS id FROM links WHERE memo_id = ? UNION SELECT memo_id AS id FROM links WHERE ref_id = ? ORDER BY id').all(n, n)) {
          if (seen.has(r.id) || seen.size >= THREAD_MAX) continue;
          seen.add(r.id);
          next.push(r.id);
        }
      }
      ring = next;
    }
    return { id: c.id, memos: [...seen].sort((a, b) => a - b).map((n) => transcript(get(n))) };
  }
  // The threads of the open memos to the owner (a postponed one too), by memo id: only the memos that have one.
  // For the ledger, so the phone has them in state/inbox.json.
  function threads() {
    const out = {};
    for (const m of list(owner, { withPostponed: true })) {
      const t = thread(m.id);
      if (t.memos.length > 1) out[m.id] = t;
    }
    return out;
  }

  // id: the number of the memo, or its code ("OPS-14"). Every change of a memo goes through here, so each takes both.
  function get(id) {
    const n = idOf(id);
    const row = Number.isInteger(n) ? db.prepare('SELECT * FROM memos WHERE id = ?').get(n) : undefined;
    if (!row) throw new MemoError(404, parseCode(id) ? `No memo has the code ${String(id).trim().toUpperCase()}.` : `No memo has the id ${id}.`);
    return withNotes(row);
  }

  function getOpen(id) {
    const c = get(id);
    if (c.state !== 'open') throw new MemoError(409, `Memo ${c.id} is ${c.state}. It cannot change.`);
    return c;
  }

  function corrections(sender) {
    return db.prepare(
      `SELECT k.memo_id, k.old_impact, k.new_impact, k.at, substr(c.text, 1, 80) AS text
       FROM corrections k JOIN memos c ON c.id = k.memo_id
       WHERE k.sender = ? ORDER BY k.rowid DESC LIMIT 5`,
    ).all(sender).map(plain);
  }

  // ws: the workstream code of the memo (OPS). Without it, a memo with re takes the code of the first origin that
  // has one: a reply stays in the workstream of the memo it answers. The number in the code follows the last memo of
  // that code; the calls are synchronous, so two memos never get the same number.
  function send(fields = {}) { return tx(() => create(fields, checkWs)); }
  // wsOf: checkWs for a new memo, keepWs for the memo of a compact, whose code may have left the file.
  // origin: where the memo came from, for its 'send' event: { compacted_from } or { forwarded_from }.
  function create({ from, to, text, impact, effort, due, trusted, tags, title, next, re, ws } = {}, wsOf, origin = {}) {
    checkParty('from', from, names);
    checkParty('to', to, names.filter((n) => n !== 'discord'));
    const body = checkText('text', text);
    if (to === owner) {
      if (!Number.isInteger(impact) || impact < 1 || impact > 5) {
        throw new MemoError(400, `impact must be a whole number from 1 to 5 for a memo to ${owner}.`);
      }
      if (!EFFORTS.includes(effort)) {
        throw new MemoError(400, `effort must be one of: ${EFFORTS.join(', ')} for a memo to ${owner}.`);
      }
    } else {
      impact = null;
      effort = null;
    }
    const d = checkDue(due);
    const t = checkTags(tags);
    const name = checkLine('title', title, MAX_TITLE);
    const step = checkLine('next', next, MAX_NEXT);
    const origins = checkRe(re);
    let code = wsOf(ws);
    if (!code) {
      for (const n of origins) { const o = db.prepare('SELECT ws FROM memos WHERE id = ?').get(n); if (o?.ws) { code = o.ws; break; } }
    }
    const wsN = code ? db.prepare('SELECT coalesce(max(ws_n), 0) + 1 AS n FROM memos WHERE ws = ?').get(code).n : null;
    const at = ts();
    const r = db.prepare(
      // seen is 0 here and not from the column default: an older database has the default 1 for its old memos.
      'INSERT INTO memos (sender, recipient, text, impact, effort, due, trusted, created, seen, tags, title, next, re, ws, ws_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)',
    ).run(from, to, body, impact, effort, d, trusted ? 1 : 0, at, t.join(','), name, step, origins.join(','), code, wsN);
    const id = Number(r.lastInsertRowid);
    relink(id);
    record('send', id, from, { text: body, next: step, due: d, tags: t, re: origins, trusted: trusted ? 1 : 0, ...origin }, at);
    return { memo: get(id), corrections: to === owner ? corrections(from) : [] };
  }

  // by: the name of who replies, for the event log; with none, the recipient of the memo (see who). The 'reply'
  // event has the time of the reply; the memo itself keeps it only as `closed`.
  function reply(id, text, by) {
    return tx(() => {
      const c = getOpen(id);
      const body = checkText('text', text);
      const { actor, inferred } = who(by, c.recipient);
      const at = ts();
      db.prepare(`UPDATE memos SET reply = ?, state = 'replied', closed = ? WHERE id = ?`).run(body, at, c.id);
      dropDraft(c.id);
      relink(c.id);
      record('reply', c.id, actor, { ...inferred, text: body, ...answerTimes(c, actor, at) }, at);
      return get(c.id);
    });
  }

  // by: as for reply.
  function close(id, text, by) {
    return tx(() => {
      const c = getOpen(id);
      const body = checkText('text', text, false);
      const { actor, inferred } = who(by, c.recipient);
      const at = ts();
      db.prepare(`UPDATE memos SET reply = ?, state = 'closed', closed = ? WHERE id = ?`).run(body, at, c.id);
      dropDraft(c.id);
      relink(c.id);
      record('close', c.id, actor, { ...inferred, text: body, ...answerTimes(c, actor, at) }, at);
      return get(c.id);
    });
  }

  // The draft of the owner for an open memo to the owner: the text of the reply field that she did not send yet.
  // The Inbox saves it as she types, on each device, so the text follows her from the phone to the computer.
  // updated is the time of the change, from the browser. A draft replaces the stored one only when it is newer, so a
  // device with an old copy never undoes what she typed later on a different device. An empty text removes the draft.
  // Gives the draft that is stored after the call: { id, text, updated }, with text '' when there is none.
  const dropDraft = (id) => db.prepare('DELETE FROM drafts WHERE memo_id = ?').run(id);
  const storedDraft = (id) => db.prepare('SELECT memo_id AS id, text, updated FROM drafts WHERE memo_id = ?').get(id);
  function draft(id, text, updated) {
    const c = getOpen(id);
    if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} has a draft.`);
    if (typeof text !== 'string') throw new MemoError(400, 'text must be text.');
    if (text.length > MAX_TEXT) throw new MemoError(400, `A draft must have ${MAX_TEXT} characters or fewer.`);
    if (typeof updated !== 'string' || Number.isNaN(Date.parse(updated))) throw new MemoError(400, 'updated must be a time in ISO form.');
    const at = new Date(updated).toISOString();
    const old = storedDraft(c.id);
    if (!old || old.updated < at) {
      if (text) db.prepare('INSERT OR REPLACE INTO drafts (memo_id, text, updated) VALUES (?, ?, ?)').run(c.id, text, at);
      else dropDraft(c.id);
    }
    const now = storedDraft(c.id);
    return now ? { ...now } : { id: c.id, text: '', updated: old && old.updated >= at ? old.updated : at };
  }
  // The drafts of the open memos to the owner, by memo id: { "12": { text, updated } }.
  function drafts() {
    const out = {};
    for (const r of db.prepare(`SELECT d.memo_id AS id, d.text, d.updated FROM drafts d JOIN memos m ON m.id = d.memo_id WHERE m.state = 'open' ORDER BY d.memo_id`).all()) {
      out[r.id] = { text: r.text, updated: r.updated };
    }
    return out;
  }

  // A new text for an open memo, for example to make it easier to read. The impact, the effort, and the place in the queue stay.
  // The 'edit' event keeps the old text and the new text. by: who edits; with none, the sender of the memo.
  function edit(id, text, by) {
    return tx(() => {
      const c = getOpen(id);
      const body = checkText('text', text);
      const { actor, inferred } = who(by, c.sender);
      // A text that the owner saw and that changes shows as "updated" in the Inbox.
      db.prepare('UPDATE memos SET text = ?, seen = CASE seen WHEN 1 THEN 2 ELSE seen END WHERE id = ?').run(body, c.id);
      // The sender changes the text to do what a note of the owner asks. Thus the notes of the owner are read,
      // and memo wait does not give the same note again.
      db.prepare('UPDATE notes SET read = 1 WHERE memo_id = ? AND author = ?').run(c.id, owner);
      relink(c.id);
      record('edit', c.id, actor, { ...inferred, old_text: c.text, new_text: body });
      return get(c.id);
    });
  }

  // A new brief for an open memo: the title, the next step, or both. A part that is not given stays.
  // An empty part removes it. The memo does not show as "updated": the text is the same.
  function brief(id, { title, next } = {}, by) {
    return tx(() => {
      const c = getOpen(id);
      if (title === undefined && next === undefined) throw new MemoError(400, 'Give title, next, or both.');
      const name = title === undefined ? c.title : checkLine('title', title, MAX_TITLE);
      const step = next === undefined ? c.next : checkLine('next', next, MAX_NEXT);
      const { actor, inferred } = who(by, c.sender);
      db.prepare('UPDATE memos SET title = ?, next = ? WHERE id = ?').run(name, step, c.id);
      record('brief', c.id, actor, { ...inferred, old_title: c.title, new_title: name, old_next: c.next, new_next: step });
      return get(c.id);
    });
  }

  // A note is a message in an open memo to the owner. The memo stays open and keeps its place in the queue.
  // The owner writes a note to ask for a change or for more data. The sender of the memo answers with a note.
  // A new note marks the notes of the other party as read.
  function note(id, from, text) {
    return tx(() => {
      const c = getOpen(id);
      if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} can have notes.`);
      if (from !== owner && from !== c.sender) throw new MemoError(403, `Only ${owner} and ${c.sender} can add a note to memo ${c.id}.`);
      const body = checkText('text', text);
      if (body.length > MAX_NOTE) throw new MemoError(400, `A note must have ${MAX_NOTE} characters or fewer.`);
      const at = ts();
      const r = db.prepare('INSERT INTO notes (memo_id, author, text, created) VALUES (?, ?, ?, ?)').run(c.id, from, body, at);
      db.prepare('UPDATE notes SET read = 1 WHERE memo_id = ? AND author != ?').run(c.id, from);
      // A note of the sender shows as "updated" in the Inbox, as a changed text does.
      if (from !== owner) db.prepare('UPDATE memos SET seen = CASE seen WHEN 1 THEN 2 ELSE seen END WHERE id = ?').run(c.id);
      // The note of the owner was the text of the reply field: the draft is sent.
      else dropDraft(c.id);
      relink(c.id);
      record('note', c.id, from, { note_id: Number(r.lastInsertRowid), text: body }, at);
      return get(c.id);
    });
  }
  // The sender makes a short new memo from an open memo to the owner, when the owner asks for it (the Compact button).
  // The new memo has the new text and the impact, effort, due date, and tags of the old one. It shows as new.
  // The old memo closes with a link to the new one. It is acked, so the sender gets no result for it.
  // The log gets two events: 'send' for the new memo (compacted_from: the old id), and 'compact' for the old one,
  // with the old text and the new text.
  function compact(id, from, { text, title, next } = {}) {
    return tx(() => {
      const c = getOpen(id);
      if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} can be compacted.`);
      if (from === owner || from !== c.sender) throw new MemoError(403, `Only ${c.sender} can compact memo ${c.id}.`);
      // The new memo stays in the workstream of the old one, with the next number, even when that code has left
      // workstreams.json since: an old GEN memo compacts into the next GEN.
      const { memo } = create({
        from, to: owner, text, impact: c.impact, effort: c.effort, due: c.due, tags: c.tags, ws: c.ws,
        title: title === undefined ? c.title : title, next: next === undefined ? c.next : next,
      }, keepWs, { compacted_from: c.id });
      const at = ts();
      db.prepare(`UPDATE memos SET reply = ?, state = 'closed', closed = ?, acked = 1 WHERE id = ?`).run(`Compacted into memo #${memo.id}.`, at, c.id);
      db.prepare('UPDATE notes SET read = 1 WHERE memo_id = ? AND author = ?').run(c.id, owner);
      // The old memo names the new one: the two are one thread.
      relink(c.id);
      // A draft for the old memo goes with the new memo, so the owner does not lose what she typed.
      const d = storedDraft(c.id);
      if (d) { db.prepare('INSERT OR REPLACE INTO drafts (memo_id, text, updated) VALUES (?, ?, ?)').run(memo.id, d.text, d.updated); dropDraft(c.id); }
      record('compact', c.id, from, { new_memo_id: memo.id, old_text: c.text, new_text: memo.text }, at);
      return { memo, old: get(c.id) };
    });
  }
  const unreadFromOwner = (id) => db.prepare('SELECT COUNT(*) AS n FROM notes WHERE memo_id = ? AND author = ? AND read = 0').get(id, owner).n;

  // The owner changes one check box of a memo ("- [ ] text"). The text changes only in that box, and the memo stays seen.
  function check(id, n, on) {
    const c = getOpen(id);
    if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} has check boxes that change.`);
    if (!Number.isInteger(n) || typeof on !== 'boolean') throw new MemoError(400, 'n must be a whole number and on must be true or false.');
    const text = setCheckBox(c.text, n, on);
    if (text === null) throw new MemoError(404, `Memo ${c.id} has no check box ${n}.`);
    return tx(() => {
      db.prepare('UPDATE memos SET text = ? WHERE id = ?').run(text, c.id);
      record('check', c.id, owner, { n, on });
      return get(c.id);
    });
  }

  // The Inbox calls this when a memo was on the screen of the owner. The "new" or "updated" tag of the memo goes away.
  function seen(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((n) => Number.isInteger(n))) {
      throw new MemoError(400, 'ids must be a list of 1 to 500 memo ids.');
    }
    const mark = db.prepare('UPDATE memos SET seen = 1 WHERE id = ? AND recipient = ? AND seen != 1');
    return tx(() => {
      let changed = 0;
      let at = null;
      for (const id of ids) {
        if (!Number(mark.run(id, owner).changes)) continue;
        changed += 1;
        // One 'seen' event for each memo whose tag went away: its first is the time the owner first had the memo on
        // her screen (answerTimes).
        at ??= ts();
        record('seen', id, owner, {}, at);
      }
      return { seen: changed };
    });
  }

  // The owner corrects the impact of a memo, one step up or down. The effort has no correction: no route changes it.
  function adjust(id, delta, by) {
    return tx(() => {
      const c = getOpen(id);
      if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} has an impact.`);
      if (delta !== 1 && delta !== -1) throw new MemoError(400, 'delta must be 1 or -1.');
      const { actor, inferred } = who(by, owner);
      const next = Math.min(5, Math.max(1, c.impact + delta));
      if (next !== c.impact) {
        const at = ts();
        db.prepare('UPDATE memos SET impact = ? WHERE id = ?').run(next, c.id);
        db.prepare('INSERT INTO corrections (memo_id, sender, old_impact, new_impact, at) VALUES (?, ?, ?, ?, ?)')
          .run(c.id, c.sender, c.impact, next, at);
        record('impact', c.id, actor, { ...inferred, old_impact: c.impact, new_impact: next }, at);
      }
      return get(c.id);
    });
  }

  // by: who acks, for the event log; with none, the sender of the memo.
  function ack(id, by) {
    return tx(() => {
      const c = get(id);
      const { actor, inferred } = who(by, c.sender);
      // For an open memo, the sender marks the notes of the owner as read, when no answer is necessary.
      if (c.state === 'open' && unreadFromOwner(c.id)) {
        db.prepare('UPDATE notes SET read = 1 WHERE memo_id = ? AND author = ?').run(c.id, owner);
        record('ack', c.id, actor, { ...inferred, of: 'notes' });
        return get(c.id);
      }
      if (c.state === 'open') throw new MemoError(409, `Memo ${c.id} is open. It has no result.`);
      db.prepare('UPDATE memos SET acked = 1 WHERE id = ?').run(c.id);
      record('ack', c.id, actor, { ...inferred, of: 'result' });
      return get(c.id);
    });
  }

  // The liaison cannot write a memo from the owner. It can only pass on a message that the watcher marked
  // as written by the owner's own Discord account. The new memo has the text of that message, not text of the liaison.
  function forward(id, to) {
    const c = getOpen(id);
    if (c.sender !== 'discord' || !c.trusted) {
      throw new MemoError(403, `Memo ${c.id} is not a Discord message from the owner. It cannot go to an agent.`);
    }
    // trusted = 2: the message went on one time. A second forward would make the agent do the request again.
    if (c.trusted === 2) throw new MemoError(409, `Memo ${c.id} was already forwarded.`);
    checkParty('to', to, forwardTo);
    return tx(() => {
      const sent = create({ from: owner, to, text: c.text }, checkWs, { forwarded_from: c.id });
      db.prepare('UPDATE memos SET trusted = 2 WHERE id = ?').run(c.id);
      return sent;
    });
  }

  // Adds (on: true) or removes (on: false) one tag of a memo to the owner. The memo can be open or closed.
  // The log gets a 'tag' or an 'untag' event when the tags of the memo change. by: who; with none, the owner.
  function tag(id, name, on, by) {
    return tx(() => {
      const c = get(id);
      if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} has tags.`);
      if (typeof on !== 'boolean') throw new MemoError(400, 'on must be true or false.');
      const [t] = checkTags(name);
      if (!t) throw new MemoError(400, 'tag is necessary.');
      const { actor, inferred } = who(by, owner);
      const tags = on ? checkTags([...c.tags, t]) : c.tags.filter((x) => x !== t);
      db.prepare('UPDATE memos SET tags = ? WHERE id = ?').run(tags.join(','), c.id);
      if (tags.join(',') !== c.tags.join(',')) record(on ? 'tag' : 'untag', c.id, actor, { ...inferred, tag: t, tags });
      return get(c.id);
    });
  }

  // Takes an open memo to the owner out of the Inbox until 9:00 AM on the date (YYYY-MM-DD) in the owner's zone.
  // date null: the memo comes back now. A postpone is not an answer: the sender gets no news from it.
  // The 'postpone' event has the date and the return time; both null: the memo came back now. by: as for tag.
  function postpone(id, date, by) {
    return tx(() => {
      const c = getOpen(id);
      if (c.recipient !== owner) throw new MemoError(400, `Only a memo to ${owner} can be postponed.`);
      const { actor, inferred } = who(by, owner);
      if (date === null) {
        db.prepare('UPDATE memos SET until = NULL WHERE id = ?').run(c.id);
        record('postpone', c.id, actor, { ...inferred, date: null, until: null });
        return get(c.id);
      }
      const day = checkDue(date);
      if (!day) throw new MemoError(400, 'date must be a date in the form YYYY-MM-DD, or null to bring the memo back now.');
      const until = returnTime(day, timeZone);
      const at = ts();
      if (until <= at) throw new MemoError(400, `The date must be in the future: 9:00 AM on ${day} has passed.`);
      db.prepare('UPDATE memos SET until = ? WHERE id = ?').run(until, c.id);
      record('postpone', c.id, actor, { ...inferred, date: day, until }, at);
      return get(c.id);
    });
  }

  // A postponed memo whose time has come goes back to the Inbox as new, at the top until the owner sees it.
  // SET uses the old value of until for back.
  const wake = () => db.prepare('UPDATE memos SET back = until, until = NULL, seen = 0 WHERE until IS NOT NULL AND until <= ?').run(ts());

  // The open memos to a name. For the owner, a postponed memo is not in the list, unless withPostponed.
  // For an agent, the list is what memo list and memo wait show it, so each memo in it gets its delivery marker: from
  // now on the agent may work on it, and the handover job leaves it alone.
  function list(to, { withPostponed = false } = {}) {
    checkParty('to', to, names);
    wake();
    const rows = db.prepare(`SELECT * FROM memos WHERE recipient = ? AND state = 'open' ORDER BY id`).all(to)
      .filter((r) => withPostponed || !r.until).map(withNotes);
    if (to !== owner) {
      const mark = db.prepare('UPDATE memos SET delivered = ? WHERE id = ? AND delivered IS NULL');
      for (const r of rows) if (!r.delivered) { r.delivered = ts(); mark.run(r.delivered, r.id); }
    }
    return to === owner ? sortQueue(rows, now()) : rows;
  }

  // The open memos from the owner to an agent that the agent never got (no delivery marker), oldest first. For the
  // handover job (src/handover.js).
  const undelivered = (agent) => db.prepare(`SELECT * FROM memos WHERE recipient = ? AND sender = ? AND state = 'open' AND delivered IS NULL ORDER BY id`)
    .all(agent, owner).map(withNotes);

  // Moves an open memo that its agent never got to a different agent. The check and the change are one statement, so
  // a memo that the agent got a moment before is never moved. Gives true when the memo moved.
  function move(id, from, to) {
    checkParty('to', to, forwardTo);
    return tx(() => {
      const r = db.prepare(`UPDATE memos SET recipient = ? WHERE id = ? AND recipient = ? AND sender = ? AND state = 'open' AND delivered IS NULL`)
        .run(to, id, from, owner);
      const moved = Number(r.changes) === 1;
      if (moved) record('move', id, SERVER_ACTOR, { from, to });
      return moved;
    });
  }

  // The postponed memos of the owner, the first to come back first.
  function postponed() {
    wake();
    return db.prepare(`SELECT * FROM memos WHERE recipient = ? AND state = 'open' AND until IS NOT NULL ORDER BY until, id`)
      .all(owner).map(withNotes);
  }

  // The time of the owner's latest action tied to each memo of the Inbox (memo 1236), by memo id, as ISO times: a note
  // of hers on the memo; or, on one of its origins (the memos it links to: its re, and the memos its text, reply or
  // notes name), a send by her, her reply or close (the closed time; not a compact, which the agent does), or a note of
  // hers. A memo she sent herself counts by its created time. Only the memos that have a time are in the answer. The
  // Inbox marks the latest in green and the next few in gold (ui/recent.js). memos: the list of the queue, so the
  // route reads it once.
  function fired(memos = list(owner, { withPostponed: true })) {
    const out = {};
    const noteTime = db.prepare('SELECT MAX(created) AS t FROM notes WHERE memo_id = ? AND author = ?');
    const origins = db.prepare('SELECT m.id, m.sender, m.recipient, m.state, m.created, m.closed, m.reply FROM links l JOIN memos m ON m.id = l.ref_id WHERE l.memo_id = ? ORDER BY m.id');
    for (const m of memos) {
      const times = [];
      if (m.sender === owner) times.push(m.created);
      times.push(noteTime.get(m.id, owner).t);
      for (const o of origins.all(m.id)) {
        if (o.sender === owner) times.push(o.created);
        if (o.recipient === owner && o.state !== 'open' && !/^Compacted into memo #\d+\.$/.test(o.reply || '')) times.push(o.closed);
        times.push(noteTime.get(o.id, owner).t);
      }
      const best = times.filter(Boolean).sort().at(-1);
      if (best) out[m.id] = best;
    }
    return out;
  }

  // The memos to the owner that she replied to or closed in the last 7 days, the last answered first.
  // For the Answered view of the Inbox, so she can find a memo that left it. At most 50.
  function answered() {
    const since = new Date(now().getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return db.prepare(`SELECT * FROM memos WHERE recipient = ? AND state != 'open' AND closed >= ? ORDER BY closed DESC, id DESC LIMIT 50`)
      .all(owner, since).map(withNotes);
  }

  // Search: the memos whose text, reply, title or notes hold each word, newest first. Words match without regard to
  // case (of ASCII letters: lower() in SQLite folds no others, so both sides go through it), anywhere in a word.
  // The words are bound, and instr has no special characters. For the agents, so they can find what was settled.
  // A word that is a code ("OPS-14") also finds the memo that has the code, and that memo comes first.
  function search(q, { limit = 20 } = {}) {
    const words = String(q ?? '').split(/\s+/).filter(Boolean).slice(0, 10);
    if (!words.length) throw new MemoError(400, 'Give one or more words to search for.');
    const n = Math.min(Math.max(Math.floor(Number(limit)) || 20, 1), 200);
    const hay = `lower(m.text || ' ' || coalesce(m.reply, '') || ' ' || coalesce(m.title, '') || ' ' ||
      coalesce((SELECT group_concat(text, ' ') FROM notes WHERE memo_id = m.id), ''))`;
    const own = '(m.ws = ? AND m.ws_n = ?)';
    const params = [];
    const where = words.map((w) => {
      const code = parseCode(w);
      params.push(w);
      if (!code) return `instr(${hay}, lower(?)) > 0`;
      params.push(code.ws, code.n);
      return `(instr(${hay}, lower(?)) > 0 OR ${own})`;
    }).join(' AND ');
    const first = words.map(parseCode).find(Boolean);
    const order = first ? `${own} DESC, m.id DESC` : 'm.id DESC';
    if (first) params.push(first.ws, first.n);
    return db.prepare(`SELECT m.* FROM memos m WHERE ${where} ORDER BY ${order} LIMIT ${n}`).all(...params).map(withNotes);
  }

  // All memos in a short form, oldest first: for the copy that the cloud agent searches when this computer is off.
  function archive() {
    return db.prepare('SELECT id, ws, ws_n, sender, recipient, state, created, closed, title, text, reply FROM memos ORDER BY id').all()
      .map(({ ws, ws_n: wsN, ...r }) => {
        const notes = notesOf(r.id).map(({ author, text, created }) => ({ author, text, created }));
        const memo = { id: r.id, code: codeOf({ ws, ws_n: wsN }), ...r };
        return notes.length ? { ...memo, notes } : memo;
      });
  }

  function news(who) {
    const to_you = list(who);
    const results = db.prepare(`SELECT * FROM memos WHERE sender = ? AND state != 'open' AND acked = 0 ORDER BY id`)
      .all(who).map(withNotes);
    // Open memos of this sender that have a note of the owner that the sender did not read.
    const noted = db.prepare(
      `SELECT * FROM memos WHERE sender = ? AND state = 'open'
       AND id IN (SELECT memo_id FROM notes WHERE author = ? AND read = 0) ORDER BY id`,
    ).all(who, owner).map(withNotes);
    return { to_you, results, noted };
  }

  // The open memos of an agent, for the Agents page: the counts, and the memos themselves in a short form, each with
  // its id, its title, and the first line of its text. memos_to: the memos that wait on the agent, oldest first.
  // memos_from: the memos from the agent that wait on the owner, in the order of the Inbox; a postponed memo is in it too.
  const firstLine = (text) => String(text || '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 160) || '';
  // created: the time of the memo, so the pet of the agent knows how long its oldest memo has waited (ui/pets.js waitLevel).
  const short = (m) => ({ id: m.id, code: codeOf(m), title: m.title, line: firstLine(m.text), created: m.created, ...(m.until ? { until: m.until } : {}) });
  // replies: the answers of the owner to the memos of the agent in the last day, the newest first, at most 10, each
  // with the id, the text and the time; the pet of the agent looks happy after thanks (ui/pets.js). A compact is the
  // agent's own close, so it is left out.
  function counts(name) {
    wake();
    const to = db.prepare(`SELECT id, ws, ws_n, title, text, until, created, delivered FROM memos WHERE recipient = ? AND state = 'open' ORDER BY id`).all(name);
    const from = db.prepare(`SELECT * FROM memos WHERE sender = ? AND state = 'open' ORDER BY id`).all(name);
    const since = new Date(now().getTime() - REPLIES_MS).toISOString();
    const replies = db.prepare(`SELECT id, reply, closed FROM memos WHERE sender = ? AND recipient = ? AND state != 'open' AND reply IS NOT NULL AND closed >= ? ORDER BY closed DESC, id DESC LIMIT 10`)
      .all(name, owner, since).filter((r) => !/^Compacted into memo #\d+\.$/.test(r.reply));
    return {
      open_to: to.length,
      open_from: from.length,
      // delivered: the time the agent got the memo through memo list or memo wait, when it has it. The Inbox follows a
      // memo from Send to that moment (memo 1407, ui/sendstage.js).
      memos_to: to.map((m) => ({ ...short(m), ...(m.delivered ? { delivered: m.delivered } : {}) })),
      memos_from: (name === owner ? from : sortQueue(from, now())).map(short),
      replies,
    };
  }

  // True when an open memo holds this text in its text, its reply or a note: a video that another open memo still
  // links to is not deleted when one memo closes (src/app.js).
  const holdsOpen = (fragment) => db.prepare(`SELECT COUNT(*) AS n FROM memos m WHERE m.state = 'open' AND (instr(m.text, ?) > 0
    OR instr(coalesce(m.reply, ''), ?) > 0 OR EXISTS (SELECT 1 FROM notes WHERE memo_id = m.id AND instr(text, ?) > 0))`).get(fragment, fragment, fragment).n > 0;

  return { get, send, reply, close, edit, brief, note, compact, seen, check, adjust, ack, forward, tag, postpone, postponed, answered, list, fired, undelivered, move, news, search, archive, corrections, counts, draft, drafts, thread, threads, holdsOpen, inboxLoaded, timeZone, workstreams };
}
