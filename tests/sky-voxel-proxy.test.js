import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOccupancyGrid, createSkyProxy, proxyGridLayout, rayEscapes } from '../src/sky-voxel-proxy.js';
import { applyFloorSkyVisibility } from '../src/floor-sky-visibility.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// A flat square of side `size` at `height`, cut into `divisions` x `divisions` cells, facing up (1) or down (-1).
function gridSquare(name, size, height, divisions, facing = 1) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let row = 0; row <= divisions; row++) {
    for (let column = 0; column <= divisions; column++) {
      positions.push(-size / 2 + (size * column) / divisions, height, -size / 2 + (size * row) / divisions);
      normals.push(0, facing, 0);
    }
  }
  for (let row = 0; row < divisions; row++) {
    for (let column = 0; column < divisions; column++) {
      const corner = row * (divisions + 1) + column;
      const quad = [corner, corner + 1, corner + divisions + 2, corner + divisions + 1];
      indices.push(...(facing > 0 ? [quad[0], quad[2], quad[1], quad[0], quad[3], quad[2]] : [quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]]));
    }
  }
  const geometry = { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
  return { name, geometry, matrix: IDENTITY, material: { color: [0.5, 0.5, 0.5] } };
}

function visibilityNear(part, x, z) {
  const { positions, skyVisibility } = part.geometry;
  let nearest = 0;
  let nearestDistance = Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const distance = Math.hypot(positions[vertex * 3] - x, positions[vertex * 3 + 2] - z);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = vertex;
    }
  }
  return skyVisibility[nearest];
}

test('the grid never holds more cells than asked, and refuses a budget below 8', () => {
  const layout = proxyGridLayout([0, 0, 0], [100, 3, 47], 5000);
  assert.ok(layout.size[0] * layout.size[1] * layout.size[2] <= 5000, `size ${layout.size}`);
  assert.throws(() => proxyGridLayout([0, 0, 0], [1, 1, 1], 4), /maximumCells must be at least 8/);
});

test('a ray up from under a roof is blocked and one beside it escapes', () => {
  const grid = buildOccupancyGrid([gridSquare('floor', 20, 0, 4), gridSquare('roof', 6, 2, 2, -1)], { maximumCells: 50_000 });
  assert.equal(rayEscapes(grid, 0, 0.5, 0, 0, 1, 0), false);
  assert.equal(rayEscapes(grid, 8, 0.5, 8, 0, 1, 0), true);
});

test('the grid gives the same visibility for a coarse and a dense mesh of the same room', () => {
  const sample = divisions => {
    const parts = [gridSquare('floor', 20, 0, divisions), gridSquare('roof', 6, 2, divisions, -1)];
    const proxy = createSkyProxy(buildOccupancyGrid(parts, { maximumCells: 50_000 }));
    return [[0, 0], [2, 1], [5, 5], [9, 9]].map(([x, z]) => proxy.lookup(x, 0, z, 0, 1, 0));
  };
  assert.deepEqual(sample(10), sample(40));
});

test('past the ray budget the trace is skipped by default and says which limit it met', () => {
  const parts = [gridSquare('floor', 20, 0, 20), gridSquare('roof', 6, 2, 2, -1)];
  const result = applyFloorSkyVisibility(parts, { maximumTexels: 1600, maximumRays: 1 });
  assert.equal(result.parts, parts);
  assert.equal(result.report.reason, 'too many rays');
  assert.match(result.report.fallbackReason, /more than 1 rays/);
});

test('largeScenes proxy traces the grid where the triangle trace stops, close to its values', () => {
  const parts = [gridSquare('floor', 20, 0, 20), gridSquare('roof', 6, 2, 2, -1)];
  const exact = applyFloorSkyVisibility(parts, { maximumTexels: 1600 });
  const proxied = applyFloorSkyVisibility(parts, { maximumTexels: 1600, maximumRays: 1, largeScenes: 'proxy' });
  assert.equal(exact.report.method, 'triangles');
  assert.equal(proxied.report.method, 'proxy');
  assert.equal(proxied.report.reason, null);
  for (const [x, z] of [[0, 0], [9, 9], [5, 0]]) {
    const difference = Math.abs(visibilityNear(exact.parts[0], x, z) - visibilityNear(proxied.parts[0], x, z));
    assert.ok(difference < 0.2, `at ${x},${z} the proxy differs by ${difference}`);
  }
});

test('the proxy writes sky visibility to every level of a part with lods, level 0 being its own geometry', () => {
  const floor = gridSquare('floor', 20, 0, 20);
  const coarse = gridSquare('floor', 20, 0, 4).geometry;
  const withLods = { ...floor, lods: [{ geometry: floor.geometry, error: 0 }, { geometry: coarse, error: 0.1 }] };
  const result = applyFloorSkyVisibility([withLods, gridSquare('roof', 6, 2, 2, -1)], { maximumRays: 1, largeScenes: 'proxy' });
  const part = result.parts[0];
  assert.equal(part.lods[0].geometry, part.geometry);
  assert.ok(part.lods.every(level => level.geometry.skyVisibility?.length === level.geometry.positions.length / 3));
  assert.equal(part.lods[1].error, 0.1);
});

test('largeScenes takes only skip or proxy', () => {
  assert.throws(() => applyFloorSkyVisibility([gridSquare('floor', 20, 0, 2)], { largeScenes: 'grid' }), /largeScenes must be 'skip' or 'proxy', got grid/);
});

test('openScenes proxy traces an open scene through the grid that onlyClosedRooms would otherwise skip', () => {
  const parts = [gridSquare('floor', 20, 0, 10), gridSquare('roof', 6, 2, 2, -1)];
  const skipped = applyFloorSkyVisibility(parts, { onlyClosedRooms: true });
  assert.equal(skipped.parts, parts);
  assert.equal(skipped.report.reason, 'open scene');
  const traced = applyFloorSkyVisibility(parts, { onlyClosedRooms: true, openScenes: 'proxy' });
  assert.equal(traced.report.method, 'proxy');
  assert.equal(traced.report.fallbackReason, 'open scene');
  const floor = traced.parts[0];
  assert.ok(visibilityNear(floor, 0, 0) < visibilityNear(floor, 9, 9), 'under the roof sees less sky than the open corner');
  assert.ok(traced.parts.every(part => part.geometry.skyVisibility?.length === part.geometry.positions.length / 3), 'every part gets visibility');
});

test('openScenes takes only skip or proxy', () => {
  assert.throws(() => applyFloorSkyVisibility([gridSquare('floor', 20, 0, 2)], { openScenes: 'grid' }), /openScenes must be 'skip' or 'proxy', got grid/);
});
