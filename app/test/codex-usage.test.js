import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readCodexLimits, parseCodexLimits, createCodexUsage } from '../src/codex-usage.js';

const report = { rateLimits: { limitId: 'codex', primary: { usedPercent: 20, windowDurationMins: 300, resetsAt: 1800000000 }, secondary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: 1800100000 } } };

test('Codex quota uses actual windows, prefers multiple buckets, and omits missing readings', () => {
  const p = parseCodexLimits(report);
  assert.equal(p.provider, 'openai');
  assert.deepEqual(p.windows.map(w => [w.label, w.percent]), [['Session', 20], ['Week', 35]]);
  assert.equal(p.windows[0].resets_at, new Date(1800000000000).toISOString());
  const multi = parseCodexLimits({ ...report, rateLimitsByLimitId: {
    one: { limitName: 'One', primary: { usedPercent: 0, windowDurationMins: 60 } },
    two: { primary: { usedPercent: null }, secondary: { usedPercent: 102, windowDurationMins: 15 } },
  } });
  assert.deepEqual(multi.windows.map(w => [w.label, w.percent, w.resets_at]), [['One · 1h', 0, null], ['two · 15m', 100, null]]);
  assert.deepEqual(parseCodexLimits({ rateLimits: { primary: null } }).windows, []);
  assert.throws(() => parseCodexLimits(null), /no usage/);
});

test('Codex preserves credit metadata per bucket without inventing unknown balances or availability', () => {
  const available = parseCodexLimits({ rateLimits: { ...report.rateLimits, credits: { hasCredits: true, unlimited: false, balance: null } } });
  assert.deepEqual(available.credits_by_limit_id.codex, { hasCredits: true, unlimited: false, balance: null });
  assert.ok(available.windows.every(w => w.limit_id === 'codex'));
  assert.deepEqual(parseCodexLimits(report).credits_by_limit_id.codex, { hasCredits: null, unlimited: null, balance: null });
  const multi = parseCodexLimits({ rateLimitsByLimitId: {
    codex: { ...report.rateLimits, credits: { hasCredits: false, unlimited: false, balance: '0' } },
    other: { ...report.rateLimits, credits: { hasCredits: true, unlimited: true, balance: '12.5' } },
    unknown: { credits: { hasCredits: 'true', unlimited: 1, balance: 'unknown' } },
  } });
  assert.deepEqual(multi.credits_by_limit_id.codex, { hasCredits: false, unlimited: false, balance: '0' });
  assert.deepEqual(multi.credits_by_limit_id.other, { hasCredits: true, unlimited: true, balance: '12.5' });
  assert.deepEqual(multi.credits_by_limit_id.unknown, { hasCredits: null, unlimited: null, balance: null });
  assert.deepEqual(multi.windows.map(w => w.limit_id), ['codex', 'codex', 'other', 'other']);
});

function fakeServer(answer) {
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close', 0)); };
  child.stdin.on('data', chunk => {
    for (const line of chunk.toString().trim().split('\n')) {
      const request = JSON.parse(line); calls.push(request);
      if (request.method === 'initialize') queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 1, result: {} }) + '\n'));
      if (request.method === 'account/rateLimits/read' && answer) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: 2, ...answer }) + '\n'));
    }
  });
  return { calls, spawnImpl: () => child };
}

test('Codex monitor performs only handshake and quota read, without starting a model', async () => {
  const fake = fakeServer({ result: report });
  assert.deepEqual(await readCodexLimits(fake), report);
  assert.deepEqual(fake.calls.map(c => c.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  const denied = fakeServer({ error: { code: 401, message: 'private detail' } });
  await assert.rejects(readCodexLimits(denied), e => /401/.test(e.message) && !e.message.includes('private detail'));
  await assert.rejects(readCodexLimits({ ...fakeServer(null), timeoutMs: 10 }), /timed out/);
});

test('Codex refresh coalesces calls and retains the timestamp of last good data on failure', async () => {
  let resolve;
  let clock = new Date('2026-11-08T00:00:00Z');
  let calls = 0;
  const monitor = createCodexUsage({ now: () => clock, read: () => {
    calls++;
    return calls === 1 ? new Promise(r => { resolve = r; }) : Promise.reject(new Error('offline'));
  } });
  const first = monitor.refresh();
  assert.equal(monitor.refresh(), first);
  resolve(report); await first;
  clock = new Date('2026-11-08T00:20:00Z');
  await monitor.refresh();
  assert.equal(calls, 2);
  assert.equal(monitor.get().at, '2026-11-08T00:00:00.000Z');
  assert.equal(monitor.get().tried, clock.toISOString());
  assert.equal(monitor.get().error, 'offline');
  assert.equal(monitor.get().windows[0].percent, 20);
});
