// The Memo command-line client. The agents call it through Bash: scripts/memo <command> ...
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageNames, fileLinks, videoLinks, FILE_NAME, VIDEO_NAME, extension, safeFileName, expiryWords } from '../ui/attach.js';
import { modelVersioned, VERSION_WORD, FAMILY_WORD } from '../src/models.js';

const USAGE = `Usage:
  memo send --from <name> --to <name|auto> [--capability general|image-generation|computer-use] [--impact 1-5 --effort micro|short|hour|half-day|day] [--due YYYY-MM-DD] [--tag <tag> ...] [--title <name>] [--next <step>] [--re <id>,<id>] [--ws <code>] [--] <text>
  memo tag <id> <tag> [<tag> ...]
  memo untag <id> <tag> [<tag> ...]
  memo postpone <id> <YYYY-MM-DD> | memo postpone <id> now
  memo reply <id> <text>
  memo close <id> [<text>]
  memo edit <id> [--] <new text>
  memo brief <id> [--title <name>] [--next <step>]
  memo note <id> --from <name> [--] <text>
  memo compact <id> --from <name> [--title <name>] [--next <step>] [--] <new text>
  memo ack <id> [<id> ...]
  memo forward <id> [--to <agent>]
  memo status --as <agent> <text>
  memo helper --as <agent> start <label> <model> | memo helper --as <agent> done <label> | memo helper --as <agent> list
                 (<model> with its version: "fable 5.1" or claude-fable-5-1, shown as Fable 5.1 in the Inbox)
  memo recap --as <agent> <text>
  memo list --to <name>
  memo search [--limit <n>] [--] <words>   (all memos, open and closed, that hold each word; newest first)
  memo prompt --as <agent>
  memo image <path> [<text that describes the image>]
  memo file <stored-name> [<dir>]        (a file, or a video while Memo still has it)
  memo wait --as <agent> [--hold <id>,<id>] [<max_minutes>]
  memo tick add --impact 1-5 --effort <effort> [--days mon,wed,fri] [--every <days>] [--after HH:MM] [--by HH:MM] [--] <text>
  memo tick set <id> [--impact ...] [--effort ...] [--days ...] [--every ...] [--after ...] [--by ...] [<new text>]
  memo tick list | memo tick remove <id> | memo tick log [<days>]
  memo tz        (the time zone of the owner's browser, from the last load of the Inbox)
A memo to the owner needs --impact and --effort. --title and --next are the brief for the compact view of the Inbox.
--re names the memos that the new memo answers or continues (its origins), for the Back and Forward buttons of the Inbox;
a memo that says "memo 355" in its text is linked to memo 355 without it.
--ws gives the memo a workstream code from workstreams.json (REL, FUND, OPS, ...): the memo is then OPS-14, the next
number in that code. With --re and no --ws, the memo takes the code of the memo it answers.
<id> is the number of a memo, or its code: memo close OPS-14. memo search OPS-14 finds the memo with that code.
reply, close, edit, brief, ack, tag, untag and postpone take --as <name>: who does it, for the event log. With no
--as the log names the party the change belongs to (the recipient for a reply or a close, the sender for an edit).`;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function fileEnv() {
  const out = {};
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch { /* no .env: the environment must give the values */ }
  return out;
}
const file = fileEnv();
const token = process.env.MEMO_TOKEN || file.MEMO_TOKEN;
// MEMO_URL is for a server on a different computer, for example https://memo.your-tailnet.ts.net
const base = (process.env.MEMO_URL || file.MEMO_URL || `http://127.0.0.1:${file.PORT || 3280}`).replace(/\/+$/, '');

function fail(message) {
  console.error(message);
  process.exit(1);
}

// soft: a server that does not answer, or an answer that is not from Memo, gives null and not an exit. memo wait uses it.
async function call(path, body, { soft = false } = {}) {
  let r;
  try {
    r = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    if (soft) return null;
    fail(`The Memo server does not answer at ${base}.`);
  }
  const raw = await r.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  if (!r.ok) {
    // A failure with no JSON body is not from Memo: for example a different program that has the port
    // while the server starts again. memo wait tries again.
    if (soft && (r.status >= 500 || data === null || typeof data !== 'object')) return null;
    fail(data?.error || raw || `The request failed with status ${r.status}.`);
  }
  return data;
}

const OPTIONS = ['from', 'to', 'as', 'impact', 'effort', 'due', 'hold', 'days', 'every', 'after', 'by', 'tag', 'title', 'next', 'limit', 're', 'ws', 'capability'];
// An option that can come more than one time. Its value is a list.
const REPEATED = ['tag'];
function parse(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (!OPTIONS.includes(key)) fail(`${a} is not a known option. Put -- before text that starts with two hyphens.`);
      if (i + 1 >= argv.length) fail(`${a} needs a value.`);
      if (REPEATED.includes(key)) (flags[key] ||= []).push(argv[++i]);
      else flags[key] = argv[++i];
    } else rest.push(a);
  }
  return { flags, rest };
}

const [command, ...argv] = process.argv.slice(2);
const { flags, rest } = parse(argv);
const need = (key) => flags[key] ?? fail(`--${key} is necessary.`);
// A memo id from the command line: a number (906), or a code (OPS-14, in any case). The server resolves a code.
const CODE = /^[A-Za-z][A-Za-z0-9]{1,7}-\d{1,7}$/;
const memoId = (v) => {
  if (typeof v === 'string' && CODE.test(v.trim())) return v.trim().toUpperCase();
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) fail(`The memo id must be a number or a code such as OPS-14. Found: ${v ?? 'nothing'}.`);
  return n;
};
// The number of a memo with its code: "906 OPS-14", or "906" for a memo with no code.
const label = (m) => (m.code ? `${m.id} ${m.code}` : String(m.id));
const query = (v) => encodeURIComponent(v);
const when = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

// The images in the text that a memo brings to the reader: the memo text (not for a memo that the reader sent),
// the notes, and the reply.
const brought = (c, own) => [own ? '' : c.text, c.reply || '', ...(c.notes || []).map((n) => n.text)].join('\n');
const broughtImages = (c, own) => imageNames(brought(c, own));

// An agent cannot see an image in the text, so the client gets each file and gives its local path. The agent
// opens the path with its Read tool. The first directory that the client can write to holds the files.
const imageDirs = [process.env.MEMO_IMAGE_DIR, process.env.MEMO_WORK_DIR && join(process.env.MEMO_WORK_DIR, 'images'), join(root, 'work', 'images'), join(tmpdir(), 'memo-images')].filter(Boolean);
async function localImage(name) {
  for (const dir of imageDirs) if (existsSync(join(dir, name))) return join(dir, name);
  let r;
  try { r = await fetch(`${base}/api/image/${name}`, { headers: { Authorization: `Bearer ${token}` } }); } catch { return null; }
  if (!r.ok) return null;
  const bytes = Buffer.from(await r.arrayBuffer());
  for (const dir of imageDirs) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), bytes, { mode: 0o600 });
      return join(dir, name);
    } catch { /* try the next directory */ }
  }
  return null;
}
// own: the reader sent these memos.
async function showAll(memos, own = false) {
  const out = [];
  for (const c of memos) {
    const lines = [];
    for (const name of broughtImages(c, own)) {
      const path = await localImage(name);
      lines.push(path ? `Image ${name} is the file ${path}. Open the file to see the image.` : `Image ${name}: memo could not get the file. Run the command again.`);
    }
    // A file can be 20 MB, so the client gets it only on request.
    for (const f of fileLinks(brought(c, own))) lines.push(`File "${f.label}" is attached. To get it, run: memo file ${f.name}`);
    // A video is kept 48 hours, or until its memo closes: the line says when it goes. Its still frames are the images above.
    for (const v of videoLinks(brought(c, own))) lines.push(await videoLine(v));
    out.push(show(c) + (lines.length ? `${lines.join('\n')}\n` : ''));
  }
  return out.join('\n');
}

// The line of `memo list` for a video: its state from the server, so the agent knows how long it has to get it.
async function videoLine({ name, label }) {
  let meta = null;
  try {
    const r = await fetch(`${base}/api/video/${name}/meta`, { headers: { Authorization: `Bearer ${token}` } });
    meta = r.ok ? await r.json() : r.status === 404 ? { deleted: true } : null;
  } catch { /* no server: no state */ }
  if (!meta) return `Video "${label}" is attached (Memo keeps a video 48 hours, or until the memo closes). To get it, run: memo file ${name}`;
  if (meta.deleted) return `Video "${label}" was attached and is deleted (Memo keeps a video 48 hours, or until the memo closes). Its still frames are the images above, if any.`;
  return `Video "${label}" is attached, ${expiryWords(meta.expires)} (${when(meta.expires)}, or when the memo closes). To get it, run: memo file ${name}`;
}

// The original name from a Content-Disposition header: filename* (UTF-8) if it is there.
function originalName(header) {
  const star = String(header || '').match(/filename\*=UTF-8''([^;]+)/i);
  if (star) { try { return decodeURIComponent(star[1]); } catch { /* use the plain name */ } }
  return String(header || '').match(/filename="([^"]*)"/i)?.[1] || '';
}

// A path in dir for the file that does not overwrite a different file: "report.pdf", then "report (2).pdf".
function freePath(dir, fileName, bytes) {
  const ext = fileName.match(/\.[^.]+$/)?.[0] || '';
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let n = 1; ; n++) {
    const path = join(dir, n === 1 ? fileName : `${stem} (${n})${ext}`);
    if (!existsSync(path)) return path;
    try { if (readFileSync(path).equals(bytes)) return path; } catch { /* a directory or no access: try the next name */ }
  }
}

function show(c) {
  const head = `#${label(c)} from ${c.sender} to ${c.recipient}, ${when(c.created)}`
    + (c.impact != null ? `, impact ${c.impact}, effort ${c.effort}` : '')
    + (c.due ? `, due ${c.due}` : '')
    + (c.tags?.length ? `, tags ${c.tags.join(' ')}` : '')
    + (c.until ? `, postponed until ${when(c.until)}` : '')
    + (c.state !== 'open' ? `, ${c.state}` : '');
  const notes = (c.notes || []).map((n) => `Note from ${n.author}, ${when(n.created)}${n.read ? '' : ' (not read)'}: ${n.text}\n`).join('');
  return `${head}\n${c.text}\n${notes}${c.reply ? `Reply: ${c.reply}\n` : ''}`;
}

async function setTags(on) {
  const id = memoId(rest[0]);
  const names = rest.slice(1);
  if (!names.length) fail('Give one tag or more.');
  let memo;
  for (const tag of names) memo = await call('/api/tag', { id, tag, on, by: flags.as });
  console.log(`Memo ${id} has the tags: ${memo.tags.length ? memo.tags.join(' ') : 'none'}.`);
}

const commands = {
  async send() {
    const r = await call('/api/send', {
      from: need('from'), to: need('to'), text: rest.join(' '),
      capability: flags.capability,
      impact: flags.impact === undefined ? undefined : Number(flags.impact),
      effort: flags.effort, due: flags.due, tags: flags.tag, title: flags.title, next: flags.next, re: flags.re, ws: flags.ws,
    });
    console.log(`Memo ${label(r.memo)} is sent to ${r.memo.recipient}.${r.memo.tags?.length ? ` Tags: ${r.memo.tags.join(' ')}.` : ''}`);
    if (r.corrections.length) {
      console.log('The owner changed the impact of your last memos. Use this when you select an impact:');
      for (const k of r.corrections) console.log(`  memo ${k.memo_id}: ${k.old_impact} to ${k.new_impact} ("${k.text.replace(/\s+/g, ' ')}")`);
    }
  },
  async reply() {
    const id = memoId(rest[0]);
    const m = await call('/api/reply', { id, text: rest.slice(1).join(' '), by: flags.as });
    console.log(`Memo ${label(m)} has the reply.`);
  },
  async edit() {
    const id = memoId(rest[0]);
    const m = await call('/api/edit', { id, text: rest.slice(1).join(' '), by: flags.as });
    console.log(`Memo ${label(m)} has the new text.`);
  },
  // The brief of an open memo for the compact view of the Inbox. An empty value removes that part.
  async brief() {
    const id = memoId(rest[0]);
    if (rest.length > 1) fail('Give the brief with --title and --next.');
    const m = await call('/api/brief', { id, title: flags.title, next: flags.next, by: flags.as });
    console.log(`Memo ${label(m)} has the brief: ${m.title || '(no title)'} · next: ${m.next || '(no next step)'}.`);
  },
  // A message in an open memo to the owner. The memo stays open.
  async note() {
    const id = memoId(rest[0]);
    const m = await call('/api/note', { id, from: need('from'), text: rest.slice(1).join(' ') });
    console.log(`Memo ${label(m)} has the note. It stays open.`);
  },
  // The owner asked for a short memo: the old memo closes, and a new memo with the new text takes its place.
  async compact() {
    const id = memoId(rest[0]);
    const r = await call('/api/compact', { id, from: need('from'), text: rest.slice(1).join(' '), title: flags.title, next: flags.next });
    console.log(`Memo ${label(r.old)} is compacted into memo ${label(r.memo)}.`);
  },
  async close() {
    const id = memoId(rest[0]);
    const m = await call('/api/close', { id, text: rest.slice(1).join(' ') || undefined, by: flags.as });
    console.log(`Memo ${label(m)} is closed.`);
  },
  async ack() {
    const ids = (rest.length ? rest : [undefined]).map(memoId);
    const read = [];
    for (const id of ids) read.push(label(await call('/api/ack', { id, by: flags.as })));
    console.log(`Marked as read: ${read.join(', ')}.`);
  },
  async forward() {
    const id = memoId(rest[0]);
    const r = await call('/api/forward', { id, to: flags.to });
    console.log(`Memo ${label(r.memo)} is sent to ${r.memo.recipient} with the text of memo ${id}.`);
  },
  // Tags of a memo to the owner, for the filter of the Inbox. For example: memo tag 42 work money
  async tag() { await setTags(true); },
  async untag() { await setTags(false); },
  // Takes a memo out of the Inbox until 9:00 AM (the owner's time) on the date. "now" brings it back.
  // The sender gets no news from a postpone.
  async postpone() {
    const id = memoId(rest[0]);
    const date = rest[1];
    if (!date) fail('Give the date (YYYY-MM-DD), or now.');
    const r = await call('/api/postpone', { id, date: date === 'now' ? null : date, by: flags.as });
    console.log(r.until ? `Memo ${id} is postponed until ${when(r.until)}.` : `Memo ${id} is back in the Inbox.`);
  },
  // The time zone of the browser in which the owner last opened the Inbox, and when, in that zone's own time.
  // For example: America/New_York, seen 2026-10-22 09:14
  async tz() {
    const r = await call('/api/client-tz');
    if (!r.timeZone) return console.log('No time zone yet. The Inbox sends it each time the owner opens it.');
    const p = {};
    for (const { type, value } of new Intl.DateTimeFormat('en-US', { timeZone: r.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(r.seen))) p[type] = value;
    console.log(`${r.timeZone}, seen ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`);
  },
  async status() {
    await call('/api/status', { agent: need('as'), text: rest.join(' ') });
    console.log('The status is saved.');
  },
  // The helpers (subagents) of an agent, under the agent on the Agents page. The label is one or more words;
  // for start, the last word is the model, with its version: memo helper --as main start "Vault sync" "fable 5.1"
  // or claude-fable-5-1. A version typed as its own word, `fable 5.1` with no quotes, is part of the model, not of
  // the label. The server stores the short form, "Fable 5.1" (src/models.js). A bare alias still works, and the
  // command then says to pass the version (memo 1159).
  async helper() {
    const agent = need('as');
    const [action, ...words] = rest;
    if (action === 'start') {
      const split = words.length >= 2 && VERSION_WORD.test(words.at(-1)) && FAMILY_WORD.test(words.at(-2)) ? 2 : 1;
      if (words.length <= split) fail('Give the label and the model: memo helper --as <agent> start <label> <model>');
      const r = await call('/api/helper/start', { agent, label: words.slice(0, -split).join(' '), model: words.slice(-split).join(' ') });
      console.log(`The helper "${r.label}" (${r.model}) of ${agent} runs.`);
      if (!modelVersioned(r.model)) console.log(`Give the model with its version next time, so the Inbox shows it: for example "fable 5.1" or claude-fable-5-1 in the place of "${r.model}".`);
    } else if (action === 'done') {
      if (!words.length) fail('Give the label: memo helper --as <agent> done <label>');
      const r = await call('/api/helper/done', { agent, label: words.join(' ') });
      console.log(`The helper "${r.label}" of ${agent} is done.`);
    } else if (action === 'list') {
      const me = (await call('/api/agents')).find((a) => a.name === agent);
      if (!me) fail(`No agent has the name ${agent}.`);
      if (!me.helpers.length) console.log(`No helpers of ${agent} in the last day.`);
      for (const h of me.helpers) console.log(`${h.running ? 'Running' : 'Done'}: ${h.label} (${h.model}), ${h.running ? `since ${when(h.started)}` : `${when(h.started)} to ${when(h.ended)}`}`);
    } else fail(USAGE);
  },
  async recap() {
    await call('/api/recap', { agent: need('as'), text: rest.join(' ') });
    console.log('The recap is saved.');
  },
  async list() {
    const memos = await call(`/api/list?to=${query(need('to'))}`);
    if (!memos.length) console.log(`No open memos to ${flags.to}.`);
    if (memos.length) console.log(await showAll(memos));
  },
  // One line for each memo that matches, with the start of its text and its reply. memo show is not needed: the id is enough.
  async search() {
    const words = rest.join(' ').trim();
    if (!words) fail('Give one or more words to search for.');
    const memos = await call(`/api/search?q=${query(words)}${flags.limit ? `&limit=${query(flags.limit)}` : ''}`);
    if (!memos.length) { console.log(`No memo holds: ${words}`); return; }
    const short = (t, n) => { const one = String(t || '').replace(/\s+/g, ' ').trim(); return one.length > n ? `${one.slice(0, n)}...` : one; };
    for (const c of memos) {
      console.log(`#${label(c)} ${c.sender} to ${c.recipient}, ${when(c.created)}, ${c.state}${c.title ? `: ${c.title}` : ''}`);
      console.log(`  ${short(c.text, 240)}`);
      if (c.reply) console.log(`  Reply: ${short(c.reply, 240)}`);
      for (const n of c.notes || []) console.log(`  Note from ${n.author}: ${short(n.text, 160)}`);
    }
  },
  // Stores an image file in Memo and prints the Markdown that shows it. Put the printed text into a memo.
  async image() {
    if (!rest[0]) fail('Give the path of the image file.');
    let bytes;
    try { bytes = readFileSync(rest[0]); } catch { fail(`memo cannot read the file ${rest[0]}.`); }
    let r;
    try {
      r = await fetch(`${base}/api/image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: bytes });
    } catch { fail(`The Memo server does not answer at ${base}.`); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) fail(data.error || `The request failed with status ${r.status}.`);
    console.log(`![${rest.slice(1).join(' ').replace(/[\[\]\n]/g, ' ') || 'image'}](image:${data.name})`);
  },
  // Gets a file (or a video, while Memo still has it) of a memo and saves it in <dir> (default: the current
  // directory) under its original name.
  async file() {
    const name = rest[0];
    if (!name || !(FILE_NAME.test(name) || VIDEO_NAME.test(name))) fail('Give the stored name of the file, for example 0123456789abcdef.pdf (it is in the link of the memo).');
    let r;
    try { r = await fetch(`${base}/api/${VIDEO_NAME.test(name) ? 'video' : 'file'}/${name}`, { headers: { Authorization: `Bearer ${token}` } }); } catch { fail(`The Memo server does not answer at ${base}.`); }
    if (!r.ok) fail((await r.json().catch(() => ({}))).error || `The request failed with status ${r.status}.`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const dir = resolve(rest[1] || '.');
    try { mkdirSync(dir, { recursive: true }); } catch { fail(`memo cannot make the directory ${dir}.`); }
    const path = freePath(dir, safeFileName(originalName(r.headers.get('content-disposition')) || name, extension(name)), bytes);
    try { writeFileSync(path, bytes, { mode: 0o600 }); } catch { fail(`memo cannot write the file ${path}.`); }
    console.log(path);
  },
  async prompt() {
    process.stdout.write(await call(`/api/agent/prompt?name=${query(need('as'))}`));
  },
  // A tick is a small action of the owner that comes back. See "Ticks" in README.md.
  async tick() {
    const [action, ...words] = rest;
    const schedule = (t) => [t.days ? `on ${t.days}` : 'each day', t.every > 1 ? `${t.every} days after the last time` : '', t.after ? `after ${t.after}` : '', t.by ? `by ${t.by}` : ''].filter(Boolean).join(', ');
    const line = (t) => `#${t.id} impact ${t.impact}, effort ${t.effort}, ${schedule(t)}: ${t.text}`;
    const fields = (text) => ({
      text: text || undefined, effort: flags.effort, days: flags.days, after: flags.after, by: flags.by,
      impact: flags.impact === undefined ? undefined : Number(flags.impact),
      every: flags.every === undefined ? undefined : Number(flags.every),
    });
    if (action === 'add') console.log(`The tick is added. ${line(await call('/api/tick/add', fields(words.join(' '))))}`);
    else if (action === 'set') console.log(`The tick has the change. ${line(await call('/api/tick/set', { id: memoId(words[0]), ...fields(words.slice(1).join(' ')) }))}`);
    else if (action === 'remove') { await call('/api/tick/remove', { id: memoId(words[0]) }); console.log(`Tick ${words[0]} is removed.`); }
    else if (action === 'list') {
      const ticks = await call('/api/ticks');
      console.log(ticks.length ? ticks.map(line).join('\n') : 'No ticks are active.');
    } else if (action === 'log') {
      const days = words[0] === undefined ? 7 : Number(words[0]);
      const ticks = await call(`/api/ticks?log=${query(days)}`);
      if (!ticks.length) console.log('No ticks are active.');
      // One letter for each day, the newest day last. d: done. s: skipped. A point: no mark.
      for (const t of ticks) console.log(`${line(t)}\n  ${t.from} to ${t.to}: ${t.states.map((s) => (s === 'done' ? 'd' : s === 'skip' ? 's' : '.')).join('')}  done ${t.done}, skipped ${t.skipped}`);
    } else fail(USAGE);
  },
  async wait() {
    const who = need('as');
    const minutes = rest[0] === undefined ? 10080 : Number(rest[0]);
    if (!(minutes > 0)) fail('The time must be a number of minutes that is more than 0.');
    // --hold takes ids and codes: --hold 12,OPS-14
    const hold = (flags.hold || '').split(',').filter(Boolean).map(memoId);
    const held = (c) => hold.includes(c.id) || (c.code && hold.includes(c.code));
    const interval = Number(process.env.MEMO_WAIT_INTERVAL_MS || 30000);
    const end = Date.now() + minutes * 60000;
    for (;;) {
      const news = await call(`/api/news?for=${query(who)}`, undefined, { soft: true });
      if (news) {
        const fresh = news.to_you.filter((c) => !held(c));
        const noted = news.noted || [];
        if (fresh.length || news.results.length || noted.length) {
          if (fresh.length) console.log(`New memos to ${who}:\n\n${await showAll(fresh)}`);
          if (noted.length) {
            console.log(`Open memos from ${who} with a new note of the owner. Each memo stays open:\n\n${await showAll(noted, true)}`);
            console.log(`Do what each note asks. Answer in the memo with: memo note <id> --from ${who} "<text>". To change the memo text, use memo edit.`);
            console.log(`If no answer is necessary, run: memo ack ${noted.map((c) => c.id).join(' ')}\n`);
          }
          if (news.results.length) {
            console.log(`Results of memos from ${who}:\n\n${await showAll(news.results, true)}`);
            console.log(`After you read the results, run: memo ack ${news.results.map((c) => c.id).join(' ')}`);
          }
          return;
        }
      }
      if (Date.now() + interval > end) {
        console.log(`No news for ${who} in ${minutes} minutes.`);
        process.exit(2);
      }
      await new Promise((done) => setTimeout(done, interval));
    }
  },
};

if (!Object.hasOwn(commands, command ?? '')) fail(USAGE);
if (!token) fail('MEMO_TOKEN is not set. See .env.example.');
await commands[command]();
