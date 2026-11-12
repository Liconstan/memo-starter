// The dashboard parts of the Inbox (memo 1421): the Skill Suggestion card and the Quick Access card of the side
// column. The data of the skill card is that of the skill trial (memo 1418, src/registry.js): the prediction of each
// memo and its other suggestions. No DOM code outside the builders, which take `el` of ui/common.js, so a test can
// import the file.

// ---------- the Skill Suggestion card ----------
// A skill name as a title: "funding-analysis" is "Funding Analysis".
export const skillTitle = (name) => String(name || '').split(/[-_]/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
// The description of a skill without its fixed start: "Use when you draft a reply" is "When you draft a reply".
export function shortDescription(text, max = 130) {
  const t = String(text || '').replace(/^Use when\b/, 'When').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : t;
}
// The memo the card speaks about: the open memo, or else the selected one; when that memo has no skill at all, the
// first memo of the list with a predicted skill. null with no memo.
export function contextMemo(list, { openId = null, selected = null, skills = {}, others = {} } = {}) {
  const has = (m) => skills[m.id]?.kind === 'match' || (others[m.id] || []).length > 0 || skills[m.id]?.kind === 'suggest';
  const now = list.find((m) => m.id === openId) || list.find((m) => m.id === selected) || null;
  if (now && has(now)) return now;
  return list.find((m) => skills[m.id]?.kind === 'match') || now || list[0] || null;
}
// The skill in the middle of the card and the chips under it. picked: the name of a chip she chose for this memo.
// { main, chips }: main is a prediction of kind 'match' or one of the others, or null; chips are the rest, at most 3.
export function suggestionOf(top, others = [], picked = null) {
  const match = top?.kind === 'match' ? top : null;
  const all = [...(match ? [match] : []), ...others];
  const main = all.find((s) => s.skill === picked) || all[0] || null;
  return { main, chips: all.filter((s) => s !== main).slice(0, 3) };
}
// The badge of a skill for the agent of the memo: Available, Sync needed, or that the agent loads no Claude skills.
export function badgeOf(access) {
  if (access?.has === true) return { text: 'Available', level: 'ok', title: access.line };
  if (access?.has === false) return { text: 'Sync needed', level: 'warn', title: `${access.line} ${access.next || ''}`.trim() };
  return { text: 'Not loaded', level: '', title: `${access?.line || ''} ${access?.next || ''}`.trim() };
}
// "Use skill" writes this line into the reply field of the memo. Nothing is sent: she presses Note or Reply.
export const useLine = (name) => `Use the skill ${name} for this memo.`;
// The reply text with the line of a skill in it; a line of another skill from this card goes out.
export function withSkillLine(text, name) {
  const kept = String(text || '').split('\n').filter((line) => !/^Use the skill [a-z0-9][a-z0-9_-]* for this memo\.$/.test(line.trim())).join('\n').trimEnd();
  return kept ? `${kept}\n${useLine(name)}` : useLine(name);
}
// The card. memo: the memo it speaks about, or null. top: its prediction; others: its other suggestions.
// on: { use(memo, name), pick(name), open(memo) }. link: (prediction, memoId) => the address in the System page.
export function suggestCard({ memo, top, others, picked }, el, { on, link = () => null, icon = () => '' } = {}) {
  const box = el('div', { className: 'sg' });
  if (!memo) { box.append(el('p', { className: 'dim' }, 'No memo to suggest a skill for.')); return box; }
  const name = memo.code || `Memo ${memo.id}`;
  const about = el('a', { href: `#memo-${memo.id}`, title: 'Open this memo' }, memo.title ? `${name} · ${memo.title}` : name);
  about.addEventListener('click', (event) => { event.preventDefault(); on.open(memo); });
  box.append(el('p', { className: 'sg-for dim' }, 'For ', about));
  const { main, chips } = suggestionOf(top, others, picked);
  if (!main) {
    if (top?.kind === 'suggest') {
      box.append(el('p', { className: 'sg-none' }, 'No skill fits this memo yet. Work like it repeats: ', el('b', {}, skillTitle(top.name)), ' could be a new skill.'),
        el('a', { className: 'sg-use', href: link(top, memo.id) || '/system#h-skills', title: 'Open a draft of the new skill on the System page. Nothing is saved until you save it there.' }, 'Draft the skill →'));
    } else box.append(el('p', { className: 'sg-none dim' }, 'No skill stands out for this memo.'));
    return box;
  }
  const badge = badgeOf(main.access);
  const pill = el('span', { className: `sg-badge ${badge.level}`.trim(), title: badge.title }, badge.text);
  const edit = link(main, memo.id);
  const pencil = edit ? el('a', { className: 'skill-edit', href: edit, title: main.editable ? `Edit skill ${main.skill}` : `View skill ${main.skill} (hand-made: view only)` }, '✎') : '';
  if (pencil) pencil.setAttribute('aria-label', pencil.title);
  box.append(el('div', { className: 'sg-main' }, icon('skill'),
    el('div', { className: 'sg-text' }, el('b', { title: main.skill }, `“${skillTitle(main.skill)}”`), el('p', {}, shortDescription(main.description))), pill, pencil));
  if (main.reason || main.why) box.append(el('p', { className: 'sg-why dim' }, main.reason || main.why));
  const use = el('button', { type: 'button', className: 'sg-use' }, 'Use Skill →');
  if (main.access?.has === false) {
    use.disabled = true;
    box.append(use, el('p', { className: 'sg-why' }, badge.title));
  } else {
    use.title = `Opens the memo and writes "${useLine(main.skill)}" in its reply field. Nothing is sent until you press Note or Reply.`;
    use.addEventListener('click', (event) => { event.stopPropagation(); on.use(memo, main.skill); });
    box.append(use);
  }
  if (chips.length) {
    const row = el('div', { className: 'sg-chips' }, ...chips.map((s) => {
      const chip = el('button', { type: 'button', title: `${s.skill}: ${shortDescription(s.description, 200)}` }, skillTitle(s.skill));
      chip.addEventListener('click', (event) => { event.stopPropagation(); on.pick(s.skill); });
      return chip;
    }));
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Other suggestions');
    box.append(el('p', { className: 'sg-other dim' }, 'Other suggestions'), row);
  }
  return box;
}

// ---------- the Quick Access card ----------
// The five buttons. Each is a link (href), an action on this page (run), or not built yet (neither): then it shows as
// off, with the words "not built yet", and does nothing.
// layout: the page has the settings of the minimal view (memo 1531); open: they show now.
export function quickItems({ routing = false, theme = '', layout = false, open = false } = {}) {
  return [
    { key: 'charters', label: 'Edit Charters', href: '/system#h-charters', title: 'The charters of your agents, on the System page. Each opens in the editor.' },
    { key: 'routing', label: 'Routing', run: routing ? 'routing' : null, title: routing ? 'Tasks go to an agent automatically. This puts you in the agent picker of the capture field, to pick one by hand for the next task.' : 'Not built yet: there are no routing settings. Tasks go to an agent automatically.' },
    { key: 'skills', label: 'Skills', href: '/system#h-skills', title: 'The skills of your agents, on the System page, with their workstreams and who has them.' },
    { key: 'themes', label: 'Themes', run: theme ? 'theme' : null, title: theme || 'Not built yet.' },
    { key: 'layout', label: 'Layout', run: layout ? 'layout' : null, expanded: layout ? open : undefined, title: layout ? 'Minimal view: pick which widgets show when ADHD mode is off. The settings open under these buttons.' : 'Not built yet: the layout of this page cannot be changed.' },
  ];
}
export function quickAccess(items, el, { run = () => {}, icon = () => '' } = {}) {
  const row = el('div', { className: 'qa-row' }, ...items.map((item) => {
    const inside = [icon(item.key), el('span', {}, item.label)];
    if (item.href) return el('a', { className: 'qa', href: item.href, title: item.title }, ...inside);
    if (item.run) {
      const b = el('button', { type: 'button', className: 'qa', title: item.title }, ...inside);
      b.addEventListener('click', (event) => { event.stopPropagation(); run(item.run); });
      // A button that opens a part of this card says whether the part is open.
      if (item.expanded !== undefined) b.setAttribute('aria-expanded', String(item.expanded));
      return b;
    }
    // Not built yet: not a button and not a link, so no click and no place in the tab order; the words say why.
    const off = el('span', { className: 'qa off', title: item.title }, ...inside, el('small', {}, 'not built yet'));
    off.setAttribute('aria-disabled', 'true');
    return off;
  }));
  return row;
}
