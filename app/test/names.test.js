import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, ROOT } from './helpers.js';
import { DISPLAY_NAMES, displayName, pickAgent, pickWords, waitingLists } from '../ui/agentstate.js';
import { PETS } from '../ui/pets.js';

// The names the pages show for the agents (memo 1408): one map in ui/agentstate.js. The ids do not change.
test('displayName gives the name a page shows for an agent, from one map; any other name shows as it is', () => {
  assert.deepEqual(DISPLAY_NAMES, { main: 'Peeve', second: 'Darkness', gpt: 'Landon' });
  assert.deepEqual(['main', 'second', 'gpt'].map(displayName), ['Peeve', 'Darkness', 'Landon']);
  // The names are those of the pets of the agents.
  for (const [id, name] of Object.entries(DISPLAY_NAMES)) assert.equal(PETS[id].pet, name);
  assert.deepEqual(['liaison', 'discord', 'cam', 'Main', 'constructor', 'toString', '', null, undefined].map(displayName), ['liaison', 'discord', 'cam', 'Main', 'constructor', 'toString', '', '', '']);
});

test('the pick of the capture form keeps the id of the agent and shows its name', () => {
  const now = new Date('2026-11-08T18:00:00Z');
  const usage = { at: '2026-11-08T17:57:00Z', session: { percent: 10, resets_at: '2026-11-08T22:00:00Z' }, week: { percent: 20, resets_at: '2026-11-12T18:00:00Z' }, models: [] };
  const agents = [{ name: 'main', kind: 'long', running: true, activity: 'blocked', blocked: { reason: 'permission' }, usage }, { name: 'second', kind: 'long', running: true, activity: 'idle', usage }];
  const picked = pickAgent(agents, { now });
  assert.equal(picked.name, 'second', 'the id goes to the server');
  assert.equal(picked.why, 'Peeve is blocked');
  assert.equal(pickWords(agents, { now }), 'Auto: Darkness · Peeve is blocked');
  assert.equal(waitingLists(agents[1], 'cam')[0].label, 'Memos waiting on Darkness');
  assert.equal(waitingLists(agents[1], 'cam')[1].label, 'Memos waiting on cam');
});

test('the pages show the names and keep the ids in what goes to the server, the sessions and the files', async () => {
  const inbox = readFileSync(join(ROOT, 'ui', 'inbox.html'), 'utf8');
  const agents = readFileSync(join(ROOT, 'ui', 'agents.html'), 'utf8');
  for (const page of [inbox, agents]) assert.match(page, /^import \{ displayName \} from '\/ui\/agentstate\.js';$/m);
  // The agent select: the option says the name, its value is the id.
  assert.match(inbox, /el\('option', \{ value: a\.name, selected: a\.name === pick \}, displayName\(a\.name\)\)/);
  // The card of the agent says the name, with the id on hover.
  assert.match(inbox, /el\('b', \{ title: `Agent \$\{a\.name\}` \}, displayName\(a\.name\)\)/);
  assert.match(agents, /el\('span', \{ className: 'sender', title: `Agent \$\{agent\.name\}` \}, displayName\(agent\.name\)\)/);
  // The sender, the recipient and the author of a note in a memo.
  assert.match(inbox, /el\('span', \{ className: 'sender' \}, displayName\(memo\.sender\)\)/);
  assert.match(inbox, /el\('b', \{\}, displayName\(n\.author\)\)/);
  // The ids stay where they are ids: the requests, and the tmux command of a blocked agent.
  assert.match(agents, /run\('\/api\/agent\/start', \{ name: agent\.name \}\)/);
  assert.match(readFileSync(join(ROOT, 'ui', 'blocked.js'), 'utf8'), /tmux attach -t memo-\$\{agent\.name\}/);
  // No page and no other file of ui/ writes a name of the map itself: they all go through displayName.
  for (const name of ['inbox.html', 'agents.html', 'system.html', 'sendstage.js', 'usage.js', 'blocked.js', 'specialists.js']) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'ui', name), 'utf8'), /['"`>](Peeve|Darkness|Landon)\b/, `ui/${name} has no name of its own`);
  }
  // The API still gives the ids.
  const { app } = makeApp();
  const r = await app.request('/api/agents', { headers: { Authorization: 'Bearer full-token-0123456789' } });
  assert.deepEqual((await r.json()).map((a) => a.name), ['main', 'liaison']);
});
