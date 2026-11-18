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

test('every sample part but the base lifts off, keeps distinct offsets and rests at zero when assembled', async () => {
  const parts = await loadSampleParts();
  const offsets = new Set();
  for (const part of parts) {
    assert.deepEqual(assemblyOffset(part, 0), [0, 0, 0], part.name);
    const full = assemblyOffset(part, 1);
    if (part.name === 'Base') assert.deepEqual(full, [0, 0, 0], 'the base stays on the floor as the anchor');
    else assert.ok(Math.hypot(...full) > 0.5, `${part.name} moves visibly`);
    const key = full.join(',');
    assert.ok(!offsets.has(key), `${part.name} has its own offset`);
    offsets.add(key);
  }
});

test('the fully exploded sample keeps every part above the floor and the parts stacked in assembly order up the stand', async () => {
  const parts = await loadSampleParts();
  const exploded = new Map(parts.map(part => {
    const offset = assemblyOffset(part, 1);
    const heights = [];
    const positions = part.geometry.positions;
    for (let index = 0; index < positions.length; index += 3) {
      const [x, y, z] = [positions[index], positions[index + 1], positions[index + 2]];
      heights.push(part.matrix[1] * x + part.matrix[5] * y + part.matrix[9] * z + part.matrix[13] + offset[1]);
    }
    return [part.name, { lowest: Math.min(...heights), center: (Math.min(...heights) + Math.max(...heights)) / 2 }];
  }));
  for (const [name, { lowest }] of exploded) assert.ok(lowest >= -1e-6, `${name} stays above the floor when exploded (lowest ${lowest.toFixed(2)})`);
  const spine = ['Base', 'Limb and rack', 'Objective turret', 'Eyepiece tube'].map(name => exploded.get(name).center);
  assert.deepEqual([...spine].sort((first, second) => first - second), spine, 'the central parts rise in assembly order');
});
