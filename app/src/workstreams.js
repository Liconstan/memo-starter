import { readFileSync } from 'node:fs';

// The workstreams: the codes that a memo can carry (memo send --ws OPS). A memo with a code has a number in that
// code, which starts at 1 for each code: OPS-1, OPS-2, then REL-1. The codes are in workstreams.json, an object of
// code to description. The file in local/ is the real one; the file in the repository is an example (src/paths.js).
// A code is 2 to 8 capital letters or digits, and starts with a letter.
export const WS_CODE = /^[A-Z][A-Z0-9]{1,7}$/;
// A memo code in a text or an argument: OPS-14. Case does not matter in an argument (memo close ops-14).
const FULL_CODE = /^([A-Za-z][A-Za-z0-9]{1,7})-(\d{1,7})$/;

// { ws: 'OPS', n: 14 } for "OPS-14" (any case), or null when the value is not a memo code.
export function parseCode(v) {
  const m = typeof v === 'string' ? v.trim().match(FULL_CODE) : null;
  if (!m) return null;
  return { ws: m[1].toUpperCase(), n: Number(m[2]) };
}

// The code of a memo row: "OPS-14", or null for a memo with no code.
export const codeOf = (row) => (row?.ws ? `${row.ws}-${row.ws_n}` : null);

// Reads workstreams.json. Gives { OPS: 'Operations: ...', ... } with the codes in the order of the file.
export function loadWorkstreams(path) {
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch (err) {
    throw new Error(`workstreams.json cannot be read: ${err.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('workstreams.json must be an object of code to description, for example {"OPS": "Operations"}.');
  const out = {};
  for (const [code, about] of Object.entries(data)) {
    if (!WS_CODE.test(code)) throw new Error(`workstreams.json: the code "${code}" must be 2 to 8 capital letters or digits, starting with a letter.`);
    if (typeof about !== 'string') throw new Error(`workstreams.json: the description of ${code} must be text.`);
    out[code] = about;
  }
  return out;
}
