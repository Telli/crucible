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

test('the sample model has fifteen named parts in both layers, each with a section and an offset', () => {
  assert.equal(parts.length, 15);
  assert.deepEqual(parts.map(part => part.name).sort(), [...SAMPLE_PART_NAMES].sort());
  for (const part of parts) {
    assert.ok(['exterior', 'interior'].includes(part.assembly.layer), part.name);
    assert.ok(part.assembly.section.length > 3, part.name);
    assert.equal(part.assembly.offset.length, 3);
    assert.ok(part.assembly.offset.every(Number.isFinite));
    assert.ok(part.matrix instanceof Float32Array && Array.from(part.matrix).every(Number.isFinite));
    assert.ok(part.geometry.indices.length > 0 && part.geometry.indices.length % 3 === 0);
  }
  assert.equal(parts.filter(part => part.assembly.layer === 'exterior').length, 8);
  assert.equal(parts.filter(part => part.assembly.layer === 'interior').length, 7);
  assert.equal(new Set(parts.map(part => part.assembly.section)).size, 6);
});

test('the sample model stands about 3.7 tall on the ground, and its exploded pose stays above the floor in the studio frame', () => {
  const assembled = worldBounds(parts, 0);
  assert.ok(assembled.minimum[1] >= -0.01 && assembled.minimum[1] < 0.05, `base sits on the ground: ${assembled.minimum[1]}`);
  assert.ok(assembled.maximum[1] > 3.4 && assembled.maximum[1] < 3.8, `height ${assembled.maximum[1]}`);
  const exploded = worldBounds(parts, 1);
  assert.ok(exploded.minimum[1] >= -0.01 && exploded.maximum[1] < 7, `exploded height ${exploded.minimum[1]} to ${exploded.maximum[1]}`);
  assert.ok([0, 2].every(axis => exploded.maximum[axis] < 3.5 && exploded.minimum[axis] > -3.5), "exploded width and depth stay within 3.5 of the axis");
});

test('the sample model snapshot stays stable', () => {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(JSON.stringify({ name: part.name, matrix: Array.from(part.matrix), assembly: part.assembly, color: part.material.color }));
    for (const field of [part.geometry.positions, part.geometry.normals, part.geometry.indices, part.geometry.uvs ?? new Float32Array(0)]) {
      hash.update(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
    }
  }
  assert.equal(hash.digest('hex'), '775ddd77085ed466eba186e6d1907c4812a92c5c373c5980d04e0363c51da186');
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

function partNamed(name) {
  return parts.find(part => part.name === name);
}

test('the enamel body, metal parts, rubber knobs, stage scale and objective labels are textured with UVs on every vertex', () => {
  const enamelNames = ['Base and arm', 'Head', 'Prism housing'];
  for (const name of enamelNames) {
    const { material } = partNamed(name);
    assert.ok(material.metallicRoughnessMap, `${name} has a roughness grain`);
    assert.ok(material.color[0] > 0.7 && material.color[0] > material.color[2] + 0.15, `${name} is warm beige-white: ${material.color}`);
    assert.ok(material.metallic === 0, `${name} is paint, not metal`);
  }
  for (const name of ['Objectives', 'Nosepiece', 'Stage clips', 'Rack post']) {
    assert.ok(partNamed(name).material.metallic >= 0.9, `${name} is metal`);
  }
  assert.ok(partNamed('Focus knobs').material.normalMap, 'the focus knobs carry a knurl normal map');
  assert.ok(partNamed('Objectives').material.map, 'the objectives carry the label atlas');
  assert.ok(partNamed('Stage').material.map, 'the stage carries the scale');
  for (const name of ['Base and arm', 'Head', 'Focus knobs', 'Objectives', 'Stage', 'Nosepiece']) {
    const { geometry } = partNamed(name);
    assert.equal(geometry.uvs.length, (geometry.positions.length / 3) * 2, `${name} has one UV pair per vertex`);
    assert.ok(Array.from(geometry.uvs).every(Number.isFinite));
  }
});

/** The shortest span the three u values can have on a circle of the given period, found by trying each as the lowest. */
function shortestCircularSpan(us, period) {
  return Math.min(...us.map(lowest => {
    const arranged = us.map(value => (value < lowest ? value + period : value));
    return Math.max(...arranged) - Math.min(...arranged);
  }));
}

test('no triangle of a wrapped part stretches its texture across a seam it could have avoided', () => {
  for (const [name, period] of [['Objectives', 1], ['Focus knobs', 9]]) {
    const { geometry } = partNamed(name);
    for (let corner = 0; corner < geometry.indices.length; corner += 3) {
      const us = [0, 1, 2].map(offset => geometry.uvs[geometry.indices[corner + offset] * 2]);
      const span = Math.max(...us) - Math.min(...us);
      assert.ok(span <= shortestCircularSpan(us, period) + 1e-6, `${name} triangle ${corner / 3} spans u ${us}`);
    }
  }
});

test('the four objectives carry their own label row and the stage keeps the scale off its sides', () => {
  const { geometry } = partNamed('Objectives');
  const rowsUsed = new Set();
  for (let vertex = 0; vertex < geometry.uvs.length; vertex += 2) rowsUsed.add(Math.floor(geometry.uvs[vertex + 1] * 4));
  assert.deepEqual([...rowsUsed].sort(), [0, 1, 2, 3]);
  const stage = partNamed('Stage').geometry;
  for (let vertex = 0; vertex < stage.positions.length / 3; vertex++) {
    if (stage.normals[vertex * 3 + 1] < 0.7) assert.deepEqual([stage.uvs[vertex * 2], stage.uvs[vertex * 2 + 1]].map(value => Math.round(value * 100) / 100), [0.5, 0.35]);
  }
});

test('the exploded view keeps the parts as a set: every part stays within 2.8 of its assembled spot and no two parts overlap', () => {
  const boxes = parts.map(part => ({ name: part.name, ...worldBounds([part], 1), assembled: worldBounds([part], 0) }));
  for (const box of boxes) {
    const shift = [0, 1, 2].map(axis => Math.abs((box.minimum[axis] + box.maximum[axis]) / 2 - (box.assembled.minimum[axis] + box.assembled.maximum[axis]) / 2));
    assert.ok(Math.hypot(...shift) < 2.8, `${box.name} moved ${Math.hypot(...shift).toFixed(2)}`);
  }
  for (let first = 0; first < boxes.length; first++) {
    for (let second = first + 1; second < boxes.length; second++) {
      const overlapping = [0, 1, 2].every(axis => boxes[first].minimum[axis] < boxes[second].maximum[axis] && boxes[second].minimum[axis] < boxes[first].maximum[axis]);
      assert.ok(!overlapping, `${boxes[first].name} and ${boxes[second].name} overlap when exploded`);
    }
  }
});
