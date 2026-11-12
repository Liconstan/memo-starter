import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PETS, petOf, FEELINGS, FEELING_WORDS, TIRED_AT, OVERLOADED_MEMOS, OVERLOADED_HELPERS, HAPPY_MS, THANKS, mostUsed, atSpendLimit, recentThanks, feelingOf, sizeOf, upsetOf, rowLabel, rowFeeling, SIZE_WORDS, UPSET_WORDS, artUrl, artPicture,
  excitedOf, EXCITED_IMPACT, EXCITED_EFFORTS, cuddleMoment, CUDDLE_EVERY_MS, CUDDLE_ONE_IN, waitLevel, WAIT_LEVEL_MS } from '../ui/pets.js';
import { createPetArt, PET_ROUTE, TYPES, ANIMATED, isAnimated } from '../src/pets.js';
import { mannerOf, rowMarks, pictureMarks, pictureSources, REDUCED_MOTION } from '../ui/petview.js';
import { makeApp, call, ROOT } from './helpers.js';

const now = new Date('2026-11-10T08:00:00Z');
const ago = (ms) => new Date(now.getTime() - ms).toISOString();
const ahead = (ms) => new Date(now.getTime() + ms).toISOString();
const HOUR = 3600000;
// A long agent whose session is up and that waits in `memo wait`, with nothing open and fresh, low figures.
const idle = { name: 'main', kind: 'long', running: true, activity: 'idle', open_to: 0, open_from: 0, helpers: [], replies: [],
  usage: { at: ago(60000), session: { percent: 12, resets_at: ahead(HOUR) }, week: { percent: 40, resets_at: ahead(48 * HOUR) }, models: [] } };
const feel = (agent) => feelingOf(agent, { now });

test('the pets after the quiz (memo 1252): Peeve the grey cat for main, Darkness the black cat for second, Landon the papillon for gpt, a sprout for the others', () => {
  assert.deepEqual(Object.keys(PETS), ['main', 'second', 'gpt']);
  assert.deepEqual([petOf('main').pet, petOf('main').species, petOf('main').coat], ['Peeve', 'cat', 'grey']);
  assert.deepEqual([petOf('second').pet, petOf('second').species, petOf('second').coat], ['Darkness', 'cat', 'black']);
  assert.deepEqual([petOf('gpt').pet, petOf('gpt').species, petOf('gpt').coat], ['Landon', 'dog', undefined]);
  assert.deepEqual(petOf('liaison'), { pet: 'Liaison', species: 'sprout' });
  assert.deepEqual(petOf('cloud'), { pet: 'Cloud', species: 'sprout' });
  // The drawing module keys each pet's manner by its name, so the pairing can change without the manners.
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  for (const name of ['Landon', 'Peeve', 'Darkness']) assert.match(view, new RegExp(`pet\\.pet === '${name}'`));
});

test('excited (SYS-72): an impact of 4 or 5 with the effort micro or short, a quick big win', () => {
  assert.equal(EXCITED_IMPACT, 4);
  assert.deepEqual(EXCITED_EFFORTS, ['micro', 'short']);
  assert.equal(excitedOf(4, 'micro'), true);
  assert.equal(excitedOf(5, 'short'), true);
  assert.equal(excitedOf(5, 'SHORT'), true);
  assert.equal(excitedOf(3, 'micro'), false, 'impact 3 is not a big win');
  assert.equal(excitedOf(5, 'hour'), false, 'an hour is not quick');
  assert.equal(excitedOf(4, 'day'), false);
  assert.equal(excitedOf(null, 'micro'), false);
  assert.equal(excitedOf(4, null), false);
  assert.equal(rowLabel('gpt', 4, 'micro'), 'Landon, big and calm, excited: impact 4, effort micro');
  assert.equal(rowLabel('main', 5, 'short'), 'Peeve, huge and a bit bothered, excited: impact 5, effort short');
  assert.equal(rowLabel('second', 5, 'hour'), 'Darkness, huge and bothered: impact 5, effort hour', 'not excited: no word');
  // The row classes: twirl for Landon, hop for the others.
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  assert.match(view, /\.\.\.\(excited \? \['excited', pet\.pet === 'Landon' \? 'twirl' : 'hop'\] : \[\]\)/);
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  assert.match(css, /\.pet\.row\.twirl \.pet-art \{[^\n]*animation: pet-twirl/);
  assert.match(css, /\.pet\.row\.hop \.pet-art \{[^\n]*animation: pet-bounce/);
});

test("Peeve's cuddly moment: one window of 5 minutes in 4, by the clock, the same on every device", () => {
  assert.equal(CUDDLE_EVERY_MS, 5 * 60000);
  assert.equal(CUDDLE_ONE_IN, 4);
  const t0 = new Date('2026-11-10T00:00:00Z'); // a multiple of 20 minutes since the epoch
  assert.equal(cuddleMoment(t0), true);
  assert.equal(cuddleMoment(new Date(t0.getTime() + 4 * 60000)), true, 'the whole window of 5 minutes');
  assert.equal(cuddleMoment(new Date(t0.getTime() + 5 * 60000)), false);
  assert.equal(cuddleMoment(new Date(t0.getTime() + 15 * 60000)), false);
  assert.equal(cuddleMoment(new Date(t0.getTime() + 20 * 60000)), true);
  const hits = Array.from({ length: 48 }, (_, i) => cuddleMoment(new Date(t0.getTime() + i * 5 * 60000))).filter(Boolean).length;
  assert.equal(hits, 12, 'a quarter of the windows of four hours');
  assert.equal(cuddleMoment(t0, { every: 1000, oneIn: 2 }), true);
  assert.equal(cuddleMoment(new Date(t0.getTime() + 1000), { every: 1000, oneIn: 2 }), false);
});

test("Darkness's wait: the level 1 to 4 from the age of its oldest open memo to the owner", () => {
  assert.deepEqual(WAIT_LEVEL_MS, [HOUR, 6 * HOUR, 24 * HOUR]);
  const agent = (ages) => ({ memos_from: ages.map((a, i) => ({ id: i + 1, title: null, line: 'x', created: ago(a) })) });
  assert.equal(waitLevel(agent([]), now), 1, 'no memo');
  assert.equal(waitLevel({ memos_from: [{ id: 1, title: null, line: 'x' }] }, now), 1, 'an older server gives no times');
  assert.equal(waitLevel(agent([10 * 60000]), now), 1);
  assert.equal(waitLevel(agent([HOUR]), now), 2);
  assert.equal(waitLevel(agent([10 * 60000, 7 * HOUR]), now), 3, 'the oldest counts');
  assert.equal(waitLevel(agent([30 * HOUR]), now), 4);
  assert.equal(waitLevel(agent([-HOUR]), now), 1, 'a time in the future does not count');
  assert.equal(waitLevel(null, now), 1);
});

test('the feelings in their order of priority, each with a word', () => {
  assert.deepEqual(FEELINGS, ['upset', 'tired', 'overloaded', 'waiting', 'working', 'happy', 'sleeping']);
  for (const f of FEELINGS) assert.ok(FEELING_WORDS[f], `${f} has a word`);
  assert.equal(TIRED_AT, 80);
  assert.equal(OVERLOADED_MEMOS, 5);
  assert.equal(OVERLOADED_HELPERS, 3);
  assert.equal(HAPPY_MS, 4 * HOUR);
});

test('sleeping: idle with nothing open; napping when the session is away; GPT with no recent contact naps', () => {
  assert.deepEqual(feel(idle), { key: 'sleeping', label: 'Sleeping', reason: 'idle, nothing open to it', title: 'Sleeping: idle, nothing open to it' });
  assert.deepEqual(feel({ ...idle, running: false, activity: 'stopped' }), { key: 'sleeping', label: 'Napping', reason: 'its session is stopped', title: 'Napping: its session is stopped' });
  const gpt = { name: 'gpt', kind: 'remote', runtime: 'codex-desktop', online: false, activity: 'offline', open_to: 0, open_from: 0, helpers: [] };
  assert.deepEqual(feel(gpt), { key: 'sleeping', label: 'Napping', reason: 'no recent contact, a memo wakes it', title: 'Napping: no recent contact, a memo wakes it' });
  assert.equal(feel({ name: 'mac', kind: 'remote', online: false, activity: 'offline' }).reason, 'offline');
  // Idle with memos to it that it did not start: dozing, not asleep.
  assert.deepEqual(feel({ ...idle, open_to: 2 }), { key: 'sleeping', label: 'Dozing', reason: 'idle, 2 memos to it not started', title: 'Dozing: idle, 2 memos to it not started' });
  assert.equal(feel({ ...idle, open_to: 1 }).reason, 'idle, 1 memo to it not started');
  // A short agent naps between runs, and works for a few minutes after one.
  assert.deepEqual(feel({ name: 'liaison', kind: 'short', updated: ago(HOUR) }), { key: 'sleeping', label: 'Napping', reason: 'between runs', title: 'Napping: between runs' });
  assert.deepEqual(feel({ name: 'liaison', kind: 'short', updated: ago(60000) }).key, 'working');
  assert.equal(feel({ name: 'x', kind: 'long' }).key, 'sleeping', 'a long agent with no session naps');
});

test('working: in a turn, with the status line as the reason; stopping wraps up', () => {
  assert.deepEqual(feel({ ...idle, activity: 'working', status: 'SYS-66, the pets' }), { key: 'working', label: 'Working', reason: 'SYS-66, the pets', title: 'Working: SYS-66, the pets' });
  assert.equal(feel({ ...idle, activity: 'working', status: '  ' }).reason, 'in a turn');
  assert.equal(feel({ ...idle, activity: 'working', open_from: 2 }).key, 'working', 'working goes before waiting? no: waiting needs idle');
  assert.deepEqual(feel({ ...idle, stopping_since: ago(1000) }), { key: 'working', label: 'Working', reason: 'wrapping up with a recap', title: 'Working: wrapping up with a recap' });
  // A remote agent that is online and gives no activity counts as working (stateWord).
  assert.equal(feel({ name: 'gpt', kind: 'remote', online: true, activity: 'working', open_to: 1 }).key, 'working');
});

test('waiting on you: idle while memos it sent wait on the owner', () => {
  assert.deepEqual(feel({ ...idle, open_from: 1 }), { key: 'waiting', label: 'Waiting on you', reason: '1 memo from it waits on you', title: 'Waiting on you: 1 memo from it waits on you' });
  assert.equal(feel({ ...idle, open_from: 3 }).reason, '3 memos from it wait on you');
  assert.equal(feel({ ...idle, open_from: 3, running: false, activity: 'stopped' }).key, 'sleeping', 'a stopped agent is not waiting, it naps');
});

test('overloaded: 5 open memos to it, or 3 helpers that run', () => {
  assert.deepEqual(feel({ ...idle, open_to: 5 }), { key: 'overloaded', label: 'Overloaded', reason: '5 memos wait on it', title: 'Overloaded: 5 memos wait on it' });
  assert.equal(feel({ ...idle, open_to: 4 }).key, 'sleeping');
  const h = (label, running) => ({ label, model: 'Fable 5.1', started: ago(HOUR), ended: running ? null : ago(1000), running });
  assert.deepEqual(feel({ ...idle, activity: 'working', helpers: [h('a', true), h('b', true), h('c', true), h('d', false)] }).title, 'Overloaded: 3 helpers run at once');
  assert.equal(feel({ ...idle, activity: 'working', helpers: [h('a', true), h('b', true), h('d', false), h('e', false)] }).key, 'working', 'two run, two are done');
  // Overloaded goes before waiting and working.
  assert.equal(feel({ ...idle, open_to: 6, open_from: 2 }).key, 'overloaded');
  assert.equal(feel({ ...idle, open_to: 6, activity: 'working' }).key, 'overloaded');
});

test('tired: a window of the account at 80 percent or more, with the percent in the reason; stale figures do not count', () => {
  const tired = { ...idle, usage: { ...idle.usage, week: { percent: 86, resets_at: ahead(48 * HOUR) } } };
  assert.deepEqual(feel(tired), { key: 'tired', label: 'Tired', reason: 'account at 86 percent (week)', title: 'Tired: account at 86 percent (week)' });
  assert.equal(feel({ ...idle, usage: { ...idle.usage, session: { percent: 79, resets_at: ahead(HOUR) } } }).key, 'sleeping', '79 is not tired');
  assert.equal(feel({ ...idle, usage: { ...idle.usage, models: [{ name: 'Fable', percent: 91, resets_at: ahead(HOUR) }] } }).reason, 'account at 91 percent (Fable)');
  assert.equal(feel({ ...idle, usage: { ...idle.usage, session: { percent: 97, resets_at: ahead(HOUR) } } }).reason, 'account at its limit, session at 97 percent');
  assert.equal(feel({ ...tired, usage: { ...tired.usage, at: ago(25 * 60000) } }).key, 'sleeping', 'figures older than 20 minutes are unknown');
  assert.equal(feel({ ...tired, usage: { ...tired.usage, week: { percent: 86, resets_at: ago(1000) } } }).key, 'sleeping', 'a reset that passed');
  assert.equal(feel({ ...idle, usage: null }).key, 'sleeping');
  assert.equal(feel({ ...idle, usage: { at: ago(1000), session: null, week: null, models: [], error: 'x' } }).key, 'sleeping');
  // The OpenAI figures of the desktop worker: windows with a label, and credits.
  const codex = { provider: 'openai', at: ago(1000), session: null, week: null, models: [], windows: [{ key: 'codex-primary', label: 'Session', percent: 30, resets_at: ahead(HOUR) }, { key: 'codex-secondary', label: 'Week', percent: 84, resets_at: ahead(HOUR) }], credits_by_limit_id: { codex: { hasCredits: true, unlimited: null, balance: null } } };
  assert.deepEqual(mostUsed(codex, now), { name: 'Week', percent: 84 });
  const gpt = { name: 'gpt', kind: 'remote', runtime: 'codex-desktop', online: true, activity: 'idle', open_to: 0, open_from: 0 };
  assert.equal(feel({ ...gpt, usage: codex }).title, 'Tired: account at 84 percent (Week)');
  assert.equal(atSpendLimit({ credits_by_limit_id: { codex: { hasCredits: false, unlimited: null } } }), true);
  assert.equal(atSpendLimit({ credits_by_limit_id: { codex: { hasCredits: false, unlimited: true } } }), false);
  assert.equal(atSpendLimit(idle.usage), false, 'the Claude figures have no spend data');
  assert.equal(feel({ ...gpt, usage: { ...codex, windows: [], credits_by_limit_id: { codex: { hasCredits: false, unlimited: null } } } }).title, 'Tired: at a spend limit');
  // Tired goes before overloaded, waiting and working.
  assert.equal(feel({ ...tired, open_to: 7, activity: 'working' }).key, 'tired');
});

test('upset: blocked on a permission question or a sign-in, an unconfirmed wakeup, or a failed helper; it goes first', () => {
  const blocked = { ...idle, activity: 'blocked', blocked: { reason: 'permission', prompt: 'Do you want to', since: ago(1000) } };
  assert.deepEqual(feel(blocked), { key: 'upset', label: 'Upset', reason: 'a permission question waits for you', title: 'Upset: a permission question waits for you' });
  assert.equal(feel({ ...blocked, blocked: { ...blocked.blocked, reason: 'sign-in' } }).reason, 'it needs a sign-in');
  assert.equal(feel({ ...idle, activity: 'blocked' }).reason, 'it is blocked');
  assert.equal(feel({ name: 'gpt', kind: 'remote', online: true, dispatch: { state: 'uncertain' } }).title, 'Upset: its wakeup was not confirmed');
  assert.equal(feel({ ...idle, helpers: [{ label: 'Vault sync', running: false, failed: true }] }).title, 'Upset: a helper failed: Vault sync');
  const tiredBlocked = { ...blocked, open_to: 9, usage: { ...idle.usage, week: { percent: 99, resets_at: ahead(HOUR) } } };
  assert.equal(feel(tiredBlocked).key, 'upset');
});

test('happy: thanks or praise from the owner in the last 4 hours, after working and before sleeping', () => {
  const replies = [{ id: 40, reply: 'Thanks, perfect.', closed: ago(HOUR) }];
  assert.deepEqual(feel({ ...idle, replies }), { key: 'happy', label: 'Happy', reason: 'your thanks on memo 40', title: 'Happy: your thanks on memo 40' });
  assert.equal(feel({ ...idle, replies: [{ id: 41, reply: 'No, use the other one.', closed: ago(HOUR) }] }).key, 'sleeping');
  assert.equal(feel({ ...idle, replies: [{ id: 42, reply: 'Thank you!', closed: ago(5 * HOUR) }] }).key, 'sleeping', 'too long ago');
  assert.equal(feel({ ...idle, replies: [{ id: 43, reply: 'Great', closed: ahead(HOUR) }] }).key, 'sleeping', 'a time in the future does not count');
  assert.equal(feel({ ...idle, replies, activity: 'working' }).key, 'working', 'working goes before happy');
  assert.equal(feel({ ...idle, replies, open_from: 1 }).key, 'waiting', 'waiting goes before happy');
  assert.deepEqual(recentThanks({ replies: [{ id: 1, reply: 'ok', closed: ago(1000) }, { id: 2, reply: 'Nice work 🙏', closed: ago(2000) }] }, now), { id: 2, text: 'Nice work 🙏' });
  assert.equal(recentThanks({ replies: 'x' }, now), null);
  for (const word of ['thanks', 'Thank you', 'thx', 'great', 'Perfect', 'nice', 'love it', 'lovely', 'wonderful', 'excellent', 'awesome', 'brilliant', 'well done', 'good job', 'amazing', 'fantastic', 'yay', 'bravo', 'kudos', '🙏', '❤️', '👍', '🎉']) {
    assert.ok(THANKS.test(word), `${word} is thanks`);
  }
  for (const word of ['thankless', 'greater', 'nicer', 'glove', 'No.', 'Use the second one', 'tyre']) assert.ok(!THANKS.test(word), `${word} is not thanks`);
});

test('a row: the size is the impact 1 to 5, how bothered is the effort, and the label has the real numbers', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(sizeOf), [1, 2, 3, 4, 5]);
  assert.deepEqual([0, 9, 'x', null, 3.4].map(sizeOf), [1, 5, 3, 3, 3]);
  assert.deepEqual(['micro', 'short', 'hour', 'half-day', 'day'].map(upsetOf), [0, 1, 2, 3, 4]);
  assert.equal(upsetOf('DAY'), 4);
  assert.equal(upsetOf(null), 1, 'no effort counts as short, as the energy tabs do');
  assert.equal(SIZE_WORDS.length, 5);
  assert.equal(UPSET_WORDS.length, 5);
  assert.equal(rowLabel('gpt', 4, 'hour'), 'Landon, big and bothered: impact 4, effort hour');
  assert.equal(rowLabel('second', 1, 'day'), 'Darkness, tiny and very bothered: impact 1, effort day');
  assert.equal(rowLabel('main', 3, 'micro'), 'Peeve, medium and calm: impact 3, effort micro');
  assert.equal(rowLabel('liaison', 3, 'half-day'), 'Liaison, medium and quite bothered: impact 3, effort half-day');
  assert.equal(rowLabel('main', null, 'micro'), null, 'a memo with no impact keeps the plain numbers');
  assert.equal(rowLabel('main', 3, null), null);
});

test('the picture of a pet: an address only when the folder has a file for the feeling or a plain one', () => {
  assert.equal(artUrl('main', 'tired', null), null);
  assert.equal(artUrl('main', 'tired', { any: false, feelings: ['working'] }), null);
  assert.equal(artUrl('main', 'working', { any: false, feelings: ['working'] }), '/ui/pet/main/working');
  assert.equal(artUrl('main', 'tired', { any: true, feelings: [] }), '/ui/pet/main/tired', 'the server falls back to the plain file');
  assert.equal(artUrl('main', 'any', { any: true, feelings: [] }), '/ui/pet/main/any');
  assert.equal(artUrl('main', 'any', { any: false, feelings: ['working'] }), null);
  assert.equal(artUrl('../x', 'any', { any: true }), null, 'a name of the wrong form gives no address');
});

// A folder of pictures for the tests: a plain file for main, a working file for main, a jpg for second.
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function petsFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'memo-pets-'));
  writeFileSync(join(dir, 'main.png'), PNG);
  writeFileSync(join(dir, 'main-working.png'), Buffer.concat([PNG, Buffer.from('w')]));
  writeFileSync(join(dir, 'second.jpg'), Buffer.from('ffd8ffe0', 'hex'));
  writeFileSync(join(dir, 'Second-tired.png'), PNG); // a capital: not an agent name, so it is not listed
  writeFileSync(join(dir, 'notes.txt'), 'x');
  writeFileSync(join(dir, 'main-angry.png'), PNG); // not a feeling
  return dir;
}

test('src/pets.js lists the folder by agent and feeling, and gives the file of the feeling or the plain one', () => {
  const dir = petsFolder();
  let t = now.getTime();
  const art = createPetArt({ dir, now: () => new Date(t) });
  assert.deepEqual(art.of('main'), { any: true, feelings: ['working'], animated: [], still: [] });
  assert.deepEqual(art.of('second'), { any: true, feelings: [], animated: [], still: [] });
  assert.equal(art.of('gpt'), null);
  assert.equal(art.of('../main'), null);
  assert.equal(art.of('Main'), null);
  assert.deepEqual(art.file('main', 'working'), { bytes: readFileSync(join(dir, 'main-working.png')), type: 'image/png', animated: false });
  assert.deepEqual(art.file('main', 'tired'), { bytes: PNG, type: 'image/png', animated: false }, 'no file for tired: the plain one');
  assert.deepEqual(art.file('main', 'any'), { bytes: PNG, type: 'image/png', animated: false });
  assert.equal(art.file('second', 'happy').type, 'image/jpeg');
  assert.equal(art.file('gpt', 'any'), null);
  assert.equal(art.file('main', 'angry'), null, 'not a feeling');
  assert.equal(art.file('main/../main', 'any'), null);
  assert.equal(art.file('main', '../../.env'), null);
  // The folder is read again after LIST_MS: a new file shows then, and the list is not read at each request.
  writeFileSync(join(dir, 'gpt.png'), PNG);
  assert.equal(art.of('gpt'), null, 'the list of a moment ago');
  t += 11000;
  assert.deepEqual(art.of('gpt'), { any: true, feelings: [], animated: [], still: [] });
  // A folder that is not there: nothing, with no error.
  const none = createPetArt({ dir: join(dir, 'missing') });
  assert.equal(none.of('main'), null);
  assert.equal(none.file('main', 'any'), null);
});

test('the route /ui/pet/<agent>/<feeling> gives a picture of the folder, with no token, and nothing else', async () => {
  assert.equal(PET_ROUTE, '/ui/pet/:agent/:feeling');
  const dir = petsFolder();
  const { app } = makeApp({ petsDir: dir });
  const get = async (path) => { const r = await app.request(path); return { status: r.status, type: r.headers.get('content-type') || '', bytes: Buffer.from(await r.arrayBuffer()) }; };
  const working = await get('/ui/pet/main/working');
  assert.equal(working.status, 200);
  assert.equal(working.type, 'image/png');
  assert.deepEqual(working.bytes, readFileSync(join(dir, 'main-working.png')));
  assert.deepEqual((await get('/ui/pet/main/sleeping')).bytes, PNG, 'the plain file for a feeling with none');
  assert.equal((await get('/ui/pet/second/any')).type, 'image/jpeg');
  assert.equal((await get('/ui/pet/gpt/any')).status, 404);
  assert.equal((await get('/ui/pet/main/angry')).status, 404);
  assert.equal((await get('/ui/pet/..%2F..%2Fpackage.json/any')).status, 404);
  assert.equal((await get('/ui/pet/main/..%2F..%2F.env')).status, 404);
  assert.equal((await get('/ui/pet/Main/any')).status, 404);
  assert.equal((await get('/ui/pet/main')).status, 404);
  // The agents carry their art, so the pages know when to ask for a picture.
  const agents = (await call(app, '/api/agents')).data;
  assert.deepEqual(agents.find((a) => a.name === 'main').art, { any: true, feelings: ['working'], animated: [], still: [] });
  assert.equal(agents.find((a) => a.name === 'liaison').art, null);
  // Without the folder, every agent has art null and the route gives 404.
  const bare = makeApp();
  assert.equal((await call(bare.app, '/api/agents')).data[0].art, null);
  assert.equal((await bare.app.request('/ui/pet/main/any')).status, 404);
});

test('the two pages draw the pets, and the modules are served', async () => {
  const { app } = makeApp();
  const text = async (path) => (await app.request(path)).text();
  assert.match(await text('/ui/pets.js'), /export function feelingOf/);
  assert.match(await text('/ui/petview.js'), /export function petView/);
  const inbox = await text('/inbox');
  assert.match(inbox, /import \{ petView, rowPet \} from '\/ui\/petview\.js'/);
  assert.match(inbox, /const pet = memo\.sender === 'cam' \? null : rowPet\(memo, el, \{ art: artOf\(memo\.sender\), today: todayIn\(zone\) \}\);/);
  assert.match(inbox, /return pet \? \[pet\] : \[levelChip\(memo\), el\('span', \{ className: 'effort' \}, memo\.effort\)\];/);
  assert.match(inbox, /feelingLine\(pet\.feeling\)/);
  const agents = await text('/agents');
  assert.match(agents, /import \{ petView \} from '\/ui\/petview\.js'/);
  assert.match(agents, /petView\(agent, el, \{ size: 3 \}\)\.node/);
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  assert.match(css, /\.pet \{ display: inline-flex/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n(?:  \/\*[^]*?\*\/\n)?  \.pet-art, \.pet-art \* \{ animation: none !important; \}/);
  assert.match(css, /\.pet-art \.huff, \.pet-art \.bubble \{ opacity: 1; \}/, 'the poses stay in view with no motion');
  // The drawing module builds the SVG element by element, never from markup.
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  for (const word of ['innerHTML', 'insertAdjacentHTML', 'DOMParser']) assert.ok(!view.includes(word), `petview.js must not use ${word}`);
  assert.match(view, /createElementNS\(NS, tag\)/);
});

// The rules of a style sheet, with no comments: [{ selectors, body, media }], media '' outside an @media block.
// @keyframes blocks are left out. Enough for ui/common.css, which nests no deeper than one @media.
function cssRules(css) {
  const text = css.replace(/\/\*[^]*?\*\//g, '');
  const rules = [];
  const read = (from, to, media) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf('{', i);
      if (open === -1 || open >= to) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let end = open + 1;
      while (depth && end < to) { if (text[end] === '{') depth += 1; else if (text[end] === '}') depth -= 1; end += 1; }
      if (head.startsWith('@media')) read(open + 1, end - 1, head);
      else if (!head.startsWith('@')) rules.push({ selectors: head.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: text.slice(open + 1, end - 1).trim(), media });
      i = end;
    }
  };
  read(0, text.length, '');
  return rules;
}
// The specificity of a simple selector of this style sheet, as [ids, classes, types]: enough for classes, types and *.
const specificity = (selector) => [(selector.match(/#[\w-]+/g) || []).length, (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length,
  (selector.replace(/[.#:][\w-]+|\[[^\]]*\]/g, ' ').match(/[a-z][\w-]*/gi) || []).length];
const beats = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// With prefers-reduced-motion the drawings must hold still. The rules that start an animation of a drawing name the
// feeling or the manner of the pet (.pet.working .pet-art .tail), so a plain "animation: none" in the media block
// lost to them and the drawings kept moving. The rule of the media block must win over each of them: by !important
// (no animation rule has it), or else by a specificity that is as high and a place later in the file.
test('with reduced motion the rule of the drawings wins over every rule that animates a drawing, and leaves the poses', () => {
  const rules = cssRules(readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8'));
  const reduced = (r) => /prefers-reduced-motion:\s*reduce/.test(r.media);
  const animates = (r) => /(?:^|;)\s*animation(?:-name)?\s*:\s*(?!none\b)/.test(r.body);
  // Each selector that animates the drawing or a part of it, outside the media block.
  const moving = rules.filter((r) => !reduced(r) && animates(r)).flatMap((r) => r.selectors.map((selector) => ({ selector, body: r.body }))).filter((x) => x.selector.includes('.pet-art'));
  assert.ok(moving.length >= 15, `the test reads the animation rules of the drawings (${moving.length})`);
  for (const sample of ['.pet.working .pet-art .tail', '.pet.happy .pet-art', '.pet.row.twirl .pet-art', '.pet-art .zz', '.pet.wait-4 .pet-art .bubble.b3']) {
    assert.ok(moving.some((x) => x.selector === sample) || rules.some((r) => r.selectors.includes(sample)), `${sample} is a rule of the file`);
  }
  for (const x of moving) assert.ok(!/animation[^;]*!important/.test(x.body), `${x.selector} must not make its animation !important`);

  const stops = rules.filter((r) => reduced(r) && /(?:^|;)\s*animation\s*:\s*none\b/.test(r.body) && r.selectors.some((s) => s.includes('.pet-art')));
  assert.equal(stops.length, 1, 'one rule of the media block stops the animations of the drawings');
  const [stop] = stops;
  const important = /animation\s*:\s*none\s*!important/.test(stop.body);
  // The element that each animation rule moves is the drawing (.pet-art) or a part of it (.pet-art .tail). The stop
  // rule must reach both: .pet-art, and every element inside it.
  const covers = (selector) => {
    const part = !/\.pet-art$/.test(selector);
    return stop.selectors.some((s) => {
      const reaches = part ? /\.pet-art (\*|\.[\w-]+)$/.test(s) && (s.endsWith(' *') || selector.endsWith(s.split(' ').at(-1))) : /\.pet-art$/.test(s);
      return reaches && (important || beats(specificity(s), specificity(selector)) >= 0);
    });
  };
  for (const x of moving) assert.ok(covers(x.selector), `the reduced-motion rule must win over ${x.selector}`);
  // The old rule, for the record: it had the plain selectors and no !important, and it lost.
  assert.ok(beats(specificity('.pet.working .pet-art .tail'), specificity('.pet .pet-art .tail')) > 0, 'a feeling rule is more specific than the old selectors');
  assert.ok(beats(specificity('.pet.happy .pet-art'), specificity('.pet .pet-art')) > 0);

  // The poses stay. The stop rule sets nothing but the animation, and no rule of the media block touches a
  // transform, an origin or the display of a pet; the fixed poses outside it are still there.
  assert.equal(stop.body.replace(/\s+/g, ' '), 'animation: none !important;');
  for (const r of rules.filter((x) => reduced(x) && x.selectors.some((s) => /\.pet\b|\.pet-/.test(s)))) {
    assert.ok(!/transform|display|visibility|clip-path/.test(r.body), `${r.selectors.join(', ')} must not change a pose`);
  }
  const plain = rules.filter((r) => !reduced(r));
  assert.ok(plain.some((r) => r.selectors.includes('.pet.tired .pet-pic svg') && /transform: translateY\(6%\) rotate\(-4deg\)/.test(r.body)), 'the tired pose');
  assert.ok(plain.some((r) => r.selectors.includes('.pet-art .tail') && /transform-origin/.test(r.body)), 'the origin of the tail');
  // The extras whose animation starts from "not in view" are in view with no motion.
  assert.ok(rules.some((r) => reduced(r) && r.selectors.includes('.pet-art .huff') && r.selectors.includes('.pet-art .bubble') && /opacity: 1/.test(r.body)));
});

// The manner of a pet with a picture (memo 1301): the classes that the CSS animates the picture by, and the marks
// that show over it. mannerOf is pure, so it runs here with no page.
const noCuddle = new Date(now.getTime() + 5 * 60000);
const manner = (name, key, at = noCuddle, more = {}) => mannerOf({ name, ...more }, { key }, at);

test('the manner of Peeve: still and grumpy when upset, a cuddle with the heart in its moment, Zs asleep', () => {
  assert.deepEqual(manner('main', 'upset'), { mood: 'grumpy', pose: 'earsback', extras: [], backdrop: [], classes: ['still', 'flick'] });
  assert.deepEqual(manner('main', 'sleeping').extras, [['zz']]);
  assert.deepEqual(manner('main', 'sleeping').classes, []);
  assert.deepEqual(manner('main', 'happy').extras, [['heart']]);
  assert.equal(cuddleMoment(now), true);
  for (const key of ['sleeping', 'happy']) {
    const m = manner('main', key, now);
    assert.deepEqual([m.pose, m.classes, m.extras], ['curl', ['cuddle'], [['heart']]], `${key}: the heart alone, no Zs`);
  }
  assert.deepEqual(manner('main', 'working', now).classes, [], 'no cuddle at work');
  assert.deepEqual(manner('main', 'tired').extras, []);
  assert.deepEqual(manner('main', 'overloaded').extras, [['drop']]);
});

test('the manner of Darkness: chatter with bubbles at work and in a wait, hiding when upset, restless asleep', () => {
  assert.deepEqual(manner('second', 'working'), { mood: 'smile', pose: '', extras: [['bubbles', 1]], backdrop: [], classes: ['chatter'] });
  const waited = (age) => manner('second', 'waiting', now, { memos_from: [{ id: 1, title: null, line: 'x', created: ago(age) }] });
  assert.deepEqual([waited(10 * 60000).extras, waited(10 * 60000).classes], [[['bubbles', 1]], ['chatter', 'wait-1']]);
  assert.deepEqual([waited(7 * HOUR).extras, waited(7 * HOUR).classes], [[['bubbles', 3]], ['chatter', 'wait-3']]);
  assert.deepEqual([waited(30 * HOUR).extras, waited(30 * HOUR).classes], [[['bubbles', 4]], ['chatter', 'wait-4']]);
  assert.deepEqual(manner('second', 'upset'), { mood: 'wide', pose: 'hide', extras: [], backdrop: [], classes: ['still', 'hiding'] });
  assert.deepEqual([manner('second', 'sleeping').extras, manner('second', 'sleeping').classes], [[['zz']], ['restless']]);
  assert.deepEqual(manner('second', 'happy', now).classes, [], 'the cuddle is only for Peeve');
});

test('the manner of Landon: at the door in a wait, still with a huff when upset; a pet with no manner is plain', () => {
  assert.deepEqual(manner('gpt', 'waiting'), { mood: 'calm', pose: '', extras: [], backdrop: [['door']], classes: ['at-door'] });
  assert.deepEqual(manner('gpt', 'upset'), { mood: 'quiet', pose: '', extras: [['huff']], backdrop: [], classes: ['still'] });
  assert.deepEqual(manner('gpt', 'happy').extras, [['heart']]);
  assert.deepEqual(manner('liaison', 'upset'), { mood: 'angry', pose: '', extras: [], backdrop: [], classes: [] });
  assert.deepEqual(manner('liaison', 'sleeping').extras, [['zz']]);
});

test('the marks over a picture: the extras of the manner or of the row, never the door', () => {
  assert.deepEqual(pictureMarks(manner('gpt', 'upset').extras), [['huff']]);
  assert.deepEqual(pictureMarks(manner('second', 'working').extras), [['bubbles', 1]]);
  assert.deepEqual(pictureMarks(manner('main', 'happy', now).extras), [['heart']]);
  assert.deepEqual(pictureMarks(manner('second', 'upset').extras), [], 'in hiding, nothing over the picture');
  assert.deepEqual(pictureMarks([['door'], ['zz']]), [['zz']]);
  assert.deepEqual(pictureMarks(), []);
  assert.deepEqual(rowMarks(true, 0), [['sparks']]);
  assert.deepEqual(rowMarks(true, 4), [['sparks']], 'excited goes first');
  assert.deepEqual(rowMarks(false, 3), [['drop']]);
  assert.deepEqual(rowMarks(false, 4), [['drop']]);
  assert.deepEqual(rowMarks(false, 2), []);
});

test('a picture moves by the classes of its pet, with the overlay, and holds still with reduced motion', () => {
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  for (const rule of [
    '.pet.peeve.working .pet-pic img, .pet.peeve.waiting .pet-pic img, .pet.peeve.happy .pet-pic img, .pet.peeve.overloaded .pet-pic img { animation: pet-pic-breathe 4.2s',
    '.pet.peeve.tired .pet-pic img, .pet.peeve.sleeping .pet-pic img { animation: pet-pic-breathe 7s',
    '.pet.peeve.cuddle .pet-pic img { transform: translateY(4%) scale(1.03, .96); animation: pet-pic-settle',
    '.pet.darkness.working .pet-pic img, .pet.darkness.waiting .pet-pic img { animation: pet-pic-fidget',
    '.pet.darkness.restless .pet-pic img { animation: pet-stumble',
    '.pet.darkness.hiding .pet-pic img { transform: translateY(48%); clip-path: inset(0 0 48% 0); }',
    '.pet.landon.waiting .pet-pic img { animation: pet-pic-nod .8s ease-in-out infinite alternate; }',
    '.pet.landon.upset .pet-pic img { animation: pet-pic-huff',
    '.pet.landon.row.twirl .pet-pic img { transform-origin: 50% 50%; animation: pet-pic-twirl',
    '.pet.still.peeve .pet-pic img, .pet.still.darkness .pet-pic img { animation: none; }',
    '.pet-pic .pet-over { position: absolute; inset: 0; pointer-events: none; }',
    '.pet.wait-4 .pet-over .bubble { animation-duration: 1.2s; }',
    '  .pet .pet-pic img, .pet .pet-over * { animation: none !important; }\n  .pet-over .huff, .pet-over .bubble { opacity: 1; }',
  ]) assert.ok(css.includes(rule), `common.css must have: ${rule}`);
  for (const name of ['pet-pic-breathe', 'pet-pic-settle', 'pet-pic-fidget', 'pet-pic-nod', 'pet-pic-huff', 'pet-pic-twirl']) assert.ok(css.includes(`@keyframes ${name} `), `the keyframes ${name}`);
  // The page gives the picture its overlay and takes it away when the drawing comes back.
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  assert.match(view, /const over = overlayOf\(pictureMarks\(marks\)\);/);
  assert.match(view, /frame\.replaceWith\(drawing\); over\?\.remove\(\); art\.classList\.remove\('has-pic', 'animated'\);/);
  assert.match(view, /picOrDrawing\(el, artPicture\(agent\.name, feeling\.key, agent\.art\), drawing, size, manner\.extras\)/);
});

// The animated pictures: a .webp or a .gif with the same stems as the still ones. The bytes are only the first bytes
// of each type; the server tells the type by the extension and never reads inside the file.
const WEBP = Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8X', 'latin1');
const GIF = Buffer.from('GIF89a', 'latin1');
const JPG = Buffer.from('ffd8ffe0', 'hex');
// A folder with the files of `names`, written in that order: [name, bytes].
function folderOf(names) {
  const dir = mkdtempSync(join(tmpdir(), 'memo-pets-'));
  for (const [name, bytes] of names) writeFileSync(join(dir, name), bytes);
  return dir;
}
// main: every type for the plain picture, a happy picture as PNG alone, a tired one as WebP alone, a working one as
// GIF with a JPEG. second: a GIF with a PNG. gpt: still files alone. The still files are written first, and the
// order of the folder must not count.
const mixedFolder = () => folderOf([
  ['main.jpeg', JPG], ['main.jpg', Buffer.concat([JPG, Buffer.from('j')])], ['main.png', PNG], ['main.gif', GIF], ['main.webp', WEBP],
  ['main-happy.png', Buffer.concat([PNG, Buffer.from('h')])], ['main-tired.webp', Buffer.concat([WEBP, Buffer.from('t')])],
  ['main-working.jpg', Buffer.concat([JPG, Buffer.from('w')])], ['main-working.gif', Buffer.concat([GIF, Buffer.from('w')])],
  ['second.png', PNG], ['second.gif', GIF], ['gpt.jpeg', JPG], ['gpt.jpg', Buffer.concat([JPG, Buffer.from('j')])], ['gpt-sleeping.png', PNG],
  ['main.webp.txt', 'x'], ['main-angry.webp', WEBP], ['Main-happy.gif', GIF],
]);

test('the types of a picture and their order: webp, gif, png, jpg, jpeg; webp and gif are the animated ones', () => {
  assert.deepEqual(Object.entries(TYPES), [['webp', 'image/webp'], ['gif', 'image/gif'], ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg']]);
  assert.deepEqual(ANIMATED, ['webp', 'gif']);
  for (const name of ['main.webp', 'main-happy.gif', 'MAIN.WEBP', 'x.GIF']) assert.equal(isAnimated(name), true, name);
  for (const name of ['main.png', 'main.jpg', 'main.jpeg', 'main.webp.png', 'webp', 'gif.txt', '']) assert.equal(isAnimated(name), false, name);
});

test('a stem with several files: the animated type goes first, by a fixed order and not by the order of the folder', () => {
  const art = createPetArt({ dir: mixedFolder(), now: () => now });
  assert.deepEqual(art.file('main', 'any'), { bytes: WEBP, type: 'image/webp', animated: true }, 'webp before gif, png and jpg');
  assert.deepEqual(art.file('main', 'working'), { bytes: Buffer.concat([GIF, Buffer.from('w')]), type: 'image/gif', animated: true }, 'gif before jpg');
  assert.deepEqual(art.file('second', 'any'), { bytes: GIF, type: 'image/gif', animated: true }, 'gif before png');
  assert.deepEqual(art.file('gpt', 'any'), { bytes: Buffer.concat([JPG, Buffer.from('j')]), type: 'image/jpeg', animated: false }, 'jpg before jpeg');
  // The file of a feeling goes before the plain file, whatever their types.
  assert.deepEqual(art.file('main', 'happy'), { bytes: Buffer.concat([PNG, Buffer.from('h')]), type: 'image/png', animated: false });
  assert.deepEqual(art.file('main', 'sleeping'), { bytes: WEBP, type: 'image/webp', animated: true }, 'no file for sleeping: the plain one');
  assert.equal(art.file('main', 'angry'), null, 'not a feeling');
  // Each pair alone, written in the two orders: the same choice.
  const pairs = [[['a.webp', WEBP], ['a.gif', GIF], 'image/webp'], [['a.gif', GIF], ['a.png', PNG], 'image/gif'], [['a.webp', WEBP], ['a.jpg', JPG], 'image/webp'],
    [['a.png', PNG], ['a.jpg', JPG], 'image/png'], [['a.png', PNG], ['a.jpeg', JPG], 'image/png'], [['a.jpg', JPG], ['a.jpeg', JPG], 'image/jpeg']];
  for (const [first, second, type] of pairs) {
    for (const files of [[first, second], [second, first]]) {
      const found = createPetArt({ dir: folderOf(files), now: () => now }).file('a', 'any');
      assert.equal(found.type, type, files.map(([name]) => name).join(' then '));
      assert.deepEqual(found.bytes, first[1], 'the bytes of the first type of the order');
    }
  }
});

test('the art of an agent says which pictures are animated and which of those have a still file', () => {
  const art = createPetArt({ dir: mixedFolder(), now: () => now });
  assert.deepEqual(art.of('main'), { any: true, feelings: ['tired', 'working', 'happy'], animated: ['any', 'tired', 'working'], still: ['any', 'working'] });
  assert.deepEqual(art.of('second'), { any: true, feelings: [], animated: ['any'], still: ['any'] });
  assert.deepEqual(art.of('gpt'), { any: true, feelings: ['sleeping'], animated: [], still: [] });
  assert.equal(art.of('liaison'), null);
  // An animated file alone, for one feeling and no plain picture.
  const lone = createPetArt({ dir: folderOf([['gpt-happy.webp', WEBP]]), now: () => now });
  assert.deepEqual(lone.of('gpt'), { any: false, feelings: ['happy'], animated: ['happy'], still: [] });
  assert.equal(lone.file('gpt', 'any'), null);
  assert.equal(lone.file('gpt', 'tired'), null);
});

test('the still file of an animated picture: the first still type of the same stem, else the picture itself', () => {
  const art = createPetArt({ dir: mixedFolder(), now: () => now });
  const still = (name, feeling) => art.file(name, feeling, { still: true });
  assert.deepEqual(still('main', 'any'), { bytes: PNG, type: 'image/png', animated: false }, 'png before jpg');
  assert.deepEqual(still('main', 'working'), { bytes: Buffer.concat([JPG, Buffer.from('w')]), type: 'image/jpeg', animated: false });
  assert.deepEqual(still('main', 'tired'), { bytes: Buffer.concat([WEBP, Buffer.from('t')]), type: 'image/webp', animated: true }, 'no still file of the stem main-tired: not the plain PNG, the animated file');
  assert.deepEqual(still('main', 'sleeping'), { bytes: PNG, type: 'image/png', animated: false }, 'the plain stem, then its still file');
  assert.deepEqual(still('main', 'happy'), art.file('main', 'happy'), 'a still picture is its own still file');
  assert.deepEqual(still('second', 'upset'), { bytes: PNG, type: 'image/png', animated: false });
  assert.equal(still('liaison', 'any'), null);
  assert.equal(still('main', '../../.env'), null);
});

test('the route gives a webp as image/webp and a gif as image/gif, and the still file with ?still=1', async () => {
  const { app } = makeApp({ petsDir: mixedFolder() });
  const get = async (path) => { const r = await app.request(path); return { status: r.status, type: r.headers.get('content-type') || '', sniff: r.headers.get('x-content-type-options'), bytes: Buffer.from(await r.arrayBuffer()) }; };
  const plain = await get('/ui/pet/main/any');
  assert.deepEqual([plain.status, plain.type, plain.sniff], [200, 'image/webp', 'nosniff']);
  assert.deepEqual(plain.bytes, WEBP);
  const working = await get('/ui/pet/main/working');
  assert.deepEqual([working.status, working.type, working.sniff], [200, 'image/gif', 'nosniff']);
  assert.deepEqual(working.bytes, Buffer.concat([GIF, Buffer.from('w')]));
  assert.equal((await get('/ui/pet/second/any')).type, 'image/gif');
  assert.equal((await get('/ui/pet/main/happy')).type, 'image/png');
  assert.equal((await get('/ui/pet/gpt/any')).type, 'image/jpeg');
  // The still file of the same stem.
  const still = await get('/ui/pet/main/any?still=1');
  assert.deepEqual([still.status, still.type], [200, 'image/png']);
  assert.deepEqual(still.bytes, PNG);
  assert.equal((await get('/ui/pet/main/working?still=1')).type, 'image/jpeg');
  assert.equal((await get('/ui/pet/main/tired?still=1')).type, 'image/webp', 'no still file: the animated one');
  assert.equal((await get('/ui/pet/main/any?still=0')).type, 'image/webp', 'only still=1 asks for the still file');
  assert.equal((await get('/ui/pet/main/any?still=yes')).type, 'image/webp');
  assert.equal((await get('/ui/pet/liaison/any?still=1')).status, 404);
  assert.equal((await get('/ui/pet/main/angry?still=1')).status, 404);
  // The agents carry the animated keys and the still keys.
  const agents = (await call(app, '/api/agents')).data;
  assert.deepEqual(agents.find((a) => a.name === 'main').art, { any: true, feelings: ['tired', 'working', 'happy'], animated: ['any', 'tired', 'working'], still: ['any', 'working'] });
});

test('the picture a page shows: animated or not, with the still address for reduced motion when there is a still file', () => {
  const art = { any: true, feelings: ['tired', 'working', 'happy'], animated: ['any', 'tired', 'working'], still: ['any', 'working'] };
  assert.deepEqual(artPicture('main', 'working', art), { src: '/ui/pet/main/working', animated: true, still: '/ui/pet/main/working?still=1' });
  assert.deepEqual(artPicture('main', 'tired', art), { src: '/ui/pet/main/tired', animated: true, still: null }, 'animated with no still file');
  assert.deepEqual(artPicture('main', 'happy', art), { src: '/ui/pet/main/happy', animated: false, still: null }, 'the PNG of the feeling, though the plain one is animated');
  assert.deepEqual(artPicture('main', 'sleeping', art), { src: '/ui/pet/main/sleeping', animated: true, still: '/ui/pet/main/sleeping?still=1' }, 'no file for the feeling: the plain picture and its still file');
  assert.deepEqual(artPicture('main', 'any', art), { src: '/ui/pet/main/any', animated: true, still: '/ui/pet/main/any?still=1' });
  // Still pictures alone, and the art of an older server with no lists.
  assert.deepEqual(artPicture('gpt', 'happy', { any: true, feelings: [], animated: [], still: [] }), { src: '/ui/pet/gpt/happy', animated: false, still: null });
  assert.deepEqual(artPicture('gpt', 'happy', { any: true, feelings: [] }), { src: '/ui/pet/gpt/happy', animated: false, still: null });
  assert.deepEqual(artPicture('gpt', 'any', { any: true, feelings: [], animated: 'any', still: true }), { src: '/ui/pet/gpt/any', animated: false, still: null }, 'lists of a wrong form count as none');
  assert.deepEqual(artPicture('gpt', 'any', { any: true, feelings: [], animated: [], still: ['any'] }), { src: '/ui/pet/gpt/any', animated: false, still: null }, 'a still picture needs no still address');
  // No picture: the drawing, as artUrl.
  assert.equal(artPicture('main', 'tired', null), null);
  assert.equal(artPicture('main', 'tired', { any: false, feelings: ['working'], animated: ['working'], still: [] }), null);
  assert.equal(artPicture('../x', 'any', { any: true, animated: ['any'] }), null);
  // What the <picture> gets: the still file for a reader with reduced motion, only for an animated picture that has one.
  assert.equal(REDUCED_MOTION, '(prefers-reduced-motion: reduce)');
  assert.deepEqual(pictureSources({ src: '/ui/pet/main/any', animated: true, still: '/ui/pet/main/any?still=1' }), [{ media: '(prefers-reduced-motion: reduce)', srcset: '/ui/pet/main/any?still=1' }]);
  assert.deepEqual(pictureSources({ src: '/ui/pet/main/tired', animated: true, still: null }), [], 'no still file: the animated file shows');
  assert.deepEqual(pictureSources({ src: '/ui/pet/gpt/any', animated: false, still: null }), []);
  assert.deepEqual(pictureSources({ src: '/ui/pet/gpt/any', animated: false, still: '/ui/pet/gpt/any?still=1' }), [], 'a still picture has no other source');
  assert.deepEqual(pictureSources(null), []);
});

test('an animated picture gets no movement and no pose from the CSS, and keeps its overlay', () => {
  const css = readFileSync(join(ROOT, 'ui', 'common.css'), 'utf8');
  const rules = cssRules(css);
  const off = rules.filter((r) => r.selectors.includes('.pet .pet-pic.animated img'));
  assert.equal(off.length, 1);
  assert.equal(off[0].media, '', 'for every reader, not only with reduced motion');
  assert.equal(off[0].body.replace(/\s+/g, ' '), 'animation: none !important; transform: none !important; clip-path: none !important;');
  // Every rule that moves or poses the <img> of a picture loses to it: none of them is !important, and it is.
  const onImg = rules.filter((r) => r !== off[0] && r.media === '' && r.selectors.some((s) => /\.pet-pic img$/.test(s)) && /animation|transform:|clip-path/.test(r.body));
  assert.ok(onImg.length >= 15, `the test reads the rules of the pictures (${onImg.length})`);
  for (const r of onImg) assert.ok(!/!important/.test(r.body), `${r.selectors.join(', ')} must not be !important`);
  // The overlay is not touched: no rule names the overlay of an animated picture.
  assert.ok(!rules.some((r) => r.selectors.some((s) => /\.animated\b.*\.pet-over/.test(s))));
  assert.ok(css.includes('.pet-pic picture { display: contents; }'));
  // The page: the class for an animated picture, the sources before the <img>, the address of the <img> last.
  const view = readFileSync(join(ROOT, 'ui', 'petview.js'), 'utf8');
  assert.match(view, /if \(picture\.animated\) art\.classList\.add\('animated'\);/);
  assert.match(view, /const frame = el\('picture', \{\}, \.\.\.pictureSources\(picture\)\.map\(\(source\) => el\('source', source\)\), img\);/);
  assert.match(view, /img\.src = picture\.src;/);
  assert.match(view, /picOrDrawing\(el, artPicture\(memo\.sender, feeling\.key, art\), drawing,/);
});

test('the pet of a row takes its mood from the memo, the first rule that applies', () => {
  const now = new Date('2026-11-10T18:00:00Z');
  const at = (hours) => new Date(now.getTime() - hours * 3600000).toISOString();
  const base = { state: 'open', sender: 'main', impact: 3, effort: 'hour', seen: 1, created: at(2) };
  const key = (extra) => rowFeeling({ ...base, ...extra }, { now, today: '2026-11-10' }).key;
  assert.equal(key({}), 'waiting');
  assert.equal(key({ due: '2026-11-09', effort: 'day' }), 'upset', 'overdue goes first');
  assert.equal(key({ due: '2026-11-10' }), 'waiting', 'due today is not overdue');
  assert.equal(key({ created: at(6 * 24), impact: 5, effort: 'micro' }), 'tired');
  assert.equal(key({ back: at(1) }), 'tired');
  assert.equal(key({ effort: 'half-day', seen: 0 }), 'overloaded');
  assert.equal(key({ impact: 4, effort: 'short' }), 'happy');
  assert.equal(key({ seen: 0 }), 'working');
  assert.equal(key({ seen: 2, impact: 1 }), 'working');
  assert.equal(key({ impact: 2 }), 'sleeping');
  assert.equal(key({ state: 'closed', due: '2026-11-01' }), 'sleeping');
  assert.equal(key({ state: 'replied', reply: 'Perfect, thanks' }), 'happy');
  assert.equal(rowFeeling({ ...base, created: at(6 * 24) }, { now }).title, 'Tired: has waited 6 days');
  for (const k of ['waiting', 'upset', 'tired', 'overloaded', 'happy', 'working', 'sleeping']) assert.ok(FEELINGS.includes(k));
});

test('a row of the Inbox has no tags and no circle of the sender; the keys of the card are the keys of the page', async () => {
  const { app } = makeApp();
  const inbox = await (await app.request('/inbox')).text();
  assert.doesNotMatch(inbox, /cell who|cell tags|<span>Tags<\/span>/);
  assert.match(inbox, /readOnly \? '' : unseenDot\(memo\)/);
  for (const [key, code] of [['r', "event.key === 'r'"], ['a', "event.key === 'a'"], ['/', "event.key === '/'"], ['esc', "event.key === 'Escape'"], ['1', '/^[1-9]$/.test(event.key)'], ['w', "event.key === 'w'"], ['j', "event.key === 'j'"]]) {
    assert.ok(inbox.includes(`<kbd>${key}</kbd>`), `the card names ${key}`);
    assert.ok(inbox.includes(code), `the page handles ${key}`);
  }
});
