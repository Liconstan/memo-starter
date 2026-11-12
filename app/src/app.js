import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { etag } from 'hono/etag';
import { createHash, timingSafeEqual } from 'node:crypto';
import { chmodSync, createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MemoError, SERVER_ACTOR } from './memos.js';
import { disposition } from './files.js';
import { FILE_MAX_BYTES, videoLinks } from '../ui/attach.js';
import { placeTicks } from './ticks.js';
import { dueSoon } from './rank.js';
import { parseCalendar, eventsOn, validZone } from './ical.js';
import { CAPABILITIES, pickSpecialist, taskCapability } from '../ui/specialists.js';
import { pickAgent } from '../ui/agentstate.js';
import { createPetArt, PET_ROUTE } from './pets.js';

// The only files that /ui/<name> gives.
const UI = {
  'filter.js': 'text/javascript; charset=utf-8',
  'common.js': 'text/javascript; charset=utf-8',
  'markdown.js': 'text/javascript; charset=utf-8',
  'keys.js': 'text/javascript; charset=utf-8',
  'attach.js': 'text/javascript; charset=utf-8',
  'feedback.js': 'text/javascript; charset=utf-8',
  'usage.js': 'text/javascript; charset=utf-8',
  'pacing.js': 'text/javascript; charset=utf-8',
  'lightbox.js': 'text/javascript; charset=utf-8',
  'calendar.js': 'text/javascript; charset=utf-8',
  'drafts.js': 'text/javascript; charset=utf-8',
  'agentstate.js': 'text/javascript; charset=utf-8',
  'recent.js': 'text/javascript; charset=utf-8',
  'specialists.js': 'text/javascript; charset=utf-8',
  'blocked.js': 'text/javascript; charset=utf-8',
  'pets.js': 'text/javascript; charset=utf-8',
  'petview.js': 'text/javascript; charset=utf-8',
  'theme.js': 'text/javascript; charset=utf-8',
  'place.js': 'text/javascript; charset=utf-8',
  'sendstage.js': 'text/javascript; charset=utf-8',
  'common.css': 'text/css; charset=utf-8',
  // The home screen icon, tab icon, and sidebar logo: a 180 px crop of an illustration of the cat Peeve.
  'icon.png': 'image/png',
};
const LIAISON = 'liaison';
const digest = (s) => createHash('sha256').update(s).digest();
const same = (a, b) => timingSafeEqual(digest(a), digest(b));

// ticksOn: the ticks are an optional part. They are off unless MEMO_TICKS is set (see README.md).
// schedulePath: the file of the Scheduled view, local/schedule.json (MEMO_LOCAL gives a different directory).
// The Today card of the Inbox reads the calendar of the owner from its secret iCal address (MEMO_CALENDAR_ICS, or
// data/calendars.json for an address added on the Inbox page). The server keeps the text 5 minutes. The address is a
// secret: it never goes into a log or an answer.
const CALENDAR_CACHE_MS = 5 * 60 * 1000;
export async function fetchCalendar(url) {
  const r = await fetch(url.replace(/^webcals?:\/\//i, 'https://'), { signal: AbortSignal.timeout(15000), redirect: 'follow' });
  if (!r.ok) throw new Error(`Google Calendar gave status ${r.status}.`);
  return r.text();
}
// A secret address of Google Calendar, as the page may add it: https:// or webcal://, the iCal path, .ics at the end, one piece.
const CALENDAR_ADDRESS = /^(https|webcal):\/\/calendar\.google\.com\/calendar\/ical\/[^\s,]+\.ics$/;
const CALENDAR_HELP = 'That is not a Google Calendar secret address. In Google Calendar on the web: Settings, click your calendar, Integrate calendar, then copy Secret address in iCal format.';
// The address of the owner, from a secret address: the id of a primary calendar (the segment after /calendar/ical/) is
// her email. A group calendar (xxx@group.calendar.google.com) has no owner; it gives ''. Only the decoded id is kept, in memory.
export function calendarOwner(url) {
  const m = /\/calendar\/ical\/([^/]+)\//i.exec(url);
  if (!m) return '';
  let id;
  try { id = decodeURIComponent(m[1]); } catch { return ''; }
  return id.includes('@') && !/calendar\.google\.com$/i.test(id) ? id : '';
}

// The secret addresses that the owner added on the Inbox page: data/calendars.json, {"urls": [...]}, mode 600. No file,
// or a file that does not parse, gives none. The Today card and the meeting follow-ups (src/followups.js) both read it here.
export function pageCalendars(dataDir) {
  try {
    const { urls } = JSON.parse(readFileSync(join(dataDir, 'calendars.json'), 'utf8'));
    return Array.isArray(urls) ? urls.filter((u) => typeof u === 'string') : [];
  } catch { return []; }
}
// The addresses of MEMO_CALENDAR_ICS: several secret addresses, separated by commas or spaces.
export const envCalendars = (value) => (value ? String(value).split(/[\s,]+/).filter(Boolean) : []);

// calendarUrl: the secret iCal address of the calendar of the owner, or nothing. getCalendar: gets its text (a test gives its own).
// dataDir: the directory of data/client-tz.json, the time zone of the browser of the owner, and of data/calendars.json.
// system: the System page (src/system.js), or nothing.
// videos: the store of videos (src/videos.js), or nothing: then a video upload is refused. frames: the still frames of
// a video (src/frames.js), or nothing: then a video comes with no frames.
export function createApp({ store, agents, images, files, videos, frames, ticks, ticksOn = false, system, root, token, liaisonToken, owner = 'owner', tailscale, now = () => new Date(),
  schedulePath = join(process.env.MEMO_LOCAL || join(root, 'local'), 'schedule.json'),
  calendarUrl, getCalendar = fetchCalendar, dataDir = join(root, 'data'),
  // ledgerPage: the address of the GitHub Pages Inbox (README.md, "Inbox from anywhere"), or nothing. It is only for the
  // setup link that the Agents page makes ("Set up phone").
  // onDraft: runs after each saved draft (POST /api/draft), so the ledger publishes it to the phone at once.
  // started: the time of the start of this server. GET /api/queue gives it, so a page that is open across a restart
  // loads itself again (ui/inbox.html): the pages and ui/ come from disk at each request, the routes come with a start.
  // petsDir: the folder of the pictures of the pets (README.md, "Pictures of the pets"); the default is
  // ~/memo-pets. The folder need not exist: then every pet is drawn in code.
  ledgerPage, onDraft, started = new Date().toISOString(), petsDir }) {
  const app = new Hono();
  const petArt = createPetArt({ dir: petsDir, now });

  app.onError((err, c) => {
    if (err instanceof MemoError) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'The server has an error. See data/server.log.' }, 500);
  });

  // The short tailnet name (for example http://memo/inbox, through Tailscale Serve on port 80) goes to the full
  // HTTPS name. There the browser keeps the token and the Tailscale check applies. A redirect gives no data.
  if (tailscale) {
    const short = tailscale.host.split('.')[0];
    app.use('*', async (c, next) => {
      const host = c.req.header('Host') || '';
      if (host !== short && host !== `${short}:80`) return next();
      const url = new URL(c.req.url);
      return c.redirect(`https://${tailscale.host}${url.pathname}${url.search}`, 308);
    });
  }

  app.get('/health', (c) => c.json({ ok: true }));
  app.get('/', (c) => c.redirect('/inbox'));
  // The pages talk only to this server. A frame of a memo has no src (it uses srcdoc in a sandbox), so frame-src is 'none'.
  const PAGE_RULE = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; "
    + "connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";
  // A page gets the name of the owner in the place of __OWNER__.
  const fill = (text) => text.replaceAll('__OWNER__', owner);
  const page = (file) => (c) => c.html(fill(readFileSync(join(root, 'ui', file), 'utf8')), 200, { 'Content-Security-Policy': PAGE_RULE });
  // The pages and the files of ui/ are read from disk at each request. A browser keeps a copy only with a check at each
  // use (no-cache, with an ETag): a refresh always gets the files of this moment, in one short 304 when nothing changed.
  const fresh = async (c, next) => { await next(); c.header('Cache-Control', 'no-cache'); };
  app.use('/inbox', fresh, etag());
  app.use('/agents', fresh, etag());
  app.use('/system', fresh, etag());
  app.use('/ui/*', fresh, etag());
  // A picture of a pet from the pets folder: /ui/pet/<agent>/<feeling>, the file <agent>-<feeling>.webp (or .gif,
  // .png, .jpg, in that order), or <agent>.webp with no file for that feeling; "any" asks for the plain one. With
  // ?still=1 the still file of the same stem goes out when there is one (for reduced motion). The two names are checked
  // against a fixed form and the fixed list of feelings before they touch a path, so the route gives only files of
  // that folder.
  app.get(PET_ROUTE, (c) => {
    const found = petArt.file(c.req.param('agent'), c.req.param('feeling'), { still: c.req.query('still') === '1' });
    return found ? c.body(found.bytes, 200, { 'Content-Type': found.type, 'X-Content-Type-Options': 'nosniff' }) : c.notFound();
  });
  app.get('/inbox', page('inbox.html'));
  app.get('/agents', page('agents.html'));
  app.get('/system', page('system.html'));
  app.get('/ui/:file', (c) => {
    const file = c.req.param('file');
    // The picture of the owner lives in local/ (git ignores it), so a personal photo never goes into the repository.
    if (file === 'owner.png') {
      const path = join(root, 'local', 'owner.png');
      return existsSync(path) ? c.body(readFileSync(path), 200, { 'Content-Type': 'image/png' }) : c.notFound();
    }
    if (!Object.hasOwn(UI, file)) return c.notFound();
    // The place of the day and night theme: local/place.js (git ignores it; `npm run setup` writes it), or the example.
    if (file === 'place.js' && existsSync(join(root, 'local', 'place.js'))) return c.body(readFileSync(join(root, 'local', 'place.js'), 'utf8'), 200, { 'Content-Type': UI[file] });
    const binary = !UI[file].includes('charset');
    return c.body(readFileSync(join(root, 'ui', file), binary ? undefined : 'utf8'), 200, { 'Content-Type': UI[file] });
  });

  // Tailscale Serve sets Tailscale-User-Login and removes a value that the client sent. The owner then needs no token.
  // The Host must be the Tailscale name, so a page that points its own name at this server (DNS rebinding) gets nothing.
  // The Origin and Sec-Fetch-Site checks stop a page of a different site that sends a request from the browser of the owner.
  const fromOwnerTailnet = (c) => {
    if (!tailscale) return false;
    const header = (name) => c.req.header(name) || '';
    if (!same(header('Tailscale-User-Login'), tailscale.login) || header('Host') !== tailscale.host) return false;
    if (header('Origin') && header('Origin') !== `https://${tailscale.host}`) return false;
    return !header('Sec-Fetch-Site') || header('Sec-Fetch-Site') === 'same-origin';
  };

  app.use('/api/*', async (c, next) => {
    const given = (c.req.header('Authorization') || '').replace(/^Bearer\s*/, '');
    if (given && same(given, token)) c.set('role', 'full');
    else if (given && liaisonToken && same(given, liaisonToken)) c.set('role', LIAISON);
    else if (!given && fromOwnerTailnet(c)) c.set('role', 'full');
    else throw new MemoError(401, 'The token is missing or wrong.');
    await next();
  });

  // The liaison run reads text from other people. Its token can do only what `permitted` says.
  const only = (c, permitted) => {
    if (c.get('role') !== 'full' && !permitted) throw new MemoError(403, 'This token cannot do that.');
  };
  const body = async (c) => {
    let b = null;
    try { b = await c.req.json(); } catch { /* handled below */ }
    if (!b || typeof b !== 'object' || Array.isArray(b)) throw new MemoError(400, 'The request body must be a JSON object.');
    return b;
  };
  // The actor of a change, for the event log (src/memos.js who): the name in `by` of the request (the Inbox page
  // gives the owner, memo ... --as gives the agent), or nothing: then the store takes the party the change belongs
  // to. The liaison token is always the liaison.
  // No request can name the server as the actor.
  const by = (c, b) => {
    if (b.by === SERVER_ACTOR) throw new MemoError(400, `by cannot be ${SERVER_ACTOR}.`);
    return c.get('role') === 'full' ? b.by : LIAISON;
  };

  app.post('/api/send', async (c) => {
    const b = await body(c);
    only(c, b.from === LIAISON && b.to === owner);
    if (c.get('role') !== 'full') delete b.trusted;
    if (b.capability !== undefined && !CAPABILITIES.includes(b.capability)) throw new MemoError(400, 'Unknown capability. Use general, image-generation or computer-use.');
    if (b.to === 'auto') {
      const capability = b.capability || taskCapability(b.text);
      const available = agents.list();
      const picked = capability === 'general' ? pickAgent(available, { task: b.text }) : pickSpecialist(available, capability);
      if (!picked?.name) throw new MemoError(409, `No verified worker is available for ${capability}. Select an agent explicitly or wait for the desktop connection.`);
      b.to = picked.name;
    }
    const sent = store.send(b);
    // A long agent that sits idle at its prompt gets a nudge to read its queue. See agents.arrived.
    // nudged: the server typed that wake-up (or queued the wakeup of a desktop worker), so the Inbox can say so in the
    // line that follows a memo from Send to its agent (memo 1407, ui/sendstage.js).
    const nudged = agents.arrived(sent.memo.recipient) === true;
    return c.json(nudged ? { ...sent, nudged } : sent);
  });
  // A memo that ends (a reply, a close, a compact) takes its videos with it: each video it links to is deleted now,
  // unless another open memo still links to it. The still frames are images and stay. carried: the text that ends
  // the memo (the reply). A video that this text links to is new, so it stays and lives its 48 hours.
  const releaseVideos = (memo, carried = '') => {
    if (!videos) return;
    const text = [memo.text, memo.reply || '', ...(memo.notes || []).map((n) => n.text)].join('\n');
    const fresh = new Set(videoLinks(carried).map((v) => v.name));
    for (const { name } of videoLinks(text)) {
      if (fresh.has(name) || store.holdsOpen(`video:${name}`)) continue;
      try { videos.remove(name); } catch (err) { console.error(`video ${name}: ${err.message}`); }
    }
  };
  app.post('/api/reply', async (c) => {
    const b = await body(c);
    only(c, false);
    const memo = store.reply(b.id, b.text, by(c, b));
    agents.arrived(memo.sender);
    releaseVideos(memo, memo.reply);
    return c.json(memo);
  });
  app.post('/api/close', async (c) => {
    const b = await body(c);
    only(c, store.get(b.id).recipient === LIAISON);
    const memo = store.close(b.id, b.text, by(c, b));
    agents.arrived(memo.sender);
    releaseVideos(memo, memo.reply || '');
    return c.json(memo);
  });
  app.post('/api/edit', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.edit(b.id, b.text, by(c, b)));
  });
  app.post('/api/brief', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.brief(b.id, { title: b.title, next: b.next }, by(c, b)));
  });
  app.post('/api/note', async (c) => {
    const b = await body(c);
    only(c, false);
    const memo = store.note(b.id, b.from, b.text);
    // A note of the owner is news for the sender of the memo.
    if (b.from === owner) agents.arrived(memo.sender);
    return c.json(memo);
  });
  // The sender (from) closes an open memo to the owner and sends a short new memo in its place.
  app.post('/api/compact', async (c) => {
    const b = await body(c);
    only(c, false);
    const done = store.compact(b.id, b.from, { text: b.text, title: b.title, next: b.next });
    releaseVideos(done.old);
    return c.json(done);
  });
  app.post('/api/seen', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.seen(b.ids));
  });
  app.post('/api/check', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.check(b.id, b.n, b.on));
  });
  app.post('/api/adjust', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.adjust(b.id, b.delta, by(c, b)));
  });
  app.post('/api/tag', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.tag(b.id, b.tag, b.on, by(c, b)));
  });
  // date: YYYY-MM-DD, or null to bring the memo back now.
  app.post('/api/postpone', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(store.postpone(b.id, b.date ?? null, by(c, b)));
  });
  app.get('/api/postponed', (c) => {
    only(c, false);
    return c.json(store.postponed());
  });
  // Read only: the thread of a memo, for the Back and Forward buttons of the open memo (README.md, "The thread of a memo").
  app.get('/api/thread', (c) => {
    only(c, false);
    return c.json(store.thread(c.req.query('id')));
  });
  // Read only: the threads of the open memos to the owner, by memo id, for the ledger.
  app.get('/api/threads', (c) => {
    only(c, false);
    return c.json(store.threads());
  });
  // Read only: the memos that the owner answered or closed in the last 7 days.
  app.get('/api/answered', (c) => {
    only(c, false);
    return c.json(store.answered());
  });
  // Read only: the list of the things that run on a schedule, local/schedule.json. The agent edits the file by hand,
  // so the server reads it on each request. No file: an empty list. This route gives only that one file.
  app.get('/api/schedule', (c) => {
    only(c, false);
    let text;
    try { text = readFileSync(schedulePath, 'utf8'); } catch (err) {
      if (err.code === 'ENOENT') return c.json({ items: [] });
      throw err;
    }
    let data;
    try { data = JSON.parse(text); } catch (err) {
      return c.json({ error: `local/schedule.json is not valid JSON: ${err.message}` }, 500);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.items)) {
      return c.json({ error: 'local/schedule.json must be a JSON object with an "items" list.' }, 500);
    }
    return c.json(data);
  });
  // The time zone of the browser of the owner. The Inbox sends it at each load, so the agents know where the owner is
  // (memo tz). The file is data/client-tz.json: {"timeZone": "America/New_York", "seen": "<ISO time>"}.
  const tzPath = join(dataDir, 'client-tz.json');
  const clientTz = () => {
    try { return JSON.parse(readFileSync(tzPath, 'utf8')); } catch { return { timeZone: null, seen: null }; }
  };
  app.post('/api/client-tz', async (c) => {
    const b = await body(c);
    only(c, false);
    if (!validZone(b.timeZone)) throw new MemoError(400, 'timeZone must be an IANA time zone name, for example America/New_York.');
    const data = { timeZone: b.timeZone, seen: now().toISOString() };
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(tzPath, `${JSON.stringify(data)}\n`);
    // The page sends its zone at each load: the event log keeps the time, for the time the owner takes to answer.
    store.inboxLoaded({ time_zone: b.timeZone });
    return c.json(data);
  });
  app.get('/api/client-tz', (c) => {
    only(c, false);
    return c.json(clientTz());
  });
  // Read only: the events of one day of the calendar of the owner. ?date=YYYY-MM-DD; ?tz= the zone of that day
  // (default: the last zone of the browser, then that of this computer).
  let calendarCache = null; // { at, cals }
  // MEMO_CALENDAR_ICS can hold several secret addresses, separated by commas or spaces: for example a work and a personal calendar.
  const envUrls = envCalendars(calendarUrl);
  // The addresses that the owner added on the Inbox page are in data/calendars.json: {"urls": [...]}, mode 600.
  // The server reads the file each time it gets the calendars again, so an address added on the page counts with no restart.
  const calendarsPath = join(dataDir, 'calendars.json');
  const pageUrls = () => pageCalendars(dataDir);
  const savePageUrls = (urls) => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(calendarsPath, `${JSON.stringify({ urls })}\n`, { mode: 0o600 });
    chmodSync(calendarsPath, 0o600);
    calendarCache = null;
  };
  // All the addresses, those of .env first. The place of an address in this list names it to the owner ("Calendar 2").
  const allUrls = () => [...envUrls, ...pageUrls()];
  app.get('/api/calendar', async (c) => {
    only(c, false);
    const calendarUrls = allUrls();
    if (!calendarUrls.length) return c.json({ configured: false });
    const date = c.req.query('date') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new MemoError(400, 'date must be YYYY-MM-DD.');
    const zone = c.req.query('tz') || clientTz().timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!validZone(zone)) throw new MemoError(400, 'tz must be an IANA time zone name.');
    if (!calendarCache || now() - calendarCache.at > CALENDAR_CACHE_MS) {
      const cals = [];
      for (const [i, url] of calendarUrls.entries()) {
        // With more than one calendar, the message says which one, by its place in the list (the Inbox page shows the same number).
        const which = calendarUrls.length > 1 ? `Calendar ${i + 1} did not load.` : 'The calendar did not load.';
        let text;
        // The message never has the address: the error of fetch can contain it.
        try { text = await getCalendar(url); } catch (err) {
          const known = /^Google Calendar gave status \d+\.$/.test(err?.message || '') ? err.message : 'Google Calendar did not answer.';
          return c.json({ error: `${which} ${known}` }, 502);
        }
        if (!/BEGIN:VCALENDAR/i.test(text)) return c.json({ error: `${which} The answer is not an iCal calendar; check the address.` }, 502);
        cals.push({ cal: parseCalendar(text), self: calendarOwner(url) });
      }
      calendarCache = { at: now(), cals };
    }
    // The events of all the calendars in one list. An event that is on two calendars (the same title, start and end) shows once.
    const seen = new Set();
    const events = calendarCache.cals.flatMap(({ cal, self }) => eventsOn(cal, date, zone, { self })).filter((e) => {
      const key = `${e.title}|${e.start}|${e.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => (b.allDay - a.allDay) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title));
    return c.json({ configured: true, date, timeZone: zone, events });
  });
  // The calendars of the Today card, for the form on the Inbox page: how many, and which ones the page may remove
  // (source "page"; an address of MEMO_CALENDAR_ICS has source "env"). No answer of these routes has an address or a part of one.
  const calendarList = () => {
    const items = allUrls().map((url, index) => ({ index, source: index < envUrls.length ? 'env' : 'page' }));
    return { count: items.length, items };
  };
  app.get('/api/calendars', (c) => {
    only(c, false);
    return c.json(calendarList());
  });
  app.post('/api/calendars/add', async (c) => {
    const b = await body(c);
    only(c, false);
    const url = typeof b.url === 'string' ? b.url.trim() : '';
    if (!CALENDAR_ADDRESS.test(url)) throw new MemoError(400, CALENDAR_HELP);
    if (allUrls().includes(url)) throw new MemoError(409, 'That calendar is already in Memo.');
    savePageUrls([...pageUrls(), url]);
    return c.json(calendarList());
  });
  app.post('/api/calendars/remove', async (c) => {
    const b = await body(c);
    only(c, false);
    const urls = pageUrls();
    const at = Number.isInteger(b.index) ? b.index - envUrls.length : -1;
    if (at < 0 || at >= urls.length) throw new MemoError(400, 'Only a calendar added on this page can be removed here. One from .env goes out of MEMO_CALENDAR_ICS.');
    urls.splice(at, 1);
    savePageUrls(urls);
    return c.json(calendarList());
  });
  app.post('/api/ack', async (c) => {
    const b = await body(c);
    only(c, store.get(b.id).sender === LIAISON);
    return c.json(store.ack(b.id, by(c, b)));
  });
  app.post('/api/forward', async (c) => {
    const b = await body(c);
    const sent = store.forward(b.id, b.to ?? agents.defaultAgent());
    agents.arrived(sent.memo.recipient);
    return c.json(sent);
  });
  app.post('/api/status', async (c) => {
    const b = await body(c);
    only(c, b.agent === LIAISON);
    return c.json(agents.setStatus(b.agent, b.text));
  });
  app.post('/api/recap', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(agents.recap(b.agent, b.text));
  });
  // The helpers (subagents) of an agent, for the Agents page. As the status line, the liaison can set only its own.
  app.post('/api/helper/start', async (c) => {
    const b = await body(c);
    only(c, b.agent === LIAISON);
    return c.json(agents.startHelper(b.agent, b.label, b.model));
  });
  app.post('/api/helper/done', async (c) => {
    const b = await body(c);
    only(c, b.agent === LIAISON);
    return c.json(agents.endHelper(b.agent, b.label));
  });
  app.post('/api/agent/start', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(agents.start(b.name));
  });
  app.post('/api/agent/stop', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(agents.stop(b.name, { now: b.now === true }));
  });
  app.post('/api/agent/answer', async (c) => {
    const b = await body(c);
    only(c, false);
    return c.json(agents.answer(b.name, b.key));
  });
  app.get('/api/list', (c) => {
    const to = c.req.query('to');
    only(c, to === LIAISON);
    // The client shows the postponed memos of the owner too, with their return time.
    return c.json(store.list(to, { withPostponed: true }));
  });
  // Read only: memos that hold each word of q. Not for the liaison token, which reads text from other people.
  app.get('/api/search', (c) => {
    only(c, false);
    return c.json(store.search(c.req.query('q'), { limit: c.req.query('limit') }));
  });
  // Read only: all memos in a short form, for the ledger copy that the cloud agent searches.
  app.get('/api/archive', (c) => {
    only(c, false);
    return c.json(store.archive());
  });
  app.get('/api/news', (c) => {
    const who = c.req.query('for');
    only(c, who === LIAISON);
    const news = store.news(who);
    // No news: the agent keeps waiting (memo wait asks again in 30 seconds). News: it goes to work.
    agents.contact(who, { wait: !(news.to_you.length || news.results.length || news.noted.length) });
    return c.json(news);
  });
  // Each agent carries `art`: the pictures of its pet in the pets folder, { any, feelings } or null (src/pets.js).
  app.get('/api/agents', (c) => {
    only(c, false);
    return c.json(agents.list().map((a) => ({ ...a, art: petArt.of(a.name) })));
  });
  // The Inbox: the open memos to the owner in their order, and the ticks of now with their places in that order.
  app.get('/api/queue', (c) => {
    only(c, false);
    const memos = store.list(owner);
    return c.json({
      memos,
      ticks: ticksOn ? placeTicks(memos, ticks.due(), dueSoon(now())) : [],
      // For the "Postponed (n)" button, and for the dates of the postpone picker.
      postponed: store.postponed().length,
      timeZone: store.timeZone,
      // The unsent reply text of each memo, so the same draft is on the phone and on the computer (README.md, "Drafts").
      drafts: store.drafts(),
      // By memo id, the time of the owner's latest action tied to the memo: the Inbox marks the latest in green and
      // the next few in gold (memo 1236; ui/recent.js).
      fired: store.fired(memos),
      // The time of the start of this server: a page from before a restart loads itself again.
      started,
    });
  });
  // The owner typed in the reply field of a memo: the Inbox saves the text as a draft, with the time of the change.
  // An older draft never replaces a newer one; an empty text removes the draft. The answer is the draft that is stored.
  app.post('/api/draft', async (c) => {
    const b = await body(c);
    only(c, false);
    const saved = store.draft(b.id, b.text, b.updated);
    onDraft?.(saved);
    return c.json(saved);
  });
  const needTicks = () => {
    if (!ticksOn) throw new MemoError(400, 'Ticks are off. To use them, set MEMO_TICKS=1 in .env and start the server again.');
  };
  app.get('/api/ticks', (c) => {
    only(c, false);
    needTicks();
    return c.json(c.req.query('log') ? ticks.log(Number(c.req.query('log'))) : ticks.list());
  });
  const tick = (path, fn) => app.post(`/api/tick/${path}`, async (c) => {
    const b = await body(c);
    only(c, false);
    needTicks();
    return c.json(fn(b));
  });
  tick('add', (b) => ticks.add(b));
  tick('set', (b) => ticks.set(b.id, b));
  tick('adjust', (b) => ticks.adjust(b.id, b.delta));
  tick('remove', (b) => ticks.remove(b.id));
  tick('done', (b) => ticks.done(b.id));
  tick('skip', (b) => ticks.skip(b.id));
  tick('undo', (b) => ticks.undo(b.id));
  // An image for a memo. The pages get it with the token, so a memo can show a screenshot and stay private.
  app.post('/api/image', async (c) => {
    only(c, false);
    return c.json(images.save(await c.req.arrayBuffer()));
  });
  app.get('/api/image/:name', (c) => {
    only(c, false);
    const { bytes, type } = images.read(c.req.param('name'));
    return c.body(bytes, 200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=31536000, immutable' });
  });
  // A file for a memo (PDF, Office, or text). The name of the file on the computer of the owner is in ?name=.
  // A body over the limit stops early, so a large upload does not fill the memory.
  const fileLimit = bodyLimit({ maxSize: FILE_MAX_BYTES, onError: (c) => c.json({ error: 'A file must be 20 MB or smaller.' }, 413) });
  app.post('/api/file', fileLimit, async (c) => {
    only(c, false);
    return c.json(files.save(await c.req.arrayBuffer(), c.req.query('name') || ''));
  });
  // Always a download with a fixed type: the browser never shows a file as a page.
  app.get('/api/file/:name', (c) => {
    only(c, false);
    const { bytes, type, original } = files.read(c.req.param('name'));
    return c.body(bytes, 200, {
      'Content-Type': type, 'Content-Disposition': disposition(original), 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=31536000, immutable',
    });
  });
  // A video for a memo (README.md, "A video from the owner"). The body goes to the disk as a stream, never into
  // memory; the type comes from the first bytes; the limit is 500 MB. The answer has the name, the original name,
  // the time of the delete, and the still frames that were made of it, as stored images: {image, seconds}.
  const needVideos = () => { if (!videos) throw new MemoError(400, 'This server does not take videos.'); return videos; };
  app.post('/api/video', async (c) => {
    only(c, false);
    const saved = await needVideos().save(c.req.raw.body, c.req.query('name') || '', { length: c.req.header('Content-Length') });
    const made = [];
    if (frames) {
      for (const f of await frames.make(saved.path)) {
        try { made.push({ image: images.save(f.bytes).name, seconds: f.seconds }); } catch (err) { console.error(`video frame: ${err.message}`); }
      }
    }
    return c.json({ name: saved.name, original: saved.original, expires: saved.expires, size: saved.size, frames: made });
  });
  // What the page shows next to a video: its name, its time of delete, and whether it was deleted.
  app.get('/api/video/:name/meta', (c) => {
    only(c, false);
    return c.json(needVideos().info(c.req.param('name')));
  });
  // The video itself, as a download from the disk, in pieces when the client asks for a range. 410 after the delete.
  app.get('/api/video/:name', (c) => {
    only(c, false);
    const { path, size, type, original } = needVideos().read(c.req.param('name'));
    const headers = { 'Content-Type': type, 'Content-Disposition': disposition(original), 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') || '');
    let start = 0, end = size - 1, status = 200;
    if (range && (range[1] || range[2])) {
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : end;
      if (start > end || start >= size) return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    if (!size) return c.body(null, status, headers);
    return c.body(Readable.toWeb(createReadStream(path, { start, end })), status, headers);
  });
  app.get('/api/agent/prompt', (c) => {
    only(c, false);
    return c.text(agents.prompt(c.req.query('name')));
  });

  // The GitHub Pages Inbox ("Set up phone" on the Agents page). Local only: the GitHub copy never reaches these routes
  // (src/ledger.js has its own list of paths). The key and the link are secrets: they never go into a log.
  app.get('/api/ledger/status', (c) => {
    only(c, false);
    return c.json({ configured: Boolean(ledgerPage), page: ledgerPage || null });
  });
  app.post('/api/ledger/setup-link', async (c) => {
    const b = await body(c);
    only(c, false);
    if (!ledgerPage) throw new MemoError(400, 'The GitHub Inbox is not set up on this computer.');
    const key = typeof b.ghKey === 'string' ? b.ghKey.trim() : '';
    if (!/^[A-Za-z0-9_]{20,255}$/.test(key)) throw new MemoError(400, 'That does not look like a GitHub key. It starts with github_pat_.');
    // The same link as scripts/setup-link.mjs; ui/ledger.js reads it (setupFromLink).
    const code = Buffer.from(`${key}\n${token}`).toString('base64url');
    return c.json({ link: `${ledgerPage.replace(/#.*$/, '')}#setup=${code}` });
  });

  // The System page (src/system.js). The owner only: the files are the charters and the rules of the agents.
  const needSystem = (c) => {
    only(c, false);
    if (!system) throw new MemoError(503, 'The System page is not set up on this server.');
    return system;
  };
  app.get('/api/system', (c) => c.json(needSystem(c).summary()));
  app.get('/api/system/version', (c) => c.json(needSystem(c).version()));
  app.get('/api/system/map', (c) => c.json(needSystem(c).mapHtml()));
  app.get('/api/system/file', (c) => c.json(needSystem(c).read(c.req.query('id'))));
  app.post('/api/system/save', async (c) => {
    const b = await body(c);
    return c.json(await needSystem(c).save(b.id, b.text, b.base));
  });
  app.post('/api/system/check', async (c) => {
    const s = needSystem(c);
    await s.checkSync();
    return c.json(s.summary());
  });
  app.post('/api/system/rebuild', async (c) => {
    const s = needSystem(c);
    await s.rebuild();
    return c.json(s.mapHtml());
  });

  return app;
}
