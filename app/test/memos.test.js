import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore, MemoError, referencedIds, referencedCodes } from '../src/memos.js';

const NAMES = ['cam', 'discord', 'main', 'liaison'];
function makeStore() {
  let t = Date.parse('2026-10-09T12:00:00Z');
  return createStore(openDb(), { owner: 'cam', names: NAMES, forwardTo: ['main'], now: () => new Date((t += 1000)) });
}
const toCam = { from: 'main', to: 'cam', text: 'Approve the deploy?', impact: 4, effort: 'micro' };
const refuses = (fn, status, part) =>
  assert.throws(fn, (e) => e instanceof MemoError && e.status === status && e.message.includes(part));

test('send to cam stores an open memo with its impact and effort', () => {
  const s = makeStore();
  const { memo, corrections } = s.send(toCam);
  assert.equal(memo.id, 1);
  assert.equal(memo.state, 'open');
  assert.equal(memo.sender, 'main');
  assert.equal(memo.recipient, 'cam');
  assert.equal(memo.impact, 4);
  assert.equal(memo.effort, 'micro');
  assert.equal(memo.acked, 0);
  assert.deepEqual(corrections, []);
});

test('a memo to cam needs a correct impact and effort', () => {
  const s = makeStore();
  refuses(() => s.send({ ...toCam, impact: undefined }), 400, 'impact');
  refuses(() => s.send({ ...toCam, impact: 6 }), 400, 'impact');
  refuses(() => s.send({ ...toCam, impact: '4' }), 400, 'impact');
  refuses(() => s.send({ ...toCam, impact: 2.5 }), 400, 'impact');
  refuses(() => s.send({ ...toCam, effort: undefined }), 400, 'effort');
  refuses(() => s.send({ ...toCam, effort: 'deep' }), 400, 'effort');
});

test('a memo to an agent needs no impact and keeps none', () => {
  const s = makeStore();
  const { memo } = s.send({ from: 'cam', to: 'main', text: 'Update the README.', impact: 5, effort: 'day' });
  assert.equal(memo.impact, null);
  assert.equal(memo.effort, null);
});

test('the sender and the recipient must be known names', () => {
  const s = makeStore();
  refuses(() => s.send({ ...toCam, from: 'nobody' }), 400, 'from');
  refuses(() => s.send({ ...toCam, to: 'nobody' }), 400, 'to');
  refuses(() => s.send({ from: 'cam', to: 'discord', text: 'x' }), 400, 'to');
  refuses(() => s.send(), 400, 'from');
});

test('the text must be present, must be text, and has a limit', () => {
  const s = makeStore();
  refuses(() => s.send({ ...toCam, text: '' }), 400, 'text');
  refuses(() => s.send({ ...toCam, text: undefined }), 400, 'text');
  refuses(() => s.send({ ...toCam, text: 42 }), 400, 'text');
  refuses(() => s.send({ ...toCam, text: 'x'.repeat(20001) }), 400, '20000');
  assert.equal(s.send({ ...toCam, text: 'x'.repeat(20000) }).memo.text.length, 20000);
});

test('the due date must be a real date', () => {
  const s = makeStore();
  for (const due of ['tomorrow', '2026-13-45', '2026-02-30', '10/15/2026', 20261015]) {
    refuses(() => s.send({ ...toCam, due }), 400, 'due');
  }
  assert.equal(s.send({ ...toCam, due: '2026-10-15' }).memo.due, '2026-10-15');
  assert.equal(s.send({ ...toCam, due: '' }).memo.due, null);
});

test('reply sets the reply and the state, one time only', () => {
  const s = makeStore();
  s.send(toCam);
  const c = s.reply(1, 'Yes.');
  assert.equal(c.state, 'replied');
  assert.equal(c.reply, 'Yes.');
  assert.ok(c.closed);
  refuses(() => s.reply(1, 'Again.'), 409, 'replied');
  refuses(() => s.close(1), 409, 'replied');
});

test('reply needs text and a known memo', () => {
  const s = makeStore();
  s.send(toCam);
  refuses(() => s.reply(1, ''), 400, 'text');
  refuses(() => s.reply(99, 'x'), 404, '99');
  refuses(() => s.reply('abc', 'x'), 404, 'abc');
});

test('close works with and without a text', () => {
  const s = makeStore();
  s.send(toCam);
  s.send(toCam);
  assert.equal(s.close(1).reply, null);
  assert.equal(s.close(1 + 1, 'Done by hand.').reply, 'Done by hand.');
  assert.equal(s.get(1).state, 'closed');
  refuses(() => s.adjust(1, 1), 409, 'closed');
});

test('adjust changes the impact and records a correction', () => {
  const s = makeStore();
  s.send(toCam);
  assert.equal(s.adjust(1, 1).impact, 5);
  assert.equal(s.adjust(1, 1).impact, 5); // the limit is 5: no change and no new correction
  assert.equal(s.adjust(1, -1).impact, 4);
  const rows = s.corrections('main');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].old_impact, rows[0].new_impact], [5, 4]); // the newest is first
  assert.deepEqual([rows[1].old_impact, rows[1].new_impact], [4, 5]);
  assert.equal(rows[0].text, 'Approve the deploy?');
});

test('adjust refuses a wrong delta and a memo to an agent', () => {
  const s = makeStore();
  s.send(toCam);
  s.send({ from: 'cam', to: 'main', text: 'Work.' });
  refuses(() => s.adjust(1, 2), 400, 'delta');
  refuses(() => s.adjust(1, '1'), 400, 'delta');
  refuses(() => s.adjust(2, 1), 400, 'impact');
});

test('send to cam returns the last 5 corrections of that sender', () => {
  const s = makeStore();
  for (let i = 0; i < 7; i++) s.adjust(s.send({ ...toCam, impact: 3 }).memo.id, -1);
  s.adjust(s.send({ ...toCam, from: 'liaison', impact: 3 }).memo.id, 1);
  const { corrections } = s.send(toCam);
  assert.equal(corrections.length, 5);
  assert.ok(corrections.every((k) => k.new_impact === 2));
  assert.equal(corrections[0].memo_id, 7);
});

test('list gives cam the queue order and gives an agent the order of age', () => {
  const s = makeStore();
  s.send({ ...toCam, impact: 1 });
  s.send({ ...toCam, impact: 5 });
  s.send({ from: 'cam', to: 'main', text: 'First.' });
  s.send({ from: 'cam', to: 'main', text: 'Second.' });
  s.close(3);
  assert.deepEqual(s.list('cam').map((c) => c.id), [2, 1]);
  assert.deepEqual(s.list('main').map((c) => c.id), [4]);
  refuses(() => s.list('nobody'), 400, 'to');
});

test('news shows open memos and results until the sender acks them', () => {
  const s = makeStore();
  s.send(toCam);
  s.send({ from: 'cam', to: 'main', text: 'Work.' });
  assert.deepEqual(s.news('main').to_you.map((c) => c.id), [2]);
  assert.deepEqual(s.news('main').results, []);
  refuses(() => s.ack(1), 409, 'open');
  s.reply(1, 'Yes.');
  assert.deepEqual(s.news('main').results.map((c) => c.id), [1]);
  assert.equal(s.ack(1).acked, 1);
  assert.deepEqual(s.news('main').results, []);
});

test('counts gives the open memos to and from a name, with the memos themselves in a short form', () => {
  const s = makeStore();
  s.send(toCam);
  s.send(toCam);
  s.send({ from: 'cam', to: 'main', text: 'Work.' });
  s.reply(1, 'Yes.');
  const c = s.counts('main');
  // replies: her answers of the last day to the memos of the agent, for its pet (ui/pets.js recentThanks).
  assert.deepEqual(c.replies.map((r) => [r.id, r.reply, typeof r.closed]), [[1, 'Yes.', 'string']]);
  // created: the time of each memo, for the pet of the agent (ui/pets.js waitLevel).
  for (const m of [...c.memos_to, ...c.memos_from]) assert.match(m.created, /^\d{4}-\d{2}-\d{2}T/);
  const noTimes = (list) => list.map(({ created, ...m }) => m);
  assert.deepEqual({ ...c, replies: undefined, memos_to: noTimes(c.memos_to), memos_from: noTimes(c.memos_from) }, {
    open_to: 1, open_from: 1,
    memos_to: [{ id: 3, code: null, title: null, line: 'Work.' }],
    memos_from: [{ id: 2, code: null, title: null, line: 'Approve the deploy?' }],
    replies: undefined,
  });
});

test('the memos from an agent are in the order of the Inbox, with the title and the first line of each', () => {
  const s = makeStore();
  s.send({ ...toCam, impact: 1, effort: 'day', text: '\n\n  # Low  \nMore text' });
  s.send({ ...toCam, impact: 5, effort: 'micro', title: 'Driver license', text: 'Mail the form.' });
  s.send({ ...toCam, impact: 3, effort: 'short', due: '2026-10-09' });
  s.send({ from: 'cam', to: 'main', text: 'Second task' });
  s.send({ from: 'cam', to: 'main', text: 'First task' });
  s.postpone(2, '2026-12-01');
  const c = s.counts('main');
  // The due memo first, then by score; a postponed memo stays in the list with its return time.
  assert.deepEqual(c.memos_from.map((m) => [m.id, m.title, m.line, m.until]), [
    [3, null, 'Approve the deploy?', undefined], [2, 'Driver license', 'Mail the form.', '2026-12-01T14:00:00.000Z'], [1, null, '# Low', undefined],
  ]);
  // The memos to the agent: oldest first, as memo list prints them.
  assert.deepEqual(c.memos_to.map((m) => m.line), ['Second task', 'First task']);
  assert.deepEqual(c.memos_to.map((m) => Object.keys(m)), [['id', 'code', 'title', 'line', 'created'], ['id', 'code', 'title', 'line', 'created']]);
  // A long first line is cut at 160 characters.
  s.send({ ...toCam, text: 'x'.repeat(300) });
  assert.equal(s.counts('main').memos_from.find((m) => m.line.startsWith('xxx')).line.length, 160);
});

test('a draft is the unsent reply text of a memo; the newer one wins, and a reply, note or close removes it', () => {
  const s = makeStore();
  s.send(toCam);
  s.send(toCam);
  assert.deepEqual(s.drafts(), {});
  assert.deepEqual(s.draft(1, 'Yes, but', '2026-10-09T12:00:10.000Z'), { id: 1, text: 'Yes, but', updated: '2026-10-09T12:00:10.000Z' });
  // An older draft, from a device that was offline, does not replace the newer text; the answer is the stored draft.
  assert.deepEqual(s.draft(1, 'Ye', '2026-10-09T12:00:05.000Z'), { id: 1, text: 'Yes, but', updated: '2026-10-09T12:00:10.000Z' });
  // The same time: no change.
  assert.equal(s.draft(1, 'Other', '2026-10-09T12:00:10.000Z').text, 'Yes, but');
  // A newer one wins; the time is kept in ISO form.
  assert.deepEqual(s.draft(1, 'Yes, but not today', '2026-10-09T12:00:20Z'), { id: 1, text: 'Yes, but not today', updated: '2026-10-09T12:00:20.000Z' });
  s.draft(2, 'No.', '2026-10-09T12:00:30.000Z');
  assert.deepEqual(s.drafts(), { 1: { text: 'Yes, but not today', updated: '2026-10-09T12:00:20.000Z' }, 2: { text: 'No.', updated: '2026-10-09T12:00:30.000Z' } });
  // An empty text removes the draft, if it is newer; an older empty text does nothing.
  assert.equal(s.draft(2, '', '2026-10-09T12:00:25.000Z').text, 'No.');
  assert.deepEqual(s.draft(2, '', '2026-10-09T12:00:35.000Z'), { id: 2, text: '', updated: '2026-10-09T12:00:35.000Z' });
  assert.deepEqual(Object.keys(s.drafts()), ['1']);
  // A note of the owner sends the text: the draft goes. A note of the agent keeps it.
  s.draft(2, 'Later', '2026-10-09T12:00:40.000Z');
  s.note(2, 'main', 'Any news?');
  assert.equal(s.drafts()[2].text, 'Later');
  s.note(2, 'cam', 'Later');
  assert.equal(s.drafts()[2], undefined);
  // A reply or a close removes it too.
  s.reply(1, 'Yes, but not today');
  assert.deepEqual(s.drafts(), {});
  s.draft(2, 'x', '2026-10-09T12:01:00.000Z');
  s.close(2);
  assert.deepEqual(s.drafts(), {});
  refuses(() => s.draft(1, 'x', '2026-10-09T12:02:00.000Z'), 409, 'replied');
});

test('a draft needs an open memo to cam, text, and a time', () => {
  const s = makeStore();
  s.send(toCam);
  s.send({ from: 'cam', to: 'main', text: 'Work.' });
  refuses(() => s.draft(2, 'x', '2026-10-09T12:00:00.000Z'), 400, 'Only a memo to cam');
  refuses(() => s.draft(99, 'x', '2026-10-09T12:00:00.000Z'), 404, '99');
  refuses(() => s.draft(1, 5, '2026-10-09T12:00:00.000Z'), 400, 'text');
  refuses(() => s.draft(1, 'x'.repeat(20001), '2026-10-09T12:00:00.000Z'), 400, '20000');
  refuses(() => s.draft(1, 'x', 'yesterday'), 400, 'updated');
  refuses(() => s.draft(1, 'x'), 400, 'updated');
});

test('compact moves the draft of the old memo to the new memo', () => {
  const s = makeStore();
  s.send(toCam);
  s.draft(1, 'Half an answer', '2026-10-09T12:00:10.000Z');
  const { memo } = s.compact(1, 'main', { text: 'Short.' });
  assert.deepEqual(s.drafts(), { [memo.id]: { text: 'Half an answer', updated: '2026-10-09T12:00:10.000Z' } });
});

test('forward copies a trusted Discord memo to an agent as a memo from cam', () => {
  const s = makeStore();
  s.send({ from: 'discord', to: 'liaison', text: 'Discord, Cam (the owner): add a page', trusted: true });
  const { memo } = s.forward(1, 'main');
  assert.equal(memo.sender, 'cam');
  assert.equal(memo.recipient, 'main');
  assert.equal(memo.text, 'Discord, Cam (the owner): add a page');
  assert.equal(s.get(1).state, 'open'); // the liaison closes its own memo
});

test('forward refuses a memo that is not a trusted Discord memo', () => {
  const s = makeStore();
  s.send({ from: 'discord', to: 'liaison', text: 'From another person.' });
  s.send({ from: 'cam', to: 'liaison', text: 'Not from Discord.', trusted: true });
  s.send({ from: 'discord', to: 'liaison', text: 'Trusted.', trusted: true });
  refuses(() => s.forward(1, 'main'), 403, 'Discord');
  refuses(() => s.forward(2, 'main'), 403, 'Discord');
  refuses(() => s.forward(3, 'cam'), 400, 'to');
  refuses(() => s.forward(3, 'discord'), 400, 'to');
  refuses(() => s.forward(3, 'liaison'), 400, 'to'); // not a long agent
});

test('forward works one time only for each memo', () => {
  const s = makeStore();
  s.send({ from: 'discord', to: 'liaison', text: 'Discord, Cam (the owner): add a page', trusted: true });
  s.forward(1, 'main');
  refuses(() => s.forward(1, 'main'), 409, 'already');
  assert.equal(s.list('main').length, 1);
});

test('edit changes the text of an open memo and nothing more', () => {
  const s = makeStore();
  s.send({ ...toCam, due: '2026-10-15' });
  s.adjust(1, -1);
  const c = s.edit(1, '**Approve the deploy?**');
  assert.equal(c.text, '**Approve the deploy?**');
  assert.deepEqual([c.state, c.impact, c.effort, c.due, c.sender], ['open', 3, 'micro', '2026-10-15', 'main']);
});

test('edit marks the notes of the owner as read, so that the sender does not get the same note again', () => {
  const s = makeStore();
  const { id } = s.send(toCam).memo;
  s.note(id, 'cam', 'Add the price, please.');
  assert.deepEqual(s.news('main').noted.map((c) => c.id), [id]);
  const c = s.edit(id, 'Approve the deploy? The price is $14.');
  assert.equal(c.notes[0].read, 1);
  assert.deepEqual(s.news('main').noted, []);
  assert.equal(c.state, 'open');
});

test('edit refuses a closed memo, an empty text, and an unknown memo', () => {
  const s = makeStore();
  s.send(toCam);
  refuses(() => s.edit(1, ''), 400, 'text');
  refuses(() => s.edit(9, 'x'), 404, '9');
  s.reply(1, 'Yes.');
  refuses(() => s.edit(1, 'x'), 409, 'replied');
});

test('a memo to the owner is new, then seen, and an edit after that makes it updated', () => {
  const s = makeStore();
  s.send({ from: 'main', to: 'cam', text: 'Approve the deploy?', impact: 3, effort: 'micro' });
  s.send({ from: 'main', to: 'cam', text: 'A second question.', impact: 2, effort: 'micro' });
  assert.equal(s.get(1).seen, 0);
  s.edit(1, 'Approve the deploy today?');
  assert.equal(s.get(1).seen, 0, 'an edit of a memo that the owner did not see keeps it new');
  assert.deepEqual(s.seen([1]), { seen: 1 });
  assert.equal(s.get(1).seen, 1);
  assert.equal(s.get(2).seen, 0, 'only the memo in the list changes');
  assert.deepEqual(s.seen([1]), { seen: 0 }, 'a second call changes nothing');
  s.edit(1, 'Approve the deploy tomorrow?');
  assert.equal(s.get(1).seen, 2);
  s.seen([1, 2]);
  assert.deepEqual([s.get(1).seen, s.get(2).seen], [1, 1]);
});

test('seen changes only memos to the owner and refuses a bad list', () => {
  const s = makeStore();
  s.send({ from: 'cam', to: 'main', text: 'Update the README.' });
  assert.deepEqual(s.seen([1, 99]), { seen: 0 });
  assert.equal(s.get(1).seen, 0);
  refuses(() => s.seen([]), 400, 'ids');
  refuses(() => s.seen('1'), 400, 'ids');
  refuses(() => s.seen([1.5]), 400, 'ids');
});

test('check changes one check box of a memo to the owner and keeps the memo seen', () => {
  const s = makeStore();
  s.send({ from: 'main', to: 'cam', text: 'Pack:\n- [ ] Rain jacket\n- [ ] Charger', impact: 3, effort: 'short' });
  s.seen([1]);
  assert.equal(s.check(1, 1, true).text, 'Pack:\n- [ ] Rain jacket\n- [x] Charger');
  assert.equal(s.get(1).seen, 1, 'a check box is not an update of the memo');
  assert.equal(s.check(1, 1, false).text, 'Pack:\n- [ ] Rain jacket\n- [ ] Charger');
  refuses(() => s.check(1, 2, true), 404, 'check box 2');
  refuses(() => s.check(1, '0', true), 400, 'whole number');
  refuses(() => s.check(1, 0, 'yes'), 400, 'true or false');
  s.send({ from: 'cam', to: 'main', text: '- [ ] a task for the agent' });
  refuses(() => s.check(2, 0, true), 400, 'Only a memo to cam');
  s.close(1);
  refuses(() => s.check(1, 0, true), 409, '');
});

// Notes: messages in an open memo to the owner. The memo stays open.
function withMemo() {
  const s = createStore(openDb(), { names: ['cam', 'discord', 'main', 'liaison'], owner: 'cam' });
  const { memo } = s.send({ from: 'main', to: 'cam', text: 'Approve the plan?', impact: 3, effort: 'short' });
  return { s, id: memo.id };
}
const refusesNote = (fn, status, part) => assert.throws(fn, (e) => e instanceof MemoError && e.status === status && e.message.includes(part));

test('a note of the owner keeps the memo open and goes to the sender as news', () => {
  const { s, id } = withMemo();
  const m = s.note(id, 'cam', 'Add the price, please.');
  assert.equal(m.state, 'open');
  assert.deepEqual(m.notes.map((n) => [n.author, n.text, n.read]), [['cam', 'Add the price, please.', 0]]);
  assert.equal(s.list('cam')[0].notes.length, 1);
  const news = s.news('main');
  assert.deepEqual(news.noted.map((c) => c.id), [id]);
  assert.deepEqual(news.results, []);
});

test('an answer of the sender marks the note as read and shows the memo as updated', () => {
  const { s, id } = withMemo();
  s.seen([id]);
  s.note(id, 'cam', 'Add the price, please.');
  assert.equal(s.get(id).seen, 1, 'a note of the owner does not make the memo new for the owner');
  const m = s.note(id, 'main', 'The price is $14.');
  assert.deepEqual(m.notes.map((n) => [n.author, n.read]), [['cam', 1], ['main', 0]]);
  assert.equal(m.seen, 2);
  assert.deepEqual(s.news('main').noted, []);
  assert.equal(s.note(id, 'cam', 'Thanks.').notes[1].read, 1);
});

test('ack of an open memo marks the notes of the owner as read, with no answer', () => {
  const { s, id } = withMemo();
  refusesNote(() => s.ack(id), 409, 'open');
  s.note(id, 'cam', 'I read this later.');
  assert.equal(s.ack(id).notes[0].read, 1);
  assert.deepEqual(s.news('main').noted, []);
  assert.equal(s.get(id).acked, 0);
  refusesNote(() => s.ack(id), 409, 'open');
});

test('note refuses a wrong party, a closed memo, a memo to an agent, and a text that is too long', () => {
  const { s, id } = withMemo();
  refusesNote(() => s.note(id, 'liaison', 'x'), 403, 'Only cam and main');
  refusesNote(() => s.note(id, 'cam', ''), 400, 'text');
  refusesNote(() => s.note(id, 'cam', 'x'.repeat(4001)), 400, '4000');
  const toAgent = s.send({ from: 'cam', to: 'main', text: 'Do it.' }).memo;
  refusesNote(() => s.note(toAgent.id, 'cam', 'x'), 400, 'Only a memo to cam');
  s.reply(id, 'Yes.');
  refusesNote(() => s.note(id, 'cam', 'x'), 409, 'replied');
});

test('a memo with no notes has no notes field', () => {
  const { s, id } = withMemo();
  assert.equal('notes' in s.get(id), false);
});

test('a memo can have a brief: a title and a next step, each one line', () => {
  const s = makeStore();
  const { memo } = s.send({ ...toCam, title: '  Deploy of PR 12 ', next: 'Reply deploy' });
  assert.equal(memo.title, 'Deploy of PR 12');
  assert.equal(memo.next, 'Reply deploy');
  const plain = s.send(toCam).memo;
  assert.equal(plain.title, null);
  assert.equal(plain.next, null);
  refuses(() => s.send({ ...toCam, title: 'two\nlines' }), 400, 'one line');
  refuses(() => s.send({ ...toCam, title: 'x'.repeat(61) }), 400, '60 characters');
  refuses(() => s.send({ ...toCam, next: 'x'.repeat(101) }), 400, '100 characters');
  refuses(() => s.send({ ...toCam, next: 5 }), 400, 'must be text');
});

test('memo brief changes one part, keeps the other, and does not mark the memo updated', () => {
  const s = makeStore();
  const { memo } = s.send({ ...toCam, title: 'Deploy', next: 'Reply deploy' });
  s.seen([memo.id]);
  let m = s.brief(memo.id, { next: 'Reply wait' });
  assert.equal(m.title, 'Deploy');
  assert.equal(m.next, 'Reply wait');
  assert.equal(m.seen, 1);
  m = s.brief(memo.id, { title: '' });
  assert.equal(m.title, null);
  assert.equal(m.next, 'Reply wait');
  refuses(() => s.brief(memo.id, {}), 400, 'title, next');
  s.close(memo.id);
  refuses(() => s.brief(memo.id, { title: 'Late' }), 409, 'closed');
});

test('compact closes an open memo to cam and sends a short new memo with the same impact, effort, due date, tags, and brief', () => {
  const s = makeStore();
  const { memo: old } = s.send({ ...toCam, impact: 3, effort: 'hour', due: '2026-11-01', tags: ['work', 'money'], title: 'Deploy', next: 'Reply yes' });
  s.seen([old.id]);
  s.note(old.id, 'cam', 'Compact this memo, please.');
  const { memo, old: closed } = s.compact(old.id, 'main', { text: '- [x] Tests\n- [ ] Approve the deploy' });
  assert.equal(memo.id, 2);
  assert.equal(memo.sender, 'main');
  assert.equal(memo.recipient, 'cam');
  assert.equal(memo.state, 'open');
  assert.equal(memo.text, '- [x] Tests\n- [ ] Approve the deploy');
  assert.equal(memo.impact, 3);
  assert.equal(memo.effort, 'hour');
  assert.equal(memo.due, '2026-11-01');
  assert.deepEqual(memo.tags, ['money', 'work']);
  assert.equal(memo.title, 'Deploy');
  assert.equal(memo.next, 'Reply yes');
  assert.equal(memo.seen, 0, 'the new memo shows as new');
  assert.equal(closed.state, 'closed');
  assert.equal(closed.reply, 'Compacted into memo #2.');
  assert.equal(closed.acked, 1);
  assert.equal(closed.notes[0].read, 1);
  // The sender gets no result and no note for the old memo, and the Inbox has only the new memo.
  const news = s.news('main');
  assert.deepEqual(news.results, []);
  assert.deepEqual(news.noted, []);
  assert.deepEqual(s.list('cam').map((c) => c.id), [2]);
});

test('compact takes a new title and next step, and an empty part removes it', () => {
  const s = makeStore();
  s.send({ ...toCam, title: 'Deploy', next: 'Reply yes' });
  const { memo } = s.compact(1, 'main', { text: 'Short.', title: 'Deploy v2', next: '' });
  assert.equal(memo.title, 'Deploy v2');
  assert.equal(memo.next, null);
});

test('compact refuses a closed memo, a memo not to cam, a wrong sender, and no text', () => {
  const s = makeStore();
  s.send(toCam);
  refuses(() => s.compact(1, 'liaison', { text: 'x' }), 403, 'main');
  refuses(() => s.compact(1, 'cam', { text: 'x' }), 403, 'main');
  refuses(() => s.compact(1, 'main', {}), 400, 'text');
  refuses(() => s.compact(99, 'main', { text: 'x' }), 404, '99');
  s.close(1);
  refuses(() => s.compact(1, 'main', { text: 'x' }), 409, 'closed');
  s.send({ from: 'cam', to: 'main', text: 'Update the README.' });
  refuses(() => s.compact(2, 'cam', { text: 'x' }), 400, 'Only a memo to cam');
  // A refused compact sends nothing.
  assert.deepEqual(s.list('cam'), []);
});

test('search finds memos by each word in text, reply, title or notes, newest first', () => {
  const s = makeStore();
  const a = s.send({ ...toCam, text: 'Approve the venue in Boston?', title: 'Venue' }).memo;
  s.reply(a.id, 'Yes, the harbor one');
  const b = s.send({ ...toCam, text: 'Draft for Robin' }).memo;
  s.note(b.id, 'cam', 'Mention the Boston venue too.');
  s.send({ ...toCam, text: 'Unrelated' });
  assert.deepEqual(s.search('boston VENUE').map((m) => m.id), [b.id, a.id]);
  assert.deepEqual(s.search('harbor').map((m) => m.id), [a.id]);
  assert.deepEqual(s.search('boston', { limit: 1 }).map((m) => m.id), [b.id]);
  // A limit from a query string: text, and not always whole.
  assert.deepEqual(s.search('boston', { limit: '1.5' }).map((m) => m.id), [b.id]);
  assert.equal(s.search('boston', { limit: 'many' }).length, 2);
  // The special characters of LIKE mean nothing here.
  assert.deepEqual(s.search('%_'), []);
  assert.deepEqual(s.search('nothing-like-this'), []);
  refuses(() => s.search('   '), 400, 'words');
});

test('the memos a text names: "memo N", "memos N and M", "memo #N", "#NN"; not an amount, a year or a rank', () => {
  assert.deepEqual(referencedIds('This answers your memo 355. See memos 349, 350 and 351; also memo #12 and #40.'), [355, 349, 350, 351, 12, 40]);
  assert.deepEqual(referencedIds('Memo 349 from cam, forwarded by second. Review in memo 368, replaces memo 371.'), [349, 368, 371]);
  assert.deepEqual(referencedIds('Not $355, not 2026, not #1, not memo_id 7, not a#22, not 355 alone. Memos 12 or #13.'), [12, 13]);
  assert.deepEqual(referencedIds('Compacted into memo #14.'), [14]);
  assert.deepEqual(referencedIds(''), []);
  assert.deepEqual(referencedIds(null), []);
});

test('a memo names its origins with re: memos that exist, ten at most, as a list or as "a,b"', () => {
  const s = makeStore();
  const a = s.send({ ...toCam, text: 'Venue?' }).memo;
  const b = s.send({ from: 'cam', to: 'main', text: 'Book it' }).memo;
  assert.deepEqual(a.re, []);
  assert.deepEqual(s.send({ ...toCam, text: 'Booked', re: [b.id, a.id, b.id] }).memo.re, [b.id, a.id]);
  assert.deepEqual(s.send({ ...toCam, text: 'Booked', re: `${a.id}, ${b.id}` }).memo.re, [a.id, b.id]);
  assert.deepEqual(s.send({ ...toCam, text: 'Booked', re: '' }).memo.re, []);
  refuses(() => s.send({ ...toCam, text: 'Booked', re: [99] }), 400, 'memo 99');
  refuses(() => s.send({ ...toCam, text: 'Booked', re: 'x' }), 400, 'memo x');
  refuses(() => s.send({ ...toCam, text: 'Booked', re: { id: 1 } }), 400, 'list');
  const many = Array.from({ length: 11 }, () => s.send({ ...toCam, text: 'One of many' }).memo.id);
  assert.equal(s.send({ ...toCam, text: 'Booked', re: many.slice(0, 10) }).memo.re.length, 10);
  refuses(() => s.send({ ...toCam, text: 'Booked', re: many }), 400, 'at most');
});

test('the thread of a memo: its origins and theirs, the memo, and the memos that name it, in the order of the ids', () => {
  const s = makeStore();
  const a = s.send({ ...toCam, text: 'Pick a venue' }).memo;                              // 1
  const b = s.send({ from: 'cam', to: 'main', text: 'Book the harbor one' }).memo;        // 2
  s.reply(a.id, 'The harbor one. I sent memo 2 to main.');                                 // 1 names 2 in its reply
  const c = s.send({ ...toCam, text: 'Booked. This answers your memo 2.', re: [a.id] }).memo; // 3: two origins, 1 (re) and 2 (text)
  const d = s.send({ ...toCam, text: 'Invoice for $350 from 2026, the #1 venue' }).memo; // 4: no links
  const e = s.send({ ...toCam, text: 'Follow-up to memo 3', title: 'Follow-up' }).memo;  // 5: names 3
  assert.deepEqual(s.thread(c.id).memos.map((m) => m.id), [1, 2, 3, 5]);
  assert.deepEqual(s.thread(a.id).memos.map((m) => m.id), [1, 2, 3, 5]);
  assert.deepEqual(s.thread(e.id).memos.map((m) => m.id), [1, 2, 3, 5]);
  assert.deepEqual(s.thread(d.id).memos.map((m) => m.id), [4]);
  // Each memo of the thread in the form of the Answered view.
  const t = s.thread(c.id).memos;
  assert.deepEqual(Object.keys(t[0]).sort(), ['closed', 'code', 'created', 'effort', 'id', 'impact', 'next', 're', 'recipient', 'reply', 'sender', 'state', 'text', 'title']);
  assert.equal(t[0].reply, 'The harbor one. I sent memo 2 to main.');
  assert.equal(t[0].state, 'replied');
  assert.equal(t[1].state, 'open');
  assert.deepEqual(t[2].re, [a.id]);
  assert.equal(t[3].title, 'Follow-up');
  // A note names a memo: a link too, with the note in the thread. An edit that drops the name drops the link.
  s.note(d.id, 'cam', 'This goes with memo 1.');
  assert.deepEqual(s.thread(d.id).memos.map((m) => m.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(s.thread(c.id).memos.find((m) => m.id === d.id).notes.map((n) => n.text), ['This goes with memo 1.']);
  s.edit(e.id, 'Nothing to do with the rest');
  assert.deepEqual(s.thread(e.id).memos.map((m) => m.id), [5]);
  // A close with a text that names a memo links it; a compact links the old memo to the new one.
  s.close(e.id, 'See memo 4.');
  assert.deepEqual(s.thread(e.id).memos.map((m) => m.id), [1, 2, 3, 4, 5]);
  const { memo: f } = s.compact(d.id, 'main', { text: 'Short.' });
  assert.deepEqual(s.thread(f.id).memos.map((m) => m.id).includes(d.id), true);
  // A name of a memo that does not exist is no link.
  const g = s.send({ ...toCam, text: 'See memo 999.' }).memo;
  assert.deepEqual(s.thread(g.id).memos.map((m) => m.id), [g.id]);
  refuses(() => s.thread(999), 404, '999');
});

test('a thread stops at 12 memos and 3 links away', () => {
  const s = makeStore();
  const first = s.send({ ...toCam, text: 'Start' }).memo;
  let last = first;
  for (let i = 0; i < 20; i += 1) last = s.send({ ...toCam, text: `After memo ${last.id}` }).memo;
  assert.deepEqual(s.thread(first.id).memos.map((m) => m.id), [1, 2, 3, 4], 'three links away');
  const hub = s.send({ ...toCam, text: 'Hub' }).memo;
  for (let i = 0; i < 15; i += 1) s.send({ ...toCam, text: `Spoke of memo ${hub.id}` });
  assert.equal(s.thread(hub.id).memos.length, 12);
});

test('threads gives the threads of the open memos to the owner that have one, and the links of old memos are made at the start', () => {
  const db = openDb();
  const make = () => createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main'] });
  let s = make();
  const a = s.send({ from: 'cam', to: 'main', text: 'Do it' }).memo;
  const b = s.send({ ...toCam, text: 'Done, see memo 1' }).memo;
  s.send({ ...toCam, text: 'Alone' });
  const c = s.send({ ...toCam, text: 'Also from memo 1' }).memo;
  s.postpone(c.id, '2099-01-01');
  assert.deepEqual(Object.keys(s.threads()), [String(b.id), String(c.id)]);
  assert.deepEqual(s.threads()[b.id].memos.map((m) => m.id), [a.id, b.id, c.id]);
  // A database from before the threads: no links. A new store makes them.
  db.prepare('DELETE FROM links').run();
  s = make();
  assert.deepEqual(s.thread(a.id).memos.map((m) => m.id), [a.id, b.id, c.id]);
});

test('archive gives all memos in a short form with their notes', () => {
  const s = makeStore();
  const a = s.send({ ...toCam, text: 'One' }).memo;
  s.note(a.id, 'cam', 'A note');
  s.send({ from: 'cam', to: 'main', text: 'Two' });
  const all = s.archive();
  assert.deepEqual(all.map((m) => m.text), ['One', 'Two']);
  assert.deepEqual(all[0].notes.map((n) => n.text), ['A note']);
  assert.equal(all[1].notes, undefined);
  assert.equal(all[0].impact, undefined);
});

// Workstream codes: a memo can be OPS-14 (memo send --ws OPS). The number starts at 1 for each code.
const WS = { OPS: 'Operations', REL: 'Relationships', GEN: 'Anything else' };
function makeWsStore() {
  let t = Date.parse('2026-11-04T12:00:00Z');
  return createStore(openDb(), { owner: 'cam', names: NAMES, forwardTo: ['main'], now: () => new Date((t += 1000)), workstreams: WS });
}

test('send --ws gives the memo the next number in its code, in any case; an unknown code is refused', () => {
  const s = makeWsStore();
  const a = s.send({ ...toCam, ws: 'OPS' }).memo;
  assert.equal(a.ws, 'OPS');
  assert.equal(a.ws_n, 1);
  assert.equal(a.code, 'OPS-1');
  assert.equal(s.send({ ...toCam, ws: 'ops' }).memo.code, 'OPS-2');
  assert.equal(s.send({ ...toCam, ws: 'REL' }).memo.code, 'REL-1');
  assert.equal(s.send({ ...toCam, ws: ' rel ' }).memo.code, 'REL-2');
  const none = s.send({ ...toCam }).memo;
  assert.equal(none.ws, null);
  assert.equal(none.ws_n, null);
  assert.equal(none.code, null);
  assert.equal(s.send({ ...toCam, ws: '' }).memo.code, null);
  refuses(() => s.send({ ...toCam, ws: 'FUND' }), 400, 'ws must be one of: OPS, REL, GEN');
  refuses(() => s.send({ ...toCam, ws: 'OPS-3' }), 400, 'ws must be one of');
  refuses(() => s.send({ ...toCam, ws: 7 }), 400, 'ws must be one of');
  // With no workstreams set up, a code is refused with a message that says so.
  refuses(() => makeStore().send({ ...toCam, ws: 'OPS' }), 400, 'No workstreams are set up');
});

test('a memo with re takes the code of the first origin that has one, unless ws is given', () => {
  const s = makeWsStore();
  const plain = s.send({ from: 'cam', to: 'main', text: 'No code.' }).memo;
  const ops = s.send({ from: 'cam', to: 'main', text: 'In OPS.', ws: 'OPS' }).memo;
  assert.equal(s.send({ ...toCam, re: [plain.id, ops.id] }).memo.code, 'OPS-2');
  assert.equal(s.send({ ...toCam, re: [ops.id], ws: 'REL' }).memo.code, 'REL-1');
  assert.equal(s.send({ ...toCam, re: [plain.id] }).memo.code, null);
  // re takes a code in the place of an id, in any case.
  const r = s.send({ ...toCam, re: 'ops-1' }).memo;
  assert.deepEqual(r.re, [ops.id]);
  assert.equal(r.code, 'OPS-3');
  assert.deepEqual(s.send({ ...toCam, re: ['OPS-1', ops.id, 'REL-1'] }).memo.re, [ops.id, 4]);
  refuses(() => s.send({ ...toCam, re: 'OPS-99' }), 400, 're names memo OPS-99, which does not exist');
});

test('get and each change take a code in the place of an id', () => {
  const s = makeWsStore();
  s.send({ ...toCam, ws: 'OPS', title: 'Insurance' });
  s.send({ ...toCam, ws: 'OPS' });
  assert.equal(s.get('OPS-1').id, 1);
  assert.equal(s.get('ops-2').id, 2);
  assert.equal(s.get(' OPS-1 ').title, 'Insurance');
  assert.equal(s.get('2').id, 2);
  refuses(() => s.get('OPS-3'), 404, 'No memo has the code OPS-3');
  refuses(() => s.get('REL-1'), 404, 'REL-1');
  refuses(() => s.get('XX'), 404, 'No memo has the id XX');
  assert.equal(s.brief('OPS-1', { next: 'Sign' }).next, 'Sign');
  assert.equal(s.note('OPS-1', 'cam', 'A note.').notes.length, 1);
  assert.equal(s.tag('OPS-1', 'money', true).tags[0], 'money');
  assert.equal(s.postpone('OPS-1', null).until, null);
  assert.equal(s.reply('OPS-1', 'Yes.').state, 'replied');
  assert.equal(s.ack('OPS-1').acked, 1);
  assert.equal(s.close('ops-2', 'Done.').state, 'closed');
  assert.equal(s.thread('OPS-1').id, 1);
});

test('compact keeps the code of the old memo, with the next number', () => {
  const s = makeWsStore();
  s.send({ ...toCam, ws: 'OPS' });
  const { memo, old } = s.compact('OPS-1', 'main', { text: 'Short.' });
  assert.equal(memo.code, 'OPS-2');
  assert.equal(old.code, 'OPS-1');
  assert.equal(old.state, 'closed');
  assert.equal(s.compact(s.send(toCam).memo.id, 'main', { text: 'Short too.' }).memo.code, null);
});

// A retired code (2026-11-08: GEN left workstreams.json for the nine codes of the time tracker projects). The old memos
// keep it and work by it in every way; only a new memo cannot take it.
test('an old memo with a code that left workstreams.json still shows, links and answers to its code', () => {
  const db = openDb();
  let t = Date.parse('2026-11-04T12:00:00Z');
  const now = () => new Date((t += 1000));
  const before = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main'], now, workstreams: { OPS: 'Operations', GEN: 'Anything else' } });
  const old = before.send({ ...toCam, ws: 'GEN', title: 'Old general', text: 'From before the change.' }).memo;
  assert.equal(old.code, 'GEN-1');
  before.send({ ...toCam, ws: 'OPS', text: 'An OPS memo that names GEN-1.' });
  // The same database, with GEN gone from the file.
  const s = createStore(db, { owner: 'cam', names: NAMES, forwardTo: ['main'], now, workstreams: { OPS: 'Operations', SPEC: 'Special projects' } });
  // Read, listed, counted, searched and archived by its code.
  assert.equal(s.get('GEN-1').id, old.id);
  assert.equal(s.get('gen-1').title, 'Old general');
  assert.equal(s.get(old.id).code, 'GEN-1');
  assert.deepEqual(s.list('cam').map((m) => m.code), ['GEN-1', 'OPS-1']);
  assert.deepEqual(s.counts('cam').memos_to.map((m) => m.code), ['GEN-1', 'OPS-1']);
  assert.equal(s.search('GEN-1')[0].id, old.id);
  assert.equal(s.search('before')[0].code, 'GEN-1');
  assert.equal(s.archive()[0].code, 'GEN-1');
  // The thread: the OPS memo that names GEN-1 is linked to it, and the ledger's threads (state/inbox.json) carry the code.
  assert.deepEqual(s.thread('OPS-1').memos.map((m) => m.code), ['GEN-1', 'OPS-1']);
  assert.deepEqual(s.threads()[old.id].memos.map((m) => m.code), ['GEN-1', 'OPS-1']);
  // A reply with re stays in GEN, and each change takes the code.
  assert.equal(s.send({ ...toCam, re: 'GEN-1' }).memo.code, 'GEN-2');
  assert.equal(s.brief('GEN-1', { next: 'Decide' }).next, 'Decide');
  s.note('GEN-1', 'cam', 'A note on an old memo.');
  assert.equal(s.compact('GEN-2', 'main', { text: 'Short.' }).memo.code, 'GEN-3');
  assert.equal(s.close('GEN-1').code, 'GEN-1');
  assert.equal(s.get('GEN-1').state, 'closed');
  // Only a new code is refused; the list names the current codes.
  refuses(() => s.send({ ...toCam, ws: 'GEN' }), 400, 'ws must be one of: OPS, SPEC');
});

test('the codes a text names: OPS-14, in capital letters only', () => {
  assert.deepEqual(referencedCodes('See OPS-14 and REL-2; also OPS-14 again and ops-15, covid-19, ISO-8601, x-OPS-1, A-1, #FUND-007.'),
    [{ ws: 'OPS', n: 14 }, { ws: 'REL', n: 2 }, { ws: 'ISO', n: 8601 }, { ws: 'FUND', n: 7 }]);
  assert.deepEqual(referencedCodes(''), []);
  assert.deepEqual(referencedCodes(null), []);
});

test('a code in the text, the reply or a note links the memos for the thread, as "memo N" does', () => {
  const s = makeWsStore();
  const a = s.send({ ...toCam, ws: 'OPS', text: 'The first.' }).memo;
  const b = s.send({ ...toCam, text: 'This continues OPS-1. ISO-8601 is no memo.' }).memo;
  assert.deepEqual(s.thread(a.id).memos.map((m) => m.id), [a.id, b.id]);
  assert.deepEqual(s.thread(b.id).memos.map((m) => m.code), ['OPS-1', null]);
  const c = s.send({ ...toCam, text: 'Nothing here.' }).memo;
  assert.deepEqual(s.thread(c.id).memos.map((m) => m.id), [c.id]);
  s.note(c.id, 'cam', 'This goes with ops-1? No: only OPS-1 counts.');
  assert.deepEqual(s.thread(c.id).memos.map((m) => m.id), [a.id, b.id, c.id]);
  // The code of a memo that comes later: the link is made when the memo of the other text changes.
  const d = s.send({ ...toCam, text: 'Waits for REL-1.' }).memo;
  assert.deepEqual(s.thread(d.id).memos.map((m) => m.id), [d.id]);
  const e = s.send({ ...toCam, ws: 'REL', text: 'Here, see memo 4.' }).memo;
  assert.deepEqual(s.thread(e.id).memos.map((m) => m.id), [d.id, e.id]);
});

test('search finds a memo by its code, first, and the memos that name it', () => {
  const s = makeWsStore();
  const a = s.send({ ...toCam, ws: 'OPS', text: 'The venue.' }).memo;
  const b = s.send({ ...toCam, text: 'About OPS-1: the venue is booked.' }).memo;
  s.send({ ...toCam, ws: 'OPS', text: 'OPS-10 is not OPS-1.' });
  const c = s.send({ ...toCam, ws: 'OPS', text: 'Nothing.' }).memo;
  assert.deepEqual(s.search('OPS-1').map((m) => m.id), [a.id, 3, b.id]);
  assert.deepEqual(s.search('ops-1 venue').map((m) => m.id), [a.id, b.id]);
  assert.deepEqual(s.search('OPS-3').map((m) => m.id), [c.id]);
  assert.deepEqual(s.search('OPS-10').map((m) => m.id), [3]);
  assert.deepEqual(s.search('OPS-99'), []);
});

test('the short forms carry the code: counts, archive, and the thread', () => {
  const s = makeWsStore();
  s.send({ ...toCam, ws: 'OPS', title: 'Insurance' });
  s.send({ from: 'cam', to: 'main', text: 'Plain.' });
  assert.deepEqual(s.counts('main').memos_from.map((m) => m.code), ['OPS-1']);
  assert.deepEqual(s.counts('main').memos_to.map((m) => m.code), [null]);
  assert.deepEqual(s.archive().map((m) => [m.id, m.code]), [[1, 'OPS-1'], [2, null]]);
  assert.ok(!('ws' in s.archive()[0]));
  assert.equal(s.thread(1).memos[0].code, 'OPS-1');
});
