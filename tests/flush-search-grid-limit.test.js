import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { loadAllAgentSceneModules } from '../src/agent-scene-modules.js';

// Issue #2302: a 160 m ground widens the search reach, which put about 16 million cell entries of two million small triangles
// into one Map and threw "Map maximum size exceeded" from scene_create.
function scatterNode(id, geometry, seed) {
  return { id, geometry, material: 'red', instances: { scatter: { count: 600, min: [-14, 0.3, -14], max: [14, 4.5, 14] }, seed, yaw: true, scale: [0.5, 1.2] } };
}

function groundWithCopiesRecipe() {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'ball', type: 'icoSphere', subdivisions: 2 }, { id: 'gem', type: 'box' }, { id: 'slab', type: 'box' }],
    materials: [{ id: 'red', color: [0.9, 0.3, 0.2], roughness: 0.5 }],
    nodes: [
      { id: 'ground', geometry: 'slab', material: 'red', translation: [0, -0.1, 0], scale: [160, 0.2, 160] },
      scatterNode('balls0', 'ball', 1), scatterNode('balls1', 'gem', 2), scatterNode('balls2', 'ball', 3), scatterNode('balls3', 'gem', 4),
    ],
    camera: { eye: [0, 8, 30], target: [0, 2, 0], fov: 40 },
    environment: { world: true },
  };
}

test('a large ground with 2,400 instanced copies builds with the coplanar search on', { timeout: 120_000 }, async () => {
  const recipe = groundWithCopiesRecipe();
  await loadAllAgentSceneModules();
  const scene = createAgentScene(recipe);
  assert.equal(scene.parts.length, 2401);
});
