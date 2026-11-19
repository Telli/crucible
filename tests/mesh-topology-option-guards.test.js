import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeshData } from '../src/mesh-data.js';
import { joinTriangles } from '../src/mesh-convert.js';
import { dissolveLimited, fillHoles } from '../src/mesh-dissolve.js';
import { createTriangleSurfaceIndex } from '../src/mesh-query.js';

function meshFromFaces(positions, faces) {
  const faceOffsets = [0];
  const cornerVertices = [];
  for (const face of faces) {
    cornerVertices.push(...face);
    faceOffsets.push(cornerVertices.length);
  }
  return createMeshData({ positions: Float32Array.from(positions), faceOffsets: Uint32Array.from(faceOffsets), cornerVertices: Uint32Array.from(cornerVertices) });
}

const foldedPair = () => meshFromFaces([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1], [[0, 1, 2], [0, 2, 3]]);
const openTriangle = () => meshFromFaces([0, 0, 0, 1, 0, 0, 0, 1, 0], [[0, 1, 2]]);
const square = () => ({ positions: Float32Array.of(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0), indices: [0, 1, 2, 0, 2, 3] });

test('joinTriangles refuses a maxAngle that would join a folded pair', () => {
  assert.equal(joinTriangles(foldedPair()).faceCount, 2);
  for (const maxAngle of [NaN, -1, 4]) assert.throws(() => joinTriangles(foldedPair(), { maxAngle }), /maxAngle/);
});

test('createTriangleSurfaceIndex refuses fractional and NaN indices instead of rounding them', () => {
  const { positions } = square();
  assert.equal(createTriangleSurfaceIndex(square()).info.triangleCount, 2);
  for (const bad of [2.7, NaN]) assert.throws(() => createTriangleSurfaceIndex({ positions, indices: [0, 1, 2, 0, bad, 3] }), /whole vertex numbers/);
});

test('dissolveLimited and fillHoles refuse NaN, negative and out-of-range options', () => {
  const mask = new Uint8Array(1).fill(1);
  for (const angle of [NaN, -90, 181]) assert.throws(() => dissolveLimited(openTriangle(), mask, { angle }), /angle/);
  for (const sides of [NaN, 2, 3.5]) assert.throws(() => fillHoles(openTriangle(), { sides }), /sides/);
  assert.equal(fillHoles(openTriangle(), { sides: 3 }).filled, 1);
});
