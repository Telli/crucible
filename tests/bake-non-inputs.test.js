// An edit outside what a light bake reads never runs the bake again (issue 3052). The bake reads the lights, the sky and sun,
// the bake settings, the materials, and each part's mesh and world matrix; the camera, the post effects and a motion track
// that leaves every part where it rests are not among them.
import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudioController } from '../src/studio.js';
import { bakesTraced, clearBakeReuse } from '../src/agent-bake.js';
import { createStudio } from '../src/studio.js';
import { createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';
import { closedRoom } from './support/agent-bake-rooms.mjs';

function bakedRoom() {
  return closedRoom({ bake: { preset: 'draft', samples: 2, bounces: 1, texelsPerUnit: 1, probes: false } });
}

function controllerOn(recipe, bakeWhileSettling) {
  clearBakeReuse();
  return createStudioController({ scene: createAgentScene(recipe), viewportWidth: 800, viewportHeight: 600, bakeWhileSettling });
}

const OUTSIDE_THE_BAKE = [
  ['the camera', recipe => { recipe.camera = { ...recipe.camera, eye: [0.5, 1.6, 1.7], fov: 55 }; }],
  ['the exposure and bloom', recipe => { recipe.effects = { exposure: 1.4, bloom: { strength: 0.3 } }; }],
  ['a motion track that leaves every part at rest', recipe => {
    recipe.motion = { duration: 1, tracks: [{ kind: 'camera', property: 'eye', keyframes: [{ time: 0, value: [0, 1.5, 1.9] }, { time: 1, value: [0.3, 1.5, 1.9] }] }] };
  }],
];

for (const [name, edit] of OUTSIDE_THE_BAKE) {
  test(`an edit of ${name} through the controller does not run the bake again`, () => {
    const controller = controllerOn(bakedRoom());
    const tracedBefore = bakesTraced();
    const edited = controller.exportRecipe();
    edit(edited);
    controller.loadRecipe(edited);
    controller.settleBake();
    assert.equal(controller.bakePending, false);
    assert.equal(bakesTraced(), tracedBefore);
  });

  test(`an edit of ${name} with the last light kept does not start a bake`, () => {
    const controller = controllerOn(bakedRoom(), 'previous');
    const tracedBefore = bakesTraced();
    const edited = controller.exportRecipe();
    edit(edited);
    controller.loadRecipe(edited);
    assert.equal(controller.bakePending, false, 'nothing the bake reads changed, so nothing is pending');
    controller.settleBake();
    assert.equal(bakesTraced(), tracedBefore);
  });
}

test('control: an edit of a part the bake reads does run it, so the counter sees the bake', () => {
  const controller = controllerOn(bakedRoom());
  const tracedBefore = bakesTraced();
  const edited = controller.exportRecipe();
  edited.nodes.find(node => node.id === 'block').translation = [0.4, 0.6, -0.2];
  controller.loadRecipe(edited);
  controller.settleBake();
  assert.equal(bakesTraced() - tracedBefore, 1);
});

// The path of an agent's edit of the watched file: Studio reads the text and hands it to the same controller.
test('the file Studio reloads for an agent edit outside the bake does not bake again, and one inside it does', async testContext => {
  const dom = installStudioDom();
  clearBakeReuse();
  const studio = createStudio(dom.container, { recipe: bakedRoom(), createRenderer: () => createFakeRenderer() });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  studio.renderNow();
  const agent = { name: 'Claude' };
  const tracedBefore = bakesTraced();
  for (const [, edit] of OUTSIDE_THE_BAKE) {
    const edited = studio.controller.exportRecipe();
    edit(edited);
    await studio.loadExternalTextFile(JSON.stringify(edited), { filePath: 'C:/agent/room.scene.json', fileName: 'room.scene.json', recordUndo: false, agent });
    studio.controller.settleBake();
  }
  assert.equal(bakesTraced(), tracedBefore);
  const moved = studio.controller.exportRecipe();
  moved.nodes.find(node => node.id === 'block').translation = [0.4, 0.6, -0.2];
  await studio.loadExternalTextFile(JSON.stringify(moved), { filePath: 'C:/agent/room.scene.json', fileName: 'room.scene.json', recordUndo: false, agent });
  studio.controller.settleBake();
  assert.equal(bakesTraced() - tracedBefore, 1);
});
