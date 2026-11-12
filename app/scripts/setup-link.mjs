// Makes the one-time setup link of the GitHub Pages Inbox (README.md, "Inbox from anywhere") and copies it to the clipboard.
//   node scripts/setup-link.mjs <address of the GitHub Pages Inbox>
// It asks for the GitHub key, reads MEMO_TOKEN from .env, and prints nothing secret. Send the link to each device
// (AirDrop, or Universal Clipboard), open it once, and delete it. The link holds both keys: treat it as a password.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const page = process.argv[2];
if (!/^https:\/\//.test(page || '')) {
  console.error('Usage: node scripts/setup-link.mjs https://<you>.github.io/<repository>/');
  process.exit(1);
}
const env = readFileSync(join(import.meta.dirname, '..', '.env'), 'utf8');
const memo = /^MEMO_TOKEN=(.*)$/m.exec(env)?.[1]?.trim();
if (!memo) {
  console.error('MEMO_TOKEN is not in .env.');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const gh = (await rl.question('Paste the GitHub key, then press Return: ')).trim();
rl.close();
if (!gh) process.exit(1);
const code = Buffer.from(`${gh}\n${memo}`).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
spawnSync('pbcopy', { input: `${page.replace(/#.*$/, '')}#setup=${code}` });
console.log('The setup link is on the clipboard. Open it once on each device, then delete it from wherever you sent it.');
