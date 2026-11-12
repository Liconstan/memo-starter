import { spawn as realSpawn } from 'node:child_process';

// A text message to the owner through the Messages app on this Mac (MEMO_ALERT_IMESSAGE). Only one fixed line
// goes out, from watchAgents in server.js: "<agent> is blocked: ...". Never memo text, never the handle in a log.

// The handle: a phone number in E.164 form (+12025550123) or an Apple ID mail address.
export function validHandle(handle) {
  if (typeof handle !== 'string') return false;
  return /^\+[0-9]{8,15}$/.test(handle) || /^[^\s@"'<>()]+@[^\s@"'<>()]+\.[^\s@"'<>()]+$/.test(handle);
}

// The AppleScript is fixed text. The handle and the message reach it only through argv (item 1 and item 2), so no
// character in them can change the script. The send goes through the iMessage account only; a failure is not retried by SMS.
export const SCRIPT = [
  'on run argv',
  'tell application "Messages" to send (item 2 of argv) to participant (item 1 of argv) of (1st account whose service type = iMessage)',
  'end run',
];

export function osascriptArgs(handle, text) {
  return [...SCRIPT.flatMap((line) => ['-e', line]), handle, text];
}

// Resolves to true when osascript exits 0, else false. Logs "imessage: <short error>" with no handle and no text.
// spawn and timeoutMs are for the tests.
export function sendIMessage(handle, text, { spawn = realSpawn, timeoutMs = 15000, log = (m) => console.error(m) } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      if (!ok) log(`imessage: ${shortError(why, handle)}`);
      resolve(ok);
    };
    let child;
    try {
      child = spawn('osascript', osascriptArgs(handle, text), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) {
      finish(false, err.message);
      return;
    }
    let stderr = '';
    child.stderr?.on('data', (chunk) => { if (stderr.length < 300) stderr += chunk; });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } finish(false, `no answer from osascript in ${timeoutMs / 1000} seconds`); }, timeoutMs);
    child.on('error', (err) => { clearTimeout(timer); finish(false, err.message); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) finish(true);
      else finish(false, stderr.trim() || `osascript exited with ${code}`);
    });
  });
}

// One short line, so a log stays readable, and never the handle: an AppleScript error can echo the participant,
// so the handle becomes "<handle>". The errors read like "execution error: Messages got an error: ... (-1728)".
function shortError(message, handle) {
  let line = String(message || 'unknown error').split('\n')[0];
  if (handle) line = line.split(handle).join('<handle>');
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}
