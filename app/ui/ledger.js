// The Inbox from anywhere (README.md, "Inbox from anywhere"). On the GitHub Pages copy of the Inbox, api() of common.js
// comes here instead of going to the computer of the owner. The page reads state/inbox.json from the private repository
// and writes each action as a signed file in outbox/. The computer (src/ledger.js) applies the files when it is on.
// Until then the page shows each action as done, from the files that wait in outbox/.
import { setCheckBox } from './markdown.js';

const GH_KEY = 'memo-gh-token';
const MEMO_KEY = 'memo-token';
const STALE_MS = 15 * 60 * 1000;
const config = () => globalThis.MEMO_LEDGER || {};
const read = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* a private window: the page asks again */ } };

// A setup link: #setup=<base64url of "github key newline memo token">, from the Set up phone card (src/app.js) or
// scripts/setup-link.mjs. The code can come with or without the = padding. The keys of a link, or of its code alone
// (what the owner pastes into the form), or null when the text is not a setup link.
export function keysOfLink(text) {
  const m = /#setup=([A-Za-z0-9+/=_-]+)/.exec(text) || /^([A-Za-z0-9+/=_-]+)$/.exec(text.trim());
  if (!m) return null;
  const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
  try {
    const [gh, memo] = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)).split('\n');
    return gh?.trim() && memo?.trim() ? { gh: gh.trim(), memo: memo.trim() } : null;
  } catch { return null; }
}

// The part after # never goes to a server. The page saves the two keys and removes them from the address, so they
// are not in the history or a bookmark.
(function setupFromLink() {
  const hash = globalThis.location?.hash || '';
  if (!hash.startsWith('#setup=')) return;
  const keys = keysOfLink(hash);
  if (keys) { write(GH_KEY, keys.gh); write(MEMO_KEY, keys.memo); }
  history.replaceState(null, '', location.pathname + location.search);
})();

let state = null;          // the last state/inbox.json
const files = new Map();   // name of a file in outbox/ -> its entry
const mine = new Map();    // nonce -> an entry that this page wrote, until state/inbox.json is newer than it

export class LedgerAuthError extends Error {}

// keepalive: the request goes on when the page closes (a draft that must be saved).
async function gh(method, path, body, raw = false, { keepalive = false } = {}) {
  const token = read(GH_KEY);
  if (!token) throw new LedgerAuthError('Paste your setup link.');
  const r = await fetch(`https://api.github.com/repos/${config().repo}${path}`, {
    method,
    cache: 'no-cache',
    headers: { Authorization: `Bearer ${token}`, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    keepalive,
  });
  if (r.status === 401 || r.status === 403) throw new LedgerAuthError('GitHub did not accept the key. Paste the setup link again.');
  if (r.status === 404) return null;
  if (!r.ok) throw Object.assign(new Error(`GitHub gave status ${r.status}.`), { status: r.status });
  return raw ? r.text() : r.json();
}

const branch = () => config().branch || 'inbox';

// HMAC-SHA256 with the Memo token, as src/ledger.js checks it.
async function signature(entry) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(read(MEMO_KEY)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const text = `${entry.path}\n${JSON.stringify(entry.body)}\n${entry.at}\n${entry.nonce}`;
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The name of the repository, for the owner: "me/memo-ledger" is memo-ledger.
const repoName = () => String(config().repo || '').split('/').pop();

// The Agents page reads /api/agents each 5 seconds; the state behind it is read again when it is older than this.
// Before memo 494 only /api/queue read it again, so a question that was answered stayed on the Agents page.
const AGENTS_FRESH_MS = 15 * 1000;
let readAt = 0;
async function refresh() {
  const text = await gh('GET', `/contents/state/inbox.json?ref=${branch()}`, null, true);
  if (text === null) {
    // A fine-grained key that cannot open the repository gets 404 for each file, the same as a file that is not there.
    // The repository itself tells the two apart.
    if (!(await gh('GET', ''))) throw new LedgerAuthError(`Your GitHub key cannot open your private Inbox repository, ${repoName()}. On GitHub, open Settings, Developer settings, Fine-grained tokens, click the key, and under Repository access add ${repoName()} with Contents: Read and write. Then paste the setup link again.`);
    throw new Error('Your Mac has not published the Inbox yet. Keep the Mac on for a minute and reload.');
  }
  state = JSON.parse(text);
  readAt = Date.now();
  const listing = (await gh('GET', `/contents/outbox?ref=${branch()}`)) || [];
  const names = new Set(listing.filter((f) => f.type === 'file').map((f) => f.name));
  for (const name of [...files.keys()]) if (!names.has(name)) files.delete(name);
  for (const name of names) {
    if (files.has(name)) continue;
    try { files.set(name, JSON.parse(await gh('GET', `/contents/outbox/${encodeURIComponent(name)}?ref=${branch()}`, null, true))); } catch { /* not an entry */ }
  }
  const generated = Date.parse(state.generated || 0);
  for (const [nonce, e] of mine) if (Date.parse(e.at) < generated) mine.delete(nonce);
  banner(generated);
}

// A line at the top of the page when the computer has not written for a while.
function banner(generated) {
  let node = document.getElementById('ledger-banner');
  if (!node) {
    node = document.createElement('p');
    node.id = 'ledger-banner';
    node.setAttribute('role', 'status');
    node.className = 'ledger-banner';
    document.body.prepend(node);
  }
  const old = !generated || Date.now() - generated > STALE_MS;
  node.hidden = !old;
  node.textContent = old
    ? `Your computer is off${generated ? ` since ${new Date(generated).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}. Your answers are saved, and the agents get them at the next hourly run or when the computer is on.`
    : '';
}

const clone = (v) => JSON.parse(JSON.stringify(v ?? null));
const pending = () => {
  const all = new Map();
  for (const e of files.values()) all.set(e.nonce, e);
  for (const e of mine.values()) all.set(e.nonce, e);
  return [...all.values()].sort((a, b) => a.at.localeCompare(b.at));
};

// The answers of the computer with the waiting actions done on them, so the page shows what the owner did.
function view() {
  const data = clone(state?.data || {});
  const queue = data['/api/queue'] || (data['/api/queue'] = { memos: [], ticks: [], postponed: 0 });
  const answered = data['/api/answered'] || (data['/api/answered'] = []);
  const postponed = data['/api/postponed'] || (data['/api/postponed'] = []);
  // The drafts of the reply fields (ui/drafts.js), by memo id. A waiting draft counts when it is newer.
  const drafts = queue.drafts || (queue.drafts = {});
  const ids = state?.ids || {};
  const real = (id) => (typeof id === 'string' && ids[id] !== undefined ? ids[id] : id);
  const find = (id) => queue.memos.find((m) => m.id === real(id)) || postponed.find((m) => m.id === real(id));
  const dropDraft = (id) => { delete drafts[real(id)]; delete drafts[id]; };
  const leave = (memo) => {
    queue.memos = queue.memos.filter((m) => m !== memo);
    const i = postponed.indexOf(memo);
    if (i >= 0) { postponed.splice(i, 1); queue.postponed = Math.max(0, (queue.postponed || 1) - 1); }
  };
  for (const e of pending()) {
    const b = e.body || {};
    const memo = 'id' in b ? find(b.id) : null;
    switch (e.path) {
      case '/api/reply':
      case '/api/close':
        dropDraft(b.id);
        if (!memo) break;
        leave(memo);
        Object.assign(memo, { state: e.path === '/api/reply' ? 'replied' : 'closed', reply: b.text ?? null, closed: e.at });
        answered.unshift(memo);
        break;
      case '/api/note':
        if (memo) (memo.notes ||= []).push({ id: e.nonce, author: b.from, text: b.text, created: e.at, read: 0 });
        // The note of the owner was the text of the reply field.
        if (b.from === config().owner) dropDraft(b.id);
        break;
      case '/api/draft': {
        // The newer draft wins, as on the computer (src/memos.js draft).
        const id = real(b.id);
        const old = drafts[id];
        if (typeof b.text !== 'string' || typeof b.updated !== 'string' || (old && old.updated >= b.updated)) break;
        if (b.text) drafts[id] = { text: b.text, updated: b.updated }; else dropDraft(id);
        break;
      }
      case '/api/seen':
        for (const id of b.ids || []) { const m = find(id); if (m) m.seen = 1; }
        break;
      case '/api/tag':
        if (memo) memo.tags = b.on ? [...new Set([...(memo.tags || []), b.tag])].sort() : (memo.tags || []).filter((t) => t !== b.tag);
        break;
      case '/api/adjust':
        if (memo && memo.impact) memo.impact = Math.min(5, Math.max(1, memo.impact + Number(b.delta || 0)));
        break;
      case '/api/check':
        if (memo) memo.text = setCheckBox(memo.text, b.n, b.on) ?? memo.text;
        break;
      case '/api/postpone':
        if (!memo) break;
        if (b.date) {
          if (!postponed.includes(memo)) { queue.memos = queue.memos.filter((m) => m !== memo); postponed.push(memo); queue.postponed = (queue.postponed || 0) + 1; }
          memo.until = `${b.date}T09:00:00`;
        } else if (postponed.includes(memo)) {
          leave(memo);
          memo.until = null;
          queue.memos.unshift(memo);
        }
        break;
      case '/api/send':
        // A memo from an agent, from the cloud agent while the computer is off. It waits at the top.
        if (b.to === config().owner && b.from !== config().owner && !find(e.temp)) {
          queue.memos.unshift({ id: e.temp, sender: b.from, recipient: b.to, text: b.text, reply: null, state: 'open', impact: b.impact ?? null,
            effort: b.effort ?? null, due: b.due ?? null, seen: 0, created: e.at, closed: null, tags: [], title: b.title ?? null, next: b.next ?? null });
        }
        break;
      case '/api/agent/answer': {
        // The answer is on its way to the computer: the question goes away, so a second tap does not look needed.
        const agent = (data['/api/agents'] || []).find((x) => x.name === b.name);
        if (agent) agent.blocked = null;
        break;
      }
      case '/api/tick/done':
      case '/api/tick/skip':
        queue.ticks = (queue.ticks || []).filter((t) => t.id !== b.id);
        break;
      default:
        break;
    }
  }
  return data;
}

// The writes of this page go out one at a time. Each write is a commit on the branch, and two at once (the draft
// that a tap on Reply saves as the field loses the focus, and the reply) make GitHub refuse one with status 409.
// A 409 also comes when the computer commits in the same second (it deletes the files it applied): the write tries
// again after a short wait. A new file in outbox/ has a new name each time, so a second try never writes it twice.
let writes = Promise.resolve();
const RETRY_MS = [400, 1000, 2000, 4000];
export function serialWrite(write, wait = (ms) => new Promise((done) => setTimeout(done, ms))) {
  const run = async () => {
    for (let i = 0; ; i += 1) {
      try { return await write(); } catch (error) {
        if (error?.status !== 409 || i >= RETRY_MS.length) throw error;
        await wait(RETRY_MS[i]);
      }
    }
  };
  const result = writes.then(run, run);
  writes = result.catch(() => {});
  return result;
}

async function act(path, body, options = {}) {
  const at = new Date().toISOString();
  const nonce = crypto.randomUUID();
  const entry = { v: 1, path, body, at, nonce };
  if (path === '/api/send') entry.temp = `t-${nonce}`;
  entry.sig = await signature(entry);
  const name = `${at.replace(/[:.]/g, '-')}-${nonce}.json`;
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(entry))));
  // A key that cannot open the repository gets 404 here too: the action is not saved.
  // A draft saved as the page closes (keepalive) cannot wait in the line: the page may be gone by then.
  const put = () => gh('PUT', `/contents/outbox/${name}`, { message: `Inbox: ${path}`, content, branch: branch() }, false, options);
  if (!(await (options.keepalive ? put() : serialWrite(put)))) throw new Error('GitHub did not save your answer. Reload the page and try again.');
  mine.set(nonce, entry);
  if (path === '/api/send') return { memo: { id: entry.temp }, corrections: [] };
  // The draft that is stored, as the computer answers: the one in the view, which is the newest.
  if (path === '/api/draft') return { id: body.id, ...(view()['/api/queue']?.drafts?.[body.id] || { text: '', updated: body.updated }) };
  const memo = 'id' in body ? (view()['/api/answered'] || []).concat(view()['/api/queue']?.memos || []).find((m) => m.id === body.id) : null;
  return memo || { ok: true };
}

// The same answers as the routes of the computer, from state/inbox.json and the waiting actions.
export async function ledgerApi(path, body, options = {}) {
  if (!read(GH_KEY) || !read(MEMO_KEY)) { showSetup(); throw new LedgerAuthError('Paste your setup link.'); }
  try {
    if (body) return await act(path, body, options);
    const url = new URL(path, location.href);
    if (url.pathname === '/api/queue' || !state || (url.pathname === '/api/agents' && Date.now() - readAt > AGENTS_FRESH_MS)) await refresh();
    if (url.pathname === '/api/calendar') {
      const day = state.calendar?.[url.searchParams.get('date')];
      if (day) return day;
      return Object.keys(state.calendar || {}).length ? { error: 'Only the next 7 days are here while you are away from your computer.' } : { configured: false };
    }
    // A calendar is added on the computer only: its secret address must not go through GitHub. The page hides the form.
    if (url.pathname === '/api/calendars') return { count: 0, items: [], remote: true };
    // The thread of a memo, from the threads of the open memos that the computer published. A memo with no thread,
    // or a memo the computer has not seen yet (a temporary id), has none.
    if (url.pathname === '/api/thread') {
      const id = url.searchParams.get('id');
      return (view()['/api/threads'] || {})[id] || { id: Number(id) || id, memos: [] };
    }
    const data = view()[url.pathname];
    if (data === undefined) {
      if (url.pathname === '/api/ticks') return [];
      if (url.pathname === '/api/schedule') return { items: [] };
      throw new Error('This part of Memo works only on your computer.');
    }
    return data;
  } catch (err) {
    if (err instanceof LedgerAuthError) showSetup();
    throw err;
  }
}

// The form for the keys. Each stays only in this browser. The owner pastes the setup link (or its code) into it: on an
// iPhone, a page on the Home Screen has its own storage apart from Safari, and no address bar to open the link in.
// The two keys can also go in one by one. The form goes under #note, so an error about the keys (common.js note())
// is right above it; when keys are saved but refused, a button forgets them.
function showSetup() {
  if (document.getElementById('ledger-setup')) return;
  const form = document.createElement('form');
  form.id = 'ledger-setup';
  form.className = 'ledger-setup';
  const field = (name, label) => {
    const wrap = document.createElement('label');
    wrap.append(label);
    const input = document.createElement('input');
    Object.assign(input, { name, type: 'password', autocomplete: 'off', spellcheck: false });
    wrap.append(input);
    return wrap;
  };
  const text = (tag, content, className = '') => {
    const node = document.createElement(tag);
    node.textContent = content;
    if (className) node.className = className;
    return node;
  };
  const plain = (label) => { const b = text('button', label); b.type = 'button'; return b; };
  const intro = text('p', 'Paste the setup link from the Set up phone card on your Mac. Each browser and each Home Screen app needs it once.');
  const said = text('p', '', 'warn');
  said.hidden = true;
  const say = (message) => { said.textContent = message; said.hidden = !message; };
  // The two keys, behind a toggle.
  const pair = document.createElement('div');
  pair.className = 'pair';
  pair.hidden = true;
  pair.append(field('gh', 'GitHub key'), field('memo', 'Memo token'));
  const other = plain('Other way: paste the two keys');
  other.className = 'dim';
  other.addEventListener('click', () => { pair.hidden = !pair.hidden; });
  const save = text('button', 'Save');
  const row = document.createElement('div');
  row.className = 'row';
  row.append(save, other);
  if (read(GH_KEY) || read(MEMO_KEY)) {
    const forget = plain('Forget keys on this device');
    forget.addEventListener('click', () => { write(GH_KEY, ''); write(MEMO_KEY, ''); location.reload(); });
    row.append(forget);
  }
  form.append(intro, field('link', 'Paste your setup link'), pair, said, row);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const link = form.elements.link.value;
    const keys = link.trim() ? keysOfLink(link) : { gh: form.elements.gh.value.trim(), memo: form.elements.memo.value.trim() };
    if (link.trim() && !keys) return say('That is not a setup link. Copy the whole link from the Set up phone card.');
    if (!keys.gh || !keys.memo) return say('Paste the setup link, or both keys.');
    write(GH_KEY, keys.gh);
    write(MEMO_KEY, keys.memo);
    form.remove();
    location.reload();
  });
  const anchor = document.getElementById('note');
  if (anchor) anchor.after(form); else document.body.prepend(form);
}
