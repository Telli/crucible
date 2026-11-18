import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene, loadAgentSceneModules } from '../src/agent-scene.js';
import { spotAngleExpectation } from '../src/spot-angle-advice.js';

function sceneRecipe(environment = {}) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [{ id: 'box', type: 'box' }],
    materials: [{ id: 'paint' }],
    nodes: [{ id: 'a', geometry: 'box', material: 'paint' }],
    environment,
  };
}

async function newScene(environment) {
  const recipe = sceneRecipe(environment);
  await loadAgentSceneModules(recipe);
  return createAgentScene(recipe);
}

const EMPTY_EDITS = [
  ['set-camera', { type: 'set-camera' }, /operation: got \{"type":"set-camera"\}; expected set-camera with at least one field to change: eye, target, up, fov/],
  ['set-node', { type: 'set-node', id: 'a' }, /expected set-node with at least one field to change: translation, rotation, scale/],
  ['set-material', { type: 'set-material', id: 'paint' }, /expected set-material with at least one field to change: color, metallic/],
  ['set-shadow', { type: 'set-shadow', shadow: {} }, /expected set-shadow with at least one field to change: /],
];

for (const [name, operation, message] of EMPTY_EDITS) {
  test(`an empty ${name} is rejected with the fields it accepts and leaves the revision alone`, async () => {
    const scene = await newScene();
    const revision = scene.revision;
    assert.throws(() => scene.apply([operation], { expectedRevision: revision }), message);
    assert.equal(scene.revision, revision);
  });
}

test('an edit that names one field still applies', async () => {
  const scene = await newScene();
  scene.apply([{ type: 'set-camera', fov: 30 }, { type: 'set-node', id: 'a', label: 'box' }, { type: 'set-shadow', shadow: { distance: 20 } }], { expectedRevision: scene.revision });
  assert.equal(scene.revision, 1);
});

test('a spot angle error names radians and the half angle', async () => {
  const scene = await newScene();
  const spot = angle => ({ type: 'set-environment', environment: { spotLights: [{ position: [0, 3, 0], direction: [0, -1, 0], angle }] } });
  assert.throws(() => scene.apply([spot(0)], { expectedRevision: scene.revision }), /angle: got 0; expected the outer half angle of the cone in radians, from 0\.01 to 1\.56 \(just under pi\/2\), such as 0\.785 for 45 degrees\.$/);
  assert.throws(() => scene.apply([spot(90)], { expectedRevision: scene.revision }), /outer half angle of the cone in radians.*90 looks like degrees, and 90 degrees is 1\.57 radians/);
});

test('only a value above pi gets the degrees hint, with the radians value', () => {
  assert.match(spotAngleExpectation(45), /45 looks like degrees, and 45 degrees is 0\.785 radians/);
  assert.doesNotMatch(spotAngleExpectation(2), /degrees, and/);
  assert.doesNotMatch(spotAngleExpectation(Number.NaN), /degrees, and/);
});
