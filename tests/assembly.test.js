import assert from 'node:assert/strict';
import test from 'node:test';
import { assemblyOffset } from '../src/assembly.js';
import { loadSampleParts } from './helpers/sample-model.js';

test('export displacement exactly matches the staged shader smoothstep', () => {
  const part = { assembly: { offset: [1, 2, -3], detailOffset: [0.5, -0.4, 0.2] } };
  assert.deepEqual(assemblyOffset(part, -1), [0, 0, 0]);
  assert.deepEqual(assemblyOffset(part, 0.2), [0.2, 0.4, -0.6000000000000001]);
  assert.deepEqual(assemblyOffset(part, 0.3), [0.3, 0.6, -0.8999999999999999]);
  const halfway = assemblyOffset(part, 0.65);
  const expected = [0.9, 1.1, -1.85];
  halfway.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-12));
  assert.deepEqual(assemblyOffset(part, 1), [1.5, 1.6, -2.8]);
  assert.deepEqual(assemblyOffset(part, 2), assemblyOffset(part, 1));
  assert.deepEqual(assemblyOffset({}, 0.8), [0, 0, 0]);
  assert.throws(() => assemblyOffset(part, NaN), /finite/);
  assert.throws(() => assemblyOffset(part, Infinity), /finite/);
});

test('every sample part lifts off, keeps distinct offsets and rests at zero when assembled', async () => {
  const parts = await loadSampleParts();
  const offsets = new Set();
  for (const part of parts) {
    assert.deepEqual(assemblyOffset(part, 0), [0, 0, 0], part.name);
    const full = assemblyOffset(part, 1);
    assert.ok(Math.hypot(...full) > 0.5, `${part.name} moves visibly`);
    const key = full.join(',');
    assert.ok(!offsets.has(key), `${part.name} has its own offset`);
    offsets.add(key);
  }
});
