#!/usr/bin/env node
// The nightly export of the event log (README.md, "The event log"): the events of the day before today, as one
// JSONL file for that day. It only reads the database, so it can run while the server runs.
//   node scripts/export-events.js [<dir>] [--out <dir>] [--day YYYY-MM-DD] [--tz <zone>] [--with-text]
// The folder: --out or the first argument, then MEMO_EVENTS_DIR, then <MEMO_VAULT>/raw/memo-events (MEMO_VAULT: ~/memo-vault by default).
// The day is a day of the owner: --tz, then the zone of her browser (data/client-tz.json), then MEMO_TZ, then the
// zone of this computer. Without --with-text the file has no memo text: see src/events.js TEXT_KEYS.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { exportDay } from '../src/events.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = {};
const rest = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--with-text') flags.withText = true;
  else if (['--out', '--day', '--tz'].includes(a)) {
    if (i + 1 >= args.length) fail(`${a} needs a value.`);
    flags[a.slice(2)] = args[++i];
  } else if (a.startsWith('--')) fail(`${a} is not a known option. Usage: export-events.js [<dir>] [--out <dir>] [--day YYYY-MM-DD] [--tz <zone>] [--with-text]`);
  else rest.push(a);
}

// The two values of .env that the export needs, when the environment does not give them. Nothing else is read.
function fileEnv(key) {
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[1] === key) return m[2].trim();
    }
  } catch { /* no .env */ }
  return undefined;
}
const setting = (key) => process.env[key] || fileEnv(key);
const home = (p) => p.replace(/^~(?=\/|$)/, homedir());

const dbPath = resolve(root, setting('DATABASE_PATH') || './data/memo.db');
const dir = resolve(home(flags.out || rest[0] || setting('MEMO_EVENTS_DIR') || join(home(setting('MEMO_VAULT') || join(homedir(), 'memo-vault')), 'raw', 'memo-events')));
const browserZone = () => {
  try { return JSON.parse(readFileSync(join(dirname(dbPath), 'client-tz.json'), 'utf8')).timeZone || undefined; } catch { return undefined; }
};
const timeZone = flags.tz || browserZone() || setting('MEMO_TZ') || Intl.DateTimeFormat().resolvedOptions().timeZone;
try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { fail(`${timeZone} is not a time zone name. For example: --tz America/Los_Angeles`); }

let db;
try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch (err) { fail(`The database ${dbPath} did not open: ${err.message}`); }
if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'").get()) {
  fail('The database has no event log yet. Start the Memo server one time; it makes the events table.');
}
try {
  const done = exportDay({ db, dir, day: flags.day, timeZone, withText: Boolean(flags.withText) });
  console.log(`${done.count} event(s) of ${done.day} (${done.timeZone}) are in ${done.path}${done.withText ? ', with the memo text' : ', with no memo text'}.`);
} catch (err) { fail(err.message); } finally { db.close(); }
