import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Official Codex app-server protocol. No model turn, thread, API key, or credential
// file read: Codex uses its existing sign-in and returns account quota metadata.
export function readCodexLimits({ spawnImpl = spawn, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
      kill.unref();
      child.once('close', () => clearTimeout(kill));
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Codex usage request timed out.')), timeoutMs);
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', () => finish(new Error('Codex could not start. Check its installation and sign-in.')));
    child.stdin.on('error', () => finish(new Error('Codex usage connection closed.')));
    child.on('close', () => { if (!done) finish(new Error('Codex exited before reporting usage.')); });
    lines.on('line', (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) return finish(new Error(`Codex usage unavailable (RPC ${message.error.code ?? 'error'}). Check ChatGPT sign-in.`));
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'account/rateLimits/read', id: 2 });
      } else finish(null, message.result);
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'memo_usage', title: 'Memo usage monitor', version: '0.1.0' } } });
  });
}

export function parseCodexLimits(result) {
  if (!result || typeof result !== 'object') throw new Error('Codex returned no usage data.');
  const buckets = result.rateLimitsByLimitId && Object.keys(result.rateLimitsByLimitId).length
    ? Object.entries(result.rateLimitsByLimitId) : result.rateLimits ? [[result.rateLimits.limitId || 'codex', result.rateLimits]] : [];
  const windows = [];
  const creditsByLimitId = {};
  for (const [id, bucket] of buckets) {
    const credits = bucket?.credits;
    // Unknown is not zero or available. Keep credits attached to their provider
    // bucket: an unrelated product's balance must not unlock an exhausted window.
    creditsByLimitId[id] = {
      hasCredits: typeof credits?.hasCredits === 'boolean' ? credits.hasCredits : null,
      unlimited: typeof credits?.unlimited === 'boolean' ? credits.unlimited : null,
      balance: (typeof credits?.balance === 'number' && Number.isFinite(credits.balance))
        || (typeof credits?.balance === 'string' && /^\d+(?:\.\d+)?$/.test(credits.balance)) ? credits.balance : null,
    };
    for (const key of ['primary', 'secondary']) {
      const w = bucket?.[key];
      if (!w || typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) continue;
      const minutes = w.windowDurationMins;
      const duration = minutes === 300 ? 'Session' : minutes === 10080 ? 'Week'
        : typeof minutes === 'number' && minutes > 0 ? (minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`)
          : key === 'primary' ? 'Primary' : 'Secondary';
      const reset = typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000) : null;
      windows.push({ key: `${id}-${key}`, limit_id: id, label: buckets.length === 1 ? duration : `${bucket.limitName || id} · ${duration}`,
        percent: Math.max(0, Math.min(100, w.usedPercent)),
        resets_at: reset && Number.isFinite(reset.getTime()) ? reset.toISOString() : null });
    }
  }
  // Preserve provider windows instead of pretending every OpenAI bucket is a Claude
  // 5-hour session or weekly model limit. No invented pacing/forecast for these rows.
  return { provider: 'openai', windows, credits_by_limit_id: creditsByLimitId, session: null, week: null, models: [] };
}

export function createCodexUsage({ read = readCodexLimits, now = () => new Date(), everyMs = 300000 } = {}) {
  let record = { provider: 'openai', windows: [], at: null, tried: null, error: null };
  let busy;
  const timers = [];
  function refresh() {
    if (busy) return busy;
    busy = (async () => {
      const tried = now().toISOString();
      try { record = { ...parseCodexLimits(await read()), at: now().toISOString(), tried, error: null }; }
      catch (error) { record = { ...record, tried, error: error.message }; }
    })().finally(() => { busy = null; });
    return busy;
  }
  function start() {
    timers.push(setTimeout(refresh, 1000), setInterval(refresh, everyMs));
    for (const timer of timers) timer.unref?.();
  }
  return { get: () => record, refresh, start, stop: () => { timers.forEach(clearTimeout); timers.length = 0; } };
}
