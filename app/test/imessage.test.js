import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { osascriptArgs, sendIMessage, validHandle, SCRIPT } from '../src/imessage.js';

// A fake osascript: records the call, then ends the way the test says.
function fakeSpawn({ code = 0, stderr = '', error, hang = false } = {}) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    if (!hang) {
      setImmediate(() => {
        if (error) { child.emit('error', error); return; }
        if (stderr) child.stderr.emit('data', stderr);
        child.emit('close', code);
      });
    }
    return child;
  };
  return { spawn, calls };
}

test('validHandle takes an E.164 number or a mail address and nothing else', () => {
  assert.equal(validHandle('+12025550123'), true);
  assert.equal(validHandle('a@b.com'), true);
  assert.equal(validHandle('2025550123'), false);
  assert.equal(validHandle('foo'), false);
  assert.equal(validHandle('"; do shell script'), false);
  assert.equal(validHandle(''), false);
  assert.equal(validHandle(undefined), false);
  assert.equal(validHandle('+1202'), false);
  assert.equal(validHandle('a@b'), false);
});

test('sendIMessage passes the handle and the text through argv, never inside the script', async () => {
  const { spawn, calls } = fakeSpawn();
  const text = 'Memo: main is blocked: sign in to Claude on the Mac';
  assert.equal(await sendIMessage('+12025550123', text, { spawn, log: () => {} }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'osascript');
  assert.deepEqual(calls[0].args, [
    '-e', 'on run argv',
    '-e', 'tell application "Messages" to send (item 2 of argv) to participant (item 1 of argv) of (1st account whose service type = iMessage)',
    '-e', 'end run',
    '+12025550123', text,
  ]);
  assert.deepEqual(calls[0].args, osascriptArgs('+12025550123', text));
  // The script lines are fixed text: the same whatever the handle and the text are, and they hold neither.
  const nasty = '" & (do shell script "rm -rf ~") & "';
  const args = osascriptArgs(nasty, nasty);
  const scriptLines = args.filter((a, i) => i % 2 === 1 && i < SCRIPT.length * 2);
  assert.deepEqual(scriptLines, SCRIPT);
  for (const line of scriptLines) assert.ok(!line.includes(nasty));
  assert.deepEqual(args.slice(-2), [nasty, nasty]);
  // No shell: the call is a direct spawn, not a shell command.
  assert.notEqual(calls[0].opts?.shell, true);
});

test('a failed send logs one short line with no handle, and is not retried', async () => {
  const handle = '+12025550123';
  const logs = [];
  const { spawn, calls } = fakeSpawn({ code: 1, stderr: `execution error: Messages got an error: Can't get participant "${handle}" of account. (-1728)\nmore` });
  assert.equal(await sendIMessage(handle, 'Memo: main is blocked', { spawn, log: (m) => logs.push(m) }), false);
  assert.equal(calls.length, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^imessage: execution error: Messages got an error: Can't get participant "<handle>" of account\. \(-1728\)$/);
  assert.ok(!logs[0].includes(handle));
  assert.ok(!logs[0].includes('more'));
});

test('a spawn error logs one line', async () => {
  const logs = [];
  const { spawn } = fakeSpawn({ error: new Error('spawn osascript ENOENT') });
  assert.equal(await sendIMessage('a@b.com', 'x', { spawn, log: (m) => logs.push(m) }), false);
  assert.deepEqual(logs, ['imessage: spawn osascript ENOENT']);
});

test('osascript that does not answer is killed after the timeout', async () => {
  const logs = [];
  const { spawn, calls } = fakeSpawn({ hang: true });
  assert.equal(await sendIMessage('a@b.com', 'x', { spawn, timeoutMs: 20, log: (m) => logs.push(m) }), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(logs, ['imessage: no answer from osascript in 0.02 seconds']);
});
