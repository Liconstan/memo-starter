import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);

// Uses the saved desktop session, not a new CLI model. Never use --resume here:
// that can resume on a separate CLI daemon without the desktop's native tools.
export async function queueDesktop(thread, message) {
  const { stdout } = await exec('codex', ['queue', '--thread', thread, '--message', message],
    { timeout: 20000, maxBuffer: 65536 });
  const match = stdout.match(/Queued message ([a-f0-9-]+) for thread ([a-f0-9-]+)\./i);
  if (!match || match[2] !== thread) throw new Error('Codex did not confirm the desktop queue destination.');
  return match[1];
}

// A durable outbox of wakeups. Acceptance means queued, never proof of execution.
// Restarting a server must not replay a successfully queued wakeup. An interrupted
// send is ambiguous, so retain it for inspection instead of risking duplicate work.
export function createDesktopDispatch({ db, config, root, owner, queue = queueDesktop, now = () => new Date() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS desktop_wakeups (
    agent TEXT NOT NULL, thread TEXT NOT NULL, event TEXT NOT NULL,
    state TEXT NOT NULL, at TEXT NOT NULL, queue_id TEXT,
    PRIMARY KEY(agent, thread, event)
  )`);
  db.prepare("UPDATE desktop_wakeups SET state = 'uncertain' WHERE state = 'sending'").run();
  const workers = config.filter(a => a.runtime === 'codex-desktop' && a.desktopThread);
  const inFlight = new Map();
  const insert = db.prepare('INSERT OR IGNORE INTO desktop_wakeups (agent, thread, event, state, at) VALUES (?, ?, ?, ?, ?)');
  const update = db.prepare('UPDATE desktop_wakeups SET state = ?, at = ?, queue_id = ? WHERE agent = ? AND thread = ? AND event = ?');

  function events(name) {
    const at = now().toISOString();
    const incoming = db.prepare("SELECT id, text FROM memos WHERE recipient = ? AND state = 'open' AND (until IS NULL OR until <= ?)").all(name, at);
    const results = db.prepare("SELECT id FROM memos WHERE sender = ? AND state != 'open' AND acked = 0").all(name);
    const notes = db.prepare(`SELECT n.id FROM notes n JOIN memos m ON m.id = n.memo_id
      WHERE m.sender = ? AND m.state = 'open' AND n.author = ? AND n.read = 0`).all(name, owner);
    return [...incoming.map(m => `memo:${m.id}:${createHash('sha256').update(m.text).digest('hex').slice(0, 12)}`),
      ...results.map(m => `result:${m.id}`), ...notes.map(n => `note:${n.id}`)];
  }

  async function drain(a) {
    for (;;) {
      const wanted = events(a.name);
      for (const event of wanted) insert.run(a.name, a.desktopThread, event, 'pending', now().toISOString());
      const pending = db.prepare("SELECT event FROM desktop_wakeups WHERE agent = ? AND thread = ? AND state = 'pending'")
        .all(a.name, a.desktopThread).map(x => x.event).filter(e => wanted.includes(e));
      if (!pending.length) return;
      for (const event of pending) update.run('sending', now().toISOString(), null, a.name, a.desktopThread, event);
      const message = `Memo has new work for ${a.name} (${pending.join(', ')}). `
        + `Read ${join(root, 'charters', `${a.name}.md`)} if not already current in context. `
        + `Run ${join(root, 'scripts/memo')} wait --as ${a.name} 0.01 to read tasks, results and owner notes. `
        + `Process only still-actionable items, follow the shared workflow, reply on their original memos, and acknowledge results. `
        + `Use the session model and native tools; report a missing capability rather than substituting a CLI worker. `
        + `Stop when the queue has no actionable work. This is an arrival-triggered wakeup, not a periodic model check.`;
      try {
        const id = await queue(a.desktopThread, message);
        for (const event of pending) update.run('queued', now().toISOString(), id, a.name, a.desktopThread, event);
      } catch {
        // The child might have queued before failing or timing out. No blind retry.
        for (const event of pending) update.run('uncertain', now().toISOString(), null, a.name, a.desktopThread, event);
        return;
      }
    }
  }

  function arrived(name) {
    const a = workers.find(w => w.name === name);
    if (!a) return false;
    if (!inFlight.has(name)) {
      const run = drain(a).catch(() => {
        console.error(`Desktop dispatch failed for ${name}; inspect desktop_wakeups before retrying.`);
      }).finally(() => inFlight.delete(name));
      inFlight.set(name, run);
    }
    return true;
  }
  function status(name) {
    const a = workers.find(w => w.name === name);
    if (!a) return null;
    const latest = db.prepare('SELECT state, at FROM desktop_wakeups WHERE agent = ? AND thread = ? ORDER BY at DESC LIMIT 1').get(name, a.desktopThread);
    const uncertain = db.prepare("SELECT COUNT(*) AS n FROM desktop_wakeups WHERE agent = ? AND thread = ? AND state = 'uncertain'").get(name, a.desktopThread).n;
    return { configured: true, verified: a.desktopVerified === true, model: a.model || null,
      state: uncertain ? 'uncertain' : latest?.state || 'ready', at: latest?.at || null };
  }
  return { arrived, status, scan: () => workers.forEach(a => arrived(a.name)),
    settled: () => Promise.all([...inFlight.values()]) };
}
