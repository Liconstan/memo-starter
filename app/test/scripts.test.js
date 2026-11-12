import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { makeApp, TOKEN, LIAISON_TOKEN, ROOT } from './helpers.js';

// The tests use the example files of the repository, not the files of this installation in local/.
process.env.MEMO_LOCAL = '/nonexistent/memo-local';
const run = promisify(execFile);
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

async function withServer(fn) {
  const made = makeApp();
  const server = await new Promise((done) => { const s = serve({ fetch: made.app.fetch, hostname: '127.0.0.1', port: 0 }, () => done(s)); });
  try { await fn({ ...made, url: `http://127.0.0.1:${server.address().port}` }); } finally { server.close(); }
}

test('agent.sh builds the start text from the charter and the recap', () => withServer(async ({ agents, url }) => {
  agents.recap('main', 'The README is complete. Next: the tests.');
  const { stdout } = await run(join(ROOT, 'scripts', 'agent.sh'), ['main'], { env: { ...process.env, MEMO_AGENT_DRY: '1', MEMO_URL: url, MEMO_TOKEN: TOKEN } });
  const [settings, prompt, options] = stdout.split('\n---\n');
  assert.deepEqual(JSON.parse(settings), {}, 'with no local/agent-settings.json, the session gets no extra settings');
  assert.ok(prompt.startsWith('# Charter: main'));
  assert.ok(prompt.includes('Recap from your last session'));
  assert.ok(prompt.includes('The README is complete. Next: the tests.'));
  // The last part is the options of claude: the model of the agent, and the Claude in Chrome integration, on by default.
  assert.equal(options, '--model claude-opus-5-5 --chrome\n');
}));

test('agent.sh starts the session without --chrome when the chrome of the agent is false', () => withServer(async ({ url }) => {
  const local = mkdtempSync(join(tmpdir(), 'memo-local-'));
  const write = (agents) => writeFileSync(join(local, 'agents.json'), JSON.stringify(agents));
  const dry = (name) => run(join(ROOT, 'scripts', 'agent.sh'), [name], { env: { ...process.env, MEMO_LOCAL: local, MEMO_AGENT_DRY: '1', MEMO_URL: url, MEMO_TOKEN: TOKEN } });
  const options = async () => (await dry('main')).stdout.split('\n---\n').at(-1);
  write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm', chrome: false }]);
  assert.equal(await options(), '--model m\n');
  write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm', chrome: true }]);
  assert.equal(await options(), '--model m --chrome\n');
  // A value that is not true or false stops the start.
  write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm', chrome: 'no' }]);
  const r = await dry('main').catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /chrome of main/);
}));

test('agent.sh gives the session the env of the agent, with the home directory put in', () => withServer(async ({ url }) => {
  const local = mkdtempSync(join(tmpdir(), 'memo-local-'));
  const write = (agents) => writeFileSync(join(local, 'agents.json'), JSON.stringify(agents));
  const dry = (name) => run(join(ROOT, 'scripts', 'agent.sh'), [name], { env: { ...process.env, MEMO_LOCAL: local, MEMO_AGENT_DRY: '1', MEMO_URL: url, MEMO_TOKEN: TOKEN, HOME: '/tmp/memo-home' } });
  write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm', env: { CLAUDE_CONFIG_DIR: '~/.claude-second', MEMO_EXAMPLE: 'a value' } }]);
  const { stdout } = await dry('main');
  const parts = stdout.split('\n---\n');
  assert.equal(parts.length, 4, 'the dry run has a third part with the variables, before the options of claude');
  assert.equal(parts[2], 'CLAUDE_CONFIG_DIR=/tmp/memo-home/.claude-second\nMEMO_EXAMPLE=a value');
  assert.equal(parts[3], '--model m --chrome\n');
  // With no env, the dry run has three parts: the settings, the start text, and the options of claude.
  write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm' }]);
  assert.equal((await dry('main')).stdout.split('\n---\n').length, 3);
  // A name that is not a variable name, or a value that is not text, stops the start. Nothing of it reaches a shell.
  for (const env of [{ 'x; rm -rf ~': '1' }, { GOOD: 1 }, { GOOD: 'two\nlines' }, ['CLAUDE_CONFIG_DIR=~/x']]) {
    write([{ name: 'main', kind: 'long', dir: '~/work', model: 'm', env }]);
    const r = await dry('main').catch((e) => e);
    assert.equal(r.code, 1, JSON.stringify(env));
    assert.match(r.stderr, /env of main/);
  }
}));

test('agent.sh refuses a name that is not a long agent', async () => {
  for (const name of ['nobody', 'liaison']) {
    const r = await run(join(ROOT, 'scripts', 'agent.sh'), [name], { env: { ...process.env, MEMO_AGENT_DRY: '1' } }).catch((e) => e);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No long agent has the name/);
  }
});

test('the example main charter has the commands and the rules that the system depends on', () => {
  const text = read('charters', 'main.md');
  for (const part of ['# Charter: main', 'memo list --to main', 'memo status --as main', 'memo wait --as main', '--hold',
    'memo recap --as main', 'memo ack', 'impact.md', '2,000 characters', 'Owner stops this session', 'local/charters/main.md', 'memo compact <id> --from main']) {
    assert.ok(text.includes(part), `charters/main.md must contain: ${part}`);
  }
});

test('the impact scale defines the five levels and the five sizes', () => {
  const text = read('impact.md');
  for (const part of ['| 5 |', '| 4 |', '| 3 |', '| 2 |', '| 1 |', '`micro`', '`short`', '`hour`', '`half-day`', '`day`']) {
    assert.ok(text.includes(part), `impact.md must contain: ${part}`);
  }
});

test('remote-agent.sh refuses a name with other characters', async () => {
  const r = await run(join(ROOT, 'scripts', 'remote-agent.sh'), ['main; rm -rf ~'], { env: { ...process.env, MEMO_REMOTE_ONCE: '1' } }).catch((e) => e);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /only a-z/);
});

test('remote-agent.sh starts nothing when the server does not answer', async () => {
  const name = `test-offline-${process.pid}`;
  const r = await run(join(ROOT, 'scripts', 'remote-agent.sh'), [name], { env: { ...process.env, MEMO_REMOTE_ONCE: '1', MEMO_URL: 'http://127.0.0.1:9', MEMO_TOKEN: TOKEN } });
  assert.equal(r.stdout, '');
});

test('pre-push-scan.sh stops a push with a secret or with a personal pattern, and passes a clean one', async () => {
  // A small repository of its own, with a copy of the script, so that the scan does not read this checkout.
  const dir = mkdtempSync(join(tmpdir(), 'memo-scan-'));
  const git = (...args) => run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir });
  const commit = async (name, text) => { writeFileSync(join(dir, name), text); await git('add', '-A'); await git('commit', '-q', '-m', `Add ${name}`); };
  mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'local'));
  copyFileSync(join(ROOT, 'scripts', 'pre-push-scan.sh'), join(dir, 'scripts', 'pre-push-scan.sh'));
  await git('init', '-q', '-b', 'main');
  await commit('base.txt', 'The start.\n');
  const scan = (range) => run('sh', [join(dir, 'scripts', 'pre-push-scan.sh'), '--range', range], { cwd: dir, env: { ...process.env, MEMO_LOCAL: join(dir, 'local') } }).catch((e) => e);
  const head = async () => (await git('rev-parse', 'HEAD')).stdout.trim();

  const base = await head();
  await commit('clean.md', 'Write to sam@example.com. The files are in /Users/you/memo.\n');
  assert.equal((await scan(`${base}..HEAD`)).code, undefined, 'example text is not a finding');

  const clean = await head();
  await commit('key.txt', `MEMO_TOKEN=${'a1B2'.repeat(8)}\n`);
  const secret = await scan(`${clean}..HEAD`);
  assert.equal(secret.code, 1);
  assert.match(secret.stderr, /key\.txt/);

  const afterKey = await head();
  // The parts are joined here so that the scan does not stop a push of this test file.
  const [host, home, mail] = [['box.tail0a1b2c', 'ts.net'].join('.'), ['', 'Users', 'robin', 'memo'].join('/'), ['robin', 'robinmail.io'].join('@')];
  await commit('note.md', `The server is at ${host}, in ${home}. Ask ${mail}.\n`);
  const personal = await scan(`${afterKey}..HEAD`);
  assert.equal(personal.code, 1);
  assert.equal(personal.stderr.split('\n').filter((l) => l.includes('note.md')).length, 1);

  // The own patterns and the allow list come from local/, which git ignores.
  const afterNote = await head();
  await commit('town.md', 'Robin lives in Springfield.\n');
  assert.equal((await scan(`${afterNote}..HEAD`)).code, undefined);
  writeFileSync(join(dir, 'local', 'scan-patterns.txt'), '# my data\nSpringfield\n');
  assert.equal((await scan(`${afterNote}..HEAD`)).code, 1);
  writeFileSync(join(dir, 'local', 'scan-allow.txt'), 'lives in Springfield\n');
  assert.equal((await scan(`${afterNote}..HEAD`)).code, undefined);

  // A scan that cannot run stops the push. It is not a clean scan.
  writeFileSync(join(dir, 'local', 'scan-patterns.txt'), 'Spring(field\n');
  const badPattern = await scan(`${afterNote}..HEAD`);
  assert.equal(badPattern.code, 2);
  assert.match(badPattern.stderr, /The scan failed/);
  writeFileSync(join(dir, 'local', 'scan-patterns.txt'), 'Springfield\n');
  writeFileSync(join(dir, 'local', 'scan-allow.txt'), 'lives in Spring(field\n');
  assert.equal((await scan(`${afterNote}..HEAD`)).code, 2);
  writeFileSync(join(dir, 'local', 'scan-allow.txt'), 'lives in Springfield\n');
  const badRange = await scan('no-such-ref..HEAD');
  assert.equal(badRange.code, 2);
  assert.match(badRange.stderr, /The scan failed/);
  assert.equal((await scan(`${afterNote}..HEAD`)).code, undefined);

  // As a hook, the script reads the refs of the push from the standard input.
  const hook = await new Promise((done) => {
    const child = execFile('sh', [join(dir, 'scripts', 'pre-push-scan.sh'), 'origin', 'url'], { cwd: dir, env: { ...process.env, MEMO_LOCAL: join(dir, 'local') } }, (error) => done(error));
    child.stdin.end(`refs/heads/main ${afterNote} refs/heads/main ${afterKey}\n`);
  });
  assert.equal(hook?.code, 1, 'the commit with the tailnet name is in the push');
});
