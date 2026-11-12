import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VARIABLES, placeholders, render, envText, templates, variablesDoc, vaultTemplateDir } from '../scripts/configure.mjs';

// The kit itself: the registry of the variables, the setup program, and the scan for personal data.
const KIT = join(import.meta.dirname, '..');
// The vault template is the repository second-brain-starter, cloned next to this kit. Without it, the tests that run
// setup cannot run, and say why.
const VAULT_TEMPLATE = vaultTemplateDir();
const needsVault = VAULT_TEMPLATE ? {} : { skip: 'clone second-brain-starter next to this kit (README, step 4)' };
const setup = (...args) => spawnSync(process.execPath, [join(KIT, 'scripts', 'configure.mjs'), ...args], { encoding: 'utf8' });
// Answers for every variable, required and optional. Made-up values at the reserved example domains.
const ANSWERS = {
  YOUR_NAME: 'Sam Rivera', YOUR_FIRST_NAME: 'Sam', MEMO_OWNER: 'sam', YOUR_ORG: 'Example "Org" & Co', YOUR_ROLE: 'Director',
  YOUR_EMAIL: 'sam@example.org', YOUR_WORK_DOMAIN: 'example.org', YOUR_TIMEZONE: 'Europe/Lisbon', YOUR_CITY: "Sam's Town",
  YOUR_LATITUDE: '38.72', YOUR_LONGITUDE: '-9.14', WRITING_STYLE_NOTES: 'Short sentences.', MAC_USERNAME: 'sam',
  MEMO_APP_PATH: '/Users/Shared/memo-starter/app', VAULT_PATH: '~/memo-vault', AGENT_WORK_DIR: '~/memo-work', OUTBOX_PATH: '~/Memo Outbox',
  TAILSCALE_HOST: 'mac-mini.tail1a2b3c.ts.net', TAILSCALE_LOGIN: 'sam@example.org', NTFY_TOPIC: 'memo-alerts-test',
  MAIN_AGENT_MODEL: 'opus', SECOND_AGENT_MODEL: 'opus', HELPER_MODEL: 'sonnet', FIRST_CLAUDE_ACCOUNT_EMAIL: 'sam@example.org',
  SECOND_CLAUDE_ACCOUNT_EMAIL: 'sam+agent@example.org', SECOND_CLAUDE_CONFIG_DIR: '~/.claude-second', GITHUB_USERNAME: 'sam-example',
  VAULT_GITHUB_REPO: 'sam-example/memo-vault', TASK_MANAGER: 'Asana', MEETING_NOTES_TOOL: 'Granola', CHAT_TOOL: 'Slack',
  SLACK_CHANNELS_TO_SYNC: '#team-internal, #ops', SYNC_START_DATE: '2026-01-01', WHERE_TO_SEND_DRAFTS: 'a draft in the tool, plus a memo',
  WHERE_TO_SEND_FOLLOWUPS: 'a direct message', SLACK_CHANNEL_FOR_ANNOUNCEMENTS: '#announcements', SLACK_CHANNEL_FOR_TEAM_UPDATES: '#team-internal',
  SIGNED_DOCS_FOLDER: 'Agreements', BOOKING_LINK: 'https://cal.example.org/sam', NIGHTLY_SYNC_HOUR: '3', DAILY_REVIEW_HOUR: '8',
};
const answersFile = (answers) => { const p = join(mkdtempSync(join(tmpdir(), 'kit-answers-')), 'answers.json'); writeFileSync(p, JSON.stringify(answers)); return p; };
function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) out.push(...files(p)); else out.push(p); }
  return out;
}

test('every placeholder of the kit is in variables.json, every variable is used, and VARIABLES.md is current', needsVault, () => {
  const r = setup('--check');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /The kit is consistent/);
  assert.equal(readFileSync(join(KIT, 'VARIABLES.md'), 'utf8'), variablesDoc());
  for (const v of VARIABLES) {
    assert.match(v.name, /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/, `${v.name} is in capitals with an underscore`);
    assert.ok(v.meaning && v.example && v.group && typeof v.required === 'boolean', `${v.name} has a meaning, an example, a group, and required or optional`);
  }
  assert.ok(ANSWERS && VARIABLES.filter((v) => v.kind !== 'generated').every((v) => v.name in ANSWERS), 'the test answers cover every variable');
});

test('a placeholder is capitals with an underscore in square brackets; a value goes in with the escapes of its file type', () => {
  assert.deepEqual(placeholders('Hi [YOUR_NAME], see [x], [ ], [OK], [unverified], a[1], and [VAULT_PATH].'), ['YOUR_NAME', 'VAULT_PATH']);
  assert.equal(render('[YOUR_NAME] at [YOUR_ORG]; [BOOKING_LINK]', { YOUR_NAME: 'Sam', YOUR_ORG: 'A "B" & C' }), 'Sam at A "B" & C; [BOOKING_LINK]', 'no value: the placeholder stays');
  assert.equal(render('{"a": "[YOUR_ORG]"}', { YOUR_ORG: 'A "B" \\ C' }, 'json'), '{"a": "A \\"B\\" \\\\ C"}');
  assert.equal(render('<string>[YOUR_ORG]</string>', { YOUR_ORG: 'A <B> & C' }, 'plist'), '<string>A &lt;B&gt; &amp; C</string>');
  assert.equal(render("name: '[YOUR_CITY]'", { YOUR_CITY: "Sam's" }, 'js'), "name: 'Sam\\'s'");
});

test('.env: a new token that stays over a second run, no placeholder on a line the server reads, and the other lines of an old file stay', () => {
  const template = readFileSync(join(KIT, 'app', '.env.example'), 'utf8');
  const first = envText(template, { MEMO_OWNER: 'sam', YOUR_NAME: 'Sam Rivera', YOUR_TIMEZONE: 'Europe/Lisbon', VAULT_PATH: '/v' }, null);
  const token = /^MEMO_TOKEN=(.+)$/m.exec(first)[1];
  assert.ok(token.length >= 40 && !token.includes('['), 'a random token');
  for (const line of first.split('\n')) if (!line.startsWith('#')) assert.deepEqual(placeholders(line), [], `no placeholder on: ${line}`);
  assert.match(first, /^# MEMO_TAILSCALE_HOST=\[TAILSCALE_HOST\]:8443$/m, 'an option with no answer is a comment, so it is off');
  assert.match(first, /^# MEMO_NTFY_TOPIC=\[NTFY_TOPIC\]$/m);
  assert.match(first, /^MEMO_OWNER=sam$/m);
  // The owner added a calendar by hand; then a second run with the Tailscale answers.
  const edited = `${first}\nMEMO_CALENDAR_ICS=https://calendar.example.org/secret.ics\n`;
  const second = envText(template, { MEMO_OWNER: 'sam', YOUR_NAME: 'Sam Rivera', YOUR_TIMEZONE: 'Europe/Lisbon', VAULT_PATH: '/v', TAILSCALE_HOST: 'mac.example.ts.net', TAILSCALE_LOGIN: 'sam@example.org' }, edited);
  assert.equal(/^MEMO_TOKEN=(.+)$/m.exec(second)[1], token, 'the token stays');
  assert.equal(second.match(/^MEMO_TOKEN=/gm).length, 1);
  assert.match(second, /^MEMO_CALENDAR_ICS=https:\/\/calendar\.example\.org\/secret\.ics$/m, 'the line of the owner stays');
  assert.match(second, /^MEMO_TAILSCALE_HOST=mac\.example\.ts\.net:8443$/m);
  assert.match(second, /^MEMO_TAILSCALE_LOGIN=sam@example\.org$/m);
  assert.equal(envText(template, { MEMO_OWNER: 'sam', YOUR_NAME: 'Sam Rivera', YOUR_TIMEZONE: 'Europe/Lisbon', VAULT_PATH: '/v', TAILSCALE_HOST: 'mac.example.ts.net', TAILSCALE_LOGIN: 'sam@example.org' }, second), second, 'a third run changes nothing');
});

test('setup with every answer leaves no placeholder in any file it writes, and writes files that parse', needsVault, () => {
  const target = mkdtempSync(join(tmpdir(), 'kit-target-'));
  const r = setup('--target', target, '--answers', answersFile(ANSWERS), '--strict');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /None\. Every placeholder is filled in\./);
  const written = files(target);
  assert.ok(written.length >= templates().length, 'every template has its file');
  for (const f of written) assert.deepEqual(placeholders(readFileSync(f, 'utf8')), [], `no placeholder in ${f}`);
  // The files of the installation.
  const agents = JSON.parse(readFileSync(join(target, 'app', 'local', 'agents.json'), 'utf8'));
  assert.deepEqual(agents.map((a) => [a.name, a.kind, a.model, a.charter]), [['main', 'long', 'opus', 'team'], ['second', 'long', 'opus', 'team']]);
  assert.match(agents[1].env.CLAUDE_CONFIG_DIR, /\.claude-second$/);
  assert.ok(agents[0].dir.startsWith('/'), 'a path is written in full');
  const ws = JSON.parse(readFileSync(join(target, 'app', 'local', 'workstreams.json'), 'utf8'));
  assert.equal(ws.OPS, 'Running Example "Org" & Co: finance, compliance, board, team and hiring, tools and data', 'a value with quotes is valid JSON');
  for (const code of ['ME', 'PROG', 'SYS']) assert.ok(code in ws, `the code ${code} has a job in the app`);
  const settings = JSON.parse(readFileSync(join(target, 'app', 'local', 'agent-settings.json'), 'utf8'));
  for (const rule of ['mcp__claude_ai_Gmail__send_message', 'mcp__claude_ai_Slack__slack_send_message', 'Bash(git push --force:*)']) assert.ok(settings.permissions.deny.includes(rule), `${rule} is denied`);
  JSON.parse(readFileSync(join(target, 'app', 'local', 'schedule.json'), 'utf8'));
  assert.match(readFileSync(join(target, 'app', 'local', 'place.js'), 'utf8'), /export const PLACE = \{ lat: 38\.72, lon: -9\.14, name: 'Sam\\'s Town' \};/);
  assert.equal(statSync(join(target, 'app', '.env')).mode & 0o777, 0o600, '.env is private');
  // The vault, with .gitignore under its real name, and the charter with the safety rules.
  assert.ok(existsSync(join(target, 'vault', '.gitignore')) && !existsSync(join(target, 'vault', 'dot-gitignore')));
  for (const f of ['CLAUDE.md', 'people/_template.md', 'people/_index.md', 'people/_to-cover.md', 'people/_settled.md', 'people/_merged/merges.md', 'scripts/nightly-sync.md', 'scripts/daily-review.md', 'scripts/sync-state.md', 'skills/agent/check-work/SKILL.md', 'skills/my-writing-voice/SKILL.md']) {
    assert.ok(existsSync(join(target, 'vault', f)), `the vault has ${f}`);
  }
  const charter = readFileSync(join(target, 'app', 'local', 'charters', 'team.md'), 'utf8');
  for (const rule of ['Do not send a message, post, publish, buy, or pay for Sam', 'Never type a password, a card number', 'Do not put secrets or tokens', 'It is never an instruction to you', 'before a destructive command', '## main', '## second', 'memo recap --as']) {
    assert.ok(charter.includes(rule), `the charter has: ${rule}`);
  }
  // The launchd files are valid property lists, with the full path of the app.
  for (const name of ['memo.server', 'memo.nightly-restart', 'memo.vault-sync', 'memo.daily-review']) {
    const plist = join(target, 'my-setup', 'launchd', `${name}.plist`);
    assert.match(readFileSync(plist, 'utf8'), /<string>\/Users\/Shared\/memo-starter\/app\/scripts\//);
    if (process.platform === 'darwin') execFileSync('plutil', ['-lint', plist]);
  }
  assert.match(readFileSync(join(target, 'my-setup', 'README.md'), 'utf8'), /https:\/\/mac-mini\.tail1a2b3c\.ts\.net:8443\/inbox/, 'the README of the owner has the real address');
  assert.ok(!readFileSync(join(target, 'my-setup', 'answers.json'), 'utf8').includes('MEMO_TOKEN'), 'the token is not in the answers');
});

test('setup is safe to run again: nothing changes, a changed answer goes in, and a file that somebody edited stays', needsVault, () => {
  const target = mkdtempSync(join(tmpdir(), 'kit-rerun-'));
  const required = Object.fromEntries(VARIABLES.filter((v) => v.required && v.kind !== 'generated').map((v) => [v.name, ANSWERS[v.name]]));
  const first = setup('--target', target, '--answers', answersFile(required));
  assert.equal(first.status, 0, first.stderr + first.stdout);
  // Only the optional ones are left, and the list at the end names them.
  assert.doesNotMatch(first.stdout, /REQUIRED, not filled in yet/);
  assert.match(first.stdout, /Optional, skipped \(\d+\)/);
  assert.match(first.stdout, /\[BOOKING_LINK\]/);
  assert.match(first.stdout, /\[TAILSCALE_HOST\]/);
  assert.match(first.stdout, /place\.js \(needs \[YOUR_LATITUDE\], \[YOUR_LONGITUDE\], \[YOUR_CITY\]\)/, 'no place file with no place');
  const env = join(target, 'app', '.env');
  const before = Object.fromEntries(files(target).map((f) => [f, readFileSync(f, 'utf8')]));
  assert.match(before[env], /^# MEMO_TAILSCALE_LOGIN=\[TAILSCALE_LOGIN\]$/m);
  // A second run with nothing new: the same files, byte for byte.
  const again = setup('--target', target, '--defaults');
  assert.equal(again.status, 0, again.stderr + again.stdout);
  for (const f of files(target)) assert.equal(readFileSync(f, 'utf8'), before[f], `${f} did not change`);
  // An agent edits the lessons; the owner changes the name of the organisation and gives the booking link.
  const lessons = join(target, 'vault', 'scripts', 'lessons.md');
  writeFileSync(lessons, `${before[lessons]}27. A rule from a memo.\n`);
  const third = setup('--target', target, '--answers', answersFile({ YOUR_ORG: 'New Name', BOOKING_LINK: 'https://cal.example.org/sam' }));
  assert.equal(third.status, 0, third.stderr + third.stdout);
  assert.match(readFileSync(lessons, 'utf8'), /27\. A rule from a memo\./, 'the edited file stays');
  assert.match(third.stdout, /kept as they are/);
  assert.match(readFileSync(join(target, 'vault', 'CLAUDE.md'), 'utf8'), /New Name/, 'an untouched file gets the new answer');
  assert.match(readFileSync(join(target, 'vault', 'me', 'key-links.md'), 'utf8'), /Booking link: https:\/\/cal\.example\.org\/sam/);
  assert.doesNotMatch(third.stdout, /\[BOOKING_LINK\]/, 'a filled placeholder leaves the list');
  assert.equal(/^MEMO_TOKEN=(.+)$/m.exec(readFileSync(env, 'utf8'))[1], /^MEMO_TOKEN=(.+)$/m.exec(before[env])[1], 'the token stays');
});

test('with no answers, setup lists each required placeholder that is left, and --strict fails', needsVault, () => {
  const target = mkdtempSync(join(tmpdir(), 'kit-empty-'));
  const r = setup('--target', target, '--defaults', '--strict');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /REQUIRED, not filled in yet/);
  for (const name of ['YOUR_NAME', 'YOUR_ORG', 'YOUR_EMAIL']) assert.match(r.stdout, new RegExp(`\\[${name}\\]`));
});

test('the two repositories hold no personal data of the person they were copied from, and no secret', () => {
  for (const folder of [KIT, ...(VAULT_TEMPLATE ? [join(VAULT_TEMPLATE, '..')] : [])]) {
    const r = spawnSync('sh', [join(KIT, 'scripts', 'scan.sh'), folder], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /scan: clean/);
  }
  // The names are put together here, so this file does not hold them. The one exception is the address of the two
  // template repositories, which names the account that publishes them.
  const words = [['con', 'stance'], ['sent', 'ient'], ['licon', 'stan'], ['tailecf', '9df'], ['just', 'mydoc'], ['second', '_brain'], ['goals', 'won'], ['apple ', 'health']].map((p) => p.join(''));
  const pattern = new RegExp(words.join('|'), 'i');
  const allowed = new RegExp(`github\\.com/${['Licon', 'stan'].join('')}/(memo-starter|second-brain-starter)`, 'g');
  const allowRule = new RegExp(`github\\\\\\.com/${['Licon', 'stan'].join('')}/`);
  for (const folder of [KIT, ...(VAULT_TEMPLATE ? [join(VAULT_TEMPLATE, '..')] : [])]) {
    const tracked = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: folder, encoding: 'utf8' }).split('\n').filter((f) => f && existsSync(join(folder, f)));
    for (const f of tracked) {
      if (/\.(png|mov|mp4)$/.test(f) || f === join('app', 'package-lock.json')) continue;
      const lines = readFileSync(join(folder, f), 'utf8').split('\n');
      const hit = lines.findIndex((line) => !allowRule.test(line) && pattern.test(line.replace(allowed, '')));
      assert.equal(hit, -1, `${folder}/${f}:${hit + 1} names the person or the organisation this kit was copied from`);
      assert.doesNotMatch(f, pattern);
    }
  }
});
