import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { studioFloorHeight } from '../src/renderer.js';
import { createStudio } from '../src/studio.js';
import { createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';

const VIEWPORT_BOX = { left: 40, top: 30, width: 800, height: 600, right: 840, bottom: 630 };

const HERO = { id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] };
const ORB = { id: 'orb', geometry: 'sphere', material: 'paint', translation: [2.2, 0.5, 0], scale: [0.5, 0.5, 0.5] };
const FLOOR_SLAB = { id: 'slab', geometry: 'slab', material: 'stone', translation: [0, -0.2, 0], scale: [10, 0.4, 10] };

function sceneRecipe({ nodes = [HERO, ORB], environment = {} } = {}) {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [
      { id: 'slab', type: 'box', bevel: 0 },
      { id: 'cube', type: 'box', bevel: 0.04 },
      { id: 'sphere', type: 'sphere', segments: 16, rings: 12 },
    ],
    materials: [
      { id: 'stone', tag: 'surface', color: [0.3, 0.32, 0.35], roughness: 0.8, metallic: 0 },
      { id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 },
    ],
    nodes,
    camera: { eye: [0, 2, 6], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
    environment: { setup: 'studio', lightDirection: [-2, 5, 3], ...environment },
  };
}

// Mounts Studio without a supplied renderer, so it builds its own through the recording factory.
function mountStudioBuildingRenderers(testContext, recipe) {
  const dom = installStudioDom();
  const builds = [];
  const createRenderer = (canvas, parts, options) => {
    const renderer = createFakeRenderer();
    builds.push({ renderer, ground: options.ground, parts });
    return renderer;
  };
  const studio = createStudio(dom.container, { recipe, createRenderer });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  dom.container.firstElementChild.querySelector('.crucible-studio-viewport').box = VIEWPORT_BOX;
  studio.renderNow();
  return { dom, studio, controller: studio.controller, builds };
}

function drawFrames(ui, count = 1) {
  for (let frame = 0; frame < count; frame += 1) {
    ui.studio.renderNow();
  }
}

test('a recipe that turns the ground off builds its renderer with no Studio floor', testContext => {
  const ui = mountStudioBuildingRenderers(testContext, sceneRecipe({ environment: { ground: false } }));
  assert.equal(ui.builds.length, 1);
  assert.equal(ui.builds[0].ground, false);
});

test('a recipe whose own part forms a floor builds its renderer with no Studio floor', testContext => {
  const ui = mountStudioBuildingRenderers(testContext, sceneRecipe({ nodes: [FLOOR_SLAB, HERO, ORB] }));
  assert.equal(ui.builds.length, 1);
  assert.equal(ui.builds[0].ground, false);
});

test('an ordinary scene and an empty scene get the Studio floor as before', testContext => {
  const ordinary = mountStudioBuildingRenderers(testContext, sceneRecipe());
  const ordinaryGround = ordinary.builds[0].ground;
  assert.equal(ordinaryGround.name, 'Studio floor');
  assert.equal(ordinaryGround.geometry.positions[1], Math.fround(studioFloorHeight(ordinary.controller.scene.parts)));
  assert.equal(ordinaryGround.material.tag, 'floor');

  const empty = mountStudioBuildingRenderers(testContext, sceneRecipe({ nodes: [] }));
  assert.equal(empty.builds[0].ground.name, 'Studio floor');
  assert.equal(empty.builds[0].ground.geometry.positions[1], Math.fround(studioFloorHeight([])));
});

test('switching environment.ground rebuilds the renderer once with the right floor', testContext => {
  const ui = mountStudioBuildingRenderers(testContext, sceneRecipe());
  ui.controller.updateLook({ environment: { ground: false } });
  drawFrames(ui, 3);
  assert.equal(ui.builds.length, 2);
  assert.equal(ui.builds[0].renderer.disposed, true);
  assert.equal(ui.builds[1].ground, false);

  ui.controller.updateLook({ environment: { ground: true } });
  drawFrames(ui, 3);
  assert.equal(ui.builds.length, 3);
  assert.equal(ui.builds[2].ground.name, 'Studio floor');
});

test('a floor-forming part, its removal and undo each rebuild once; other edits do not', testContext => {
  const ui = mountStudioBuildingRenderers(testContext, sceneRecipe());
  const withoutFloor = ui.controller.exportRecipe();
  const withFloor = sceneRecipe({ nodes: [FLOOR_SLAB, HERO, ORB] });

  ui.controller.loadRecipe(withFloor);
  drawFrames(ui, 3);
  assert.equal(ui.builds.length, 2);
  assert.equal(ui.builds[1].ground, false);

  ui.controller.updateLook({ effects: { vignette: 0.2 } });
  ui.controller.updateNodeTransform('hero', { translation: [0.5, 0.5, 0] });
  drawFrames(ui, 3);
  assert.equal(ui.builds.length, 2, 'edits that keep the answer leave the renderer alone');

  ui.controller.undo();
  ui.controller.undo();
  ui.controller.undo();
  drawFrames(ui, 3);
  assert.equal(ui.controller.scene.parts.length, 2);
  assert.equal(ui.builds.length, 3, 'undo back to a scene without a floor part brings the Studio floor back');
  assert.equal(ui.builds[2].ground.name, 'Studio floor');

  ui.controller.loadRecipe(withoutFloor);
  drawFrames(ui, 2);
  assert.equal(ui.builds.length, 3, 'a recipe that keeps the answer keeps the renderer');
});

test('the decision is made once per revision, not per frame', testContext => {
  const ui = mountStudioBuildingRenderers(testContext, sceneRecipe());
  const environment = ui.controller.scene.environment;
  let reads = 0;
  Object.defineProperty(environment, 'ground', {
    configurable: true,
    get() {
      reads += 1;
      return undefined;
    },
  });
  drawFrames(ui, 10);
  assert.ok(reads <= 1, `the rule ran ${reads} times over ten frames of one revision`);
});

test('a supplied renderer is never disposed when the answer flips', testContext => {
  const dom = installStudioDom();
  const renderer = createFakeRenderer();
  const studio = createStudio(dom.container, { recipe: sceneRecipe(), renderer });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  dom.container.firstElementChild.querySelector('.crucible-studio-viewport').box = VIEWPORT_BOX;
  studio.renderNow();
  studio.controller.updateLook({ environment: { ground: false } });
  studio.renderNow();
  assert.equal(renderer.disposed, false);
  assert.ok(renderer.frames.length >= 2);
});
