// The skill dialog (memo 1420): the pencil of a skill opens the skill in a dialog on the page it is on, the Inbox or
// the System page, and no longer moves to another page. In the dialog: the text of the skill (an editor for an agent
// skill, with the safe save of the System page; a view for a hand-made skill, which is pinned; a draft for a skill
// that is not there yet), then her rating of the text the skill has now, 1 to 5, with what she would change, then
// the old versions of the skill with their ratings.
//
// The dialog is a <dialog> opened with showModal(), as the detail of a calendar event is: the browser keeps the
// focus inside it and makes the page behind it inert, Escape closes it, and the focus goes back to the pencil. Text
// with changes that are not saved asks one time before it goes. All text goes into the page as text nodes.
//
// The page calls installSkillModal once with its own `api`, `el` and `markdown`, so this file names no other file of
// the page and a test can import it. A click on an a.skill-edit whose address is one of ui/skills.js (skillLink) opens
// the dialog; with Command, Control or Shift the address opens as a link, on the System page, as before.
//
// Memo 1513: the dialog opens every rule document of the System page, not only a skill: a charter (charter:team),
// the shared lessons (lessons), a skill (skill:<name>, hand:<name>). A link in a memo to /system#file=<id>&edit=1
// (an a.doc-link of ui/markdown.js) opens it here, with the same safe save. The dialog starts with "Latest change":
// the text the document had before its latest change against the text it has now, as removed and added lines
// (GET /api/system/previous, diffView of ui/markdown.js), so she can check what an agent changed.
//
// Memo 1527: the editor has line numbers. A link with data-lines="113-115" (the line range in the label of an old or
// new block of a memo, ui/markdown.js) opens the document and goes to those lines in the editor.
import { parseSkillHash, OLD_WORDS, OLD_TITLE } from './skills.js';
import { displayName } from './agentstate.js';
import { diffLines, diffHunks, diffView, docLinkOf } from './markdown.js';

// Line numbers in the editor, with a "Go to line" field (memo 1527, ui/linenumbers.js): the same ones as on the
// System page. A server from before that file does not give it: then the editor is the plain text box, as before.
let lineUi = null;
import('./linenumbers.js').then((m) => { lineUi = m; }).catch(() => {});

export const SCORE_WORDS = { 1: 'poor', 2: 'weak', 3: 'fine', 4: 'good', 5: 'great' };
const NAME_LINE = /^---\n(?:.*\n)*?name:[ \t]*["']?([a-z0-9][a-z0-9_-]{0,63})["']?[ \t]*\n/;

// What a pencil asks for, from its address: { file, edit } or { draft }, or null (ui/skills.js parseSkillHash).
// Only an address of the System page counts, and only a file that is a rule document there (memo 1513): a charter,
// the lessons, a skill. The server has the list; an id that is not on it gives its error in the dialog.
// Memo 1523: a whole address counts too when it is that of this page's server or of a known Memo host
// (ui/markdown.js docLinkOf); then only its part from /system on is read. origin: for a test.
export function modalTarget(href, origin = globalThis.location?.origin) {
  let text = String(href || '');
  if (/^https?:\/\//i.test(text)) text = docLinkOf(text, origin) || '';
  if (!text.startsWith('/system#')) return null;
  const t = parseSkillHash(text.slice('/system'.length));
  if (!t) return null;
  if (t.file && !/^(skill|hand|charter):./.test(t.file) && t.file !== 'lessons') return null;
  return t;
}
// The time of a change for her: "Nov 11, 9:15 AM".
export const timeWords = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
// The line over the latest change (memo 1513). p: `previous` of GET /api/system/previous, or null when no earlier
// text is kept. local: the document is a live charter of local/charters.
export function changeWords(p, { local = false } = {}) {
  if (!p) {
    return local
      ? 'No earlier text of this charter is kept yet, so there is no change to show. From now on, each change keeps the text that was there in local/charters/.history, and the next change shows here.'
      : 'No earlier version of this text is kept, so there is no change to show.';
  }
  const when = p.at ? ` ${timeWords(p.at)}` : '';
  if (p.source === 'history') return `Changed${when}. Compared with the text before, kept in ${p.label}.`;
  if (p.source === 'versions') return `Changed${when}. Compared with the old version ${p.label}.`;
  if (!p.at) return `Changed on the Mac, and not committed yet. Compared with the text of ${p.label}.`;
  return `Changed${when}${p.change ? `, with the commit "${p.change}"` : ''}. Compared with the text of ${p.label}.`;
}
// The day of a rating for her: "Nov 11".
export const dayWords = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
// One rating as a line: "4 of 5 (good), Nov 11, from memo 1420: shorter steps".
export function ratingLine(r) {
  const parts = [`${r.score} of 5 (${SCORE_WORDS[r.score] || ''})`, dayWords(r.at)];
  if (r.memo) parts.push(`from memo ${r.memo}`);
  return `${parts.filter(Boolean).join(', ')}${r.notes ? `: ${r.notes}` : ''}`;
}
// What the page says after a rating is saved.
export function ratedWords(r) {
  const saved = r.pushed ? 'Rating saved, committed and pushed to GitHub.' : (r.error || 'Rating saved.');
  if (r.memo) return `${saved} Memo ${r.memo.code || r.memo.id} asks ${displayName(r.memo.to)} to revise the skill from your notes.`;
  return `${saved} ${r.rating?.notes ? '' : 'No memo was sent: a rating with no words asks for no change.'}`.trim();
}
// The line of an old version: "2026-11-10 09:15 · 1a2b3c4d · 3.1 kB".
export const versionLine = (v) => `${v.at} · ${v.hash8} · ${Math.round(v.size / 100) / 10} kB`;

let openNow = null; // the dialog that is open, or null: one at a time

// api, el: those of ui/common.js. markdown: render of ui/markdown.js. onChange: called after a save or a rating, so
// the page loads its skill data again. The result: { open(target, { opener, memo, focus, lines }) }. lines: the lines
// to go to in the editor when the text is there, as "113" or "113-115".
export function installSkillModal({ api, el, markdown, onChange = () => {} }) {
  const say = (node, text, level = '') => { node.textContent = text; node.className = `result ${level}`.trim(); node.hidden = !text; };
  const busy = async (b, fn) => {
    b.disabled = true;
    b.classList.add('sending');
    try { await fn(); } finally { b.disabled = false; b.classList.remove('sending'); }
  };

  function open(target, { opener = null, memo = null, focus = '', lines = '' } = {}) {
    if (openNow) return;
    const title = el('h2', { id: 'skill-modal-title' }, !target.file || /^(skill|hand):/.test(target.file) ? 'Skill' : 'Rule document');
    const chips = el('span', { className: 'skill-modal-chips' });
    const close = el('button', { type: 'button', className: 'cal-close', title: 'Close (Esc)' }, '×');
    close.setAttribute('aria-label', 'Close');
    const body = el('div', { className: 'skill-modal-body' }, el('p', { className: 'dim' }, 'Loading.'));
    const guard = el('p', { className: 'result warn', hidden: true });
    guard.setAttribute('role', 'alert');
    const dialog = el('dialog', { className: 'skill-modal' }, el('div', { className: 'skill-modal-head' }, title, chips, close), guard, body);
    dialog.setAttribute('aria-labelledby', 'skill-modal-title');
    let dirty = () => false;
    let warned = false;
    const leave = () => {
      if (dirty() && !warned) { warned = true; say(guard, 'Your changes to the text are not saved. Close again to drop them, or save first.', 'warn'); return; }
      dialog.close();
      shut();
    };
    // The end of the dialog, one time: it leaves the page, and the focus goes back to the pencil. The list of the
    // page can be drawn again while the dialog is open: then the pencil with the same address takes the focus.
    let gone = false;
    const shut = () => {
      if (gone) return;
      gone = true;
      dialog.remove();
      openNow = null;
      const href = opener?.getAttribute?.('href');
      const back = opener?.isConnected ? opener : [...document.querySelectorAll('a.skill-edit, a.doc-link')].find((a) => href && a.getAttribute('href') === href);
      back?.focus();
    };
    close.addEventListener('click', leave);
    // A click outside the box (on the dialog itself, which is the dark area around it).
    dialog.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === dialog) leave(); });
    // Escape: the browser sends `cancel` before it closes the dialog.
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); leave(); });
    // The keys of the page (j, k, r and others) listen on the document: they must not act behind the dialog.
    dialog.addEventListener('keydown', (e) => e.stopPropagation());
    // The browser can close a dialog by itself; the end is the same.
    dialog.addEventListener('close', shut);
    document.body.append(dialog);
    dialog.showModal();
    openNow = dialog;
    close.focus();
    const changed = () => { try { onChange(); } catch { /* the page shows its own errors */ } };

    // ---------- a document that is there: a skill, a charter, the lessons ----------
    async function showFile(id, firstFocus) {
      // A skill has a rating and old versions; a charter and the lessons have the text and its latest change.
      const isSkill = /^(skill|hand):/.test(id);
      const name = id.replace(/^(skill|hand):/, '');
      let file;
      let log = null;
      try {
        [file, log] = await Promise.all([api(`/api/system/file?id=${encodeURIComponent(id)}`), isSkill ? api(`/api/skills/log?name=${encodeURIComponent(name)}`).catch(() => null) : null]);
      } catch (error) { body.replaceChildren(el('p', { className: 'result bad' }, error.message)); return; }
      const what = isSkill ? `the skill ${name}` : file.title;
      title.textContent = isSkill ? `Skill: ${name}` : file.title;
      if (isSkill) {
        const skill = await api('/api/skills').then((r) => (r.skills || []).find((s) => s.name === name) || null).catch(() => null);
        chips.replaceChildren(el('span', { className: 'skill-kind' }, file.editable ? 'agent skill' : 'hand-made, pinned: view only'),
          skill?.old ? el('span', { className: 'skill-old', title: OLD_TITLE }, OLD_WORDS) : '');
      } else chips.replaceChildren(el('span', { className: 'skill-kind' }, `${file.group === 'lessons' ? 'lessons' : 'charter'}${file.editable ? '' : ': view only'}`));
      warned = false;
      say(guard, '');

      // The text: an editor, or a view.
      const textBox = el('section', { className: 'skill-modal-part' });
      textBox.setAttribute('aria-label', isSkill ? 'Text of the skill' : `Text of ${file.title}`);
      let state = { text: file.text, hash: file.hash };

      // The latest change (memo 1513): the text before it against the saved text of now, as removed and added lines
      // with a few lines around each. The server finds the text before (src/system.js previous).
      const change = el('section', { className: 'skill-modal-part skill-modal-change' });
      change.setAttribute('aria-labelledby', 'skill-modal-change');
      async function showChange() {
        const head = el('h3', { id: 'skill-modal-change' }, 'Latest change');
        let found;
        try { found = await api(`/api/system/previous?id=${encodeURIComponent(id)}`); } catch (error) {
          // A server from before this route answers with a 404 that has no words of its own.
          const old = /^The request failed with status/.test(error.message);
          change.replaceChildren(head, el('p', { className: 'dim' }, old ? 'This server cannot show the latest change yet. Start the server again to get it.' : error.message));
          return;
        }
        const words = el('p', { className: 'dim' }, changeWords(found.previous, { local: file.where === 'local' }));
        if (!found.previous) { change.replaceChildren(head, words); return; }
        const rows = diffHunks(diffLines(found.previous.text, state.text));
        change.replaceChildren(head, words, rows.length ? diffView(rows, el) : el('p', { className: 'dim' }, 'The two texts differ only in the empty lines at their end.'));
      }

      let area = null;
      let editor = null; // the text box with its line numbers (ui/linenumbers.js), or null
      if (file.editable) {
        area = el('textarea', { className: 'editor', value: file.text, rows: 16, spellcheck: true });
        area.setAttribute('aria-label', `Text of ${what}`);
        editor = lineUi ? lineUi.numberedEditor(area, el) : null;
        const result = el('p', { className: 'result', hidden: true });
        result.setAttribute('role', 'status');
        const reload = el('button', { type: 'button', hidden: true, title: 'Load the version that is on the disk now and keep your text in the box' }, 'Load the new version');
        const newer = el('div', { className: 'md', hidden: true });
        const save = el('button', { type: 'button', title: isSkill ? 'Keep the old text as a version, write this text to the vault, commit and push' : 'Keep the old text, write this text, and back it up in the vault' }, 'Save');
        save.addEventListener('click', () => busy(save, async () => {
          try {
            const r = await api('/api/system/save', { id, text: area.value, base: state.hash });
            state = { text: area.value, hash: r.hash };
            warned = false;
            say(guard, '');
            say(result, [r.pushed ? 'Saved, committed and pushed to GitHub.' : (r.error || 'Saved.'), (r.kept || []).length ? 'The old text is kept as a version.' : '', r.note || ''].filter(Boolean).join(' '), r.pushed ? 'good' : 'warn');
            newer.hidden = true;
            reload.hidden = true;
            changed();
            // Her own change is the latest one now.
            await showChange();
            if (isSkill) await showLog();
          } catch (error) {
            say(result, error.message, 'bad');
            if (/changed since you opened it/.test(error.message)) reload.hidden = false;
          }
        }));
        reload.addEventListener('click', async () => {
          try {
            const fresh = await api(`/api/system/file?id=${encodeURIComponent(id)}`);
            state = { text: fresh.text, hash: fresh.hash };
            newer.replaceChildren(el('p', { className: 'dim' }, 'The new version from the disk:'), ...markdown(fresh.text, el), el('p', { className: 'dim' }, 'Your text is in the box below. Compare the two, then save again if you want yours.'));
            newer.hidden = false;
            reload.hidden = true;
            say(result, '');
          } catch (error) { say(result, error.message, 'bad'); }
        });
        const how = isSkill ? `A save keeps the old text in skills/.versions/${name}/, pulls the vault, commits and pushes.`
          : file.where === 'local' ? 'This is the live charter on the Mac. A save keeps the old text in local/charters/.history and a backup in the vault.'
            : 'A save pulls the vault, commits this file alone, and pushes to GitHub.';
        textBox.append(el('h3', {}, 'Text'), el('p', { className: 'dim' }, `${how} ${file.path}`), newer, editor ? editor.node : area, result, el('div', { className: 'row' }, save, reload));
        dirty = () => area.isConnected && area.value !== state.text;
      } else {
        textBox.append(el('h3', {}, 'Text'), el('div', { className: 'md skill-modal-view' }, ...markdown(file.text, el)),
          el('p', { className: 'dim' }, isSkill ? 'A hand-made skill is pinned, so its text is view only here. Rate it below and write what you would change: the agent gets a memo and revises it for you.' : `This text is view only here. ${file.note || ''}`.trim()));
        dirty = () => false;
      }

      // The rating of the text the skill has now.
      const rateBox = el('section', { className: 'skill-modal-part' });
      rateBox.setAttribute('aria-labelledby', 'skill-modal-rate');
      const versions = el('section', { className: 'skill-modal-part' });
      versions.setAttribute('aria-labelledby', 'skill-modal-versions');
      let firstScore = null;
      function drawLog() {
        if (!log) {
          rateBox.replaceChildren(el('h3', { id: 'skill-modal-rate' }, 'Rate this version'), el('p', { className: 'dim' }, 'This server has no ratings yet. Start the server again to get them.'));
          versions.replaceChildren();
          return;
        }
        const mine = log.current.ratings;
        const picked = { score: 0 };
        const scores = el('div', { className: 'skill-scores' });
        for (let n = 1; n <= 5; n++) {
          const input = el('input', { type: 'radio', name: 'skill-score', value: String(n), id: `skill-score-${n}` });
          input.addEventListener('change', () => { picked.score = n; });
          if (n === 1) firstScore = input;
          scores.append(el('label', { htmlFor: `skill-score-${n}`, title: `${n} of 5: ${SCORE_WORDS[n]}` }, input, el('span', {}, `${n}`), el('small', {}, SCORE_WORDS[n])));
        }
        const group = el('fieldset', { className: 'skill-score-set' }, el('legend', {}, 'Your rating of the skill as it is now'), scores);
        const notes = el('textarea', { rows: 3, id: 'skill-notes', placeholder: 'What would you change?' });
        const result = el('p', { className: 'result', hidden: true });
        result.setAttribute('role', 'status');
        const send = el('button', { type: 'button', title: 'Write the rating to skills/ratings.jsonl in the vault. With words, the agent also gets a memo to revise the skill.' }, 'Save rating');
        send.addEventListener('click', () => busy(send, async () => {
          if (!picked.score) { say(result, 'Pick a rating from 1 to 5 first.', 'bad'); return; }
          try {
            const r = await api('/api/skills/rate', { name, score: picked.score, notes: notes.value, memo: memo ?? null });
            changed();
            await showLog();
            say(rateBox.querySelector('#skill-rated-now'), ratedWords(r), r.pushed ? 'good' : 'warn');
          } catch (error) { say(result, error.message, 'bad'); }
        }));
        const now = el('p', { className: 'result', id: 'skill-rated-now', hidden: true });
        now.setAttribute('role', 'status');
        rateBox.replaceChildren(
          el('h3', { id: 'skill-modal-rate' }, 'Rate this version'),
          el('p', { className: 'dim' }, `Version ${log.current.version}. ${mine.length ? 'Your ratings of it:' : 'You did not rate this version yet.'}`),
          mine.length ? el('ul', { className: 'skill-ratings' }, ...mine.map((r) => el('li', {}, ratingLine(r)))) : '',
          now, group,
          el('label', { htmlFor: 'skill-notes', className: 'skill-notes-label' }, 'What would you change? With words here, the agent gets a memo, revises the skill, and the text of now stays as an old version.'),
          notes, file.editable ? el('p', { className: 'dim' }, 'The rating is for the saved text, not for changes in the box above that are not saved.') : '', result,
          el('div', { className: 'row' }, send));

        // The old versions, the newest first, each with its ratings; then the ratings of a text that no version file has.
        const known = new Set([log.current.hash8, ...log.versions.map((v) => v.hash8)]);
        const loose = log.ratings.filter((r) => !known.has(String(r.hash).slice(0, 8)));
        const rows = log.versions.map((v) => {
          const pre = el('pre', { className: 'skill-old-text', hidden: true });
          const view = el('button', { type: 'button', title: 'Show the text of this old version' }, 'View');
          view.setAttribute('aria-expanded', 'false');
          view.addEventListener('click', async () => {
            if (!pre.hidden) { pre.hidden = true; view.setAttribute('aria-expanded', 'false'); return; }
            try {
              if (!pre.textContent) pre.textContent = (await api(`/api/skills/version?name=${encodeURIComponent(name)}&file=${encodeURIComponent(v.file)}`)).text;
              pre.hidden = false;
              view.setAttribute('aria-expanded', 'true');
            } catch (error) { pre.textContent = error.message; pre.hidden = false; }
          });
          return el('li', {}, el('div', { className: 'row' }, el('span', {}, versionLine(v)), view),
            v.ratings.length ? el('ul', { className: 'skill-ratings' }, ...v.ratings.map((r) => el('li', {}, ratingLine(r)))) : el('span', { className: 'dim' }, 'Not rated.'), pre);
        });
        versions.replaceChildren(el('h3', { id: 'skill-modal-versions' }, `Old versions (${log.versions.length})`),
          rows.length ? el('ul', { className: 'skill-versions' }, ...rows) : el('p', { className: 'dim' }, 'No old version yet. Each change keeps the text that was there; old versions are never deleted.'),
          loose.length ? el('p', { className: 'dim' }, 'Ratings of a text that has no version file:') : '',
          loose.length ? el('ul', { className: 'skill-ratings' }, ...loose.map((r) => el('li', {}, `${r.version}: ${ratingLine(r)}`))) : '');
      }
      async function showLog() {
        try { log = await api(`/api/skills/log?name=${encodeURIComponent(name)}`); } catch { /* the last one stays */ }
        drawLog();
      }
      if (isSkill) drawLog();
      // The dialog shows at once; the latest change comes a moment later (the server reads the history).
      change.replaceChildren(el('h3', { id: 'skill-modal-change' }, 'Latest change'), el('p', { className: 'dim' }, 'Loading.'));
      body.replaceChildren(change, textBox, ...(isSkill ? [rateBox, versions] : []));
      showChange();
      if (firstFocus === 'rate' && firstScore) { rateBox.scrollIntoView({ block: 'start' }); firstScore.focus(); } else if (area && firstFocus === 'edit') area.focus(); else close.focus();
      // The link named lines (memo 1527): the editor goes there, with the cursor at the start of the first one.
      if (lines && editor && firstFocus !== 'rate') editor.goTo(lines);
    }

    // ---------- a skill that is not there yet: a draft ----------
    async function showDraft(d) {
      let file;
      try {
        file = await api(`/api/skills/draft?${new URLSearchParams({ name: d.name, description: d.description || '', category: d.category || '', memo: d.memo || '' })}`);
      } catch (error) { body.replaceChildren(el('p', { className: 'result bad' }, error.message)); return; }
      // A skill of that name is there already: its editor.
      if (file.exists) { await showFile(file.id, 'edit'); return; }
      title.textContent = `New skill, a draft: ${d.name}`;
      chips.replaceChildren(el('span', { className: 'skill-kind' }, 'not saved yet'));
      const area = el('textarea', { className: 'editor', value: file.text, rows: 18, spellcheck: true });
      area.setAttribute('aria-label', `Text of the new skill ${d.name}`);
      const editor = lineUi ? lineUi.numberedEditor(area, el) : null;
      const result = el('p', { className: 'result', hidden: true });
      result.setAttribute('role', 'status');
      let saved = false;
      dirty = () => !saved && area.isConnected && area.value !== file.text;
      const save = el('button', { type: 'button', title: 'Write the new skill to the vault, commit it alone, and push' }, 'Save the new skill');
      save.addEventListener('click', () => busy(save, async () => {
        // The name of the skill is the name in its frontmatter, so she can change it in the text.
        const name = NAME_LINE.exec(area.value)?.[1];
        if (!name) { say(result, 'The text must start with a line ---, then name: and the name of the skill in small letters, digits and hyphens.', 'bad'); return; }
        try {
          await api('/api/system/save', { id: `skill:${name}`, text: area.value, base: file.hash });
          saved = true;
          changed();
          await showFile(`skill:${name}`, 'rate');
        } catch (error) { say(result, error.message, 'bad'); }
      }));
      body.replaceChildren(el('section', { className: 'skill-modal-part' },
        el('p', { className: 'dim' }, `A draft from a suggestion, in the schema of skills/README.md. Fill in the lines in angle brackets, then save. Nothing is written until you save. ${file.path}`),
        editor ? editor.node : area, result, el('div', { className: 'row' }, save),
        el('p', { className: 'dim' }, 'You can rate the skill after its first save.')));
      area.focus();
    }

    if (target.draft) showDraft({ ...target.draft, memo: target.draft.memo || (memo ?? '') });
    // From a link in a memo (focus 'change') the focus stays at the top, so the latest change is read first.
    else showFile(target.file, focus === 'rate' ? 'rate' : focus === 'change' ? '' : target.edit ? 'edit' : '');
  }

  // A click on a pencil: the dialog, not the link. The capture phase, so the row or the memo around the pencil does
  // not take the click as its own.
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // A pencil of a skill, or a link in the text of a memo to a rule document (memo 1513, ui/markdown.js).
    const a = event.target?.closest?.('a.skill-edit, a.doc-link');
    if (!a) return;
    const target = modalTarget(a.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const memo = /^\d{1,7}$/.test(a.getAttribute('data-memo') || '') ? Number(a.getAttribute('data-memo')) : null;
    open(target, { opener: a, memo, focus: a.getAttribute('data-focus') || (a.classList.contains('doc-link') ? 'change' : ''), lines: a.getAttribute('data-lines') || '' });
  }, true);

  return { open };
}
