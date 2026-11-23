import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene, loadAgentSceneModules } from '../src/agent-scene.js';
import { agentEnvironmentMap, fitAgentShadow, resolveAgentShadow } from '../src/agent-look.js';
import { freeSpawnTranslation } from '../src/studio-controller.js';
import { createStudioController } from '../src/studio.js';
import {
  TREE_PRESET_NAMES,
  addTree,
  changeSelectedTree,
  nextTreeSeed,
  renderPresetPictures,
  singleTreeOf,
  treeControlValues,
} from '../src/studio-trees.js';

function emptyRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    nodes: [],
    camera: { eye: [0, 6, 22], target: [0, 5, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 200 },
  };
}

function mountController() {
  const scene = createAgentScene(emptyRecipe());
  const controller = createStudioController({ scene, viewportWidth: 800, viewportHeight: 600 });
  const tools = { controller, loadAgentSceneModules, findFreeSpot: freeSpawnTranslation };
  return { controller, tools };
}

function treeNodeOf(controller, nodeId) {
  return controller.exportRecipe().nodes.find(node => node.id === nodeId);
}

test('adding a tree writes a selected node whose vegetation field validates', async () => {
  const { controller, tools } = mountController();
  const node = await addTree(tools, 'oak');
  assert.equal(controller.selectedNodeId, node.id);
  const stored = treeNodeOf(controller, node.id);
  assert.equal(stored.vegetation.preset, 'oak');
  assert.ok(singleTreeOf(stored));
  assert.doesNotThrow(() => createAgentScene(controller.exportRecipe()));
  assert.equal(controller.canUndo, true);
});

test('a grown tree has bounds, so frame and the selection outline can find it', async () => {
  const { controller, tools } = mountController();
  const node = await addTree(tools, 'oak');
  const bounds = controller.nodeBounds(node.id);
  assert.ok(bounds, 'the tree node reports bounds');
  assert.ok(bounds.size[1] > 3, 'the bounds cover the whole crown, not a trunk stub');
});

test('every preset of the picker plants a tree that grows', async () => {
  const { controller, tools } = mountController();
  for (const presetName of TREE_PRESET_NAMES) {
    await addTree(tools, presetName);
  }
  const recipe = controller.exportRecipe();
  assert.equal(recipe.nodes.length, TREE_PRESET_NAMES.length);
  assert.equal(new Set(recipe.nodes.map(node => node.id)).size, TREE_PRESET_NAMES.length);
  assert.equal(createAgentScene(recipe).inspect().vegetation.length, TREE_PRESET_NAMES.length);
});

test('height, season, leaf density and seed write the vegetation field, and undo and redo restore it', async () => {
  const { controller, tools } = mountController();
  const { id } = await addTree(tools, 'birch');
  const planted = treeNodeOf(controller, id).vegetation;
  changeSelectedTree(controller, id, { height: 14.5 });
  changeSelectedTree(controller, id, { season: 0.6 });
  changeSelectedTree(controller, id, { seed: 4242 });
  changeSelectedTree(controller, id, { leafDensity: 9 });
  const tuned = treeNodeOf(controller, id).vegetation;
  assert.equal(tuned.preset, 'birch');
  assert.equal(tuned.height, 14.5);
  assert.equal(tuned.season, 0.6);
  assert.equal(tuned.seed, 4242);
  assert.equal(tuned.tree.leafCount, 9);
  assert.deepEqual(treeControlValues(tuned), { height: 14.5, season: 0.6, leafDensity: 9, seed: 4242 });

  for (let step = 0; step < 4; step += 1) {
    assert.equal(controller.undo(), true);
  }
  assert.deepEqual(treeNodeOf(controller, id).vegetation, planted);
  for (let step = 0; step < 4; step += 1) {
    assert.equal(controller.redo(), true);
  }
  assert.deepEqual(treeNodeOf(controller, id).vegetation, tuned);
});

test('a slider drag inside an undo group is one undo step', async () => {
  const { controller, tools } = mountController();
  const { id } = await addTree(tools, 'ash');
  const planted = treeNodeOf(controller, id).vegetation;
  controller.beginUndoGroup();
  for (const height of [11, 12, 13, 14]) {
    changeSelectedTree(controller, id, { height });
  }
  controller.endUndoGroup();
  assert.equal(controller.undo(), true);
  assert.deepEqual(treeNodeOf(controller, id).vegetation, planted);
});

test('the recipe saved from Studio loads identically through the agent scene path', async () => {
  const { controller, tools } = mountController();
  const { id } = await addTree(tools, 'pine');
  changeSelectedTree(controller, id, { height: 15, season: 0.35, seed: 77, leafDensity: 4 });
  const saved = JSON.parse(JSON.stringify(controller.exportRecipe()));
  const reloaded = createAgentScene(saved).exportRecipe();
  assert.deepEqual(reloaded, saved);
  assert.deepEqual(createAgentScene(reloaded).exportRecipe(), saved);
});

test('a node that is not a single tree gets no tree controls and refuses a tree edit', () => {
  const { controller } = mountController();
  assert.equal(singleTreeOf({ id: 'forest', vegetation: { mix: { broadleaf: 1 }, scatter: { ground: 'hills' } } }), null);
  assert.equal(singleTreeOf({ id: 'plain' }), null);
  assert.throws(() => changeSelectedTree(controller, 'missing', { seed: 2 }), /does not grow a single tree/);
});

test('a new seed differs from the current one and stays a whole number', () => {
  assert.equal(nextTreeSeed(5, () => 0), 1);
  const draws = [0, 0.5];
  assert.equal(nextTreeSeed(1, () => draws.shift()), 50001);
  const seed = nextTreeSeed(10);
  assert.ok(Number.isInteger(seed) && seed !== 10);
});

test('the preset pictures come from the renderer, one per preset, and the canvas leaves the page', async () => {
  const drawn = [];
  const fakeCanvas = { style: {}, removed: false, toDataURL: () => `data:image/png;count=${drawn.length}`, remove() { this.removed = true; } };
  const documentReference = { createElement: () => fakeCanvas, body: { append() {} } };
  const createRenderer = (canvas, parts) => ({
    resize() {},
    render(frame) { drawn.push({ parts: parts.length, eye: frame.eye }); },
    dispose() {},
  });
  const pictures = await renderPresetPictures({
    documentReference,
    createAgentScene,
    loadAgentSceneModules,
    createRenderer,
    agentEnvironmentMap,
    fitAgentShadow,
    resolveAgentShadow,
    presetNames: ['oak', 'bush'],
  });
  assert.deepEqual([...pictures.keys()], ['oak', 'bush']);
  assert.equal(drawn.length, 2);
  assert.ok(drawn.every(frame => frame.parts > 0));
  assert.notDeepEqual(drawn[0].eye, drawn[1].eye);
  assert.equal(fakeCanvas.removed, true);
});
