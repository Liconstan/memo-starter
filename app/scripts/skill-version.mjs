// Keeps the text a skill has now as an old version (memo 1420; src/skilllog.js). For an agent, before it edits a
// skill by hand: `scripts/skill-version <name>`. The save of the System page does the same by itself.
//   scripts/skill-version <name> [--vault <dir>]
// The vault: --vault, or MEMO_VAULT, or MEMO_VAULT in app/.env, or ~/memo-vault. The skill: skills/agent/<name>/SKILL.md, or the
// hand-made skills/<name>/SKILL.md. The copy goes to skills/.versions/<name>/<YYYY-MM-DD-HHMM>-<hash8>.md; a text
// that is in the log already is not written again. Nothing is committed: commit the copy with your edit.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { snapshot, NAME } from '../src/skilllog.js';
// A setting of app/.env, for a run from launchd or a playbook that has no environment of its own.
const fileSetting = (name) => { try { return readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim() || ''; } catch { return ''; } };
const tilde = (p) => (p ? p.replace(/^~(?=\/|$)/, homedir()) : p);

const args = process.argv.slice(2);
const at = args.indexOf('--vault');
const vault = at !== -1 ? args.splice(at, 2)[1] : tilde(process.env.MEMO_VAULT || fileSetting('MEMO_VAULT')) || join(homedir(), 'memo-vault');
const name = args[0];
const fail = (text) => { console.error(text); process.exit(1); };
if (args.length !== 1 || !vault || !NAME.test(name) || name === 'agent') fail('Usage: scripts/skill-version <name> [--vault <dir>]\nThe name of a skill is small letters, digits and hyphens, for example email-reply-drafts.');
let text = null;
for (const file of [join(vault, 'skills', 'agent', name, 'SKILL.md'), join(vault, 'skills', name, 'SKILL.md')]) {
  try { text = readFileSync(file, 'utf8'); break; } catch { /* the next place */ }
}
if (!text) fail(`No skill ${name} in ${join(vault, 'skills')}.`);
const kept = snapshot({ vault, name, text });
console.log(`${kept.written ? 'Kept' : 'Already kept'}: ${kept.rel}`);
