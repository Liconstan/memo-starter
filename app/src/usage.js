import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

// The usage of the Claude account of each long agent, as `/usage` in Claude Code shows it: the current session (the
// 5-hour window), the current week for all models, and the current week for each model with its own limit (Fable),
// each as a percentage used with its reset time (memo 971), and with its burn rate in points per hour (memo 1047).
//
// The source is Claude Code itself: `claude -p /usage --output-format stream-json`, run with the CLAUDE_CONFIG_DIR
// of the agent (the `env` of agents.json), so an agent with a second account shows that account. `/usage` is a local
// command: it costs no model tokens, and its answer carries a structured copy of the report (`usage_report`). The
// sign-in stays in Claude Code; the server reads no token and no credentials file. The status line of Claude Code
// was the other candidate, but it gives only the session and the week, not the Fable number, and only during a turn.
export const USAGE_EVERY_MS = 5 * 60 * 1000;
const FIRST_MS = 5000;
const RUN_TIMEOUT_MS = 60000;
const ARGS = ['-p', '/usage', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--strict-mcp-config'];

const expand = (path) => (typeof path === 'string' && path.startsWith('~') ? homedir() + path.slice(1) : path);

// Runs claude with the configuration directory (or the default one with '') in the directory cwd, and gives its
// standard output. Nothing goes in on stdin, so claude does not wait for it.
export function runClaude(configDir, cwd) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (configDir) env.CLAUDE_CONFIG_DIR = configDir; else delete env.CLAUDE_CONFIG_DIR;
    const child = spawn('claude', ARGS, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`claude gave no answer in ${RUN_TIMEOUT_MS / 1000} seconds.`)); }, RUN_TIMEOUT_MS);
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`claude did not start: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`claude ended with code ${code}: ${err.trim().split('\n').pop() || 'no message'}`));
      else resolve(out);
    });
  });
}

const window = (l) => ({ percent: Math.round(Number(l.percent) || 0), resets_at: typeof l.resets_at === 'string' ? l.resets_at : null });

// The three figures from the stream-json output of `claude -p /usage`: the message with `usage_report` carries
// `rate_limits.limits`, one row per window: kind "session", "weekly_all", or "weekly_scoped" with the model in scope.
// An account with no plan limits (an API key) gives no rows: then the three are empty.
export function parseUsage(text) {
  let report;
  for (const line of String(text).split('\n')) {
    if (!line.includes('usage_report')) continue;
    try { report = JSON.parse(line).usage_report; } catch { /* a line of text, not JSON */ }
    if (report) break;
  }
  if (!report) throw new Error('The answer of claude has no usage report. Is the account signed in?');
  const limits = Array.isArray(report.rate_limits?.limits) ? report.rate_limits.limits : [];
  const result = { session: null, week: null, models: [] };
  for (const l of limits) {
    if (l.kind === 'session') result.session = window(l);
    else if (l.kind === 'weekly_all') result.week = window(l);
    else if (l.kind === 'weekly_scoped' && l.scope?.model?.display_name) result.models.push({ name: String(l.scope.model.display_name), ...window(l) });
  }
  return result;
}

// The burn rate (memo 1047): each window keeps its last 12 samples, one each 5 minutes, so an hour. `rate` is the
// points used per hour from the first to the last of them. With fewer than 3 samples, it is the average since the
// start of the window: the percent used over the hours since the reset time minus the length of the window (5 hours
// for the session, 7 days for the week and for each model). A new reset time, or a percent that fell, starts the
// samples again. No reset time gives no rate.
export const SAMPLES = 12;
const WINDOW_MS = { session: 5 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 };
const HOUR = 60 * 60 * 1000;
const round2 = (x) => Math.round(x * 100) / 100;
function rateOf(list, w, windowMs, t) {
  if (list.length >= 3) {
    const first = list[0];
    const last = list[list.length - 1];
    const hours = (last.t - first.t) / HOUR;
    return hours > 0 ? round2(Math.max(0, last.percent - first.percent) / hours) : null;
  }
  const reset = Date.parse(w.resets_at ?? '');
  if (Number.isNaN(reset)) return null;
  const hours = (t - (reset - windowMs)) / HOUR;
  return hours > 0 ? round2(w.percent / hours) : null;
}
// Adds each window of the figures to the samples of the account and gives the figures with their rates.
export function withRates(figures, samples, t) {
  const windows = [['session', figures.session, WINDOW_MS.session], ['week', figures.week, WINDOW_MS.week],
    ...(figures.models || []).map((m) => [`model-${m.name}`, m, WINDOW_MS.week])];
  const rated = (key, w, windowMs) => {
    if (!w) { samples.delete(key); return w; }
    let list = samples.get(key) || [];
    const last = list[list.length - 1];
    if (last && (last.resets_at !== w.resets_at || w.percent < last.percent)) list = [];
    list = [...list, { t, percent: w.percent, resets_at: w.resets_at }].slice(-SAMPLES);
    samples.set(key, list);
    return { ...w, rate: rateOf(list, w, windowMs, t) };
  };
  for (const key of [...samples.keys()]) if (!windows.some(([k]) => k === key)) samples.delete(key);
  return { session: rated(...windows[0]), week: rated(...windows[1]), models: windows.slice(2).map((x) => rated(...x)) };
}

// config: agents.json. run(configDir, cwd): gives the output of claude (a test gives its own). One fetch for each
// configuration directory: two agents with the same account share the figures.
export function createUsage({ config, run = runClaude, now = () => new Date(), everyMs = USAGE_EVERY_MS }) {
  const dirOf = (a) => expand(a.env?.CLAUDE_CONFIG_DIR) || '';
  const accounts = new Map(); // configDir -> { cwd, record, samples }
  for (const a of config.filter((x) => x.kind === 'long')) {
    const dir = dirOf(a);
    if (accounts.has(dir)) continue;
    const cwd = expand(a.dir);
    accounts.set(dir, { cwd: cwd && existsSync(cwd) ? cwd : homedir(), samples: new Map(), record: { at: null, tried: null, session: null, week: null, models: [], error: null } });
  }
  let busy = null;
  const timers = [];

  // Gets the figures of each account, one after the other. A failure keeps the last good figures with the error.
  function refresh() {
    if (busy) return busy;
    busy = (async () => {
      for (const [dir, account] of accounts) {
        const tried = now().toISOString();
        try {
          const parsed = parseUsage(await run(dir, account.cwd));
          const at = now();
          const figures = withRates(parsed, account.samples, at.getTime());
          account.record = { ...figures, at: at.toISOString(), tried, error: null };
        } catch (e) {
          account.record = { ...account.record, tried, error: e.message };
        }
      }
    })().finally(() => { busy = null; });
    return busy;
  }

  // The figures of an agent, for GET /api/agents: null for an agent with no session on this computer.
  function get(name) {
    const a = config.find((x) => x.name === name);
    if (!a || a.kind !== 'long') return null;
    return accounts.get(dirOf(a))?.record ?? null;
  }

  function start() {
    if (!accounts.size) return;
    const first = setTimeout(() => { refresh().catch(() => {}); }, FIRST_MS);
    const each = setInterval(() => { refresh().catch(() => {}); }, everyMs);
    first.unref?.(); each.unref?.();
    timers.push(first, each);
  }
  function stop() { for (const t of timers) clearTimeout(t); timers.length = 0; }

  return { get, refresh, start, stop };
}
