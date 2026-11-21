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

/** The gap between two boxes: the largest separation along any axis, so a positive value means they do not touch. */
function boxClearance(first, second) {
  return Math.max(...[0, 1, 2].map(axis => Math.max(first.minimum[axis] - second.maximum[axis], second.minimum[axis] - first.maximum[axis])));
}

function partNamed(name) {
  return parts.find(part => part.name === name);
}

const OBJECTIVE_NAMES = ['Objective left', 'Objective centre', 'Objective right'];

test('the sample model has fourteen named parts in both layers, each with a section and an offset', () => {
  assert.equal(parts.length, 14);
  assert.deepEqual(parts.map(part => part.name).sort(), [...SAMPLE_PART_NAMES].sort());
  for (const part of parts) {
    assert.ok(['exterior', 'interior'].includes(part.assembly.layer), part.name);
    assert.ok(part.assembly.section.length > 3, part.name);
    assert.equal(part.assembly.offset.length, 3);
    assert.ok(part.assembly.offset.every(Number.isFinite));
    assert.ok(part.matrix instanceof Float32Array && Array.from(part.matrix).every(Number.isFinite));
    assert.ok(part.geometry.indices.length > 0 && part.geometry.indices.length % 3 === 0);
  }
  assert.equal(parts.filter(part => part.assembly.layer === 'exterior').length, 9);
  assert.equal(parts.filter(part => part.assembly.layer === 'interior').length, 5);
  assert.equal(new Set(parts.map(part => part.assembly.section)).size, 6);
});

test('the sample model stands about 3.7 tall on the ground, and its exploded pose stays above the floor in the studio frame', () => {
  const assembled = worldBounds(parts, 0);
  assert.ok(assembled.minimum[1] >= -0.01 && assembled.minimum[1] < 0.05, `base sits on the ground: ${assembled.minimum[1]}`);
  assert.ok(assembled.maximum[1] > 3.4 && assembled.maximum[1] < 3.8, `height ${assembled.maximum[1]}`);
  const exploded = worldBounds(parts, 1);
  assert.ok(exploded.minimum[1] >= -0.01 && exploded.maximum[1] < 7, `exploded height ${exploded.minimum[1]} to ${exploded.maximum[1]}`);
  assert.ok([0, 2].every(axis => exploded.maximum[axis] < 3.5 && exploded.minimum[axis] > -3.5), 'exploded width and depth stay within 3.5 of the axis');
});

test('the sample model snapshot stays stable', () => {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(JSON.stringify({ name: part.name, matrix: Array.from(part.matrix), assembly: part.assembly, color: part.material.color }));
    for (const field of [part.geometry.positions, part.geometry.normals, part.geometry.indices, part.geometry.uvs ?? new Float32Array(0)]) {
      hash.update(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
    }
  }
  assert.equal(hash.digest('hex'), '9aa8f63b2ef659f39f8602cb2dcafd4471d88c6b0a48d431453029218997503b');
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
  assert.ok(size < 450 * 1024, `sample-model.glb is ${size} bytes`);
  const redirects = await readFile(new URL('../public/_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/wall-e\.glb \/sample-model\.glb 301$/m);
});

test('every part carries the shared lacquered PBR material with its four textures and one UV pair per vertex', () => {
  for (const part of parts) {
    const { material, geometry } = part;
    for (const field of ['map', 'normalMap', 'metallicRoughnessMap', 'occlusionMap']) assert.ok(material[field], `${part.name} has ${field}`);
    assert.ok(material.clearcoat > 0, `${part.name} keeps the clearcoat of the source`);
    assert.equal(geometry.uvs.length, (geometry.positions.length / 3) * 2, `${part.name} has one UV pair per vertex`);
    assert.ok(Array.from(geometry.uvs).every(value => Number.isFinite(value) && value >= 0 && value <= 1), `${part.name} UVs stay inside the atlas`);
    for (let vertex = 0; vertex < geometry.normals.length; vertex += 3) {
      const length = Math.hypot(geometry.normals[vertex], geometry.normals[vertex + 1], geometry.normals[vertex + 2]);
      assert.ok(Math.abs(length - 1) < 0.02, `${part.name} normal ${vertex / 3} has length ${length}`);
    }
  }
});

test('the parts add up to the source model: 11,643 triangles, none lost or doubled', () => {
  const triangles = parts.reduce((sum, part) => sum + part.geometry.indices.length / 3, 0);
  assert.equal(triangles, 11643);
});

test('the exploded view keeps the parts as a set: every part stays within 3 of its assembled spot and no two parts overlap', () => {
  const boxes = parts.map(part => ({ name: part.name, ...worldBounds([part], 1), assembled: worldBounds([part], 0) }));
  for (const box of boxes) {
    const shift = [0, 1, 2].map(axis => Math.abs((box.minimum[axis] + box.maximum[axis]) / 2 - (box.assembled.minimum[axis] + box.assembled.maximum[axis]) / 2));
    assert.ok(Math.hypot(...shift) < 3, `${box.name} moved ${Math.hypot(...shift).toFixed(2)}`);
  }
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      const overlapping = [0, 1, 2].every(axis => boxes[first].minimum[axis] < boxes[second].maximum[axis] && boxes[second].minimum[axis] < boxes[first].maximum[axis]);
      assert.ok(!overlapping, `${boxes[first].name} and ${boxes[second].name} overlap when exploded`);
    }
  }
});

test('every exploded part clears every other part by at least 0.08, so a gap shows between them', () => {
  for (let first = 0; first < parts.length; first++) {
    for (let second = first + 1; second < parts.length; second++) {
      const clearance = boxClearance(worldBounds([parts[first]], 1), worldBounds([parts[second]], 1));
      assert.ok(clearance > 0.08, `${parts[first].name} and ${parts[second].name} are ${clearance.toFixed(2)} apart`);
    }
  }
});

test('the exploded focus knobs stand either side of the arm, level with each other and mirrored', () => {
  const left = worldBounds([partNamed('Focus knob left')], 1);
  const right = worldBounds([partNamed('Focus knob right')], 1);
  const arm = worldBounds([partNamed('Arm and head')], 1);
  const leftGap = arm.minimum[0] - left.maximum[0];
  const rightGap = right.minimum[0] - arm.maximum[0];
  assert.ok(leftGap > 0 && leftGap < 0.6, `the left knob sits ${leftGap.toFixed(2)} from the arm`);
  assert.ok(Math.abs(leftGap - rightGap) < 0.05, `the knobs sit ${leftGap.toFixed(2)} and ${rightGap.toFixed(2)} from the arm`);
  assert.ok(Math.abs(left.minimum[1] - right.minimum[1]) < 0.01, 'the knobs are level');
});

test('the three objectives hang in a row under the nosepiece, each clear of the others and of the nosepiece', () => {
  const barrels = OBJECTIVE_NAMES.map(name => ({ name, ...worldBounds([partNamed(name)], 1) }));
  for (let index = 1; index < barrels.length; index++) {
    assert.ok(barrels[index].minimum[0] - barrels[index - 1].maximum[0] > 0.15, `${barrels[index].name} stands clear of ${barrels[index - 1].name}`);
  }
  const nosepiece = worldBounds([partNamed('Nosepiece')], 1);
  for (const barrel of barrels) {
    assert.ok(barrel.maximum[1] < nosepiece.minimum[1], `${barrel.name} hangs below the nosepiece`);
    assert.ok(boxClearance(barrel, nosepiece) > 0.1, `${barrel.name} hangs clear of the nosepiece`);
  }
});
