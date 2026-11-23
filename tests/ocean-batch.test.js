import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeshData } from '../src/mesh.js';
import { vertexGroupWeights, VECTOR_PREFIX } from '../src/mesh-data.js';
import { oceanMesh } from '../src/mesh-ocean-modifier.js';
import {
  oceanWaves, oceanSurfaceAt, oceanFoamThreshold, oceanFoamWithMemory, prepareOceanBatch, setOceanBatchPoint, oceanBatchSurface,
  oceanBatchFoamWithMemory,
} from '../src/ocean-waves.js';
import { seededRandom } from '../src/seeded-random.js';

const TOLERANCE = 1e-9;
const SURFACE_FIELDS = ['height', 'moveX', 'moveZ', 'jacobian', 'foam', 'riseSpeed', 'driftX', 'driftZ'];
const SEAS = [
  { windSpeed: 8.5, direction: 30, size: 160, seed: 3, resolution: 6 },
  { windSpeed: 4, direction: -75, size: 2, seed: 11, resolution: 1 },
  { windSpeed: 20, direction: 200, size: 700, seed: 5, resolution: 16 },
];

function randomValue(index, low, high) {
  return low + (high - low) * seededRandom(index, 99, 1);
}

function scatteredGrid(count, extent) {
  const positions = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex++) {
    for (let component = 0; component < 3; component++) positions[vertex * 3 + component] = randomValue(vertex * 3 + component, -extent, extent);
  }
  const faceCount = count / 3;
  const faceOffsets = new Uint32Array(faceCount + 1);
  for (let face = 0; face <= faceCount; face++) faceOffsets[face] = face * 3;
  const cornerVertices = Uint32Array.from({ length: count }, (_, corner) => corner);
  return createMeshData({ positions, faceOffsets, cornerVertices });
}

test('the batch sum equals the per-point sum within rounding, with the foam of earlier moments', () => {
  for (const sea of SEAS) {
    const waves = oceanWaves(sea);
    for (const choppiness of [0, 1]) {
      const foamMemory = 2.5;
      const time = randomValue(sea.seed, -30, 30);
      const threshold = oceanFoamThreshold(waves, { windSpeed: sea.windSpeed, size: sea.size, choppiness });
      const batch = prepareOceanBatch(waves, time, choppiness, foamMemory);
      const batchSurface = {};
      for (let point = 0; point < 40; point++) {
        const restX = randomValue(point, -300, 300);
        const restZ = randomValue(point + 1000, -300, 300);
        const reference = oceanSurfaceAt(waves, restX, restZ, time, choppiness, threshold);
        setOceanBatchPoint(batch, restX, restZ);
        oceanBatchSurface(batch, batchSurface, threshold);
        for (const field of SURFACE_FIELDS) {
          assert.ok(Math.abs(batchSurface[field] - reference[field]) < TOLERANCE, `${field} at resolution ${sea.resolution}, choppiness ${choppiness}: ${batchSurface[field]} vs ${reference[field]}`);
        }
        const remembered = oceanFoamWithMemory(waves, restX, restZ, time, choppiness, threshold, foamMemory, reference.foam);
        assert.ok(Math.abs(oceanBatchFoamWithMemory(batch, threshold, batchSurface.foam) - remembered) < TOLERANCE);
      }
    }
  }
});

test('oceanMesh equals the per-point sea on every up axis, with foam memory and spray', () => {
  const grid = scatteredGrid(300, 120);
  const foamMemory = 1.5;
  const edit = { windSpeed: 9, direction: 40, size: 90, seed: 4, time: 6.25, resolution: 5, choppiness: 1, foamMemory, spray: true };
  const waves = oceanWaves(edit);
  const threshold = oceanFoamThreshold(waves, { windSpeed: edit.windSpeed, size: edit.size, choppiness: edit.choppiness });
  const fullSprayRise = 0.1 * edit.windSpeed;
  for (const [axis, up] of [['x', 0], ['y', 1], ['z', 2]]) {
    const first = (up + 1) % 3;
    const second = (up + 2) % 3;
    const mesh = oceanMesh(grid, { ...edit, axis });
    const foam = vertexGroupWeights(mesh, 'foam');
    const sprayWeight = vertexGroupWeights(mesh, 'spray');
    const sprayVelocity = mesh.attributes.point[`${VECTOR_PREFIX}spray`].data;
    for (let vertex = 0; vertex < grid.vertexCount; vertex++) {
      const restX = grid.positions[vertex * 3 + first];
      const restZ = grid.positions[vertex * 3 + second];
      const surface = oceanSurfaceAt(waves, restX, restZ, edit.time, edit.choppiness, threshold);
      const expectedFoam = oceanFoamWithMemory(waves, restX, restZ, edit.time, edit.choppiness, threshold, foamMemory, surface.foam);
      const expected = [0, 0, 0];
      expected[up] = grid.positions[vertex * 3 + up] + surface.height;
      expected[first] = restX + surface.moveX;
      expected[second] = restZ + surface.moveZ;
      for (let component = 0; component < 3; component++) {
        assert.ok(Math.abs(mesh.positions[vertex * 3 + component] - expected[component]) < 1e-4, `axis ${axis} position ${component}`);
      }
      assert.ok(Math.abs(foam[vertex] - expectedFoam) < 1e-5, `axis ${axis} foam`);
      assert.ok(Math.abs(sprayWeight[vertex] - Math.min(expectedFoam, Math.min(1, Math.max(0, surface.riseSpeed / fullSprayRise)))) < 1e-5, `axis ${axis} spray`);
      assert.ok(Math.abs(sprayVelocity[vertex * 3 + up] - surface.riseSpeed) < 1e-4, `axis ${axis} rise`);
      assert.ok(Math.abs(sprayVelocity[vertex * 3 + first] - surface.driftX) < 1e-4, `axis ${axis} drift first`);
      assert.ok(Math.abs(sprayVelocity[vertex * 3 + second] - surface.driftZ) < 1e-4, `axis ${axis} drift second`);
    }
  }
});

test('the batch path gives the same bytes on every run', () => {
  const grid = scatteredGrid(120, 80);
  const edit = { axis: 'y', windSpeed: 7, direction: 10, size: 60, seed: 2, time: 1.75, resolution: 6, choppiness: 1, foamMemory: 1 };
  const first = oceanMesh(grid, edit);
  const second = oceanMesh(grid, edit);
  assert.deepEqual(Array.from(first.positions), Array.from(second.positions));
  assert.deepEqual(Array.from(vertexGroupWeights(first, 'foam')), Array.from(vertexGroupWeights(second, 'foam')));
});
