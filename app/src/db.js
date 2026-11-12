import { DatabaseSync } from 'node:sqlite';

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  // Before 2026-10-09 a memo had the name "card". A database from then gets the new table and column names.
  const has = (table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (has('cards') && !has('memos')) {
    db.exec('ALTER TABLE cards RENAME TO memos; ALTER TABLE corrections RENAME COLUMN card_id TO memo_id;');
  }
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS memos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      text TEXT NOT NULL,
      reply TEXT,
      state TEXT NOT NULL DEFAULT 'open',   -- 'open' | 'replied' | 'closed'
      impact INTEGER,                       -- 1 to 5, only for a memo to the owner
      effort TEXT,                          -- a key of WEIGHTS, only for a memo to the owner
      due TEXT,                             -- YYYY-MM-DD
      trusted INTEGER NOT NULL DEFAULT 0,   -- 1: the watcher checked that the owner wrote the message; 2: also forwarded
      acked INTEGER NOT NULL DEFAULT 0,     -- 1: the sender read the result
      seen INTEGER NOT NULL DEFAULT 0,      -- for a memo to the owner. 0: new; 1: the owner saw the text; 2: the text changed after that
      created TEXT NOT NULL,
      closed TEXT
    );
    CREATE TABLE IF NOT EXISTS corrections (
      memo_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      old_impact INTEGER NOT NULL,
      new_impact INTEGER NOT NULL,
      at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS status (
      agent TEXT PRIMARY KEY,
      text TEXT NOT NULL DEFAULT '',
      updated TEXT NOT NULL DEFAULT '',
      wanted INTEGER NOT NULL DEFAULT 0,    -- 1: the owner started the agent, so the server starts it again
      recap TEXT,
      recap_at TEXT,
      stopping_since TEXT,                  -- set while the server waits for the recap
      last_stop TEXT,                       -- 'recap' | 'no_recap' | 'now'
      news_at TEXT                          -- the time of the last /api/news request of the agent (memo wait)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      impact INTEGER NOT NULL,              -- 1 to 5, as for a memo
      effort TEXT NOT NULL,                 -- a key of WEIGHTS
      days TEXT NOT NULL DEFAULT '',        -- 'mon,wed,fri'; empty: each day
      every INTEGER NOT NULL DEFAULT 1,     -- the tick comes back this many days after the owner did it
      after TEXT NOT NULL DEFAULT '',       -- 'HH:MM': not in the list before this time; empty: all day
      by TEXT NOT NULL DEFAULT '',          -- 'HH:MM': overdue after this time; empty: no time limit
      active INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tick_log (
      tick_id INTEGER NOT NULL,
      day TEXT NOT NULL,                    -- YYYY-MM-DD, the day of the owner
      state TEXT NOT NULL,                  -- 'done' | 'skip'
      at TEXT NOT NULL,
      PRIMARY KEY (tick_id, day)
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      author TEXT NOT NULL,                 -- the owner, or the sender of the memo
      text TEXT NOT NULL,
      created TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0       -- 1: the other party read the note
    );
    CREATE INDEX IF NOT EXISTS notes_memo ON notes (memo_id);
  `);
  // A database from before the overdue rule gets the column.
  if (!db.prepare('PRAGMA table_info(ticks)').all().some((c) => c.name === 'by')) {
    db.exec("ALTER TABLE ticks ADD COLUMN by TEXT NOT NULL DEFAULT ''");
  }
  // A database from before the "new" tag gets the column. The memos that are in it count as seen.
  if (!db.prepare('PRAGMA table_info(memos)').all().some((c) => c.name === 'seen')) {
    db.exec('ALTER TABLE memos ADD COLUMN seen INTEGER NOT NULL DEFAULT 1');
  }
  // Tags and postpone. The old memos get no tags and are not postponed.
  //   tags:  'money,work' (sorted; empty: no tags)
  //   until: the time (ISO, UTC) when a postponed memo comes back to the Inbox; NULL: not postponed
  //   back:  the time when a postponed memo came back. Until the owner sees it, it is at the top of the Inbox.
  const memoColumns = db.prepare('PRAGMA table_info(memos)').all().map((c) => c.name);
  if (!memoColumns.includes('tags')) db.exec("ALTER TABLE memos ADD COLUMN tags TEXT NOT NULL DEFAULT ''");
  if (!memoColumns.includes('until')) db.exec('ALTER TABLE memos ADD COLUMN until TEXT');
  if (!memoColumns.includes('back')) db.exec('ALTER TABLE memos ADD COLUMN back TEXT');
  // The brief of a memo for the compact view of the Inbox, written by the sender. NULL: no brief.
  //   title: a name for the memo, for example "Driver license address"
  //   next:  the next step of the owner, for example "Mail form MV-232"
  if (!memoColumns.includes('title')) db.exec('ALTER TABLE memos ADD COLUMN title TEXT');
  if (!memoColumns.includes('next')) db.exec('ALTER TABLE memos ADD COLUMN next TEXT');
  // The origins of a memo (memo send --re 355,349): the ids of the memos it answers or continues, 'a,b'. Empty: none.
  if (!memoColumns.includes('re')) db.exec("ALTER TABLE memos ADD COLUMN re TEXT NOT NULL DEFAULT ''");
  // The workstream code of a memo (memo send --ws OPS), from workstreams.json, and its number in that code: together
  // "OPS-14". The number starts at 1 for each code. NULL: the memo has no code; it shows its id, as all memos from
  // before the codes do (they keep their numbers). The unique index keeps one memo for each code; NULLs are distinct.
  if (!memoColumns.includes('ws')) db.exec('ALTER TABLE memos ADD COLUMN ws TEXT');
  if (!memoColumns.includes('ws_n')) db.exec('ALTER TABLE memos ADD COLUMN ws_n INTEGER');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS memos_ws ON memos (ws, ws_n)');
  // The links between memos, for the thread of a memo (src/memos.js thread): memo_id names ref_id, with --re or with
  // "memo N" in its text, its reply or a note. The store makes them at the start and after each change of a memo.
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      memo_id INTEGER NOT NULL,
      ref_id INTEGER NOT NULL,
      PRIMARY KEY (memo_id, ref_id)
    );
    CREATE INDEX IF NOT EXISTS links_ref ON links (ref_id);
  `);
  // A database from before the nudge gets the column. Its agents count as idle until they ask for news.
  if (!db.prepare('PRAGMA table_info(status)').all().some((c) => c.name === 'news_at')) {
    db.exec('ALTER TABLE status ADD COLUMN news_at TEXT');
  }
  // The helpers of an agent: the subagents it started (memo helper --as main start <label> <model>). The Agents page
  // shows them under the agent. A done helper stays for a day, then the next change of the agent's helpers removes it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS helpers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      label TEXT NOT NULL,
      model TEXT NOT NULL,
      started TEXT NOT NULL,
      ended TEXT                            -- NULL while the helper runs
    );
    CREATE INDEX IF NOT EXISTS helpers_agent ON helpers (agent);
  `);
  // The delivery marker of a memo to an agent (memo 982): the time when the agent first got the memo, from memo list or
  // memo wait. NULL: the agent never saw it, so it cannot work on it, and the handover job may move it to the other
  // agent. A database from before the marker counts all its memos as delivered, so the job never moves an old memo.
  if (!memoColumns.includes('delivered')) db.exec('ALTER TABLE memos ADD COLUMN delivered TEXT; UPDATE memos SET delivered = created;');
  // The log of the handover job: each memo it moved from an agent at its limit to the other agent. hold_until is the
  // reset time of the limit that caused the move. Until then the job does not move that memo again, so a memo never
  // goes back and forth between the two agents.
  db.exec(`
    CREATE TABLE IF NOT EXISTS handovers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memo_id INTEGER NOT NULL,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      reason TEXT NOT NULL,                 -- for example 'session at 96 percent'
      at TEXT NOT NULL,
      hold_until TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS handovers_memo ON handovers (memo_id);
  `);
  // The log of the Fable to spare memos (src/fable-spare.js): one row per agent and Fable window, the window by its
  // reset time. The job sends one memo per window, also across a restart of the server.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fable_spare (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      resets_at TEXT NOT NULL,              -- the reset time of the Fable window, in ISO form
      points INTEGER NOT NULL,              -- the Fable headroom when the memo went
      memo_id INTEGER NOT NULL,
      at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS fable_spare_window ON fable_spare (agent, resets_at);
  `);
  // The log of the meeting follow-up memos (src/followups.js): one row per occurrence of a calendar event, by the UID
  // of the event and the start of the occurrence. The job sends one memo per occurrence, also across a restart of the
  // server and when the same event is on two calendars.
  db.exec(`
    CREATE TABLE IF NOT EXISTS followups_sent (
      event_key TEXT PRIMARY KEY,           -- '<UID>|<start of the occurrence, ISO, UTC>'
      title TEXT NOT NULL,                  -- the title of the event
      ends TEXT NOT NULL,                   -- the end of the occurrence, ISO, UTC
      memo_id INTEGER,                      -- the memo that went
      at TEXT NOT NULL
    );
  `);
  // The draft of the owner for a memo: the text of the reply field that is not sent yet. The Inbox saves it as she
  // types, so the same text is on her phone and on her computer. It goes away with the reply, the note, or the close.
  //   updated: the time of the last change, from the browser. A draft with an older time never replaces a newer one.
  db.exec(`
    CREATE TABLE IF NOT EXISTS drafts (
      memo_id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      updated TEXT NOT NULL
    );
  `);
  // The event log (memo 1239, OPS-34; README.md, "The event log"): one row for each decision on a memo, in the
  // order they happened, for training data later. The store writes a row in the transaction of the change itself
  // (src/memos.js record). Append only: no code changes or removes a row, and the triggers refuse it: an UPDATE, a
  // DELETE, and an INSERT OR REPLACE over a row that is there (the delete inside a REPLACE fires no delete trigger).
  //   at:      the time of the event (ISO, UTC), from the clock of the store
  //   kind:    'send' | 'reply' | 'close' | 'note' | 'edit' | ... (src/memos.js EVENT_KINDS)
  //   memo_id: the memo of the event; NULL for an event with no memo ('inbox_load')
  //   actor:   the owner, the name of an agent, or 'server'
  //   payload: a JSON object with the facts of the event
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      memo_id INTEGER,
      actor TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS events_at ON events (at);
    CREATE INDEX IF NOT EXISTS events_memo ON events (memo_id);
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
      BEGIN SELECT RAISE(ABORT, 'The events table is append only: a row cannot change.'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
      BEGIN SELECT RAISE(ABORT, 'The events table is append only: a row cannot be removed.'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_replace BEFORE INSERT ON events WHEN EXISTS (SELECT 1 FROM events WHERE id = NEW.id)
      BEGIN SELECT RAISE(ABORT, 'The events table is append only: a row cannot be replaced.'); END;
  `);
  return db;
}
