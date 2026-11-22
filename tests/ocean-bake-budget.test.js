import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { oceanBakeStride, OCEAN_BAKE_VERTEX_STEPS } from '../src/agent-particles.js';
import { createMeshSource } from '../src/particle-emitter-mesh.js';

// A spray emitter on a big sea that an oceanTime track moves must bake in seconds, not past the 30 s preview limit (#2823).

test('a small sea is built at every 1/24 s, a bigger one at a coarser step that keeps a 5 s clip inside the budget', () => {
  assert.equal(oceanBakeStride(1000), 1);
  assert.equal(oceanBakeStride(25_000), 1);
  assert.equal(oceanBakeStride(75_000), 3);
  assert.equal(oceanBakeStride(75_266), 4);
  assert.equal(oceanBakeStride(300_000), 12);
  for (const vertexCount of [10_000, 75_000, 250_000]) {
    const builtSeas = Math.ceil(120 / oceanBakeStride(vertexCount));
    assert.ok(builtSeas * vertexCount <= OCEAN_BAKE_VERTEX_STEPS * 1.05, `${vertexCount} vertices build ${builtSeas} seas`);
  }
});

function bigSeaRecipe(from) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [
      { id: 'sea', type: 'mesh', base: { type: 'box', bevel: 0 }, edits: [{ op: 'subdivide_edges', edges: { all: true }, cuts: 7 }, { op: 'subdivide', levels: 2 }, { op: 'transform_selection', select: { all: true }, scale: [140, 1, 140] }],
        stack: [{ op: 'ocean', windSpeed: 6, choppiness: 0.8, size: 40, seed: 11, resolution: 6, spray: true }] },
      { id: 'drop', type: 'box', bevel: 0 },
    ],
    materials: [{ id: 'water' }],
    nodes: [{ id: 'surface', geometry: 'sea', material: 'water' }, { id: 'droplet', geometry: 'drop', material: 'water', scale: [0.05, 0.05, 0.05] }],
    particles: { systems: [{ node: 'droplet', count: 200, rate: 50, speed: [0, 1], lifetime: [0.6, 1.4], size: 0.02,
      emitter: { shape: 'mesh', mesh: 'surface', from, group: 'spray', groupThreshold: 0.25, velocityFrom: 'spray' } }] },
    motion: { duration: 4, tracks: [{ kind: 'geometry', id: 'sea', property: 'oceanTime', keyframes: [{ time: 0, value: 0 }, { time: 4, value: 4 }] }] },
  };
}

function dropletPositions(scene) {
  scene.sampleMotion(3.5);
  return Array.from(scene.parts.find(part => part.name === 'droplet').geometry.positions);
}

test('a vertices emitter on a sea over 8192 triangles builds, and gives the same droplets every run', () => {
  const first = dropletPositions(createAgentScene(bigSeaRecipe('vertices')));
  assert.equal(first.length / 3, 200 * 24);
  assert.ok(first.some(value => Math.abs(value) > 1), 'droplets are born on the sea');
  assert.deepEqual(dropletPositions(createAgentScene(bigSeaRecipe('vertices'))), first);
});

test('a surface emitter still stops at the triangle limit and says what to use', () => {
  assert.throws(() => createAgentScene(bigSeaRecipe('surface')), /at most 8192 triangles/);
});

test('a vertices source over a big mesh counts its triangles without building them', () => {
  const vertexCount = 30_000;
  const positions = new Float32Array(vertexCount * 3).map((_, index) => index % 7);
  const indices = Uint32Array.from({ length: (vertexCount - 2) * 3 }, (_, index) => Math.floor(index / 3) + (index % 3));
  const source = createMeshSource(positions, new Float32Array(positions.length), indices, 'vertices');
  assert.equal(source.triangleCount, vertexCount - 2);
});
