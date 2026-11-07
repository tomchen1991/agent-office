import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectModelSwitches } from '../src/modelSwitch.ts';
import type { ModelSwitchMark, ModelSwitchObservation } from '../src/modelSwitch.ts';

const observation = (patch: Partial<ModelSwitchObservation> = {}): ModelSwitchObservation => ({
  id: '["source","instance"]', identityKey: 'source/instance/e1', model: 'openai-codex / gpt-6', character: 'chatgpt', ...patch,
});
const scan = (previous: Map<string, ModelSwitchMark>, rows: ModelSwitchObservation[], tokens = { value: 0 }) =>
  detectModelSwitches(previous, rows, { at: 1234, nextToken: () => ++tokens.value });

test('model switch detection ignores the first observation and unchanged reports', () => {
  const first = scan(new Map(), [observation()]);
  assert.deepEqual(first.changes, {});
  assert.equal(first.marks.get('["source","instance"]')?.model, 'openai-codex / gpt-6');
  const repeat = scan(first.marks, [observation()]);
  assert.deepEqual(repeat.changes, {});
});

test('a provider/model change on the same instance records the persona transition', () => {
  const previous = scan(new Map(), [observation()]).marks;
  const next = scan(previous, [observation({ model: 'deepseek / deepseek-flash', character: 'deepseek' })]);
  assert.deepEqual(next.changes, { '["source","instance"]': {
    token: 1, fromCharacter: 'chatgpt', toCharacter: 'deepseek', fromModel: 'openai-codex / gpt-6', toModel: 'deepseek / deepseek-flash', at: 1234,
  } });
});

test('a same-provider model change animates without inventing a persona change', () => {
  const previous = scan(new Map(), [observation()]).marks;
  const next = scan(previous, [observation({ model: 'openai-codex / gpt-6-mini' })]);
  assert.equal(next.changes['["source","instance"]']?.fromCharacter, 'chatgpt');
  assert.equal(next.changes['["source","instance"]']?.toCharacter, 'chatgpt');
});

test('epoch replacement, missing model data and absent polls never fabricate a switch', () => {
  const previous = scan(new Map(), [observation()]).marks;
  assert.deepEqual(scan(previous, [observation({ identityKey: 'source/instance/e2', model: 'deepseek / deepseek-flash', character: 'deepseek' })]).changes, {});
  assert.deepEqual(scan(previous, [observation({ model: null })]).changes, {});
  const unknown = scan(previous, [observation({ model: null })]).marks;
  assert.deepEqual(scan(unknown, [observation({ model: 'deepseek / deepseek-flash' })]).changes, {}, 'unknown must not become a switch when a model first appears');
  const absent = scan(previous, []);
  assert.equal(absent.marks.get('["source","instance"]')?.model, 'openai-codex / gpt-6');
  const returned = scan(absent.marks, [observation({ model: 'deepseek / deepseek-flash', character: 'deepseek' })]);
  assert.equal(returned.changes['["source","instance"]']?.toModel, 'deepseek / deepseek-flash');
});

test('model switch cue ships cross-fade and pause rules', () => {
  const css = readFileSync(new URL('../src/live-office.css', import.meta.url), 'utf8');
  for (const name of ['wo-model-materialize', 'wo-model-dissolve', 'wo-model-ring', 'wo-model-scan', 'wo-model-particle']) {
    assert.ok(css.includes(`@keyframes ${name}`), `${name} keyframes`);
  }
  assert.ok(css.includes('[data-live-paused=true] .wo-model-layer'));
  assert.ok(css.includes('animation-play-state:paused'));
});
