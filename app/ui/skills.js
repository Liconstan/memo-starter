// The skill marks of the pages (memo 1418, a trial): the small star in a row of the Inbox, the card in the open
// memo, the links from them into the editor of the System page, and the words about who has a skill. The data comes
// from the server (src/registry.js): a prediction is { kind: 'match', skill, skillKind, description, category,
// categoryGuessed, id, editable, reason, confidence, access: { has, line, next } }, and a suggestion for a skill that
// is not there is { kind: 'suggest', name, description, category, reason, count }. No DOM code outside the two
// builders at the end, which take `el` of ui/common.js, so a test can import the file.
// Memo 1420: the pencil opens the skill in a dialog on the page (ui/skillmodal.js takes the click on an
// a.skill-edit); its address stays the one of the System page, which a page with no dialog follows. A prediction also
// has rated (she rated the text the skill has now), ratable (the skill has a file in the vault) and old.

// The four-point star of a predicted skill, the open one of a suggested skill, and the pencil.
export const STAR = '✦';
export const STAR_OPEN = '✧';
export const PENCIL = '✎';
// The mark of a skill that was not used in the last 30 days, or never: its text may be out of date.
export const OLD_WORDS = 'Old · may change';
export const OLD_TITLE = 'Not used in the last 30 days, or never. It may be out of date, and it may change.';
export const RATE_WORDS = 'Rate this skill';

// The address in the System page that opens one file, or the draft of a new skill:
//   /system#file=skill:email-reply-drafts&edit=1   the editor of an agent skill
//   /system#file=hand:botec                        a hand-made skill; pinned, so never the editor
//   /system#new=daily-review&category=ME&memo=1417&description=Use%20when...   a draft, saved only by her Save
// null for a hand-made skill with no pinned copy in the vault: there is no file to open.
export function skillLink(p, memoId = null) {
  if (!p) return null;
  if (p.kind === 'suggest') {
    const q = new URLSearchParams({ new: p.name });
    if (p.category) q.set('category', p.category);
    if (memoId !== null && memoId !== undefined) q.set('memo', String(memoId));
    if (p.description) q.set('description', p.description);
    return `/system#${q}`;
  }
  if (!p.id) return null;
  return `/system#file=${p.id}${p.editable ? '&edit=1' : ''}`;
}

// What the address of the System page asks for: { file, edit } or { draft: { name, description, category, memo } },
// or null. A hand-made skill never opens in the editor, whatever the address says.
export function parseSkillHash(hash) {
  const q = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const file = q.get('file');
  if (file && /^[a-z]+(:[a-z0-9][a-z0-9_-]{0,63})?$/.test(file)) return { file, edit: q.get('edit') === '1' && !file.startsWith('hand:') };
  const name = q.get('new');
  if (name && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    return { draft: { name, description: (q.get('description') || '').slice(0, 300), category: /^[A-Z][A-Z0-9]{1,7}$/.test(q.get('category') || '') ? q.get('category') : '', memo: /^\d{1,7}$/.test(q.get('memo') || '') ? q.get('memo') : '' } };
  }
  return null;
}

// The words of the marks, for a screen reader and a tooltip.
export const skillName = (p) => (p.kind === 'suggest' ? p.name : p.skill);
export const starLabel = (p) => (p.kind === 'suggest' ? `Skill suggested: ${p.name}` : `Skill predicted: ${p.skill}`);
export function pencilLabel(p) {
  if (p.kind === 'suggest') return `Edit a draft of the new skill ${p.name}`;
  return p.editable ? `Edit skill ${p.skill}` : `View skill ${p.skill} (hand-made and pinned: view only)`;
}
// The category chip of a skill: the code, and where it comes from.
export const categoryTitle = (code, guessed, about = '') => `Workstream ${code}${about ? `: ${about}` : ''}${guessed ? '. Guessed from the name and the description; the line "category: ' + code + '" in the skill sets it.' : ''}`;

// The star of a row of the Inbox, or '' for a memo with no prediction. It has a label, so a screen reader says it.
export function skillStar(p, el) {
  if (!p) return '';
  const star = el('span', { className: p.kind === 'suggest' ? 'skill-star suggest' : 'skill-star', title: starLabel(p) }, p.kind === 'suggest' ? STAR_OPEN : STAR);
  star.setAttribute('role', 'img');
  star.setAttribute('aria-label', starLabel(p));
  return star;
}

// The card of the open memo: the star and the heading, the pencil into the System page, the likely (or suggested)
// skill with its category, the reason, and the line about the agent, which opens to say what to do.
export function skillCard(p, el, memoId = null) {
  if (!p) return '';
  const suggest = p.kind === 'suggest';
  const heading = suggest ? 'Skill suggestion' : 'Skill prediction';
  const mark = el('span', { className: suggest ? 'skill-star suggest' : 'skill-star' }, suggest ? STAR_OPEN : STAR);
  mark.setAttribute('aria-hidden', 'true');
  const head = el('div', { className: 'skill-head' }, mark, el('b', {}, heading));
  const link = skillLink(p, memoId);
  if (link) {
    const pencil = el('a', { className: 'skill-edit', href: link, title: pencilLabel(p) }, PENCIL);
    pencil.setAttribute('aria-label', pencilLabel(p));
    // The dialog opens in place (ui/skillmodal.js); the memo goes with a rating made from here.
    pencil.setAttribute('aria-haspopup', 'dialog');
    if (memoId !== null && memoId !== undefined) pencil.setAttribute('data-memo', String(memoId));
    head.append(pencil);
  }
  const pick = el('p', { className: 'skill-pick' }, el('span', { className: 'skill-pill' }, suggest ? 'Suggested skill: ' : 'Likely skill: ', el('b', {}, skillName(p))));
  if (p.category) pick.append(el('span', { className: 'ws', title: categoryTitle(p.category, !suggest && p.categoryGuessed) }, p.category));
  if (!suggest) pick.append(el('span', { className: 'skill-kind' }, p.skillKind === 'hand' ? 'hand-made, pinned' : `agent skill${p.confidence === 'high' ? ', strong match' : ''}`));
  if (!suggest && p.old) pick.append(el('span', { className: 'skill-old', title: OLD_TITLE }, OLD_WORDS));
  const card = el('section', { className: suggest ? 'skill-card suggest' : 'skill-card' }, head, pick, el('p', { className: 'skill-why' }, p.reason));
  card.setAttribute('aria-label', heading);
  if (suggest) {
    card.append(el('p', { className: 'skill-why' }, 'Proposed description: ', el('i', {}, p.description)),
      el('p', { className: 'skill-access' }, 'No agent has it yet. The pencil opens a draft on the System page; nothing is saved until you save it there.'));
    return card;
  }
  const a = p.access || {};
  const level = a.has === true ? 'ok' : a.has === false ? 'warn' : '';
  const sign = el('span', { className: 'skill-sign' }, a.has === true ? '✓' : a.has === false ? '!' : '–');
  sign.setAttribute('aria-hidden', 'true');
  const more = el('details', { className: `skill-access ${level}`.trim() }, el('summary', {}, sign, a.line || ''), a.next ? el('p', {}, a.next) : '');
  if (p.description) more.append(el('p', {}, el('b', {}, 'What the skill is for: '), p.description));
  if (!link) more.append(el('p', {}, 'This skill has no pinned copy in the vault, so there is no file to open here.'));
  // A click in the card must not act as a click on the memo around it.
  more.addEventListener?.('click', (event) => event.stopPropagation());
  card.append(more);
  // She did not rate the text this skill has now: a small prompt, which opens the dialog at the rating.
  if (link && p.ratable && !p.rated) {
    const rate = el('a', { className: 'skill-edit skill-rate', href: link, title: `Rate the skill ${p.skill} as it is now, 1 to 5, and write what you would change` }, RATE_WORDS);
    rate.setAttribute('aria-haspopup', 'dialog');
    rate.setAttribute('data-focus', 'rate');
    if (memoId !== null && memoId !== undefined) rate.setAttribute('data-memo', String(memoId));
    card.append(el('p', { className: 'skill-rate-row' }, rate));
  }
  return card;
}
