import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assembleSampleModel, loadSampleModel, SAMPLE_PART_NAMES } from '../src/model.js';
import { assemblyOffset } from '../src/assembly.js';
import { loadSampleParts } from './helpers/sample-model.js';

const parts = await loadSampleParts();

function worldBounds(list, amount) {
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const part of list) {
    const displacement = assemblyOffset(part, amount);
    const { positions } = part.geometry;
    for (let vertex = 0; vertex < positions.length; vertex += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const world = part.matrix[axis] * positions[vertex] + part.matrix[axis + 4] * positions[vertex + 1] + part.matrix[axis + 8] * positions[vertex + 2] + part.matrix[axis + 12] + displacement[axis];
        minimum[axis] = Math.min(minimum[axis], world);
        maximum[axis] = Math.max(maximum[axis], world);
      }
    }
  }
  return { minimum, maximum };
}

test('the sample model has nine named parts in both layers, each with a section and an offset', () => {
  assert.equal(parts.length, 9);
  assert.deepEqual(parts.map(part => part.name).sort(), [...SAMPLE_PART_NAMES].sort());
  for (const part of parts) {
    assert.ok(['exterior', 'interior'].includes(part.assembly.layer), part.name);
    assert.ok(part.assembly.section.length > 3, part.name);
    assert.equal(part.assembly.offset.length, 3);
    assert.ok(part.assembly.offset.every(Number.isFinite));
    assert.ok(part.matrix instanceof Float32Array && Array.from(part.matrix).every(Number.isFinite));
    assert.ok(part.geometry.indices.length > 0 && part.geometry.indices.length % 3 === 0);
  }
  assert.equal(parts.filter(part => part.assembly.layer === 'exterior').length, 5);
  assert.equal(parts.filter(part => part.assembly.layer === 'interior').length, 4);
  assert.equal(new Set(parts.map(part => part.assembly.section)).size, 4);
});

test('the sample model stands about 3.6 tall on the ground, and its exploded pose stays above the floor in the studio frame', () => {
  const assembled = worldBounds(parts, 0);
  assert.ok(assembled.minimum[1] >= -0.01 && assembled.minimum[1] < 0.05, `base sits on the ground: ${assembled.minimum[1]}`);
  assert.ok(assembled.maximum[1] > 3.4 && assembled.maximum[1] < 3.8, `height ${assembled.maximum[1]}`);
  const exploded = worldBounds(parts, 1);
  assert.ok(exploded.minimum[1] >= -0.01 && exploded.maximum[1] < 7, `exploded height ${exploded.minimum[1]} to ${exploded.maximum[1]}`);
  assert.ok([0, 2].every(axis => exploded.maximum[axis] < 3 && exploded.minimum[axis] > -3), "exploded width and depth stay within 3 of the axis");
});

test('the sample model snapshot stays stable', () => {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(JSON.stringify({ name: part.name, matrix: Array.from(part.matrix), assembly: part.assembly, color: part.material.color }));
    for (const field of [part.geometry.positions, part.geometry.normals, part.geometry.indices]) {
      hash.update(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
    }
  }
  assert.equal(hash.digest('hex'), '85f67e319faad58d4a720e31a477180dffac16a87be7bbaabcc02f957a5b3c87');
});

test('an unknown part or an empty list is refused with the fix', () => {
  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  assert.throws(() => assembleSampleModel([{ name: 'wheel', matrix: identity }]), /Sample model part "wheel" has no assembly entry.*sample-model\.glb/);
  assert.throws(() => assembleSampleModel([{ name: 'constructor', matrix: identity }]), /no assembly entry/);
  assert.throws(() => assembleSampleModel([]), /expects the parts array/);
  assert.throws(() => assembleSampleModel(undefined), /expects the parts array/);
});

test('loadSampleModel asks for a source', async () => {
  await assert.rejects(() => loadSampleModel(), /URL, File or Blob/);
});

test('the sample GLB stays small and the old wall-e URL still has a redirect for one release', async () => {
  const { size } = await import('node:fs').then(fs => fs.promises.stat(new URL('../public/sample-model.glb', import.meta.url)));
  assert.ok(size < 700 * 1024, `sample-model.glb is ${size} bytes`);
  const redirects = await readFile(new URL('../public/_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/wall-e\.glb \/sample-model\.glb 301$/m);
});
