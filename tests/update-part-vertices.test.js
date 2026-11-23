import assert from 'node:assert/strict';
import test from 'node:test';
import { CrucibleRenderer } from '../src/renderer.js';
import { updatePartVertices } from '../src/update-part-vertices.js';
import { worldBounds } from '../src/probe-trace.js';
import { geometryBoundingSphere } from '../src/render-culling.js';

/** A WebGL2 stand-in that records buffer writes, with one rigid part already uploaded. */
function fakeRenderer() {
  const calls = [];
  const geometry = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
  };
  const part = { name: 'sheet', geometry, material: { tag: 'standard' } };
  const context = {
    ARRAY_BUFFER: 34962,
    bindBuffer: (target, buffer) => calls.push(['bindBuffer', buffer]),
    bufferSubData: (target, offset, data) => calls.push(['bufferSubData', offset, Array.from(data)]),
    bufferData: () => calls.push(['bufferData']),
    createVertexArray: () => calls.push(['createVertexArray']),
  };
  const renderer = Object.create(CrucibleRenderer.prototype);
  renderer.context = context;
  renderer.shadowsDirty = false;
  const batch = { parts: [part], bounds: { center: [0.5, 0.5, 0], radius: 1 } };
  renderer.partLocations = new Map([[part, { batch, geometry }]]);
  renderer.geometryBuffers = new Map([[geometry, new Map([['positions', 'positionBuffer'], ['normals', 'normalBuffer']])]]);
  return { renderer, part, geometry, batch, calls };
}

test('updatePartVertices rewrites the drawn buffers without a new batch or geometry', () => {
  const { renderer, part, geometry, batch, calls } = fakeRenderer();
  const batchesBefore = batch;
  const positions = new Float32Array([0, 0, 5, 1, 0, 5, 0, 1, 5]);
  const normals = new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]);
  updatePartVertices(renderer, part, positions, normals);
  assert.deepEqual(calls, [
    ['bindBuffer', 'positionBuffer'], ['bufferSubData', 0, Array.from(positions)],
    ['bindBuffer', 'normalBuffer'], ['bufferSubData', 0, Array.from(normals)],
  ]);
  assert.equal(renderer.partLocations.get(part).batch, batchesBefore, 'the batch is the same one');
  assert.equal(renderer.partLocations.get(part).geometry, geometry, 'the geometry object is the same one');
  assert.deepEqual(Array.from(geometry.positions), Array.from(positions), 'the geometry holds the new truth');
  assert.equal(renderer.shadowsDirty, true);
  assert.ok(batch.bounds.center[2] === 5, 'culling bounds follow the new positions');
});

test('updatePartVertices leaves normals alone when none are given', () => {
  const { renderer, part, calls } = fakeRenderer();
  updatePartVertices(renderer, part, new Float32Array(9));
  assert.deepEqual(calls.map(call => call[0]), ['bindBuffer', 'bufferSubData']);
});

test('updatePartVertices refuses a changed vertex count, an unknown part and a skinned part', () => {
  const { renderer, part } = fakeRenderer();
  assert.throws(() => updatePartVertices(renderer, part, new Float32Array(12)), /3 per vertex/);
  assert.throws(() => updatePartVertices(renderer, part, [0, 0, 0, 0, 0, 0, 0, 0, 0]), TypeError);
  assert.throws(() => updatePartVertices(renderer, { name: 'other' }, new Float32Array(9)), /Unknown part/);
  renderer.partLocations.get(part).skin = {};
  assert.throws(() => updatePartVertices(renderer, part, new Float32Array(9)), /rigid/);
});

test('worldBounds follows vertices moved by updatePartVertices after bounds were cached', () => {
  const { renderer, part } = fakeRenderer();
  part.matrix = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const before = worldBounds(part);
  assert.equal(before.maximum[2], 0);
  updatePartVertices(renderer, part, new Float32Array([0, 0, 50, 1, 0, 50, 0, 1, 50]));
  const after = worldBounds(part);
  assert.equal(after.minimum[2], 50, 'bounds must not stay stale after an in-place vertex rewrite');
  assert.equal(after.maximum[2], 50);
});

test('updatePartVertices refuses non-finite positions and normals before it writes anything', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const { renderer, part, geometry, batch, calls } = fakeRenderer();
    const positionsBefore = Array.from(geometry.positions);
    const boundsBefore = batch.bounds;
    const badPositions = new Float32Array([0, 0, 0, 1, bad, 0, 0, 1, 0]);
    assert.throws(() => updatePartVertices(renderer, part, badPositions), /positions\[4\] is .*pass finite numbers/);
    const badNormals = new Float32Array([0, 0, 1, 0, 0, bad, 0, 0, 1]);
    assert.throws(() => updatePartVertices(renderer, part, geometry.positions.slice(), badNormals), /normals\[5\] is .*pass finite numbers/);
    assert.deepEqual(Array.from(geometry.positions), positionsBefore, 'the shared geometry is untouched');
    assert.equal(batch.bounds, boundsBefore, 'the culling bounds are untouched');
    assert.deepEqual(calls, [], 'no buffer was written');
  }
});

test('updatePartVertices makes the next bounding sphere measure the new positions, as every near plane and shadow fit reads it (#3038)', () => {
  const { renderer, part, geometry } = fakeRenderer();
  const before = geometryBoundingSphere(geometry);
  updatePartVertices(renderer, part, new Float32Array([0, 0, 50, 1, 0, 50, 0, 1, 50]));
  const after = geometryBoundingSphere(geometry);
  assert.notEqual(after, before);
  assert.equal(after.maximum[2], 50);
});
