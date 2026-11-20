import test from 'node:test';
import assert from 'node:assert/strict';
import { closestPointOnTriangle } from '../src/triangle-math.js';
import { simplifyGeometry } from '../src/geometry-simplify.js';
import { recomputeNormals } from '../src/geometry-normals.js';

function flatGrid(cells) {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= cells; row++) for (let column = 0; column <= cells; column++) positions.push(column, row, 0);
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const corner = row * (cells + 1) + column;
      const below = corner + cells + 1;
      indices.push(corner, corner + 1, below + 1, corner, below + 1, below);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

test('closestPointOnTriangle stays finite for a triangle with a repeated corner', () => {
  const repeatedCorner = Float64Array.of(0, 2, 2, 0, 2, 2, 0, 0, -1);
  const nearest = closestPointOnTriangle([3, 0, 3], repeatedCorner, [0, 0, 0]);
  assert.ok(Array.from(nearest).every(Number.isFinite), `got ${Array.from(nearest)}`);
  // The nearest piece is the edge from (0,2,2) to (0,0,-1), at a fraction of 1/13 along it.
  assert.ok(Math.abs(nearest[1] - (2 - 2 / 13)) < 1e-9 && Math.abs(nearest[2] - (2 - 3 / 13)) < 1e-9 && nearest[0] === 0);
});

test('closestPointOnTriangle returns the nearest edge point for a collinear triangle', () => {
  const triangle = Float64Array.of(0, 0, 0, 2, 0, 0, 1, 0, 0);
  for (const queryX of [-1, 0.25, 0.75, 1.5, 3]) {
    const nearest = closestPointOnTriangle([queryX, 1, 1], triangle, [0, 0, 0]);
    assert.deepEqual(Array.from(nearest), [Math.min(2, Math.max(0, queryX)), 0, 0]);
  }
});

test('simplifyGeometry names the first non-finite vertex instead of returning NaN geometry', () => {
  const geometry = flatGrid(6);
  geometry.positions[9 * 3 + 1] = NaN;
  assert.throws(() => simplifyGeometry(geometry, { ratios: [0.5] }), error => error instanceof RangeError && /vertex 9/.test(error.message) && /finite/.test(error.message));
  const infinite = flatGrid(2);
  infinite.positions[2] = Infinity;
  assert.throws(() => simplifyGeometry(infinite, { ratios: [0.5] }), /vertex 0/);
});

test('recomputeNormals names a non-finite position instead of blaming the stroke', () => {
  const grid = flatGrid(2);
  const normals = new Float32Array(grid.positions.length);
  for (let vertex = 0; vertex < normals.length / 3; vertex++) normals[vertex * 3 + 2] = 1;
  const source = { positions: grid.positions, normals, indices: grid.indices };
  const moved = grid.positions.slice();
  moved[4 * 3] = NaN;
  assert.throws(() => recomputeNormals(source, moved), error => /vertex 4/.test(error.message) && !/cancel/.test(error.message));
  assert.equal(recomputeNormals(source, grid.positions).length, grid.positions.length);
});
