// Bad camera and mesh-volume input fails with a message that names the field (issues 2446, 2447, 2448).
import test from 'node:test';
import assert from 'node:assert/strict';
import { previousViewProjectionOf } from '../src/camera-effects.js';
import { assertClosedMesh, bindLocalVolumeParts } from '../src/local-volume-parts.js';

const renderer = { canvas: { width: 100, height: 50 }, world: false };
const frame = { eye: [0, 1, 5], target: [0, 1, 0] };

const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
const indices = new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
const meshVolume = [{ shape: 'mesh', part: 'room', fit: 'bounds' }];

test('previousViewProjectionOf refuses a previous camera it cannot aim', () => {
  assert.throws(() => previousViewProjectionOf(renderer, { ...frame, previousCamera: { eye: [Number.NaN, 0, 0] } }), /previousCamera camera eye, target and up must be three finite numbers/);
  assert.throws(() => previousViewProjectionOf(renderer, { ...frame, previousCamera: { eye: [0, 1, 0] } }), /previousCamera eye and target must differ/);
  assert.throws(() => previousViewProjectionOf(renderer, { ...frame, previousCamera: { up: [0, 0, 1] } }), /previousCamera up must not be parallel/);
});

test('previousViewProjectionOf still builds a finite matrix for a partial previous camera', () => {
  const matrix = previousViewProjectionOf(renderer, { ...frame, previousCamera: { eye: [1, 1, 5] } });
  assert.ok(Array.from(matrix).every(Number.isFinite));
});

test('a mesh volume part needs a matrix of 16 finite numbers', () => {
  const bind = matrix => bindLocalVolumeParts(meshVolume, [{ name: 'room', geometry: { positions, indices }, matrix }]);
  assert.throws(() => bind([Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), /part "room" needs a matrix of 16 finite numbers/);
  assert.throws(() => bind([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, Number.NaN, 0, 0, 1]), /16 finite numbers/);
  assert.throws(() => bind([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), /got 11 values/);
  assert.deepEqual(bind([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1])[0].center, [2.5, 0.5, 0.5]);
});

test('assertClosedMesh names a bad index list instead of reporting open edges', () => {
  const check = list => assertClosedMesh({ name: 'room', geometry: { positions, indices: list } }, 'localVolumes[0]');
  check(indices);
  const outOfRange = indices.slice();
  outOfRange[5] = 99;
  assert.throws(() => check(outOfRange), /index 5 is 99, but the part has 8 vertices/);
  assert.throws(() => check(new Uint32Array([...indices, 0, 1])), /38 indices; a triangle list needs a multiple of 3/);
});
