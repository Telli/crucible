import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
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
