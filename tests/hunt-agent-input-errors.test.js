import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentBake } from '../src/agent-bake.js';
import { normalizeMapSequence } from '../src/agent-texture-sequence.js';
import { BAKE_RANGES } from '../src/agent-scene-capabilities.js';

test('a fractional bake count is refused with an example inside its own range', () => {
  for (const [field, value] of [['bounces', 2.5], ['samples', 63.5]]) {
    assert.throws(() => normalizeAgentBake({ [field]: value }), error => {
      const example = Number(/such as (\d+)/.exec(error.message)?.[1]);
      const [minimum, maximum] = BAKE_RANGES[field];
      return error.message.includes(`bake.${field}`) && example >= minimum && example <= maximum && Number.isInteger(example);
    }, field);
  }
});

test('a texture sequence frame list with holes is refused at the missing frame', () => {
  const sparse = new Array(3);
  sparse[0] = 'a'.repeat(64);
  assert.throws(() => normalizeMapSequence({ sequence: { frames: sparse, fps: 12 } }), /map\.sequence\.frames\[1\]/);
});
