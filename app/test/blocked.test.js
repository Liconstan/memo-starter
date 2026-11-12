import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createAgents, blockedReason } from '../src/agents.js';
import { blockText, permissionPrompt, redactSecrets } from '../src/block-text.js';
import { ROOT } from './helpers.js';

const PERMISSION = ['⏺ Bash(gh repo create)', '', 'Bash command', '  gh repo create x', '', 'Do you want to proceed?', '❯ 1. Yes',
  "  2. Yes, and don't ask again for gh commands", '  3. No, and tell Claude what to do differently (esc)'].join('\n');
const LOGIN = ['⏺ Working', '  ⎿  API Error: 401 {"type":"error","error":{"type":"authentication_error"}} · Please run /login', '', '❯ '].join('\n');
const IDLE = ['⏺ Done.', '', '────', '❯ ', '────', '  ⏵⏵ auto mode on'].join('\n');

test('blockedReason reads a sign-in error and a permission dialog at the bottom of the screen', () => {
  assert.equal(blockedReason(PERMISSION), 'permission');
  assert.equal(blockedReason(LOGIN), 'sign-in');
  assert.equal(blockedReason(IDLE), null);
  // The same words higher up are the transcript, not a dialog.
  assert.equal(blockedReason([PERMISSION, ...Array(40).fill('⏺ more work')].join('\n')), null);
});

function setup(screen) {
  const keys = [];
  const tmux = { has: () => true, start() {}, kill() {}, send() {}, capture: () => screen.text, key: (s, k) => keys.push([s, k]) };
  const agents = createAgents({ db: openDb(), config: [{ name: 'main', kind: 'long', dir: '~/p', model: 'm' }], root: ROOT, tmux });
  return { agents, keys };
}

test('an agent counts as blocked after two checks in a row, and as free when the dialog is gone', () => {
  const screen = { text: PERMISSION };
  const { agents } = setup(screen);
  assert.deepEqual(agents.watch(), []);
  assert.equal(agents.list()[0].blocked, null);
  assert.deepEqual(agents.watch(), [{ name: 'main', reason: 'permission', prompt: 'Bash(gh repo create)\nBash command\ngh repo create x\nDo you want to proceed?' }]);
  assert.equal(agents.list()[0].blocked.reason, 'permission');
  assert.match(agents.list()[0].blocked.prompt, /Do you want to proceed\?/);
  assert.deepEqual(agents.watch(), []);
  screen.text = IDLE;
  assert.deepEqual(agents.watch(), [{ name: 'main', reason: null }]);
});

test('the owner can answer only a permission dialog, with a digit or Escape', () => {
  const screen = { text: LOGIN };
  const { agents, keys } = setup(screen);
  agents.watch(); agents.watch();
  assert.throws(() => agents.answer('main', '1'), /not waiting on a permission dialog/);
  screen.text = PERMISSION;
  agents.watch(); agents.watch();
  assert.throws(() => agents.answer('main', 'y'), /key must be/);
  assert.deepEqual(agents.answer('main', '2'), { name: 'main', sent: '2' });
  assert.deepEqual(keys, [['memo-main', '2']]);
});

// Memo 494: an answer from the Agents page drops the block at once. The next check still gives the agent as free, so
// the memo about the block closes.
test('after an answer from the Agents page, the agent is given as free again', () => {
  const screen = { text: PERMISSION };
  const { agents } = setup(screen);
  agents.watch();
  assert.deepEqual(agents.watch(), [{ name: 'main', reason: 'permission', prompt: 'Bash(gh repo create)\nBash command\ngh repo create x\nDo you want to proceed?' }]);
  agents.answer('main', '1');
  screen.text = IDLE;
  assert.deepEqual(agents.watch(), [{ name: 'main', reason: null }]);
  assert.deepEqual(agents.watch(), []);
});

test('the short permission prompt omits terminal borders and answer choices', () => {
  const prompt = ['╭────╮', '⏺ Bash(echo hello)', '  echo hello', 'Do you want to run this command?', '❯ 1. Yes', '  2. No'].join('\n');
  assert.equal(permissionPrompt(prompt), 'Bash(echo hello)\necho hello\nDo you want to run this command?');
  assert.ok(permissionPrompt('Bash\n' + 'word '.repeat(120)).length <= 400);
  assert.ok(permissionPrompt('Bash\n' + 'word '.repeat(120)).length > 300);
});

test('secrets are redacted before a permission prompt reaches a memo', () => {
  const raw = 'password=short token="two words" key=abc secret=xyz Authorization: Basic abc\nBearer hidden sk-private ghp_private xoxb-private 0123456789abcdef0123 QWxhZGRpbjpvcGVuIHNlc2FtZQ==';
  const clean = redactSecrets(raw);
  for (const secret of ['short', 'two words', 'abc', 'xyz', 'hidden', 'sk-private', 'ghp_private', 'xoxb-private', '0123456789abcdef0123', 'QWxhZGRpbjpvcGVuIHNlc2FtZQ==']) {
    assert.doesNotMatch(clean, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(clean, /password=redacted token=redacted key=redacted secret=redacted Authorization: redacted/);
  assert.match(clean, /Bearer redacted redacted redacted redacted redacted redacted/);
  assert.equal(permissionPrompt('Bash\n' + 'x'.repeat(500)), 'Bash\nredacted');
});

test('a permission memo explains the action after its first line', () => {
  const text = blockText('main', 'permission', 'Bash\ngh repo create x --token=abc\n❯ 1. Yes');
  assert.match(text, /^\*\*main waits for you to answer a permission question\.\*\*\n\nWhat it asks to do:\nBash\ngh repo create x --token=redacted\n\n/);
  assert.match(text, /Open the Agents page in Memo/);
  assert.match(text, /This memo closes by itself when main works again\./);
  assert.doesNotMatch(text, /\babc\b|1\. Yes/);
  assert.doesNotMatch(blockText('main', 'permission'), /What it asks to do:/);
  assert.doesNotMatch(blockText('main', 'sign-in', 'secret=abc'), /What it asks to do:|secret=abc/);
});
