// Builds the GitHub Pages copy of the Inbox (README.md, "Inbox from anywhere") into site/.
//   node scripts/build-site.mjs <owner/ledger-repo> [<owner name>] [<branch>]
// The copy has only the page code. It has no memos and no keys: it reads them from the private repository with the
// GitHub key that the owner pastes on each device.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const [repo, owner = process.env.MEMO_OWNER || 'owner', branch = 'inbox'] = process.argv.slice(2);
if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo || '')) {
  console.error('Usage: node scripts/build-site.mjs <owner/ledger-repo> [<owner name>] [<branch>]');
  process.exit(1);
}
const out = join(root, 'site');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'ui'), { recursive: true });

// The pages: links and imports become relative, because a project site lives under /<repository name>/.
const config = `<script>globalThis.MEMO_LEDGER = ${JSON.stringify({ repo, owner, branch })};</script>`;
const rule = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; "
  + "connect-src https://api.github.com; frame-src 'none'; base-uri 'none'; form-action 'none'";
const page = (from, to) => {
  const html = readFileSync(join(root, 'ui', from), 'utf8')
    .replaceAll('__OWNER__', owner)
    .replaceAll('"/ui/', '"ui/')
    .replaceAll("'/ui/", "'./ui/")
    .replaceAll('href="/inbox"', 'href="index.html"')
    .replaceAll('href="/agents"', 'href="agents.html"')
    .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${rule}">\n${config}`);
  writeFileSync(join(out, to), html);
};
page('inbox.html', 'index.html');
page('agents.html', 'agents.html');

for (const file of readdirSync(join(root, 'ui'))) {
  if (file.endsWith('.html')) continue;
  if (file.endsWith('.js')) {
    writeFileSync(join(out, 'ui', file), readFileSync(join(root, 'ui', file), 'utf8').replaceAll("from '/ui/", "from './"));
  } else cpSync(join(root, 'ui', file), join(out, 'ui', file));
}
// GitHub Pages must not run Jekyll on the files.
writeFileSync(join(out, '.nojekyll'), '');
console.log(`Built site/ for ${repo}, branch ${branch}.`);
