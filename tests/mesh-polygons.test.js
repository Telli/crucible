import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeshData } from '../src/mesh-data.js';
import { buildPolygonMesh } from '../src/mesh-polygons.js';

const quad = createMeshData({
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  faceOffsets: new Uint32Array([0, 4]),
  cornerVertices: new Uint32Array([0, 1, 2, 3]),
});

test('buildPolygonMesh says the edit left no faces instead of blaming the positions', () => {
  assert.throws(() => buildPolygonMesh(quad, []), /^RangeError: The edit left no faces/);
});
