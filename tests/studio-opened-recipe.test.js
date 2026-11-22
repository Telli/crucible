import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { studioFloorHeight } from '../src/renderer.js';
import { createStudio } from '../src/studio.js';
import { createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';

const PLAIN_RECIPE = {
  format: 'crucible.scene',
  schemaVersion: 1,
  geometries: [{ id: 'cube', type: 'box', bevel: 0.04 }],
  materials: [{ id: 'paint', tag: 'surface', color: [0.8, 0.25, 0.2], roughness: 0.4, metallic: 0.1 }],
  nodes: [{ id: 'hero', geometry: 'cube', material: 'paint', translation: [0, 0.5, 0] }],
  camera: { eye: [0, 2, 6], target: [0, 0.5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 },
  environment: { setup: 'studio', lightDirection: [-2, 5, 3] },
};

function mountStudio(testContext, options = {}) {
  const dom = installStudioDom();
  const built = [];
  const createRenderer = (canvas, parts, rendererOptions) => {
    const renderer = createFakeRenderer();
    renderer.environment = rendererOptions.environment;
    built.push(renderer);
    return renderer;
  };
  const studio = createStudio(dom.container, { ...options, createRenderer });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  studio.renderNow();
  return { studio, built };
}

// The renderer merges a frame's environment over the one it holds, as CrucibleRenderer does for its view transform.
function drawnViewTransform(renderer) {
  const frame = renderer.frames.at(-1);
  return { ...renderer.environment, ...frame.environment }.viewTransform;
}

test('a recipe opened over the starting scene does not keep that scene\'s view transform', testContext => {
  const ui = mountStudio(testContext);
  const renderer = ui.built[0];
  assert.equal(drawnViewTransform(renderer), 'agx', 'the starting scene sets a view transform');

  ui.studio.controller.loadRecipe(structuredClone(PLAIN_RECIPE));
  ui.studio.renderNow();

  assert.equal(ui.built.length, 1, 'the same renderer draws the opened recipe');
  assert.equal(drawnViewTransform(renderer), undefined, 'the opened recipe sets none, so the renderer default applies');
});

test('an opened recipe draws with the same environment as the same recipe given at start', testContext => {
  const opened = mountStudio(testContext);
  opened.studio.controller.loadRecipe(structuredClone(PLAIN_RECIPE));
  opened.studio.renderNow();
  const direct = mountStudio(testContext, { recipe: structuredClone(PLAIN_RECIPE) });

  const openedRenderer = opened.built[0];
  const directRenderer = direct.built[0];
  const merged = renderer => {
    const environment = { ...renderer.environment, ...renderer.frames.at(-1).environment };
    delete environment.map;
    return environment;
  };
  assert.deepEqual(merged(openedRenderer), merged(directRenderer));
});

function mountStudioRecordingFloors(testContext) {
  const dom = installStudioDom();
  const floorHeights = [];
  const createRenderer = (canvas, parts, rendererOptions) => {
    floorHeights.push(rendererOptions.ground ? rendererOptions.ground.geometry.positions[1] : null);
    return createFakeRenderer();
  };
  const studio = createStudio(dom.container, { createRenderer });
  testContext.after(() => {
    studio.dispose();
    dom.uninstall();
  });
  studio.renderNow();
  return { studio, floorHeights };
}

function recipeLoweredBy(distance) {
  const recipe = structuredClone(PLAIN_RECIPE);
  recipe.nodes[0].translation[1] -= distance;
  return recipe;
}

test('a recipe opened lower than the starting scene gets the Studio floor at its own height', testContext => {
  const ui = mountStudioRecordingFloors(testContext);
  ui.studio.controller.loadRecipe(recipeLoweredBy(5));
  ui.studio.renderNow();
  ui.studio.renderNow();

  assert.equal(ui.floorHeights.length, 2, 'the opened recipe builds one new renderer');
  assert.equal(ui.floorHeights[1], Math.fround(studioFloorHeight(ui.studio.controller.scene.parts)));
  assert.ok(ui.floorHeights[1] < -4, 'the floor went down with the scene');
});

test('a recipe opened at the same height and a part moved down build no new renderer', testContext => {
  const ui = mountStudioRecordingFloors(testContext);
  ui.studio.controller.loadRecipe(structuredClone(PLAIN_RECIPE));
  ui.studio.renderNow();
  assert.equal(ui.floorHeights.length, 1, 'same floor height: the renderer stays');

  ui.studio.controller.updateNodeTransform('hero', { translation: [0, -3, 0] });
  ui.studio.renderNow();
  assert.ok(studioFloorHeight(ui.studio.controller.scene.parts) < -2, 'the part did move down');
  assert.equal(ui.floorHeights.length, 1, 'an edit inside the scene leaves the floor and the renderer alone');
});
