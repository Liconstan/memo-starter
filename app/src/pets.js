// The pictures of the pets (memo 1242): the owner may put a photo or a drawing of a pet in the pets folder,
// ~/memo-pets/ by default (README.md, "Pictures of the pets"). A file <agent>.png is the plain picture,
// and <agent>-<feeling>.png is the picture for one feeling (ui/pets.js FEELINGS). The types are in TYPES: an animated
// picture as .webp or .gif, a still one as .png, .jpg or .jpeg. The pages then show the picture in the place of the
// drawing; without a file, the pet is drawn in code. The server reads the folder at most once in LIST_MS, so a new
// file shows within a few seconds and the Inbox polls cost no file reads.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FEELINGS } from '../ui/pets.js';

export const PET_ROUTE = '/ui/pet/:agent/:feeling';
export const LIST_MS = 10000;
// The name of an agent, as agents.json allows it (src/agents.js loadConfig). A name of a different form never
// reaches a path, so the route cannot leave the folder.
const NAME = /^[a-z][a-z0-9-]{0,40}$/;
// The accepted types, by extension, in the order of preference: when one stem has several files (main.webp and
// main.png), the first type of this list is the picture, so an animated file goes before a still one. A .webp or a
// .gif counts as animated by its type alone; the server does not look for frames in the file.
export const TYPES = { webp: 'image/webp', gif: 'image/gif', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
export const ANIMATED = ['webp', 'gif'];
const ORDER = Object.keys(TYPES);
const FILE = new RegExp(`^([a-z][a-z0-9-]{0,40}?)(?:-(${FEELINGS.join('|')}))?\\.(${ORDER.join('|')})$`, 'i');
const extOf = (file) => (/\.([^.]+)$/.exec(file)?.[1] || '').toLowerCase();
export const isAnimated = (file) => ANIMATED.includes(extOf(String(file)));
export const defaultPetsDir = () => join(homedir(), 'memo-pets');

export function createPetArt({ dir = defaultPetsDir(), now = () => new Date() } = {}) {
  let listed = -Infinity;
  let files = new Map(); // "<agent>" or "<agent>-<feeling>" -> { file: the picture, still: the first still file or null }

  // The files of the folder with a name of the accepted form, by their stem. A missing folder gives none. The files
  // of one stem are put in the order of TYPES (then by name), so the choice does not depend on the order of the folder.
  function list() {
    const t = now().getTime();
    if (t - listed < LIST_MS) return files;
    listed = t;
    const byStem = new Map();
    let names = [];
    try { names = existsSync(dir) ? readdirSync(dir) : []; } catch { names = []; }
    for (const file of names) {
      const m = FILE.exec(file);
      if (!m) continue;
      const stem = m[2] ? `${m[1]}-${m[2].toLowerCase()}` : m[1];
      byStem.set(stem, [...(byStem.get(stem) || []), file]);
    }
    const next = new Map();
    for (const [stem, group] of byStem) {
      group.sort((a, b) => ORDER.indexOf(extOf(a)) - ORDER.indexOf(extOf(b)) || (a < b ? -1 : 1));
      next.set(stem, { file: group[0], still: group.find((f) => !isAnimated(f)) || null });
    }
    files = next;
    return files;
  }

  // The stem that gives the picture of an agent for a feeling ("any" for the plain one): the stem of the feeling when
  // it has a file, else the plain stem, else null.
  const stemOf = (have, name, feeling) => (feeling !== 'any' && have.has(`${name}-${feeling}`) ? `${name}-${feeling}` : have.has(name) ? name : null);

  // What the folder has for an agent, for GET /api/agents, or null when the folder has nothing for the agent:
  // - any: true when the plain picture is there; feelings: the feelings with a file of their own.
  // - animated: of "any" and those feelings, the ones whose picture is animated (a .webp or a .gif). The pages add no
  //   movement of their own to these.
  // - still: of the animated ones, those with a still file of the same stem too (a .png or a .jpg), which the route
  //   gives with ?still=1 for a reader who asked for reduced motion.
  function of(name) {
    if (!NAME.test(String(name))) return null;
    const have = list();
    const feelings = FEELINGS.filter((f) => have.has(`${name}-${f}`));
    const any = have.has(name);
    if (!any && !feelings.length) return null;
    const entries = [...(any ? [['any', have.get(name)]] : []), ...feelings.map((f) => [f, have.get(`${name}-${f}`)])];
    const animated = entries.filter(([, entry]) => isAnimated(entry.file));
    return { any, feelings, animated: animated.map(([key]) => key), still: animated.filter(([, entry]) => entry.still).map(([key]) => key) };
  }

  // The bytes and the type of the picture of an agent for a feeling ("any" for the plain one): the file of the
  // feeling, else the plain file; null when neither is there or a name is not of the accepted form. still: true asks
  // for the still file of the same stem, and gives the picture itself when the stem has no still file.
  function file(name, feeling, { still = false } = {}) {
    if (!NAME.test(String(name)) || !(feeling === 'any' || FEELINGS.includes(feeling))) return null;
    const have = list();
    const entry = have.get(stemOf(have, name, feeling));
    if (!entry) return null;
    const chosen = (still && entry.still) || entry.file;
    try { return { bytes: readFileSync(join(dir, chosen)), type: TYPES[extOf(chosen)], animated: isAnimated(chosen) }; } catch { return null; }
  }

  return { of, file, list, dir };
}
