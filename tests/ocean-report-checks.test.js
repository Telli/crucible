import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { placementProblems } from '../src/frame-checks.js';
import { recipeDiagnostics } from '../src/agent-diagnostics.js';

function oceanScene() {
  return createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [
      { id: 'sea', type: 'mesh', base: { type: 'grid', segments: 8 }, stack: [{ op: 'ocean', windSpeed: 0.5, size: 50, seed: 4 }] },
      { id: 'box', type: 'box' },
    ],
    materials: [{ id: 'water', tag: 'water', color: [0.02, 0.1, 0.2] }, { id: 'red', color: [0.8, 0.2, 0.2] }],
    nodes: [
      { id: 'sea', geometry: 'sea', material: 'water', scale: [50, 1, 50] },
      { id: 'sea_far', geometry: 'box', material: 'water', translation: [0, -1.5, -400], scale: [800, 0.1, 400] },
      { id: 'buoy', geometry: 'box', material: 'red', translation: [0, 0.3, 0], scale: [0.5, 0.6, 0.5] },
    ],
    camera: { eye: [0, 3, 8], target: [0, 0.5, 0], fov: 45 },
  });
}

test('an ocean part with water foam has world bounds, so a buoy on it is not floating', () => {
  const boxes = oceanScene().worldBounds();
  assert.ok(boxes.some(box => box.name === 'sea'), 'the sea part is in the bounds');
  assert.deepEqual(placementProblems({ boxes }), []);
});

test('specular on a water material is not reported as ignored, and still is on a foliage material', () => {
  const recipeWith = tag => ({
    materials: [{ id: 'm', tag, specular: 0.5, specularColor: [1, 1, 1], clearcoat: 0.5 }],
    nodes: [{ id: 'n', geometry: 'g', material: 'm' }],
    geometries: [{ id: 'g', type: 'box' }],
  });
  const fieldsIgnoredOn = tag => recipeDiagnostics(recipeWith(tag)).filter(entry => entry.kind === 'ignored-material-field').map(entry => entry.message.split(' ')[0]);
  assert.deepEqual(fieldsIgnoredOn('water'), ['clearcoat']);
  assert.deepEqual(fieldsIgnoredOn('foliage'), ['clearcoat', 'specular', 'specularColor']);
});
