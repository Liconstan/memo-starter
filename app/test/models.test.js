import test from 'node:test';
import assert from 'node:assert/strict';
import { modelName, modelVersioned, VERSION_WORD, FAMILY_WORD } from '../src/models.js';

test('modelName gives the short name with the version from a full id or a name with a version (memo 1159)', () => {
  assert.equal(modelName('claude-fable-5-1'), 'Fable 5.1');
  assert.equal(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelName('claude-haiku-5-5'), 'Haiku 5.5');
  assert.equal(modelName('claude-opus-4-1-20250805'), 'Opus 4.1', 'a date suffix is dropped');
  assert.equal(modelName('claude-sonnet-4-20250514'), 'Sonnet 4', 'a date suffix is never the minor number');
  assert.equal(modelName('claude-3-5-sonnet-20241022'), 'Sonnet 3.5', 'the older ids, version first');
  assert.equal(modelName('fable 5.1'), 'Fable 5.1');
  assert.equal(modelName('Fable 5.1'), 'Fable 5.1');
  assert.equal(modelName('FABLE  5.1 '), 'Fable 5.1', 'any case, extra spaces');
  assert.equal(modelName('fable-5.1'), 'Fable 5.1');
  assert.equal(modelName('fable5.1'), 'Fable 5.1');
  assert.equal(modelName('fable@5.1'), 'Fable 5.1');
  assert.equal(modelName('opus 5'), 'Opus 5', 'a major number alone');
});

test('modelName keeps a bare alias and any other text as given, on one line', () => {
  assert.equal(modelName('fable'), 'fable');
  assert.equal(modelName('opus'), 'opus');
  assert.equal(modelName('m'), 'm');
  assert.equal(modelName('gpt-5'), 'gpt-5', 'not a Claude model');
  assert.equal(modelName('claude-opus-5-5[1m]'), 'claude-opus-5-5[1m]', 'a form the parser does not know stays');
  assert.equal(modelName(' fable\n  mini '), 'fable mini');
  assert.equal(modelName(''), '');
  assert.equal(modelName(undefined), '');
});

test('modelVersioned tells a model with a version from a bare alias', () => {
  assert.equal(modelVersioned('claude-fable-5-1'), true);
  assert.equal(modelVersioned('fable 5.1'), true);
  assert.equal(modelVersioned('Fable 5.1'), true);
  assert.equal(modelVersioned('fable'), false);
  assert.equal(modelVersioned('m'), false);
});

test('the words of the command line: a version on its own and a model family', () => {
  for (const w of ['5', '5.1', '10.12']) assert.equal(VERSION_WORD.test(w), true, w);
  for (const w of ['5.1.2', 'v5', '5.', '123', 'sync']) assert.equal(VERSION_WORD.test(w), false, w);
  for (const w of ['fable', 'Opus', 'claude-sonnet', 'claude haiku']) assert.equal(FAMILY_WORD.test(w), true, w);
  for (const w of ['sync', 'fable-5-1', 'gpt']) assert.equal(FAMILY_WORD.test(w), false, w);
});
