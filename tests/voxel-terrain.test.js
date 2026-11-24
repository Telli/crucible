import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createVoxelTerrain, VOXEL_TERRAIN_LIMITS } from '../src/voxel-terrain.js';
import { createVoxelTerrain as createFromAddon } from '../src/terrain.js';
import { GRASS, ROCK, SAND, WATER, makeLandscape } from '../scripts/voxel-landscape.mjs';

const GRID = [40, 20, 40];

function landscapeInput(overrides = {}) {
  const { occupancy, materials } = makeLandscape(GRID);
  return { grid: GRID, cellSize: 2, occupancy, materials, ...overrides };
}

function hashOf(result) {
  const hash = createHash('sha256');
  for (const part of result.parts) {
    for (const field of ['positions', 'normals', 'uvs', 'colors', 'indices']) {
      const array = part.geometry[field];
      if (array) hash.update(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    }
  }
  return hash.digest('hex');
}

function edgeUses(indices) {
  const uses = new Map();
  for (let offset = 0; offset < indices.length; offset += 3) {
    for (let side = 0; side < 3; side++) {
      const from = indices[offset + side];
      const to = indices[offset + (side + 1) % 3];
      const key = from < to ? `${from},${to}` : `${to},${from}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  return uses;
}

test('the same voxel input meshes to the same bytes, from fresh arrays each time', () => {
  const first = createVoxelTerrain(landscapeInput());
  const second = createVoxelTerrain(landscapeInput());
  assert.equal(hashOf(first), hashOf(second));
  assert.deepEqual(first.materialIds, second.materialIds);
  const firstLand = first.parts[0].geometry;
  const secondLand = second.parts[0].geometry;
  assert.ok(firstLand.indices.length > 0);
  for (const field of ['positions', 'normals', 'colors', 'indices']) {
    assert.deepEqual(Buffer.from(firstLand[field].buffer), Buffer.from(secondLand[field].buffer), field);
  }
});

test('the addon entry exports the voxel mesher', () => {
  assert.equal(createFromAddon, createVoxelTerrain);
});

test('a landscape gives a land part and a water part inside the grid bounds', () => {
  const result = createVoxelTerrain(landscapeInput({ origin: [10, 0, -5] }));
  assert.deepEqual(result.parts.map(part => part.name), ['Voxel terrain', 'Voxel water']);
  assert.deepEqual(result.bounds, { min: [10, 0, -5], max: [90, 40, 75] });
  for (const part of result.parts) {
    const { positions, indices } = part.geometry;
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[offset + axis];
        assert.ok(value >= result.bounds.min[axis] - 1e-3 && value <= result.bounds.max[axis] + 1e-3, `${part.name} vertex outside the grid`);
      }
    }
    assert.ok(indices.every(index => index < positions.length / 3));
    assert.equal(part.geometry.normals.length, positions.length);
  }
});

test('the land mesh has no hole away from the grid border', () => {
  const { indices, positions } = createVoxelTerrain(landscapeInput({ cellSize: 1 })).parts[0].geometry;
  for (const [key, count] of edgeUses(indices)) {
    const [from, to] = key.split(',').map(Number);
    const middle = [0, 1, 2].map(axis => (positions[from * 3 + axis] + positions[to * 3 + axis]) / 2);
    const onBorder = middle[0] < 0.6 || middle[0] > GRID[0] - 0.6 || middle[2] < 0.6 || middle[2] > GRID[2] - 0.6 || middle[1] < 0.6;
    assert.ok(count === 2 || (count === 1 && onBorder), `edge ${key} has ${count} triangles away from the border`);
  }
});

test('materials show as distinct colours and blend across the seam', () => {
  const grid = [12, 12, 12];
  const occupancy = new Float32Array(12 * 12 * 12);
  const materials = new Uint8Array(occupancy.length);
  for (let z = 0; z < 12; z++) {
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 12; x++) {
        const cell = (z * 12 + y) * 12 + x;
        occupancy[cell] = 1;
        materials[cell] = x < 6 ? GRASS : ROCK;
      }
    }
  }
  const result = createVoxelTerrain({ grid, cellSize: 1, occupancy, materials });
  const { positions, colors } = result.parts[0].geometry;
  const colorAt = x => {
    const distance = vertex => Math.abs(positions[vertex * 3] - x) + Math.abs(positions[vertex * 3 + 1] - 6) + Math.abs(positions[vertex * 3 + 2] - 6);
    let best = 0;
    for (let vertex = 1; vertex < positions.length / 3; vertex++) {
      if (distance(vertex) < distance(best)) best = vertex;
    }
    return [colors[best * 3], colors[best * 3 + 1], colors[best * 3 + 2]];
  };
  const grassColor = colorAt(1.5);
  const rockColor = colorAt(10.5);
  const seamColor = colorAt(6);
  assert.ok(grassColor[1] > grassColor[0] * 1.8, 'grass is green');
  assert.ok(Math.abs(rockColor[0] - rockColor[1]) < 0.08, 'rock is grey');
  assert.ok(seamColor[0] > grassColor[0] * 1.2 && seamColor[1] < grassColor[1], 'the seam sits between the two looks');
  assert.equal(result.parts.length, 1, 'no water part without water cells');
});

test('a shore cell that is partly ground still gets water against it', () => {
  const grid = [8, 6, 8];
  const occupancy = new Float32Array(8 * 6 * 8);
  const materials = new Uint8Array(occupancy.length).fill(SAND);
  for (let z = 0; z < 8; z++) {
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 3; y++) occupancy[(z * 6 + y) * 8 + x] = 1;
      const shoreCell = (z * 6 + 3) * 8 + x;
      if (x < 4) {
        occupancy[shoreCell] = 1;
        materials[shoreCell] = WATER;
      } else {
        occupancy[shoreCell] = 0.5;
      }
    }
  }
  const { parts } = createVoxelTerrain({ grid, cellSize: 1, occupancy, materials });
  const water = parts.find(part => part.name === 'Voxel water');
  assert.ok(water, 'water part');
  let farthest = 0;
  for (let offset = 0; offset < water.geometry.positions.length; offset += 3) farthest = Math.max(farthest, water.geometry.positions[offset]);
  assert.ok(farthest > 4.5, 'the water reaches over the partly full shore cells');
});

test('input errors name the field, what was received and what to pass', () => {
  const good = landscapeInput();
  assert.throws(() => createVoxelTerrain(null), /voxelTerrain: got null; expected an object/);
  assert.throws(() => createVoxelTerrain({ ...good, grid: [40, 20] }), /grid: got \[40,20\]; expected three whole numbers from 2 to 512/);
  assert.throws(() => createVoxelTerrain({ ...good, grid: [1, 20, 40] }), /grid: got \[1,20,40\]/);
  assert.throws(() => createVoxelTerrain({ ...good, cellSize: 0 }), /cellSize: got 0; expected a number above 0/);
  assert.throws(() => createVoxelTerrain({ ...good, occupancy: new Float32Array(10) }), /occupancy\.length: got 10; expected an array of 32000 numbers/);
  const badOccupancy = good.occupancy.slice();
  badOccupancy[5] = 2;
  assert.throws(() => createVoxelTerrain({ ...good, occupancy: badOccupancy }), /occupancy\[5\]: got 2; expected a number from 0/);
  const badMaterials = good.materials.slice();
  badMaterials[7] = 9;
  assert.throws(() => createVoxelTerrain({ ...good, materials: badMaterials }), /materials\[7\]: got 9; expected a whole number from 0 to 3/);
  assert.throws(() => createVoxelTerrain({ ...good, palette: ['grass', 'lava'] }), /palette\["lava"\]: got "lava"; expected one of grass, rock, sand, dirt, snow, water/);
  assert.throws(() => createVoxelTerrain({ ...good, smoothing: 9 }), /smoothing: got 9; expected a whole number from 0 to 4/);
  assert.throws(() => createVoxelTerrain({ ...good, edges: 'wrap' }), /edges: got "wrap"; expected one of open, closed/);
});

test('the grid is bounded before any array is read', () => {
  const huge = { grid: [512, 512, 512], occupancy: [], materials: [] };
  assert.throws(() => createVoxelTerrain(huge), /grid: got \[512,512,512\]; expected a grid of at most 16777216 cells/);
  assert.equal(VOXEL_TERRAIN_LIMITS.maxCells, 16_777_216);
});

test('an empty grid says there is no surface', () => {
  const empty = landscapeInput({ occupancy: new Float32Array(32000) });
  assert.throws(() => createVoxelTerrain(empty), /no surface/);
});
