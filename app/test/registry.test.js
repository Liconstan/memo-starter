import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRegistry, createRegistry, accountSkills, agentAccounts, guessCategory, unquote, parseTriggers, stem, singular, spreadLine, accessFor,
  scoreSkills, predictSkill, suggestSkill, titleKey, predictAll, BAR, SUGGEST_MIN } from '../src/registry.js';
import { skillLink, parseSkillHash, starLabel, pencilLabel, skillStar, skillCard, STAR, STAR_OPEN, PENCIL } from '../ui/skills.js';
import { makeApp, call, LIAISON_TOKEN, WORKSTREAMS, ROOT } from './helpers.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const SECRET = 'THE-BODY-OF-A-SKILL-STAYS-ON-THE-MAC';
const write = (dir, rel, text) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), text); };
const skill = (name, description, more = '') => `---\nname: ${name}\ndescription: ${description}\n${more}---\n\n# ${name}\n\n${SECRET}\n`;

// A vault and a home folder as on the Mac of the owner: two long agents on two Claude accounts that share one work
// folder, whose .claude/skills is a link to the agent skills of the vault. The first account has her hand-made
// skills; the second has only the skills that come with Claude.
function makeHome() {
  const base = mkdtempSync(join(tmpdir(), 'memo-registry-'));
  const vault = join(base, 'vault');
  const home = join(base, 'home');
  const local = join(base, 'local');
  write(vault, 'skills/README.md', '# Skills');
  write(vault, 'skills/agent/email-reply-drafts/SKILL.md', skill('email-reply-drafts', "Use when you triage the owner's email or draft a reply for her in Gmail. Covers her existing drafts and scheduling replies.", 'last_used: 2026-11-04\n'));
  write(vault, 'skills/agent/pledges-tab/SKILL.md', skill('pledges-tab', 'Use when a new gift, grant or pledge reaches Example Org, to keep the Pledges tab of the bookkeeping worksheet current.', 'last_used: 2026-09-01\ncategory: OPS\n'));
  write(vault, 'skills/agent/residency-rolling-review/SKILL.md', skill('residency-rolling-review', 'Use in each daily review, or when the owner asks about residency applicants, to rate new rolling applications to the Residency.'));
  write(vault, 'skills/agent/slack-message-drafts/SKILL.md', skill('slack-message-drafts', '"Use when you draft an internal Slack message for the owner to send herself (to a teammate, a channel or a thread)."', 'triggers: [slack draft, "post in the channel"]\n'));
  write(vault, 'skills/agent/zzz-plain/SKILL.md', skill('zzz-plain', 'Use when nothing else fits.'));
  write(vault, 'skills/botec/SKILL.md', skill('botec', 'Botec for grant RFP'));
  write(vault, 'skills/my-writing-voice/SKILL.md', skill('"my-writing-voice"', '"Use when drafting anything the owner sends as herself (emails, Slack messages, DMs) so it sounds like her."'));
  // The cloud agent starts in the vault: its .claude/skills is the same link.
  mkdirSync(join(vault, '.claude'), { recursive: true });
  symlinkSync(join(vault, 'skills', 'agent'), join(vault, '.claude', 'skills'));
  mkdirSync(join(home, 'memo-work', '.claude'), { recursive: true });
  symlinkSync(join(vault, 'skills', 'agent'), join(home, 'memo-work', '.claude', 'skills'));
  // The first account: an old folder of an earlier sign-in, and the current one with a manifest.
  const first = join(home, '.claude', 'skills', 'synced');
  write(first, 'old-bucket/stale-skill/SKILL.md', skill('stale-skill', 'Use when the old sign-in.'));
  write(first, 'old-bucket/.last-complete-round', 'x');
  utimesSync(join(first, 'old-bucket', '.last-complete-round'), new Date('2026-10-01T00:00:00Z'), new Date('2026-10-01T00:00:00Z'));
  for (const name of ['botec', 'my-writing-voice', 'docx']) write(first, `bucket/${name}/SKILL.md`, skill(name, `Use when ${name}.`));
  write(first, 'bucket/nonprofit-finance-copilot/SKILL.md', skill('nonprofit-finance-copilot', 'Run approval-based accounting operations for a nonprofit: bills, invoices and the board finance report.'));
  write(first, 'bucket/manifest.json', JSON.stringify({ skills: [
    { name: 'botec', source: 'plugin' }, { name: 'my-writing-voice', source: 'plugin' }, { name: 'nonprofit-finance-copilot', source: 'plugin' },
    { name: 'docx', source: 'anthropic' },
  ] }));
  write(first, 'bucket/.last-complete-round', 'x');
  // The second account: only what comes with Claude.
  const second = join(home, '.claude-second', 'skills', 'synced');
  write(second, 'bucket/docx/SKILL.md', skill('docx', 'Use when docx.'));
  write(second, 'bucket/pdf/SKILL.md', skill('pdf', 'Use when pdf.'));
  write(second, 'bucket/manifest.json', JSON.stringify({ skills: [{ name: 'docx', source: 'anthropic' }, { name: 'pdf', source: 'anthropic-example' }] }));
  write(local, 'agents.json', JSON.stringify([
    { name: 'main', kind: 'long', dir: '~/memo-work' },
    { name: 'second', kind: 'long', dir: '~/memo-work', env: { CLAUDE_CONFIG_DIR: '~/.claude-second' } },
    { name: 'gpt', kind: 'remote' },
    { name: 'liaison', kind: 'short', dir: 'work/liaison' },
  ]));
  return { base, vault, home, local };
}
const registryOf = (h = makeHome()) => buildRegistry({ vault: h.vault, local: h.local, home: h.home, workstreams: WORKSTREAMS, now: NOW });

test('the small parsers: quotes, triggers, and the plain form of a word', () => {
  assert.equal(unquote('"Use when x: y"'), 'Use when x: y');
  assert.equal(unquote("'it''s'"), "it's");
  assert.equal(unquote('plain "word" here'), 'plain "word" here');
  assert.equal(unquote(undefined), '');
  assert.deepEqual(parseTriggers('[Slack draft, "post in the channel", x]'), ['slack draft', 'post in the channel']);
  assert.deepEqual(parseTriggers('pledge letter,  gift   received'), ['pledge letter', 'gift received']);
  assert.deepEqual(parseTriggers(''), []);
  assert.deepEqual(['replies', 'drafts', 'class', 'status', 'ups'].map(singular), ['reply', 'draft', 'class', 'status', 'up']);
  assert.deepEqual(['matched', 'matching', 'drafts', 'speed', 'thing'].map(stem), ['match', 'match', 'draft', 'speed', 'thing']);
});

test('the registry has each skill once, with its kind, its description and never its text', () => {
  const r = registryOf();
  assert.deepEqual(r.skills.map((s) => `${s.kind}:${s.name}`), ['agent:email-reply-drafts', 'agent:pledges-tab', 'agent:residency-rolling-review', 'agent:slack-message-drafts', 'agent:zzz-plain',
    'hand:botec', 'hand:my-writing-voice', 'hand:nonprofit-finance-copilot']);
  assert.ok(!JSON.stringify(r).includes(SECRET), 'no body of a skill is in the registry');
  assert.ok(r.skills.every((s) => s.file === undefined), 'and no path');
  const by = Object.fromEntries(r.skills.map((s) => [s.name, s]));
  assert.equal(by['slack-message-drafts'].description, 'Use when you draft an internal Slack message for the owner to send herself (to a teammate, a channel or a thread).', 'the quotes of the frontmatter are gone');
  assert.deepEqual(by['slack-message-drafts'].triggers, ['slack draft', 'post in the channel']);
  assert.deepEqual([by['email-reply-drafts'].id, by.botec.id, by['nonprofit-finance-copilot'].id], ['skill:email-reply-drafts', 'hand:botec', null]);
  assert.deepEqual([by.botec.pinned, by['nonprofit-finance-copilot'].pinned], [true, false]);
  assert.match(by['nonprofit-finance-copilot'].description, /^Run approval-based accounting/, 'a skill with no copy in the vault takes the description of the account');
  assert.deepEqual([by['pledges-tab'].stale, by['email-reply-drafts'].stale], [true, false]);
  // The skills that come with Claude, and those of an old sign-in, are not in the registry.
  for (const name of ['docx', 'pdf', 'stale-skill']) assert.equal(by[name], undefined, name);
});

test('the registry says which agents have a skill, and which skills must be spread', () => {
  const r = registryOf();
  const by = Object.fromEntries(r.skills.map((s) => [s.name, s]));
  assert.deepEqual(r.agents, [{ name: 'main', display: 'Peeve', count: 8 }, { name: 'second', display: 'Darkness', count: 5 }]);
  // An agent skill reaches both through the link of the work folder, and the cloud agent through the link of the vault.
  assert.deepEqual([by['pledges-tab'].agents, by['pledges-tab'].missing, by['pledges-tab'].access, by['pledges-tab'].cloud], [['main', 'second'], [], 'all', true]);
  // A hand-made skill is only on the account that has it. Whether the cloud agent has it, the files cannot tell.
  assert.deepEqual([by.botec.agents, by.botec.missing, by.botec.access, by.botec.cloud], [['main'], ['second'], 'spread', undefined]);
  assert.equal(spreadLine(by['pledges-tab']), 'In all agents');
  assert.equal(spreadLine(by.botec), 'Needs spreading: missing on Darkness');
  assert.equal(spreadLine({ agents: [], missing: ['main', 'second'] }), 'In no agent yet');
  assert.deepEqual(r.skills.filter((s) => s.access === 'spread').map((s) => s.name), ['botec', 'my-writing-voice', 'nonprofit-finance-copilot']);
  // Without the link in the work folder, no agent has the agent skills, and the vault link says nothing of the cloud.
  const h = makeHome();
  const bare = buildRegistry({ vault: h.vault, local: join(h.base, 'no-local'), home: join(h.base, 'empty-home'), workstreams: WORKSTREAMS, now: NOW });
  assert.deepEqual(bare.agents.map((a) => [a.name, a.count]), [['main', 0], ['second', 0]], 'no agents.json: main and second');
  assert.deepEqual(bare.skills.find((s) => s.name === 'pledges-tab').missing, ['main', 'second']);
});

test('the accounts: the long agents of agents.json, the newest synced folder, and the manifest', () => {
  const h = makeHome();
  assert.deepEqual(agentAccounts({ local: h.local, home: h.home }), [
    { name: 'main', config: join(h.home, '.claude'), dir: join(h.home, 'memo-work') },
    { name: 'second', config: join(h.home, '.claude-second'), dir: join(h.home, 'memo-work') },
  ]);
  assert.deepEqual([...accountSkills(join(h.home, '.claude')).keys()].sort(), ['botec', 'my-writing-voice', 'nonprofit-finance-copilot']);
  assert.deepEqual([...accountSkills(join(h.home, '.claude-second')).keys()], []);
  assert.deepEqual([...accountSkills(join(h.home, 'nowhere')).keys()], []);
  // A skill folder of the account itself counts, and a folder with no manifest counts whole.
  write(h.home, '.claude-second/skills/merge-conflict-helper/SKILL.md', skill('merge-conflict-helper', 'Use when a merge conflict.'));
  write(h.home, '.claude-third/skills/synced/b/own/SKILL.md', skill('own', 'Use when own.'));
  assert.deepEqual([...accountSkills(join(h.home, '.claude-second')).keys()], ['merge-conflict-helper']);
  assert.deepEqual([...accountSkills(join(h.home, '.claude-third')).keys()], ['own']);
});

test('the category: the key of the skill when it is a workstream code, else a guess from the words, marked as a guess', () => {
  const r = registryOf();
  const by = Object.fromEntries(r.skills.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(r.categories), Object.keys(WORKSTREAMS));
  assert.deepEqual([by['pledges-tab'].category, by['pledges-tab'].categoryGuessed], ['OPS', false], 'the key wins over the words gift, grant and pledge');
  assert.deepEqual([by['residency-rolling-review'].category, by['residency-rolling-review'].categoryGuessed], ['PROG', true]);
  assert.deepEqual([by['email-reply-drafts'].category, by.botec.category, by['nonprofit-finance-copilot'].category], ['OPS', 'SPEC', 'OPS']);
  assert.ok(by['residency-rolling-review'].categoryWords.includes('residency'));
  assert.deepEqual([by['zzz-plain'].category, by['zzz-plain'].categoryGuessed], ['SYS', true], 'no word of any workstream: the fallback, still marked');
  assert.ok(r.skills.every((s) => Object.hasOwn(WORKSTREAMS, s.category)));
  assert.equal(guessCategory('pledges-tab', 'Use when a new gift, grant or pledge arrives.', WORKSTREAMS).code, 'FUND');
  assert.equal(guessCategory('x', 'A party with a guest list on the event app.', WORKSTREAMS).code, 'COMM');
  assert.equal(guessCategory('x', 'Nothing to see.', WORKSTREAMS), null);
  // A category that is not one of her codes is not taken.
  const h = makeHome();
  write(h.vault, 'skills/agent/odd/SKILL.md', skill('odd', 'Use when a grant report is due.', 'category: NOPE\n'));
  const odd = registryOf(h).skills.find((s) => s.name === 'odd');
  assert.deepEqual([odd.category, odd.categoryGuessed], ['FUND', true]);
  // A code that the word table does not know gets its guess from its own description.
  assert.equal(guessCategory('x', 'Use when the garden needs watering.', { GDN: 'Garden: watering and planting' }).code, 'GDN');
});

test('the prediction picks one skill by the words of its name, with a reason and the access of the agent', () => {
  const r = registryOf();
  const memo = { id: 1, ws: null, sender: 'main', title: 'Reply drafts: three left', text: '**Of the seven reply drafts, four are done and three are still waiting in your Gmail.**\n\nDone, no action needed.' };
  const p = predictSkill(memo, r, { agent: 'main' });
  assert.deepEqual([p.kind, p.skill, p.skillKind, p.id, p.editable, p.category], ['match', 'email-reply-drafts', 'agent', 'skill:email-reply-drafts', true, 'OPS']);
  assert.match(p.reason, /^The memo mentions /);
  for (const word of ['reply', 'draft']) assert.ok(p.reason.toLowerCase().includes(word), `the reason names ${word}`);
  assert.ok(p.score >= BAR);
  assert.deepEqual(p.access, { agent: 'main', display: 'Peeve', has: true, line: 'Peeve has this skill.', next: 'Proceed with Peeve.' });
  assert.equal(p.description, r.skills.find((s) => s.name === 'email-reply-drafts').description);
  assert.ok(!JSON.stringify(p).includes(SECRET));
  // The same memo twice gives the same answer: a rule, not a guess.
  assert.deepEqual(predictSkill(memo, r, { agent: 'main' }), p);
  // The workstream of the memo that is the category of the skill is in the reason, and raises the score.
  const res = { id: 2, ws: 'PROG', sender: 'second', title: 'Residency: winter cohort and 2 strong applicants', text: '**Two rolling applicants look strong.**' };
  const q = predictSkill(res, r, { agent: 'second' });
  assert.equal(q.skill, 'residency-rolling-review');
  assert.match(q.reason, /its workstream PROG is the category of the skill\.$/);
  assert.ok(q.score > predictSkill({ ...res, ws: 'OPS' }, r).score);
  assert.equal(q.confidence, 'high');
  // A higher bar, as her dismissals would set it, takes a weak match away.
  assert.equal(predictSkill(memo, r, { bar: 1000 }), null);
});

test('the prediction gives nothing below the bar: one word, words far down a long memo, or an instruction to reply', () => {
  const r = registryOf();
  const none = (memo, why) => assert.equal(predictSkill({ id: 9, ws: null, sender: 'main', ...memo }, r), null, why);
  none({ title: 'Disk at 74 percent', text: '**Three apps need you.**' }, 'no word of any skill');
  none({ title: 'Residency SOP', text: '**The SOP is ready to read.**' }, 'one word of a name is not enough');
  none({ title: 'Volunteers group', text: '**Good plan. Make a Google Group, then reply with its address.** I add the step to the draft.\n\nReply yes or no.' }, 'reply as an instruction is no word of the task');
  // A digest that names many things far down: only the head and the next 1,500 characters count.
  const digest = `**Daily review, Wednesday. Pick the focus blocks.**\n\n${'- A task of the day that says little.\n'.repeat(60)}- Update the pledges tab with the new pledge.\n- Draft the email reply to the funder.`;
  none({ title: 'Daily review, Wednesday November 11', text: digest }, 'words far down a long memo');
  // Two words of a name, but none of them in the head.
  none({ title: 'Status', text: `**All is well.**\n\n${'Nothing here. '.repeat(20)}\n\nLater: the workshop, and a rolling start.` }, 'no word of the name in the head');
  assert.deepEqual(scoreSkills({ title: 'Disk', text: 'x' }, r), []);
});

test('a trigger phrase of a skill is enough, and a skill with a one-word name needs a word of its description too', () => {
  const r = registryOf();
  const p = predictSkill({ id: 3, ws: null, title: 'Note to Sam', text: '**Here is the Slack draft for Sam.** Paste it.' }, r);
  assert.equal(p.skill, 'slack-message-drafts');
  assert.match(p.reason, /has the trigger "slack draft"/);
  assert.equal(predictSkill({ id: 4, ws: null, title: 'Botec', text: '**Numbers only.**' }, r), null, 'the name alone');
  const b = predictSkill({ id: 5, ws: 'SPEC', title: 'Botec for the grant RFP', text: '**The estimate is ready.**' }, r, { agent: 'second' });
  assert.deepEqual([b.skill, b.skillKind, b.id, b.editable], ['botec', 'hand', 'hand:botec', false], 'a hand-made skill is never editable');
});

test('the access line: the agent of the memo has the skill, lacks it, or loads no Claude skills', () => {
  const r = registryOf();
  const botec = r.skills.find((s) => s.name === 'botec');
  const agentSkill = r.skills.find((s) => s.name === 'pledges-tab');
  assert.deepEqual(accessFor(botec, 'main', r), { agent: 'main', display: 'Peeve', has: true, line: 'Peeve has this skill.', next: 'Proceed with Peeve.' });
  assert.deepEqual(accessFor(botec, 'second', r), { agent: 'second', display: 'Darkness', has: false, line: 'Darkness lacks this skill. Sync needed.',
    next: 'Peeve has it. The nightly skills sync adds it for Darkness, or send the task to Peeve.' });
  assert.equal(accessFor(agentSkill, 'second', r).has, true);
  assert.deepEqual(accessFor(agentSkill, 'gpt', r), { agent: 'gpt', display: 'Landon', has: null, line: 'Landon does not load Claude skills.', next: 'It reads the skill file only when the task names it.' });
  assert.match(accessFor({ ...agentSkill, agents: ['main'], missing: ['second'] }, 'second', r).next, /Check the skills link in the work folder of Darkness\.$/);
  assert.equal(accessFor({ ...botec, agents: [], missing: ['main', 'second'] }, 'main', r).next, 'The nightly skills sync adds it for Peeve.');
});

test('the key of a title: the words before the colon or the comma, without dates and filler', () => {
  assert.deepEqual(titleKey('Daily review, Wednesday November 11'), { key: 'daily-review', phrase: 'Daily review' });
  assert.equal(titleKey('Daily review, updated 2:50 PM').key, 'daily-review');
  assert.equal(titleKey('Follow-ups: Sam 1:1').key, 'follow-up');
  assert.equal(titleKey('Follow-up: Alex Doe').key, 'follow-up');
  assert.equal(titleKey("What last night's sync was unsure about").key, 'sync-unsure');
  assert.equal(titleKey('Sync unsure items, Nov 9').key, 'sync-unsure');
  assert.equal(titleKey('Residency forms: 15 checkboxes, ready').key, 'residency-form');
  for (const title of ['Pets: fixes in', 'Bitly', '', null, 'Nov 9, 2026', '1300']) assert.equal(titleKey(title), null, `one word or none: ${title}`);
});

test('a suggestion for a new skill: a workstream whose memo titles repeat, and no skill that matches', () => {
  const r = registryOf();
  const day = (n) => `2026-11-${String(n).padStart(2, '0')}T15:00:00.000Z`;
  const history = [
    { id: 10, ws: 'ME', title: 'Daily review, Monday November 9', created: day(9) },
    { id: 11, ws: 'ME', title: 'Daily review, Tuesday November 10', created: day(10) },
    { id: 12, ws: 'ME', title: 'Daily review, Wednesday November 11', created: day(11) },
    { id: 13, ws: 'OPS', title: 'Daily review of the books', created: day(11) },
    { id: 14, ws: 'ME', title: 'Signal digest live', created: day(11) },
  ];
  const memo = { id: 12, ws: 'ME', sender: 'second', title: 'Daily review, Wednesday November 11', text: '**Daily review. Pick the focus blocks.**', created: day(11) };
  const s = suggestSkill(memo, history, r);
  assert.deepEqual([s.kind, s.name, s.category, s.count], ['suggest', 'daily-review', 'ME', SUGGEST_MIN], 'the memo itself is in the history and counts once; the OPS memo does not count');
  assert.equal(s.description, 'Use when you prepare a "Daily review" memo in the workstream ME. Covers the steps that repeat each time.');
  assert.ok(s.description.length < 300 && s.description.startsWith('Use when'));
  assert.match(s.reason, /3 memos of ME start with "Daily review" since 2026-11-09/);
  // Not enough memos, all on one day, no workstream, no title, or a skill of that name: no suggestion.
  assert.equal(suggestSkill(memo, history.slice(1), r), null, 'two memos');
  assert.equal(suggestSkill(memo, history.map((h) => ({ ...h, created: day(11) })), r), null, 'one day');
  assert.equal(suggestSkill({ ...memo, ws: null }, history.map((h) => ({ ...h, ws: null })), r), null, 'no workstream');
  assert.equal(suggestSkill({ ...memo, title: null }, history, r), null);
  assert.equal(suggestSkill({ ...memo, title: 'Pets: fixes in' }, history, r), null, 'a title of one word');
  const taken = { ...r, skills: [...r.skills, { name: 'daily-review' }] };
  assert.equal(suggestSkill(memo, history, taken), null);
  // For the Inbox: a match where there is one, else a suggestion, else no entry; the agent is that of each memo.
  const all = predictAll([
    { id: 1, ws: null, sender: 'second', title: 'Botec for the grant RFP', text: '**The estimate is ready.**' },
    memo,
    { id: 99, ws: 'SYS', sender: 'main', title: 'Disk at 74 percent', text: '**Three apps need you.**' },
  ], history, r, { agentOf: (m) => m.sender });
  assert.deepEqual(Object.keys(all), ['1', '12']);
  assert.deepEqual([all[1].kind, all[1].access.has, all[1].access.line], ['match', false, 'Darkness lacks this skill. Sync needed.']);
  assert.equal(all[12].kind, 'suggest');
});

test('the registry of the server is built again after its time, not at each request', () => {
  const h = makeHome();
  const reg = createRegistry({ vault: h.vault, local: h.local, home: h.home, workstreams: WORKSTREAMS, now: () => NOW });
  const first = reg.get();
  write(h.vault, 'skills/agent/new-one/SKILL.md', skill('new-one', 'Use when new.'));
  assert.equal(reg.get(), first, 'the same object within 30 seconds');
  assert.ok(reg.refresh().skills.some((s) => s.name === 'new-one'));
});

test('the skill routes: the owner only, descriptions and never a body, and nothing of them in the ledger', async () => {
  const h = makeHome();
  const registry = createRegistry({ vault: h.vault, local: h.local, home: h.home, workstreams: WORKSTREAMS, now: () => NOW });
  const { app, store } = makeApp({ registry });
  const list = await call(app, '/api/skills');
  assert.equal(list.status, 200);
  assert.equal(list.data.skills.length, 8);
  assert.equal(list.data.skills.find((s) => s.name === 'botec').spread, 'Needs spreading: missing on Darkness');
  assert.deepEqual(list.data.agents.map((a) => a.display), ['Peeve', 'Darkness']);
  assert.ok(!JSON.stringify(list.data).includes(SECRET));
  // A memo of the Inbox with a match, one with none, and a memo to an agent, which is not of the Inbox.
  const a = store.send({ from: 'main', to: 'cam', text: '**Of the seven reply drafts, three are still waiting in your Gmail.**', title: 'Reply drafts: three left', impact: 3, effort: 'short' }).memo;
  const b = store.send({ from: 'main', to: 'cam', text: '**Three apps need you.**', title: 'Disk at 74 percent', impact: 3, effort: 'short' }).memo;
  store.send({ from: 'cam', to: 'main', text: 'Draft an email reply to Sam.' });
  const p = await call(app, '/api/skills/predictions');
  assert.equal(p.status, 200);
  assert.deepEqual(Object.keys(p.data.predictions), [String(a.id)]);
  assert.deepEqual([p.data.predictions[a.id].skill, p.data.predictions[a.id].access.line], ['email-reply-drafts', 'Peeve has this skill.']);
  assert.equal(p.data.predictions[b.id], undefined);
  assert.ok(!JSON.stringify(p.data).includes(SECRET));
  // The queue of the Inbox, which the ledger copies to GitHub, has nothing about skills.
  const queue = await call(app, '/api/queue');
  assert.ok(!/skill/i.test(JSON.stringify(queue.data).replace(/reply drafts/gi, '')), 'no skill field in the queue');
  const ledger = readFileSync(join(ROOT, 'src', 'ledger.js'), 'utf8');
  assert.ok(!ledger.includes('/api/skills'), 'the ledger reads no skill route');
  assert.ok(readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8').includes('if (globalThis.MEMO_LEDGER) return;\n  const ids = memos.map'), 'the GitHub copy of the Inbox never asks for the predictions');
  // The liaison token, no token, and a server with no registry.
  for (const path of ['/api/skills', '/api/skills/predictions', '/api/skills/draft?name=x-y']) {
    assert.equal((await call(app, path, null, LIAISON_TOKEN)).status, 403, path);
    assert.equal((await call(app, path, null, '')).status, 401, path);
    assert.equal((await call(makeApp().app, path)).status, 503, path);
  }
  assert.equal((await app.request('/ui/skills.js')).status, 200);
});

test('the links of the skill marks: the editor for an agent skill, a view for a pinned one, a draft for a suggestion', () => {
  const agent = { kind: 'match', skill: 'email-reply-drafts', skillKind: 'agent', id: 'skill:email-reply-drafts', editable: true };
  const hand = { kind: 'match', skill: 'botec', skillKind: 'hand', id: 'hand:botec', editable: false };
  const loose = { kind: 'match', skill: 'nonprofit-finance-copilot', skillKind: 'hand', id: null, editable: false };
  const idea = { kind: 'suggest', name: 'daily-review', category: 'ME', description: 'Use when you prepare a "Daily review" memo & more.' };
  assert.equal(skillLink(agent), '/system#file=skill:email-reply-drafts&edit=1');
  assert.equal(skillLink(hand), '/system#file=hand:botec', 'never the editor');
  assert.equal(skillLink(loose), null);
  assert.equal(skillLink(null), null);
  assert.deepEqual(parseSkillHash(new URL(skillLink(agent), 'http://memo.test').hash), { file: 'skill:email-reply-drafts', edit: true });
  assert.deepEqual(parseSkillHash('#file=hand:botec&edit=1'), { file: 'hand:botec', edit: false }, 'a hand-made skill opens view only, whatever the address says');
  assert.deepEqual(parseSkillHash('#file=lessons'), { file: 'lessons', edit: false });
  assert.deepEqual(parseSkillHash(new URL(skillLink(idea, 1417), 'http://memo.test').hash), { draft: { name: 'daily-review', description: idea.description, category: 'ME', memo: '1417' } });
  for (const hash of ['', '#', '#memo-12', '#file=../x', '#file=skill:Bad Name', '#new=Bad Name', '#new=../x']) assert.equal(parseSkillHash(hash), null, hash);
  assert.deepEqual(parseSkillHash('#new=x-y&category=nope&memo=abc'), { draft: { name: 'x-y', description: '', category: '', memo: '' } });
  assert.deepEqual([starLabel(agent), starLabel(idea)], ['Skill predicted: email-reply-drafts', 'Skill suggested: daily-review']);
  assert.deepEqual([pencilLabel(agent), pencilLabel(idea)], ['Edit skill email-reply-drafts', 'Edit a draft of the new skill daily-review']);
  assert.match(pencilLabel(hand), /^View skill botec .*view only/);
});

// A node of a page, enough for the two builders: its tag, its properties, its attributes and its children.
function el(tag, props = {}, ...children) {
  const node = { tag, ...props, attrs: {}, children: children.filter((c) => c !== ''), setAttribute(k, v) { this.attrs[k] = v; }, append(...more) { this.children.push(...more.filter((c) => c !== '')); } };
  return node;
}
const textOf = (node) => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
const find = (node, test) => (typeof node === 'string' ? [] : [...(test(node) ? [node] : []), ...node.children.flatMap((c) => find(c, test))]);

test('the star and the card say what they mean in words, for a screen reader', () => {
  const p = { kind: 'match', skill: 'botec', skillKind: 'hand', id: 'hand:botec', editable: false, category: 'SPEC', categoryGuessed: true, confidence: 'medium',
    description: 'Botec for grant RFP', reason: 'The memo mentions botec and rfp.', access: { agent: 'second', display: 'Darkness', has: false, line: 'Darkness lacks this skill. Sync needed.', next: 'Peeve has it.' } };
  assert.equal(skillStar(undefined, el), '');
  const star = skillStar(p, el);
  assert.deepEqual([star.children, star.attrs.role, star.attrs['aria-label'], star.title, star.className], [[STAR], 'img', 'Skill predicted: botec', 'Skill predicted: botec', 'skill-star']);
  const card = skillCard(p, el, 7);
  assert.equal(card.attrs['aria-label'], 'Skill prediction');
  const text = textOf(card);
  for (const part of ['Skill prediction', 'Likely skill: botec', 'SPEC', 'hand-made, pinned', 'The memo mentions botec and rfp.', 'Darkness lacks this skill. Sync needed.', 'Peeve has it.', 'Botec for grant RFP']) assert.ok(text.includes(part), part);
  const [pencil] = find(card, (n) => n.tag === 'a');
  assert.deepEqual([pencil.href, pencil.children, pencil.attrs['aria-label']], ['/system#file=hand:botec', [PENCIL], 'View skill botec (hand-made and pinned: view only)']);
  assert.equal(find(card, (n) => n.tag === 'details')[0].className, 'skill-access warn');
  assert.ok(find(card, (n) => n.attrs?.['aria-hidden'] === 'true').length >= 2, 'the signs are hidden from a screen reader; the words say it');
  // A skill with no file to open has no pencil, and says why.
  const loose = skillCard({ ...p, id: null, access: { has: true, line: 'Peeve has this skill.', next: 'Proceed with Peeve.' } }, el, 7);
  assert.equal(find(loose, (n) => n.tag === 'a').length, 0);
  assert.match(textOf(loose), /no pinned copy in the vault/);
  assert.equal(find(loose, (n) => n.tag === 'details')[0].className, 'skill-access ok');
  // A suggestion: the open star, the proposed description, and the pencil to a draft.
  const idea = { kind: 'suggest', name: 'daily-review', category: 'ME', description: 'Use when you prepare a "Daily review" memo.', reason: 'No skill matches, and 4 memos of ME start with "Daily review".' };
  assert.deepEqual([skillStar(idea, el).children, skillStar(idea, el).attrs['aria-label']], [[STAR_OPEN], 'Skill suggested: daily-review']);
  const draft = skillCard(idea, el, 1417);
  for (const part of ['Skill suggestion', 'Suggested skill: daily-review', 'ME', 'Proposed description: Use when you prepare', 'nothing is saved until you save it']) assert.ok(textOf(draft).includes(part), part);
  const [toDraft] = find(draft, (n) => n.tag === 'a');
  assert.ok(toDraft.href.startsWith('/system#new=daily-review&category=ME&memo=1417&description=Use+when'));
  assert.equal(toDraft.attrs['aria-label'], 'Edit a draft of the new skill daily-review');
  assert.equal(skillCard(undefined, el), '');
});

test('the pages carry the marks: the star in a row, the card in the open memo, and the address of one file', () => {
  const inbox = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  assert.ok(inbox.includes('skillStar(skills[memo.id], el)') && inbox.includes('skillCard(skills[memo.id], el, memo.id)'));
  const system = readFileSync(join(ROOT, 'ui', 'system.html'), 'utf8');
  // The pages come from disk at once, and the list of the files of ui/ comes with a start of the server: a page must
  // work with a server from before ui/skills.js. So it loads that file by itself, and goes on without it.
  for (const page of [inbox, system]) {
    assert.ok(!/^import [^\n]*\/ui\/skills\.js/m.test(page), 'no import that stops the page');
    assert.match(page, /^import\('\/ui\/skills\.js'\)\.then\([^\n]*\)\.catch\(\(\) => \{\}\);$/m);
  }
  for (const part of ['m.parseSkillHash(location.hash)', "addEventListener('hashchange'", '/api/skills/draft?', 'id="skill-filter"', 'aria-pressed', 's.spread']) assert.ok(system.includes(part), part);
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const rules = css.slice(css.indexOf('/* The skill marks'));
  assert.ok(rules.includes('.skill-card') && rules.includes('.skill-star'));
  assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(rules), 'the skill marks use only the color variables, so they follow both themes');
});
