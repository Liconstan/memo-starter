// The ledger: the Inbox with the computer off (README.md, "Inbox from anywhere").
// The Inbox page on GitHub Pages reads state/inbox.json from a private repository and writes each action of the owner
// as a file in outbox/. This bridge, on the computer of the owner, does the two halves:
//   - apply: each file in outbox/ goes to the same routes as the local Inbox, then the file goes away;
//   - publish: the answers of the routes that the Inbox reads go into state/inbox.json.
// Both live on one branch (default "inbox"), so the history of the main branch stays clean.
//
// Trust. Anyone who can write to the repository can add a file to outbox/, and the cloud agent reads mail from other
// people. So an action of the owner counts only with a signature: HMAC-SHA256 with MEMO_TOKEN, which only the devices of
// the owner and this computer know. A file with no valid signature can only do what an agent can do: send a memo to the
// owner, or add a note as an agent.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The routes that the Inbox page uses to act. Nothing else in outbox/ is applied.
export const OWNER_PATHS = new Set([
  '/api/send', '/api/reply', '/api/close', '/api/note', '/api/seen', '/api/check', '/api/adjust', '/api/tag', '/api/postpone', '/api/draft',
  '/api/client-tz', '/api/agent/start', '/api/agent/stop', '/api/agent/answer',
  '/api/tick/done', '/api/tick/undo', '/api/tick/skip', '/api/tick/adjust',
]);
// The routes that the Inbox page reads. Their answers make up state/inbox.json.
const READS = ['/api/queue', '/api/answered', '/api/postponed', '/api/schedule', '/api/client-tz', '/api/agents', '/api/threads'];
const HEARTBEAT_MS = 10 * 60 * 1000;
// The full run (apply, publish, archive) is each 30 seconds (start). Between the full runs, a quick run reads outbox/
// this often and applies what is there, so a draft typed on the phone is on this computer within seconds. The read
// is one request (404 when outbox/ is empty): 360 an hour, with the 120 of the full runs, out of the 5,000 an hour
// that GitHub gives the owner; the phone page reads twice each 15 seconds, 480 an hour, from the same 5,000.
const QUICK_MS = 10 * 1000;
// A change on this computer that the phone waits for (a draft typed here: nudge) is published after this pause, and
// prompt publishes are at least this far apart. So typing with pauses makes at most 6 commits a minute, well under
// the 80 a minute and 500 an hour that GitHub allows for writes.
const NUDGE_MS = 2 * 1000;
const NUDGE_GAP_MS = 10 * 1000;
// The copy of all memos for the cloud agent's search (state/archive.json) is written at most this often, and only when it changed.
const ARCHIVE_MS = 60 * 60 * 1000;
const CALENDAR_DAYS = 7;

// The text that the signature covers. The page (ui/ledger.js) builds the same text.
export function signedText({ path, body, at, nonce }) {
  return `${path}\n${JSON.stringify(body)}\n${at}\n${nonce}`;
}
export function sign(key, entry) {
  return createHmac('sha256', key).update(signedText(entry)).digest('hex');
}
function validSignature(key, entry) {
  if (typeof entry.sig !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sig)) return false;
  return timingSafeEqual(Buffer.from(sign(key, entry), 'hex'), Buffer.from(entry.sig, 'hex'));
}

// What a file with no valid signature may do: what an agent may do. from must be an agent, not the owner.
function agentAllowed(entry, owner) {
  const b = entry.body || {};
  if (typeof b.from !== 'string' || b.from === owner) return false;
  if (entry.path === '/api/send') return b.to === owner;
  if (entry.path === '/api/note') return true;
  return false;
}

// A temporary id ("t-" and the nonce) names a memo that the page or the cloud agent sent before this computer gave it
// a number. Later actions on it use the same temporary id; the bridge puts in the real id.
const TEMP = /^t-[A-Za-z0-9-]{6,64}$/;

// repo: "owner/name". ghToken: a GitHub token that can read and write that repository. memoToken: MEMO_TOKEN.
// app: the Memo app (createApp). idsPath: the file of the map of temporary ids (data/ledger-ids.json).
export function createLedger({ app, repo, ghToken, memoToken, owner, branch = 'inbox', idsPath, ticksOn = false,
  timeZone = () => 'America/New_York', now = () => new Date(), fetchImpl = fetch, log = console }) {
  let ids = {};
  if (idsPath && existsSync(idsPath)) { try { ids = JSON.parse(readFileSync(idsPath, 'utf8')); } catch { ids = {}; } }
  const saveIds = () => {
    if (!idsPath) return;
    mkdirSync(dirname(idsPath), { recursive: true });
    writeFileSync(idsPath, `${JSON.stringify(ids)}\n`);
  };
  let lastPublished = null; // { text, at }
  let stateSha = null;
  let lastArchive = null; // { text, at }

  async function gh(method, path, body, accept = 'application/vnd.github+json') {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${ghToken}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub gave status ${r.status} for ${method} ${path}.`);
    return accept.includes('raw') ? r.text() : r.json();
  }


  // The branch exists before the first write. It starts from the default branch.
  async function ensureBranch() {
    if (await gh('GET', `/branches/${branch}`)) return;
    const info = await gh('GET', '');
    const base = await gh('GET', `/git/ref/heads/${info.default_branch}`);
    await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: base.object.sha });
  }

  async function local(path, body) {
    const r = await app.request(path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${memoToken}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  }

  // Puts the real id in the place of a temporary id. An unknown temporary id stays, and the route says it is not there.
  const realId = (v) => (typeof v === 'string' && TEMP.test(v) && ids[v] !== undefined ? ids[v] : v);
  function withRealIds(body) {
    const b = { ...body };
    if ('id' in b) b.id = realId(b.id);
    if (Array.isArray(b.ids)) b.ids = b.ids.map(realId).filter((v) => !(typeof v === 'string' && TEMP.test(v)));
    return b;
  }

  // Applies the files in outbox/, oldest first. Returns a list of what happened, for the log and the tests.
  async function apply() {
    const listing = (await gh('GET', `/contents/outbox?ref=${branch}`)) || [];
    const files = listing.filter((f) => f.type === 'file' && f.name.endsWith('.json')).sort((a, b) => a.name.localeCompare(b.name));
    const results = [];
    for (const f of files) {
      let entry = null;
      try { entry = JSON.parse(await gh('GET', `/contents/outbox/${encodeURIComponent(f.name)}?ref=${branch}`, null, 'application/vnd.github.raw+json')); } catch { entry = null; }
      let outcome;
      if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || typeof entry.body !== 'object' || !entry.body) {
        outcome = 'rejected: not a valid entry';
      } else if (!OWNER_PATHS.has(entry.path)) {
        outcome = `rejected: ${entry.path} is not an Inbox action`;
      } else if (!validSignature(memoToken, entry) && !agentAllowed(entry, owner)) {
        outcome = 'rejected: no valid signature of the owner';
      } else {
        const body = withRealIds(entry.body);
        // Only the owner can mark a memo as written by the owner.
        if (!validSignature(memoToken, entry)) delete body.trusted;
        const { status, data } = await local(entry.path, body);
        // Automatic browser routing can wait for the desktop worker to recover.
        // Keep the signed request instead of losing it or substituting Claude.
        if (status === 409 && entry.path === '/api/send' && body.to === 'auto') {
          results.push({ file: f.name, outcome: `kept: ${data.error || 'automatic routing unavailable'}` });
          continue;
        }
        if (status >= 500) { results.push({ file: f.name, outcome: `kept: the server gave ${status}` }); break; }
        if (status < 300 && entry.path === '/api/send' && typeof entry.temp === 'string' && TEMP.test(entry.temp) && data.memo?.id) {
          ids[entry.temp] = data.memo.id;
          saveIds();
        }
        outcome = status < 300 ? 'applied' : `failed: ${data.error || status}`;
      }
      await gh('DELETE', `/contents/outbox/${encodeURIComponent(f.name)}`, { message: `Memo: ${outcome.split(':')[0]} ${f.name}`, sha: f.sha, branch });
      results.push({ file: f.name, path: entry?.path, outcome });
      if (outcome !== 'applied') log.warn?.(`ledger: ${f.name} ${outcome}`);
    }
    return results;
  }

  // The days of the Today card: today and the next days, in the zone of the owner.
  function days() {
    const zone = timeZone();
    const out = [];
    for (let i = 0; i < CALENDAR_DAYS; i += 1) {
      const d = new Date(now().getTime() + i * 86400000);
      out.push(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d));
    }
    return { zone, dates: out };
  }

  async function snapshot() {
    const data = {};
    for (const path of READS) {
      const { status, data: d } = await local(path);
      if (status < 300) data[path] = d;
    }
    if (ticksOn) {
      const { status, data: d } = await local('/api/ticks');
      if (status < 300) data['/api/ticks'] = d;
    }
    const calendar = {};
    const { zone, dates } = days();
    for (const date of dates) {
      const { status, data: d } = await local(`/api/calendar?date=${date}&tz=${encodeURIComponent(zone)}`);
      if (status < 300) calendar[date] = d;
      if (d?.configured === false) break;
    }
    return { v: 1, data, calendar, calendarZone: zone, ids };
  }

  // Writes state/inbox.json when it changed, and at least each 10 minutes, so the page knows that this computer is on.
  async function publish() {
    const snap = await snapshot();
    const text = JSON.stringify(snap);
    const at = now();
    if (lastPublished && lastPublished.text === text && at - lastPublished.at < HEARTBEAT_MS) return false;
    if (!stateSha) stateSha = (await gh('GET', `/contents/state/inbox.json?ref=${branch}`))?.sha || null;
    const content = Buffer.from(JSON.stringify({ ...snap, generated: at.toISOString() })).toString('base64');
    const put = async () => gh('PUT', '/contents/state/inbox.json', { message: 'Memo: Inbox state', content, branch, ...(stateSha ? { sha: stateSha } : {}) });
    let r;
    try { r = await put(); } catch (err) {
      // A different writer changed the file: get its sha and try once more.
      stateSha = (await gh('GET', `/contents/state/inbox.json?ref=${branch}`))?.sha || null;
      r = await put();
    }
    stateSha = r?.content?.sha || null;
    lastPublished = { text, at };
    return true;
  }

  // Writes state/archive.json: all memos in a short form, so the cloud agent can search old memos when this computer is off.
  async function publishArchive() {
    const at = now();
    if (lastArchive && at - lastArchive.at < ARCHIVE_MS) return false;
    const { status, data } = await local('/api/archive');
    if (status >= 300) return false;
    const text = JSON.stringify(data);
    if (lastArchive && lastArchive.text === text) { lastArchive = { text, at }; return false; }
    const sha = (await gh('GET', `/contents/state/archive.json?ref=${branch}`))?.sha;
    const content = Buffer.from(JSON.stringify({ v: 1, generated: at.toISOString(), memos: data })).toString('base64');
    await gh('PUT', '/contents/state/archive.json', { message: 'Memo: archive for search', content, branch, ...(sha ? { sha } : {}) });
    lastArchive = { text, at };
    return true;
  }

  let running = false;
  async function tick() {
    if (running) return null;
    running = true;
    try {
      const applied = await apply();
      const published = await publish();
      let archived = false;
      try { archived = await publishArchive(); } catch (err) { log.error?.(`ledger archive: ${err.message}`); }
      return { applied, published, archived };
    } finally { running = false; }
  }

  // The quick run between two full runs: what waits in outbox/ is applied, and when an action was applied, the state
  // is published at once, so the phone sees the outcome (and the computer's answer to it) without the full run.
  async function quick() {
    if (running) return null;
    running = true;
    try {
      const applied = await apply();
      const published = applied.some((r) => r.outcome === 'applied') ? await publish() : false;
      return { applied, published };
    } finally { running = false; }
  }

  // A change on this computer that the phone should see soon (a draft typed in the local Inbox): the state is
  // published after NUDGE_MS, and not within NUDGE_GAP_MS of the last publish. Calls in that time join the same
  // publish. Gives the promise of that publish: true when the state was written.
  let nudged = null;
  function nudge() {
    if (nudged) return nudged;
    const wait = Math.max(NUDGE_MS, lastPublished ? lastPublished.at.getTime() + NUDGE_GAP_MS - now().getTime() : 0);
    nudged = new Promise((resolve) => { const t = setTimeout(resolve, wait); t.unref?.(); }).then(async () => {
      nudged = null;
      if (running) return nudge();
      running = true;
      try { return await publish(); } catch (err) { log.error?.(`ledger publish: ${err.message}`); return false; } finally { running = false; }
    });
    return nudged;
  }

  // The full run each everyMs, and the quick run each quickMs between them. Gives the two timers.
  function start(everyMs = 30000, quickMs = QUICK_MS) {
    let ready = false;
    const run = async () => {
      try {
        if (!ready) { await ensureBranch(); ready = true; }
        await tick();
      } catch (err) { log.error?.(`ledger: ${err.message}`); }
    };
    const quickRun = async () => {
      if (!ready) return;
      try { await quick(); } catch (err) { log.error?.(`ledger: ${err.message}`); }
    };
    run();
    return [setInterval(run, everyMs), setInterval(quickRun, quickMs)];
  }

  return { apply, publish, publishArchive, tick, quick, nudge, start, ensureBranch, snapshot };
}
