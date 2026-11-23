import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';

function recipeWithOneBox() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'cube', type: 'box' }],
    materials: [{ id: 'paint', color: [0.8, 0.25, 0.2] }],
    nodes: [{ id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] }],
  };
}

// Every read of scene.environment copies it, so a loop that read it once per vertex made the outline of a big scan cost
// a tenth of a second and froze an agent's reload of a Studio file (#2842).
function countEnvironmentReads(scene) {
  const counter = { reads: 0 };
  const watchedScene = new Proxy(scene, {
    get(target, property) {
      if (property === 'environment') {
        counter.reads += 1;
      }
      return Reflect.get(target, property, target);
    },
  });
  return { watchedScene, counter };
}

test('the outline of a node reads the scene environment once, not once per vertex', () => {
  const { watchedScene, counter } = countEnvironmentReads(createAgentScene(recipeWithOneBox()));
  const controller = createStudioController({ scene: watchedScene, viewportWidth: 800, viewportHeight: 600 });
  counter.reads = 0;
  const outline = controller.nodeOutline('hero');
  assert.ok(outline && outline.length >= 3, 'the box has an outline');
  assert.equal(counter.reads, 1);
});

test('projecting one point still reads the scene environment once', () => {
  const { watchedScene, counter } = countEnvironmentReads(createAgentScene(recipeWithOneBox()));
  const controller = createStudioController({ scene: watchedScene, viewportWidth: 800, viewportHeight: 600 });
  counter.reads = 0;
  assert.ok(controller.projectWorldPoint([0, 0.5, 0]).visible);
  assert.equal(counter.reads, 1);
});
