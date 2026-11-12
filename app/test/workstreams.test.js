import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadWorkstreams, parseCode, codeOf } from '../src/workstreams.js';
import { ROOT } from './helpers.js';

test('the example workstreams.json loads with its codes in order', () => {
  const ws = loadWorkstreams(join(ROOT, 'workstreams.json'));
  assert.deepEqual(Object.keys(ws), ['REL', 'SPEC', 'FUND', 'OPS', 'PROG', 'COMM', 'SYS', 'ME']);
  assert.match(ws.OPS, /^Operations/);
  assert.ok(!('GEN' in ws), 'GEN is retired: no new memo gets it');
});

test('workstreams.json must be an object of valid codes to text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memo-ws-'));
  const file = (name, text) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  assert.throws(() => loadWorkstreams(join(dir, 'none.json')), /cannot be read/);
  assert.throws(() => loadWorkstreams(file('a.json', '[1]')), /object of code to description/);
  assert.throws(() => loadWorkstreams(file('b.json', '{"ops": "x"}')), /"ops" must be 2 to 8 capital letters/);
  assert.throws(() => loadWorkstreams(file('c.json', '{"O": "x"}')), /"O" must be/);
  assert.throws(() => loadWorkstreams(file('d.json', '{"TOOLONGCODE": "x"}')), /"TOOLONGCODE" must be/);
  assert.throws(() => loadWorkstreams(file('e.json', '{"OPS": 1}')), /description of OPS must be text/);
  assert.deepEqual(loadWorkstreams(file('f.json', '{"OPS": "Operations", "A1": ""}')), { OPS: 'Operations', A1: '' });
});

test('parseCode reads a memo code in any case, and nothing else', () => {
  assert.deepEqual(parseCode('OPS-14'), { ws: 'OPS', n: 14 });
  assert.deepEqual(parseCode(' ops-14 '), { ws: 'OPS', n: 14 });
  assert.deepEqual(parseCode('A1-007'), { ws: 'A1', n: 7 });
  for (const v of ['906', 906, 'OPS', 'OPS-', '-14', 'OPS-14-2', '1OPS-14', 'O-14', 'TOOLONGCODE-1', '', null, undefined]) {
    assert.equal(parseCode(v), null, String(v));
  }
});

test('codeOf gives the code of a row, or null', () => {
  assert.equal(codeOf({ ws: 'OPS', ws_n: 14 }), 'OPS-14');
  assert.equal(codeOf({ ws: null, ws_n: null }), null);
  assert.equal(codeOf({}), null);
});
