import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createImages } from '../src/images.js';
import { createFiles } from '../src/files.js';
import { createVideos } from '../src/videos.js';
import { openDb } from '../src/db.js';
import { createStore } from '../src/memos.js';
import { createAgents } from '../src/agents.js';
import { createApp } from '../src/app.js';
import { createTicks } from '../src/ticks.js';
import { loadWorkstreams } from '../src/workstreams.js';

export const TOKEN = 'full-token-0123456789';
export const LIAISON_TOKEN = 'liaison-token-0123456789';
export const ROOT = join(import.meta.dirname, '..');
// The workstream codes of the tests: those of the example in the repository (REL, FUND, OPS, ...).
export const WORKSTREAMS = loadWorkstreams(join(ROOT, 'workstreams.json'));
const CONFIG = [
  { name: 'main', kind: 'long', dir: '~/p', model: 'm' },
  { name: 'liaison', kind: 'short', dir: '~/p', model: 'm' },
];

// schedulePath: by default a file that is not there, so the tests never read the real local/schedule.json.
// dataDir: a new directory for data/client-tz.json. calendarUrl and getCalendar: a calendar with no network.
export function makeApp({ tailscale, config = CONFIG, ticksOn = true, schedulePath = join(tmpdir(), 'memo-no-schedule', 'schedule.json'),
  dataDir = mkdtempSync(join(tmpdir(), 'memo-data-')), calendarUrl, getCalendar = () => { throw new Error('no network in tests'); }, now, ledgerPage, onDraft, started, system,
  // videos: a store in a new folder with the clock of the app. frames: none by default (the Swift tool is slow to build);
  // test/videos.test.js gives a fake one.
  frames,
  // petsDir: by default a folder that is not there, so the tests never read the real pictures of the pets.
  petsDir = join(tmpdir(), 'memo-no-pets', 'agent-pets') } = {}) {
  const db = openDb();
  const store = createStore(db, { owner: 'cam', names: ['cam', 'discord', ...config.map((a) => a.name)], forwardTo: config.filter((a) => a.kind !== 'short').map((a) => a.name), workstreams: WORKSTREAMS });
  const sessions = new Set();
  const sends = []; // [session, text] for each text that went to a session
  const tmux = { has: (s) => sessions.has(s), start: (s) => sessions.add(s), kill: (s) => sessions.delete(s), send: (s, text) => sends.push([s, text]) };
  const agents = createAgents({ db, config, root: ROOT, owner: 'cam', tmux, counts: store.counts, ...(now ? { now } : {}) });
  const images = createImages(mkdtempSync(join(tmpdir(), 'memo-images-')));
  const files = createFiles(mkdtempSync(join(tmpdir(), 'memo-files-')));
  const videos = createVideos({ dir: mkdtempSync(join(tmpdir(), 'memo-videos-')), ...(now ? { now } : {}), log: () => {} });
  const ticks = createTicks(db);
  const app = createApp({ store, agents, images, files, videos, frames, ticks, ticksOn, system, root: ROOT, token: TOKEN, liaisonToken: LIAISON_TOKEN, owner: 'cam', tailscale, schedulePath, dataDir, calendarUrl, getCalendar, ledgerPage, onDraft, petsDir, ...(now ? { now } : {}), ...(started ? { started } : {}) });
  return { app, db, store, agents, images, files, videos, ticks, sessions, sends, dataDir };
}

export async function call(app, path, body, token = TOKEN) {
  const r = await app.request(path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => null) };
}
