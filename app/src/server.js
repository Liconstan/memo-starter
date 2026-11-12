import { serve } from '@hono/node-server';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createStore, SERVER_ACTOR } from './memos.js';
import { createAgents, loadConfig, realTmux } from './agents.js';
import { createApp, fetchCalendar, calendarOwner, pageCalendars, envCalendars } from './app.js';
import { createImages } from './images.js';
import { createFiles } from './files.js';
import { createVideos } from './videos.js';
import { createFrames } from './frames.js';
import { createTicks } from './ticks.js';
import { localFile } from './paths.js';
import { sendIMessage, validHandle } from './imessage.js';
import { createSystem } from './system.js';
import { loadWorkstreams } from './workstreams.js';
import { createUsage } from './usage.js';
import { createCodexUsage } from './codex-usage.js';
import { createDesktopDispatch } from './desktop-dispatch.js';
import { createHandover } from './handover.js';
import { createFableSpare } from './fable-spare.js';
import { createFollowups, followupsOn, followupDelay, followupDomain } from './followups.js';
import { homedir } from 'node:os';
import { blockText } from './block-text.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { MEMO_TOKEN: token, MEMO_LIAISON_TOKEN: liaisonToken } = process.env;
if (!token || token.length < 16) {
  console.error('MEMO_TOKEN is not set or has fewer than 16 characters. See .env.example.');
  process.exit(1);
}
if (liaisonToken && (liaisonToken.length < 16 || liaisonToken === token)) {
  console.error('MEMO_LIAISON_TOKEN must have 16 characters or more and must be different from MEMO_TOKEN.');
  process.exit(1);
}

// The name of the person who owns the queue. Agents send memos to this name.
const owner = process.env.MEMO_OWNER || 'owner';
if (!/^[a-z][a-z0-9-]*$/.test(owner)) {
  console.error('MEMO_OWNER must have only a-z, 0-9 and "-", and must start with a letter.');
  process.exit(1);
}
const config = loadConfig(localFile(root, 'agents.json'), owner);
const dbPath = resolve(root, process.env.DATABASE_PATH || './data/memo.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const store = createStore(db, {
  owner,
  names: [owner, 'discord', ...config.map((a) => a.name)],
  forwardTo: config.filter((a) => a.kind !== 'short').map((a) => a.name),
  // A postponed memo comes back at 9:00 AM in this zone.
  timeZone: process.env.MEMO_TZ || 'America/New_York',
  // The workstream codes of the memos (memo send --ws OPS): local/workstreams.json, or the example in the repository.
  workstreams: loadWorkstreams(localFile(root, 'workstreams.json')),
});
// The usage of the Claude account of each long agent (session, week, Fable), from `claude -p /usage` each 5 minutes.
const usage = createUsage({ config });
const codexUsage = config.some(a => a.runtime === 'codex-desktop') ? createCodexUsage() : null;
const desktop = createDesktopDispatch({ db, config, root, owner });
const agents = createAgents({ db, config, root, owner, tmux: realTmux(), counts: store.counts, desktop,
  usage: (name) => config.find(a => a.name === name)?.runtime === 'codex-desktop' ? codexUsage?.get() : usage.get(name) });
// Each minute: an agent at the limit of its account hands the memos it never got to the other long agent (memo 982).
const handover = createHandover({ db, store, owner, agents: () => agents.list(), arrived: (name) => agents.arrived(name) });
// Each minute: an agent whose Fable week will end with points unused gets one memo per window that asks for a model trial.
const fableSpare = createFableSpare({ db, store, owner, agents: () => agents.list(), arrived: (name) => agents.arrived(name) });
const images = createImages(join(dirname(dbPath), 'images'));
const files = createFiles(join(dirname(dbPath), 'files'));
// A video is not kept (README.md, "A video from the owner"): it goes to a cache folder outside data/ and outside the
// backups, MEMO_VIDEO_DIR or ~/Library/Caches/memo-videos, and is deleted after 48 hours or when its memo closes.
const videoDir = process.env.MEMO_VIDEO_DIR ? process.env.MEMO_VIDEO_DIR.replace(/^~(?=\/|$)/, homedir()) : join(homedir(), 'Library', 'Caches', 'memo-videos');
const videos = createVideos({ dir: videoDir });
// The still frames of a video, with the Swift tool built from scripts/video-frames.swift (no new software).
const frames = createFrames({ binDir: join(videoDir, 'bin') });
// The day of the ticks starts at MEMO_DAY_START (an hour, default 3) in the time zone MEMO_TZ (default: that of this computer).
const ticks = createTicks(db, { dayStart: Number(process.env.MEMO_DAY_START ?? 3), timeZone: process.env.MEMO_TZ || undefined });
const hostname = process.env.HOST || '127.0.0.1';
// Optional: the owner needs no token through Tailscale Serve. See README.md.
const { MEMO_TAILSCALE_LOGIN: login, MEMO_TAILSCALE_HOST: tailscaleHost } = process.env;
if (!login !== !tailscaleHost) {
  console.error('Set MEMO_TAILSCALE_LOGIN and MEMO_TAILSCALE_HOST together, or set none of the two.');
  process.exit(1);
}
// A request from a different computer could contain the Tailscale header, so only Tailscale Serve on this computer can be the source.
if (login && !['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
  console.error('MEMO_TAILSCALE_LOGIN needs HOST=127.0.0.1. With a different HOST, a computer on the network can pretend to be Tailscale.');
  process.exit(1);
}
const tailscale = login ? { login, host: tailscaleHost } : undefined;
const ticksOn = ['1', 'true', 'on', 'yes'].includes(String(process.env.MEMO_TICKS || '').toLowerCase());
// Optional: the secret iCal address of the calendar of the owner, for the Today card of the Inbox. See README.md.
// The owner can also add a calendar on the Inbox page; those addresses are in data/calendars.json.
const calendarUrl = process.env.MEMO_CALENDAR_ICS || undefined;
// Each minute: a meeting of a work calendar that ended 30 minutes ago (MEMO_FOLLOWUP_DELAY_MIN) gives the agent main
// one memo that asks for the follow-ups (memo 1323). The calendars are those of the Today card, MEMO_CALENDAR_ICS and
// then data/calendars.json, read again each 5 minutes; only one whose owner is on the work domain counts
// (MEMO_FOLLOWUP_DOMAIN). MEMO_FOLLOWUPS=0 turns the job off.
const followups = createFollowups({
  db, store, owner, urls: () => [...envCalendars(calendarUrl), ...pageCalendars(dirname(dbPath))], getCalendar: fetchCalendar, selfOf: calendarOwner,
  domain: (owners) => followupDomain(process.env.MEMO_FOLLOWUP_DOMAIN, owners),
  on: followupsOn(process.env.MEMO_FOLLOWUPS), delayMin: followupDelay(process.env.MEMO_FOLLOWUP_DELAY_MIN), arrived: (name) => agents.arrived(name),
  // The times in the memo are in the zone of the browser of the owner (data/client-tz.json), or else in MEMO_TZ.
  timeZone: () => {
    try { return JSON.parse(readFileSync(join(dirname(dbPath), 'client-tz.json'), 'utf8')).timeZone || store.timeZone; } catch { return store.timeZone; }
  },
});
// The address of the GitHub Pages Inbox, for the setup link on the Agents page. Only with the ledger (MEMO_LEDGER_REPO).
// The default is the project site of that repository: https://<owner>.github.io/<name>/.
const ledgerPageOf = (repo) => { const [who, name] = String(repo).split('/'); return `https://${who.toLowerCase()}.github.io/${name}/`; };
const ledgerPage = process.env.MEMO_LEDGER_REPO ? (process.env.MEMO_LEDGER_PAGE || ledgerPageOf(process.env.MEMO_LEDGER_REPO)) : undefined;
// A draft saved in the local Inbox goes to the phone soon: the ledger (below) publishes the state after a short pause.
let ledger = null;
// The System page reads the vault (MEMO_VAULT) and the live charters in local/ (MEMO_LOCAL). See README.md.
const system = createSystem({
  vault: (process.env.MEMO_VAULT || join(homedir(), 'memo-vault')).replace(/^~(?=\/|$)/, homedir()),
  local: process.env.MEMO_LOCAL || join(root, 'local'),
  memoRoot: root,
  codeBranch: process.env.MEMO_CODE_BRANCH || 'main',
  codeRemote: process.env.MEMO_CODE_REMOTE || 'origin',
  codeRemoteBranch: process.env.MEMO_CODE_REMOTE_BRANCH || process.env.MEMO_CODE_BRANCH || 'main',
  commitName: process.env.MEMO_OWNER_NAME || owner,
});
const app = createApp({ store, agents, images, files, videos, frames, ticks, ticksOn, system, root, token, liaisonToken, owner, tailscale, calendarUrl, dataDir: dirname(dbPath), ledgerPage,
  onDraft: () => { ledger?.nudge(); },
  // The pictures of the pets (README.md, "Pictures of the pets"): ~/memo-pets, or MEMO_PETS_DIR.
  ...(process.env.MEMO_PETS_DIR ? { petsDir: process.env.MEMO_PETS_DIR } : {}) });

// Optional: the Inbox from anywhere, through a private GitHub repository. See README.md.
// MEMO_LEDGER_REPO is "owner/name". The GitHub token is MEMO_LEDGER_TOKEN, or else that of the GitHub CLI (gh auth token).
async function startLedger() {
  const repo = process.env.MEMO_LEDGER_REPO;
  if (!repo) return;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    console.error('MEMO_LEDGER_REPO must have the form owner/name. The ledger is off.');
    return;
  }
  let ghToken = process.env.MEMO_LEDGER_TOKEN;
  if (!ghToken) {
    const { execFileSync } = await import('node:child_process');
    try { ghToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { ghToken = ''; }
  }
  if (!ghToken) {
    console.error('The ledger needs MEMO_LEDGER_TOKEN, or a signed-in GitHub CLI. The ledger is off.');
    return;
  }
  const { createLedger } = await import('./ledger.js');
  ledger = createLedger({
    app, repo, ghToken, memoToken: token, owner, ticksOn,
    branch: process.env.MEMO_LEDGER_BRANCH || 'inbox',
    idsPath: join(dirname(dbPath), 'ledger-ids.json'),
    timeZone: () => {
      try { return JSON.parse(readFileSync(join(dirname(dbPath), 'client-tz.json'), 'utf8')).timeZone || store.timeZone; } catch { return store.timeZone; }
    },
  });
  ledger.start();
  console.log(`The ledger syncs the Inbox with ${repo}.`);
}

// Each minute: is an agent blocked on a sign-in or a permission dialog? Then the owner gets a memo at the top of the
// Inbox and a notification on this computer. When the agent is free again, the memo closes by itself.
const blockMemos = new Map(); // agent name -> id of the open memo about it
const ntfyTopic = process.env.MEMO_NTFY_TOPIC || '';
// Optional: a text message through the Messages app on this Mac, to one phone number (+12025550123) or Apple ID mail
// address. A wrong value turns the text messages off; the Mac notification and ntfy stay as they are.
let alertHandle = process.env.MEMO_ALERT_IMESSAGE || '';
if (alertHandle && !validHandle(alertHandle)) {
  console.error('MEMO_ALERT_IMESSAGE must be a phone number like +12025550123 or an email.');
  alertHandle = '';
}
function watchAgents() {
  let changes = [];
  try { changes = agents.watch(); } catch (err) { console.error(`agent watch: ${err.message}`); return; }
  for (const { name, reason, prompt } of changes) {
    if (reason) {
      try {
        const { memo } = store.send({ from: name, to: owner, impact: 5, effort: 'micro', title: `${name} is blocked`,
          next: reason === 'sign-in' ? 'Sign in to Claude on the Mac' : 'Answer the question on the Agents page', text: blockText(name, reason, prompt) });
        blockMemos.set(name, memo.id);
      } catch (err) { console.error(`agent watch memo: ${err.message}`); }
      // A notification on this computer. The text is fixed; only the agent name, from agents.json, goes in, and it
      // reaches the AppleScript through argv, never as part of the script.
      const line = `${name} is blocked: ${reason === 'sign-in' ? 'sign in to Claude on the Mac' : 'answer a permission question'}`;
      spawnSync('osascript', ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title "Memo" sound name "Ping"', '-e', 'end run', line]);
      // Optional: a text message through the Messages app (MEMO_ALERT_IMESSAGE). Only this one line goes out, never memo text.
      if (alertHandle) {
        const next = reason === 'sign-in' ? 'sign in to Claude on the Mac' : 'answer its question on the Agents page';
        sendIMessage(alertHandle, `Memo: ${name} is blocked: ${next}`);
      }
      // Optional: a push to the phone through ntfy (MEMO_NTFY_TOPIC). Only this one line goes out, never memo text.
      if (ntfyTopic) {
        fetch(`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`, { method: 'POST', body: line, headers: { Title: 'Memo', Priority: 'high', Tags: 'warning' }, signal: AbortSignal.timeout(10000) })
          .catch((err) => console.error(`ntfy: ${err.message}`));
      }
    } else if (blockMemos.has(name)) {
      try { store.close(blockMemos.get(name), `${name} works again.`, SERVER_ACTOR); } catch { /* the owner closed it already */ }
      blockMemos.delete(name);
    }
  }
}

const port = Number(process.env.PORT || 3280);
serve({ fetch: app.fetch, hostname, port }, () => {
  console.log(`Memo listens on http://${hostname}:${port}`);
  agents.resume();
  startLedger();
  setInterval(watchAgents, 60000);
  desktop.scan();
  // Recovery for direct store writes, postponed tasks and arrivals during downtime.
  // This is a database check only. No model turn unless an unseen event exists.
  setInterval(() => desktop.scan(), 30000);
  system.start();
  usage.start();
  codexUsage?.start();
  handover.start();
  fableSpare.start();
  followups.start();
  // The line has the counts and the work domain, never a calendar address.
  const watch = followups.watching();
  console.log(`Meeting follow-ups: ${!followups.active ? 'off (MEMO_FOLLOWUPS)'
    : `on, ${followupDelay(process.env.MEMO_FOLLOWUP_DELAY_MIN)} minutes after a meeting ends, ${watch.used} of ${watch.total} calendars on the work domain ${watch.domain}${watch.used ? '' : ' (no memo until a work calendar is added)'}`}.`);
  // The videos past their 48 hours go at the start and each 10 minutes; the frames tool is built now, not at the first upload.
  const sweepVideos = () => { try { const gone = videos.sweep(); if (gone.length) console.log(`Deleted ${gone.length} video(s) past their time.`); } catch (err) { console.error(`video sweep: ${err.message}`); } };
  sweepVideos();
  setInterval(sweepVideos, 10 * 60000);
  frames.prepare().then((how) => console.log(`Video frames: ${how === 'swift' ? 'AVFoundation (Swift)' : how === 'qlmanage' ? 'one thumbnail with qlmanage' : 'not available'}.`));
});
