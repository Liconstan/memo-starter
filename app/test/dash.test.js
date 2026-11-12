import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { otherSkills, othersAll, predictSkill } from '../src/registry.js';
import { skillLink } from '../ui/skills.js';
import { skillTitle, shortDescription, contextMemo, suggestionOf, badgeOf, useLine, withSkillLine,
  suggestCard, quickItems, quickAccess } from '../ui/dash.js';
import { makeApp, call, LIAISON_TOKEN, ROOT } from './helpers.js';

// The dashboard parts of the Inbox (memo 1421): the Skill Suggestion card, the Quick Access card.
// A small stand-in for a DOM element, enough for the builders of ui/dash.js.
function el(tag, props = {}, ...children) {
  const node = { tag, ...props, children: [], attrs: {}, vars: {}, listeners: {},
    append(...more) { for (const c of more) if (c !== '') node.children.push(c); },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(name, fn) { node.listeners[name] = fn; },
    style: { setProperty(k, v) { node.vars[k] = v; } } };
  node.append(...children);
  return node;
}
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
const find = (node, ok) => (typeof node === 'string' ? [] : [...(ok(node) ? [node] : []), ...node.children.flatMap((c) => find(c, ok))]);
const age = () => '12 min ago';
const click = (node) => node.listeners.click({ stopPropagation() {}, preventDefault() {} });

// ---------- the Skill Suggestion card ----------
const has = (line = 'Peeve has this skill.') => ({ agent: 'main', display: 'Peeve', has: true, line, next: 'Proceed with Peeve.' });
const TOP = { kind: 'match', skill: 'funding-analysis', skillKind: 'agent', id: 'skill:funding-analysis', editable: true, category: 'FUND', description: 'Use when you analyze funding options, compare fit, and draft recommendations.', reason: 'The memo mentions funding and analysis.', access: has() };
const OTHERS = [
  { skill: 'grant-writing', skillKind: 'agent', id: 'skill:grant-writing', editable: true, category: 'FUND', description: 'Use when you draft a grant.', why: 'A skill of the workstream FUND.', access: has() },
  { skill: 'program-evaluation', skillKind: 'hand', id: 'hand:program-evaluation', editable: false, category: 'PROG', description: 'Use when you evaluate a program.', why: 'The memo also mentions program.', access: { has: false, line: 'Darkness lacks this skill. Sync needed.', next: 'Peeve has it.' } },
];
const MEMO = { id: 14, code: 'FUND-3', title: 'Grant options' };

test('the words of the card: the name as a title, the description without its fixed start, the badge', () => {
  assert.equal(skillTitle('funding-analysis'), 'Funding Analysis');
  assert.equal(skillTitle('sf_slack-post'), 'Sf Slack Post');
  assert.equal(shortDescription('Use when you analyze funding options, compare fit, and draft recommendations.'), 'When you analyze funding options, compare fit, and draft recommendations.');
  assert.ok(shortDescription('Use when ' + 'word '.repeat(60)).length <= 130);
  assert.ok(shortDescription('Use when ' + 'word '.repeat(60)).endsWith('…'));
  assert.deepEqual(badgeOf(has()), { text: 'Available', level: 'ok', title: 'Peeve has this skill.' });
  assert.deepEqual(badgeOf(OTHERS[1].access), { text: 'Sync needed', level: 'warn', title: 'Darkness lacks this skill. Sync needed. Peeve has it.' });
  assert.equal(badgeOf({ has: null, line: 'Landon does not load Claude skills.', next: '' }).text, 'Not loaded');
});

test('the card speaks about the open memo, or the selected one, or else the first memo with a predicted skill', () => {
  const list = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const skills = { 2: TOP, 3: { kind: 'suggest', name: 'daily-review' } };
  assert.equal(contextMemo(list, { openId: 3, selected: 1, skills }).id, 3, 'the open memo, also with only a suggestion for a new skill');
  assert.equal(contextMemo(list, { selected: 2, skills }).id, 2);
  assert.equal(contextMemo(list, { selected: 1, skills }).id, 2, 'the selected memo has no skill: the first one with a prediction');
  assert.equal(contextMemo(list, { selected: 1, skills: {}, others: { 1: OTHERS } }).id, 1, 'other suggestions count');
  assert.equal(contextMemo(list, { selected: 3, skills: {} }).id, 3, 'no skill anywhere: the memo in view');
  assert.equal(contextMemo([], {}), null);
});

test('the main skill and its chips: the prediction first, a chip she picks takes its place, at most three chips', () => {
  assert.deepEqual(suggestionOf(TOP, OTHERS), { main: TOP, chips: OTHERS });
  assert.deepEqual(suggestionOf(TOP, OTHERS, 'grant-writing'), { main: OTHERS[0], chips: [TOP, OTHERS[1]] });
  assert.deepEqual(suggestionOf(null, OTHERS), { main: OTHERS[0], chips: [OTHERS[1]] }, 'no prediction over the bar: the best of the others');
  assert.deepEqual(suggestionOf({ kind: 'suggest', name: 'x' }, []), { main: null, chips: [] });
  assert.equal(suggestionOf(TOP, [1, 2, 3, 4, 5].map((n) => ({ skill: `s${n}` }))).chips.length, 3);
});

test('the card of her mockup: the skill, Available, Use Skill, and the other suggestions as chips', () => {
  const used = [];
  const picked = [];
  const opened = [];
  const on = { use: (memo, name) => used.push([memo.id, name]), pick: (name) => picked.push(name), open: (memo) => opened.push(memo.id) };
  const card = suggestCard({ memo: MEMO, top: TOP, others: OTHERS, picked: null }, el, { on, link: skillLink });
  const text = textOf(card);
  for (const part of ['For FUND-3 · Grant options', '“Funding Analysis”', 'When you analyze funding options, compare fit, and draft recommendations.', 'Available', 'Use Skill →', 'Other suggestions', 'Grant Writing', 'Program Evaluation', 'The memo mentions funding and analysis.']) assert.ok(text.includes(part), part);
  const buttons = find(card, (n) => n.tag === 'button');
  assert.deepEqual(buttons.map(textOf), ['Use Skill →', 'Grant Writing', 'Program Evaluation']);
  // Use Skill does something real with the trial: the page opens the memo and writes the line into its reply field.
  assert.match(buttons[0].title, /Nothing is sent until you press Note or Reply\./);
  click(buttons[0]);
  assert.deepEqual(used, [[14, 'funding-analysis']]);
  click(buttons[2]);
  assert.deepEqual(picked, ['program-evaluation']);
  const links = find(card, (n) => n.tag === 'a');
  assert.deepEqual(links.map((a) => a.href), ['#memo-14', '/system#file=skill:funding-analysis&edit=1'], 'the memo, and the pencil into the editor of the System page');
  click(links[0]);
  assert.deepEqual(opened, [14]);
  // A chip she picked is the main skill. This agent lacks it: the button is off, and the card says what to do.
  const other = suggestCard({ memo: MEMO, top: TOP, others: OTHERS, picked: 'program-evaluation' }, el, { on, link: skillLink });
  assert.ok(textOf(other).includes('“Program Evaluation”') && textOf(other).includes('Sync needed') && textOf(other).includes('Peeve has it.'));
  const use = find(other, (n) => n.tag === 'button')[0];
  assert.equal(use.disabled, true);
  assert.equal(use.listeners.click, undefined);
  assert.equal(find(other, (n) => n.className === 'skill-edit')[0].href, '/system#file=hand:program-evaluation', 'a hand-made skill never opens in the editor');
});

test('the card with no skill: a suggestion for a new one opens a draft, and a memo with nothing says so', () => {
  const on = { use() {}, pick() {}, open() {} };
  const suggest = { kind: 'suggest', name: 'daily-review', category: 'ME', description: 'Use when you prepare a "Daily review" memo.', reason: 'x', count: 4 };
  const card = suggestCard({ memo: MEMO, top: suggest, others: [], picked: null }, el, { on, link: skillLink });
  assert.ok(textOf(card).includes('No skill fits this memo yet.') && textOf(card).includes('Daily Review'));
  const draft = find(card, (n) => n.className === 'sg-use')[0];
  assert.equal(draft.tag, 'a');
  assert.ok(draft.href.startsWith('/system#new=daily-review&category=ME&memo=14'));
  assert.equal(find(card, (n) => n.tag === 'button').length, 0);
  assert.ok(textOf(suggestCard({ memo: MEMO, top: null, others: [], picked: null }, el, { on })).includes('No skill stands out for this memo.'));
  assert.ok(textOf(suggestCard({ memo: null }, el, { on })).includes('No memo to suggest a skill for.'));
});

test('Use Skill writes one line into the reply text, keeps what she wrote, and replaces the line of another skill', () => {
  assert.equal(useLine('funding-analysis'), 'Use the skill funding-analysis for this memo.');
  assert.equal(withSkillLine('', 'botec'), 'Use the skill botec for this memo.');
  assert.equal(withSkillLine('Yes, go ahead.\n', 'botec'), 'Yes, go ahead.\nUse the skill botec for this memo.');
  assert.equal(withSkillLine('Yes.\nUse the skill grant-writing for this memo.', 'botec'), 'Yes.\nUse the skill botec for this memo.');
  assert.equal(withSkillLine(withSkillLine('Yes.', 'botec'), 'botec'), 'Yes.\nUse the skill botec for this memo.', 'a second press adds nothing');
});

// The other suggestions come from the registry of the skill trial (src/registry.js): no second registry.
const REGISTRY = {
  skills: [
    { name: 'funding-analysis', kind: 'agent', description: 'Use when you analyze funding options and compare fit.', category: 'FUND', triggers: [], agents: ['main'], missing: [], id: 'skill:funding-analysis' },
    { name: 'grant-writing', kind: 'agent', description: 'Use when you draft a grant proposal for a funder.', category: 'FUND', triggers: [], agents: ['main'], missing: [], id: 'skill:grant-writing' },
    { name: 'pledges-tab', kind: 'agent', description: 'Use when a new pledge reaches the worksheet.', category: 'FUND', triggers: [], agents: ['main'], missing: [], id: 'skill:pledges-tab' },
    { name: 'program-evaluation', kind: 'hand', description: 'Use when you evaluate a program.', category: 'PROG', triggers: [], agents: [], missing: ['main'], id: 'hand:program-evaluation' },
    { name: 'email-reply-drafts', kind: 'agent', description: 'Use when you draft a reply in Gmail.', category: 'OPS', triggers: [], agents: ['main'], missing: [], id: 'skill:email-reply-drafts' },
  ],
  agents: [{ name: 'main', display: 'Peeve', count: 4 }],
  categories: { FUND: 'Fundraising', PROG: 'Programs', OPS: 'Operations' },
};

test('the other suggestions of a memo: the other matches of its words, then the skills of its workstream, at most three', () => {
  const memo = { id: 5, ws: 'FUND', title: 'Funding analysis for the grant writing push', text: 'Compare the funding options, then the grant writing plan and the program evaluation.' };
  const top = predictSkill(memo, REGISTRY, { agent: 'main' });
  assert.equal(top.skill, 'funding-analysis');
  const others = otherSkills(memo, REGISTRY, { agent: 'main', skip: top.skill, category: top.category });
  assert.deepEqual(others.map((o) => o.skill), ['grant-writing', 'program-evaluation', 'pledges-tab']);
  assert.ok(!others.some((o) => o.skill === top.skill), 'never the predicted skill again');
  assert.match(others[0].why, /^The memo also mentions /);
  assert.equal(others[2].why, 'A skill of the workstream FUND.');
  assert.deepEqual([others[0].id, others[0].editable, others[0].access.has], ['skill:grant-writing', true, true]);
  assert.deepEqual([others[1].editable, others[1].access.has], [false, false], 'a hand-made skill that this agent lacks');
  assert.ok(!JSON.stringify(others).includes('email-reply-drafts'), 'a skill of another workstream that no word matches is no suggestion');
  assert.equal(otherSkills(memo, REGISTRY, { limit: 1 }).length, 1);
  // A memo with no workstream and no word of any skill gets none; the list by memo id leaves such a memo out.
  const plain = { id: 6, ws: null, title: 'Lunch', text: 'Where do we eat?' };
  assert.deepEqual(otherSkills(plain, REGISTRY), []);
  assert.deepEqual(Object.keys(othersAll([memo, plain], REGISTRY)), ['5']);
});

test('the route of the other suggestions: the owner only, descriptions and never a body, and 503 with no registry', async () => {
  assert.equal((await call(makeApp().app, '/api/skills/others')).status, 503);
  const { app, store } = makeApp({ registry: { get: () => REGISTRY, refresh: () => REGISTRY } });
  store.send({ from: 'main', to: 'cam', impact: 3, effort: 'short', ws: 'FUND', title: 'Funding analysis for the grant writing push', text: 'Compare the funding options and the grant writing plan.' });
  assert.equal((await call(app, '/api/skills/others', null, LIAISON_TOKEN)).status, 403);
  const got = await call(app, '/api/skills/others');
  assert.equal(got.status, 200);
  const [list] = Object.values(got.data.others);
  assert.deepEqual(list.map((o) => o.skill), ['grant-writing', 'pledges-tab']);
  assert.ok(!readFileSync(join(ROOT, 'src', 'ledger.js'), 'utf8').includes('/api/skills'), 'nothing about skills goes to the GitHub copy');
});

// ---------- the Quick Access card ----------
test('Quick Access: five buttons; each goes to the page that does it, and one that is not built says so and does nothing', () => {
  const items = quickItems({ routing: true, theme: 'Theme: Auto (day). Follows the sun.' });
  assert.deepEqual(items.map((i) => i.label), ['Edit Charters', 'Routing', 'Skills', 'Themes', 'Layout']);
  assert.deepEqual(items.map((i) => i.href || i.run || null), ['/system#h-charters', 'routing', '/system#h-skills', 'theme', null]);
  const ran = [];
  const row = quickAccess(items, el, { run: (what) => ran.push(what) });
  const nodes = row.children;
  assert.deepEqual(nodes.map((n) => n.tag), ['a', 'button', 'a', 'button', 'span']);
  click(nodes[1]);
  click(nodes[3]);
  assert.deepEqual(ran, ['routing', 'theme']);
  // Layout is not built: no link, no button, the words "not built yet", and a tooltip that says so.
  const layout = nodes[4];
  assert.equal(layout.className, 'qa off');
  assert.equal(layout.attrs['aria-disabled'], 'true');
  assert.equal(layout.href, undefined);
  assert.equal(layout.listeners.click, undefined);
  assert.ok(textOf(layout).includes('not built yet'));
  assert.match(layout.title, /^Not built yet/);
  // With one agent there is nothing to route by hand, and before the theme file loads there is no theme button.
  const bare = quickItems();
  assert.deepEqual(bare.map((i) => Boolean(i.href || i.run)), [true, false, true, false, false]);
  assert.match(bare[1].title, /^Not built yet/);
  // The sections that the links name are on the System page, which moves to them.
  const system = readFileSync(join(ROOT, 'ui', 'system.html'), 'utf8');
  for (const id of ['h-charters', 'h-skills']) assert.ok(system.includes(`id="${id}"`), id);
  assert.match(system, /const id = \/\^#\(h-\[a-z\]\+\)\$\/\.exec\(location\.hash \|\| ''\)\?\.\[1\];/);
});

test('the pages: the two cards on the Inbox, Use Skill sends nothing, and nothing of a health strip is left', () => {
  const inbox = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  for (const part of ['id="skill-suggest"', 'id="quick-access"', "api('/api/skills/others')"]) assert.ok(inbox.includes(part), part);
  const use = inbox.slice(inbox.indexOf('function useSkill'), inbox.indexOf('function renderSuggest'));
  assert.ok(use.includes('setDraft(memo.id, text);'));
  assert.ok(!use.includes('api('), 'no request: the text waits in the reply field for her Note or Reply');
  const system = readFileSync(join(ROOT, 'ui', 'system.html'), 'utf8');
  const dash = readFileSync(join(ROOT, 'ui', 'dash.js'), 'utf8');
  for (const text of [inbox, system, dash]) assert.doesNotMatch(text, /\/api\/health|health-strip|goals-card|h-integrations/);
});
