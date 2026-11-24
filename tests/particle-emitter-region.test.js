import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createMeshSource } from '../src/particle-emitter-mesh.js';

// A mesh emitter limited to a box in world space puts every birth inside it (#2823).

const REGION = { center: [0, 0, 0], halfExtents: [2, 5, 2] };

// A flat grid of 21 x 21 vertices across -10 to 10 in x and z, at y 0.
function gridMesh() {
  const side = 21;
  const positions = [];
  const normals = [];
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) {
      positions.push(column - 10, 0, row - 10);
      normals.push(0, 1, 0);
    }
  }
  const indices = [];
  for (let row = 0; row < side - 1; row++) {
    for (let column = 0; column < side - 1; column++) {
      const first = row * side + column;
      indices.push(first, first + side, first + 1, first + 1, first + side, first + side + 1);
    }
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), indices: Uint32Array.from(indices) };
}

// A closed cube from -10 to 10, 12 triangles.
function cubeMesh() {
  const corners = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5];
  return {
    positions: Float32Array.from(corners.flatMap(entry => entry.map(value => value * 10))),
    normals: Float32Array.from(corners.flatMap(entry => entry)),
    indices: Uint32Array.from(indices),
  };
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function sourceOf(mesh, mode, region) {
  return createMeshSource(mesh.positions, mesh.normals, mesh.indices, mode, null, null, null, 0, region);
}

function births(mesh, mode, region, count = 2000) {
  const source = sourceOf(mesh, mode, region);
  const random = seededRandom(7);
  return Array.from({ length: count }, () => source.sample(random).point);
}

function insideRegion(point) {
  return [0, 1, 2].every(axis => Math.abs(point[axis] - REGION.center[axis]) <= REGION.halfExtents[axis] + 1e-6);
}

for (const mode of ['surface', 'vertices', 'edges']) {
  test(`${mode} births all land inside the region, and the count is honoured`, () => {
    const points = births(gridMesh(), mode, REGION);
    assert.equal(points.length, 2000);
    assert.equal(points.filter(insideRegion).length, 2000);
    const without = births(gridMesh(), mode, null);
    assert.ok(without.filter(insideRegion).length < 2000 * 0.2, 'without a region most births are elsewhere on the grid');
  });
}

test('volume births land inside the region and the closed mesh', () => {
  const points = births(cubeMesh(), 'volume', { center: [8, 8, 8], halfExtents: [4, 4, 4] }, 300);
  assert.ok(points.every(point => point.every(value => value >= 4 - 1e-6 && value <= 10 + 1e-6)), 'births sit in the corner shared by the box and the cube');
});

test('the same seed gives the same births with a region', () => {
  assert.deepEqual(births(gridMesh(), 'surface', REGION, 200), births(gridMesh(), 'surface', REGION, 200));
});

test('without a region the births are the ones the sampler always drew', () => {
  const mesh = gridMesh();
  for (const mode of ['surface', 'vertices', 'edges']) {
    assert.deepEqual(births(mesh, mode, null, 50), births(mesh, mode, undefined, 50));
  }
  // The first vertex draw of the seeded generator, as before regions existed.
  assert.deepEqual(births(mesh, 'vertices', null, 1)[0], [-10, 0, -5]);
});

test('a region away from the mesh gives no source', () => {
  const far = { center: [100, 100, 100], halfExtents: [1, 1, 1] };
  for (const mode of ['surface', 'vertices', 'edges', 'volume']) {
    assert.equal(sourceOf(mode === 'volume' ? cubeMesh() : gridMesh(), mode, far), null);
  }
});

function sceneRecipe(region) {
  const emitter = { shape: 'mesh', mesh: 'plane', from: 'vertices' };
  if (region !== undefined) emitter.region = region;
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [
      { id: 'sea', type: 'mesh', base: { type: 'box', bevel: 0 }, edits: [{ op: 'subdivide_edges', edges: { all: true }, cuts: 7 }, { op: 'subdivide', levels: 1 }, { op: 'transform_selection', select: { all: true }, scale: [20, 0.01, 20] }] },
      { id: 'drop', type: 'box', bevel: 0 },
    ],
    materials: [{ id: 'water' }],
    nodes: [{ id: 'plane', geometry: 'sea', material: 'water' }, { id: 'droplet', geometry: 'drop', material: 'water' }],
    particles: { systems: [{ node: 'droplet', count: 2000, speed: 0, lifetime: 5, size: 0.01, drag: 0, emitter }] },
  };
}

function dropletPositions(region) {
  const scene = createAgentScene(sceneRecipe(region));
  scene.sampleMotion(0);
  return scene.parts.find(part => part.name === 'droplet').geometry.positions;
}

test('a scene recipe with a region puts 2000 droplets inside the box', () => {
  const region = { center: [3, 0, 3], halfExtents: [2, 1, 2] };
  const positions = dropletPositions(region);
  const vertexCount = positions.length / 3;
  assert.equal(vertexCount % 2000, 0);
  let inside = 0;
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    if (point.every((value, axis) => Math.abs(value - region.center[axis]) <= region.halfExtents[axis] + 0.05)) inside++;
  }
  assert.equal(inside, vertexCount);
});

test('a recipe without a region gives the same droplets every run', () => {
  assert.deepEqual(dropletPositions(undefined), dropletPositions(undefined));
});

test('a region that holds no part of the mesh says so and what to pass', () => {
  assert.throws(() => createAgentScene(sceneRecipe({ center: [500, 0, 500], halfExtents: [1, 1, 1] })), /region.*holds no part of the mesh.*region\.center onto the mesh or raise its halfExtents/s);
});

test('the region is validated at the boundary', () => {
  assert.throws(() => createAgentScene(sceneRecipe({ center: [0, 0, 0], halfExtents: [0, 1, 1] })), /region\.halfExtents\[0\].*above 0/s);
  assert.throws(() => createAgentScene(sceneRecipe({ center: [0, 0, 0], halfExtents: [1, -1, 1] })), /region\.halfExtents\[1\]/);
  assert.throws(() => createAgentScene(sceneRecipe({ center: [0, 'x', 0], halfExtents: [1, 1, 1] })), /region\.center\[1\]/);
  assert.throws(() => createAgentScene(sceneRecipe({ center: [0, 0, 0], halfExtents: [1e9, 1, 1] })), /region\.halfExtents\[0\]/);
  assert.throws(() => createAgentScene(sceneRecipe({ center: [0, 0, 0] })), /region\.halfExtents/);
  assert.throws(() => createAgentScene(sceneRecipe('box')), /region/);
});

test('region is refused on a box emitter, which has no mesh to limit', () => {
  const recipe = sceneRecipe(undefined);
  recipe.particles.systems[0].emitter = { shape: 'box', region: { center: [0, 0, 0], halfExtents: [1, 1, 1] } };
  assert.throws(() => createAgentScene(recipe), /emitter\.region.*shape is "mesh"/s);
});
