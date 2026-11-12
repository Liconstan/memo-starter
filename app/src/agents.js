import { existsSync, readFileSync } from 'node:fs';
import { localFile } from './paths.js';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { MemoError } from './memos.js';
import { modelName } from './models.js';
import { permissionPrompt } from './block-text.js';

// The charters quote the stop message, so it starts with the name of the owner with a capital letter.
const title = (owner) => owner[0].toUpperCase() + owner.slice(1);
export const stopMessage = (owner) => `${title(owner)} stops this session. Record a recap now with \`memo recap\`, then do nothing more.`;
export const continueMessage = (owner) => `${title(owner)} cancels the stop. Continue your work: run \`memo list\`, then \`memo wait\`.`;
// The nudge goes to the session of a long agent when a memo arrives and the session sits idle at its prompt.
export const nudgeMessage = (name) => `A memo arrived. Run \`memo list --to ${name}\`, then do the work. If nothing is open, run \`memo wait --as ${name}\`.`;
const MAX_RECAP = 2000;
const MAX_STATUS = 300;
// A remote agent asks for news each 30 seconds while it waits. After this time with no request, it shows as offline.
const ONLINE_MS = 120000;
// A long agent asks for news each 30 seconds while it waits (`memo wait`). With no request in this time, it is not
// waiting: it works on a task, or its session sits idle at the prompt (a turn that ended early, for example when the
// Mac slept). The screen tells the two apart. One nudge per agent in NUDGE_EVERY_MS: a nudge interrupts the session.
const NEWS_IDLE_MS = 60000;
const NUDGE_EVERY_MS = 120000;
// The helpers (subagents) of an agent, from `memo helper`. A done helper shows for HELPER_KEEP_MS, and the list
// shows at most HELPER_DONE_MAX done helpers, so the Agents page does not fill up with old ones. The model of a
// helper is stored in its short form with the version, "Fable 5.1" (src/models.js); a bare alias stays as given.
const MAX_HELPER_LABEL = 80;
const MAX_HELPER_MODEL = 40;
const HELPER_KEEP_MS = 86400000;
const HELPER_DONE_MAX = 5;


export const session = (name) => `memo-${name}`;

export function loadConfig(path, owner = 'owner') {
  const RESERVED = [owner, 'discord'];
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(config)) throw new Error('agents.json must contain a list.');
  const seen = new Set();
  for (const a of config) {
    if (typeof a.name !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.name)) throw new Error(`agents.json: the name "${a.name}" must have only a-z, 0-9 and "-".`);
    if (RESERVED.includes(a.name)) throw new Error(`agents.json: "${a.name}" is not permitted as an agent name.`);
    if (seen.has(a.name)) throw new Error(`agents.json: the name "${a.name}" is there two times.`);
    seen.add(a.name);
    if (!['long', 'short', 'remote'].includes(a.kind)) throw new Error(`agents.json: the kind of ${a.name} must be "long", "short", or "remote".`);
    // A desktop worker uses the remote heartbeat protocol, but is hosted by the desktop app,
    // not by tmux. Registering it never starts a model or grants computer permissions.
    if (a.runtime !== undefined && (a.runtime !== 'codex-desktop' || a.kind !== 'remote')) throw new Error(`agents.json: runtime must be "codex-desktop" on a remote agent.`);
    if (a.desktopThread !== undefined && (a.runtime !== 'codex-desktop' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(a.desktopThread))) throw new Error('agents.json: desktopThread must be a desktop worker session UUID.');
    if (a.desktopVerified !== undefined && (!a.desktopThread || typeof a.desktopVerified !== 'boolean')) throw new Error('agents.json: desktopVerified needs a desktopThread and a boolean.');
    // The optional charter of an agent: the name of a charter that the agents share, for example "team" for
    // charters/team.md, one charter with a section for each agent (memo 892). Without it, the agent reads charters/<name>.md.
    if (a.charter !== undefined && (typeof a.charter !== 'string' || !/^[a-z][a-z0-9-]*$/.test(a.charter))) throw new Error(`agents.json: the charter of ${a.name} must be a name with only a-z, 0-9 and "-".`);
    // The session of a remote agent is on a different computer, and the agents.json of that computer gives its dir and model.
    if (a.kind === 'remote') continue;
    if (typeof a.dir !== 'string' || !a.dir) throw new Error(`agents.json: ${a.name} needs a dir.`);
    if (typeof a.model !== 'string' || !a.model) throw new Error(`agents.json: ${a.name} needs a model.`);
    // The optional chrome of a long agent: false starts its session without the Claude in Chrome integration (scripts/agent.sh).
    if (a.chrome !== undefined && typeof a.chrome !== 'boolean') throw new Error(`agents.json: the chrome of ${a.name} must be true or false.`);
    // The optional env of a long agent: variables for its session (scripts/agent.sh), for example CLAUDE_CONFIG_DIR.
    if (a.env !== undefined) {
      if (typeof a.env !== 'object' || a.env === null || Array.isArray(a.env)) throw new Error(`agents.json: the env of ${a.name} must be an object.`);
      for (const [k, v] of Object.entries(a.env)) {
        if (!/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof v !== 'string' || /[\n\r]/.test(v)) throw new Error(`agents.json: the env of ${a.name}: ${k} must be a name in capitals with a text value on one line.`);
      }
    }
  }
  if (!config.some((a) => a.kind !== 'short')) throw new Error('agents.json needs one long or remote agent or more.');
  return config;
}

// "=name" makes tmux match the session name exactly. Without it, tmux also accepts a prefix.
export function realTmux() {
  const run = (...args) => spawnSync('tmux', args, { encoding: 'utf8' });
  return {
    has: (s) => run('has-session', '-t', `=${s}`).status === 0,
    start: (s, command) => {
      const r = run('new-session', '-d', '-s', s, '-x', '200', '-y', '50', ...command);
      if (r.status !== 0) throw new MemoError(500, `tmux did not start the session ${s}: ${(r.stderr || r.error?.message || '').trim()}`);
    },
    kill: (s) => { run('kill-session', '-t', `=${s}`); },
    // The text on the screen of the session now, for the check of a blocked agent.
    capture: (s) => run('capture-pane', '-p', '-t', `=${s}:`).stdout || '',
    // One key with no Enter, to answer a prompt: a digit or Escape.
    key: (s, k) => { run('send-keys', '-t', `=${s}:`, k); },
    // Enter goes as a second step after a short time. Claude Code reads text and an immediate Enter as one paste.
    // Escape goes first. It closes a Claude Code dialog that would take the text, and it interrupts a turn in progress.
    // The text goes after a short time, or the program reads Escape and the first letter as one key (Alt-letter).
    send: (s, text) => {
      run('send-keys', '-t', `=${s}:`, 'Escape');
      setTimeout(() => run('send-keys', '-t', `=${s}:`, '-l', text), 300);
      setTimeout(() => run('send-keys', '-t', `=${s}:`, 'Enter'), 800);
    },
  };
}

// Why an agent waits on the owner, from the bottom of its screen: 'sign-in' when Claude Code needs a new login,
// 'permission' when a dialog asks to allow a tool, or null. Only the last lines count, where a dialog shows:
// text higher up is the transcript, which can quote these words.
const BOTTOM_LINES = 25;
export function blockedReason(screen) {
  const bottom = String(screen).split('\n').filter((l) => l.trim()).slice(-BOTTOM_LINES).join('\n');
  if (/Please run \/login|OAuth token has expired|Invalid API key|API Error: 401|authentication_error/i.test(bottom)) return 'sign-in';
  if (/Do you want to/i.test(bottom) && /❯\s*1\.\s*Yes/.test(bottom)) return 'permission';
  return null;
}
// True while Claude Code runs a turn: its spinner line says "esc to interrupt". A nudge then would cut the turn short.
export function turnInProgress(screen) {
  const bottom = String(screen).split('\n').filter((l) => l.trim()).slice(-BOTTOM_LINES).join('\n');
  return /esc to interrupt/i.test(bottom);
}
// The prompt itself, for the Agents page: from its question to the end of the screen, at most 15 lines.
function promptText(screen) {
  const lines = String(screen).split('\n').filter((l) => l.trim()).slice(-BOTTOM_LINES);
  const at = lines.findLastIndex((l) => /Do you want to|\/login|OAuth token|Invalid API key|API Error/i.test(l));
  return lines.slice(Math.max(0, at - 6), at + 9).map((l) => l.replace(/\s+$/, '')).join('\n');
}

// usage(name): the usage figures of the Claude account of a long agent (src/usage.js), or null.
export function createAgents({ db, config, root, tmux, owner = 'owner', counts = () => ({}), usage = () => null, desktop = null, now = () => new Date(), recapTimeoutMs = 180000 }) {
  const ts = () => now().toISOString();
  const timers = new Map();
  const contacts = new Map(); // remote agent -> the time of its last request, in milliseconds
  const nudges = new Map(); // long agent -> the time of its last nudge, in milliseconds
  const waits = new Map(); // agent -> the time of its last `memo wait` request that got no news, in milliseconds
  for (const a of config) db.prepare('INSERT OR IGNORE INTO status (agent) VALUES (?)').run(a.name);

  const row = (name) => ({ ...db.prepare('SELECT * FROM status WHERE agent = ?').get(name) });
  const set = (name, fields) => {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE status SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE agent = ?`).run(...keys.map((k) => fields[k]), name);
  };
  const running = (name) => tmux.has(session(name));
  // name -> { reason, prompt, count, since }. A reason counts after two checks in a row, so a passing dialog gives no alarm.
  const blocks = new Map();
  const confirmed = (name) => { const b = blocks.get(name); return b && b.count >= 2 ? b : null; };
  const reported = new Set(); // long agents that watch() gave as blocked, until it gives them as free again

  // Only a name from agents.json goes on to tmux or to a file path.
  function known(name, kind) {
    const a = config.find((x) => x.name === name);
    if (!a) throw new MemoError(400, `No agent has the name ${name}.`);
    if (kind && a.kind === 'remote') throw new MemoError(400, `${name} is a remote agent. Its session is on a different computer, so this server cannot start or stop it.`);
    if (kind && a.kind !== kind) throw new MemoError(400, `${name} is a ${a.kind} agent. It has no session to start or stop.`);
    return a;
  }

  function cancel(name) {
    clearTimeout(timers.get(name));
    timers.delete(name);
    set(name, { stopping_since: null });
  }

  function finish(name, how) {
    cancel(name);
    if (running(name)) tmux.kill(session(name));
    set(name, { last_stop: how });
  }

  // What a long or remote agent does now, for the pages: 'stopped' (or 'offline' for a remote agent), 'stopping',
  // 'blocked', 'idle', or 'working'. The surest sign of an idle agent is its own `memo wait`: it asks the server for
  // news each 30 seconds (/api/news) and gets none, so a request in the last minute means the agent waits for memos.
  // The request that brings news ends the wait, so the agent shows as working at once. With no such request, the
  // screen of a long agent tells: a turn in progress ("esc to interrupt") is work; a session at its prompt is idle.
  // A short agent has no activity: it runs for one task and ends.
  function activity(a, r, up) {
    if (a.kind === 'short') return null;
    if (!up) return a.kind === 'remote' ? 'offline' : 'stopped';
    if (r.stopping_since) return 'stopping';
    if (confirmed(a.name)) return 'blocked';
    const w = waits.get(a.name);
    if (w !== undefined && now().getTime() - w < NEWS_IDLE_MS) return 'idle';
    if (a.kind === 'long' && tmux.capture) return turnInProgress(tmux.capture(session(a.name))) ? 'working' : 'idle';
    return 'working';
  }

  const waitedAt = (name) => {
    const w = waits.get(name);
    return w !== undefined && now().getTime() - w < NEWS_IDLE_MS ? new Date(w).toISOString() : null;
  };

  function list() {
    return config.map((a) => {
      const r = row(a.name);
      const last = contacts.get(a.name);
      const isRunning = a.kind === 'long' && running(a.name);
      const online = a.kind === 'remote' && last !== undefined && now().getTime() - last < ONLINE_MS;
      const dispatch = desktop?.status(a.name);
      return {
        name: a.name, kind: a.kind, running: isRunning,
        // The model of the agent's own session, from its agents.json entry, in the short form of the pages: "Opus 5.5".
        // A remote agent has its model on its own computer, so it has none here.
        ...(a.model ? { model: modelName(a.model) } : {}),
        ...(a.runtime ? { runtime: a.runtime } : {}),
        ...(dispatch ? { dispatch } : {}),
        ...(a.kind === 'remote' ? { online, contact: last === undefined ? null : new Date(last).toISOString() } : {}),
        activity: activity(a, r, isRunning || online),
        // The time of the last `memo wait` question of the agent that got no news, while it is recent: the agent asks
        // again 30 seconds after it, so the Inbox can say when a new memo will be picked up (memo 1407). Else null.
        waited: waitedAt(a.name),
        status: r.text, updated: r.updated, recap: r.recap, recap_at: r.recap_at,
        stopping_since: r.stopping_since, last_stop: r.last_stop, ...counts(a.name),
        blocked: confirmed(a.name) ? { reason: confirmed(a.name).reason, prompt: confirmed(a.name).prompt, since: confirmed(a.name).since } : null,
        helpers: helpers(a.name),
        usage: usage(a.name),
      };
    });
  }

  function start(name) {
    known(name, 'long');
    const wasStopping = !!row(name).stopping_since;
    cancel(name);
    set(name, { wanted: 1 });
    if (!running(name)) tmux.start(session(name), [join(root, 'scripts', 'agent.sh'), name]);
    // The agent got "do nothing more" from the stop message, so it needs a message to continue.
    else if (wasStopping) tmux.send(session(name), continueMessage(owner));
    return { name, running: true };
  }

  function stop(name, { now: immediately = false } = {}) {
    known(name, 'long');
    set(name, { wanted: 0 });
    if (!running(name)) { cancel(name); return { name, running: false, stopping: false }; }
    if (immediately) { finish(name, 'now'); return { name, running: false, stopping: false }; }
    if (!row(name).stopping_since) {
      set(name, { stopping_since: ts() });
      tmux.send(session(name), stopMessage(owner));
      const timer = setTimeout(() => finish(name, 'no_recap'), recapTimeoutMs);
      timer.unref?.();
      timers.set(name, timer);
    }
    return { name, running: true, stopping: true };
  }

  function recap(name, text) {
    known(name);
    if (typeof text !== 'string' || !text.trim()) throw new MemoError(400, 'text is necessary.');
    if (text.length > MAX_RECAP) throw new MemoError(400, `A recap must have ${MAX_RECAP} characters or fewer. This recap has ${text.length}.`);
    set(name, { recap: text, recap_at: ts() });
    const stopped = !!row(name).stopping_since;
    if (stopped) finish(name, 'recap');
    return { name, saved: true, stopped };
  }

  // A request of an agent. The Agents page shows from it if a remote agent is online, and `arrived` knows from it that
  // a long agent is not at its prompt. wait: true for a `memo wait` request (/api/news) that got no news, so the agent
  // keeps waiting; false for one that got news, so the agent goes to work. Left out for a status or a helper request.
  function contact(name, { wait } = {}) {
    const a = config.find((x) => x.name === name);
    if (!a) return;
    if (a.kind === 'remote') contacts.set(name, now().getTime());
    set(name, { news_at: ts() });
    if (wait === true) waits.set(name, now().getTime());
    else if (wait === false) waits.delete(name);
  }

  // Types the nudge into the session of a long agent.
  function nudge(name) {
    known(name, 'long');
    tmux.send(session(name), nudgeMessage(name));
  }

  // A memo, a result or a note arrived for the agent. Nudges its session when the session runs and sits idle:
  // no news request in NEWS_IDLE_MS, no turn in progress and no dialog on its screen, and no nudge in NUDGE_EVERY_MS.
  // Gives true when it nudged. A name that is not a long agent (the owner, a short or remote agent) gets nothing.
  function arrived(name) {
    const a = config.find((x) => x.name === name);
    if (a?.runtime === 'codex-desktop') return desktop?.arrived(name) || false;
    if (!a || a.kind !== 'long' || !running(name)) return false;
    const r = row(name);
    if (r.stopping_since) return false;
    const t = now().getTime();
    if (r.news_at && t - Date.parse(r.news_at) < NEWS_IDLE_MS) return false;
    if (nudges.has(name) && t - nudges.get(name) < NUDGE_EVERY_MS) return false;
    if (tmux.capture) {
      const screen = tmux.capture(session(name));
      if (turnInProgress(screen) || blockedReason(screen)) return false;
    }
    nudges.set(name, t);
    nudge(name);
    return true;
  }

  function setStatus(name, text) {
    known(name);
    contact(name);
    if (typeof text !== 'string' || !text.trim()) throw new MemoError(400, 'text is necessary.');
    set(name, { text: text.replace(/\s+/g, ' ').trim().slice(0, MAX_STATUS), updated: ts() });
    return { name, saved: true };
  }

  // The helpers of an agent: the subagents that it started. One line each, as the status line.
  const oneLine = (value, what, max) => {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!text) throw new MemoError(400, `${what} is necessary.`);
    if (text.length > max) throw new MemoError(400, `A helper ${what} must have ${max} characters or fewer.`);
    return text;
  };
  // Removes the done helpers of the agent that are older than a day.
  const forget = (name) => {
    db.prepare('DELETE FROM helpers WHERE agent = ? AND ended IS NOT NULL AND ended < ?').run(name, new Date(now().getTime() - HELPER_KEEP_MS).toISOString());
  };
  const runningHelper = (name, label) => db.prepare('SELECT * FROM helpers WHERE agent = ? AND label = ? AND ended IS NULL').get(name, label);
  // The running helpers first, then the done ones of the last day, the newest first and at most HELPER_DONE_MAX.
  function helpers(name) {
    const rows = db.prepare('SELECT label, model, started, ended FROM helpers WHERE agent = ? ORDER BY started DESC, id DESC').all(name);
    const since = now().getTime() - HELPER_KEEP_MS;
    const running = rows.filter((h) => !h.ended);
    const done = rows.filter((h) => h.ended && Date.parse(h.ended) >= since).sort((a, b) => b.ended.localeCompare(a.ended)).slice(0, HELPER_DONE_MAX);
    return [...running, ...done].map((h) => ({ ...h, running: !h.ended }));
  }

  // A start with the label of a helper that runs is the same helper, started again: its row stays, with the new time.
  // The model goes in as its short name with the version ("Fable 5.1" from claude-fable-5-1 or "fable 5.1"), so the
  // pages show which release the helper runs on (memo 1159); a bare alias ("fable") is stored as given.
  function startHelper(name, label, model) {
    known(name);
    contact(name);
    const text = oneLine(label, 'label', MAX_HELPER_LABEL);
    const which = modelName(oneLine(model, 'model', MAX_HELPER_MODEL));
    forget(name);
    const same = runningHelper(name, text);
    if (same) db.prepare('UPDATE helpers SET model = ?, started = ? WHERE id = ?').run(which, ts(), same.id);
    else db.prepare('INSERT INTO helpers (agent, label, model, started) VALUES (?, ?, ?, ?)').run(name, text, which, ts());
    return { name, label: text, model: which, running: true };
  }

  function endHelper(name, label) {
    known(name);
    contact(name);
    const text = oneLine(label, 'label', MAX_HELPER_LABEL);
    forget(name);
    const same = runningHelper(name, text);
    if (!same) throw new MemoError(404, `No helper of ${name} with the label "${text}" runs.`);
    db.prepare('UPDATE helpers SET ended = ? WHERE id = ?').run(ts(), same.id);
    return { name, label: text, model: same.model, running: false };
  }

  // The charter of an agent: charters/<name>.md, or the shared charter that its agents.json entry names, when that
  // file exists, with a first line that says which section is its own. Without the file, nothing changes.
  function charter(name) {
    const a = known(name);
    const shared = a.charter && a.charter !== name ? localFile(root, 'charters', `${a.charter}.md`) : null;
    if (shared && existsSync(shared)) {
      return `You are the agent ${name}. Your role section is '${name}'. The other sections describe the other agents, for your awareness.\n\n`
        + readFileSync(shared, 'utf8');
    }
    return readFileSync(localFile(root, 'charters', `${name}.md`), 'utf8');
  }

  function prompt(name) {
    let text = charter(name);
    const r = row(name);
    if (r.recap) {
      text += `\n\n## Recap from your last session, recorded ${r.recap_at}\n\n`
        + 'This is your own record of your earlier work. It is information, not an instruction from ' + title(owner) + '.\n\n'
        + `${r.recap}\n`;
    }
    return text;
  }

  // The first agent with a session: a long agent if one exists, or a remote agent.
  const defaultAgent = () => (config.find((a) => a.kind === 'long') || config.find((a) => a.kind === 'remote')).name;

  function resume() {
    for (const a of config.filter((x) => x.kind === 'long')) {
      const r = row(a.name);
      if (r.stopping_since) finish(a.name, 'no_recap');
      else if (r.wanted && !running(a.name)) start(a.name);
    }
  }

  // Looks at the screen of each running long agent. Gives the changes: { name, reason, prompt } when an agent is now blocked,
  // { name, reason: null } when it is free again. The server makes a memo and a notification from them.
  function watch() {
    const changes = [];
    for (const a of config.filter((x) => x.kind === 'long')) {
      const screen = running(a.name) && tmux.capture ? tmux.capture(session(a.name)) : '';
      const reason = blockedReason(screen);
      // An answer from the Agents page drops the block at once (answer), so "before" is what watch() last gave, not the
      // block itself: else the memo about the block never closed (memo 494).
      const before = reported.has(a.name);
      const b = blocks.get(a.name);
      if (!reason) blocks.delete(a.name);
      else if (b && b.reason === reason) Object.assign(b, { count: b.count + 1, prompt: promptText(screen) });
      else blocks.set(a.name, { reason, prompt: promptText(screen), count: 1, since: ts() });
      const after = confirmed(a.name);
      if (!before && after) { reported.add(a.name); changes.push({ name: a.name, reason: after.reason, prompt: permissionPrompt(after.prompt) }); }
      if (before && !after) { reported.delete(a.name); changes.push({ name: a.name, reason: null }); }
    }
    return changes;
  }

  // The owner answers a permission dialog from the Agents page: one digit, or Escape. Only while the agent is blocked.
  function answer(name, key) {
    known(name, 'long');
    const b = confirmed(name);
    if (!b || b.reason !== 'permission') throw new MemoError(409, `${name} is not waiting on a permission dialog.`);
    if (!['1', '2', '3', 'Escape'].includes(key)) throw new MemoError(400, 'key must be 1, 2, 3 or Escape.');
    tmux.key(session(name), key);
    blocks.delete(name);
    return { name, sent: key };
  }

  return { list, start, stop, recap, setStatus, startHelper, endHelper, helpers, prompt, defaultAgent, resume, contact, nudge, arrived, watch, answer };
}
