import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { createStudio, createStudioController } from '../src/studio.js';
import { createStudioCatalog } from '../src/studio-catalog.js';
import { skinnedStripAsset } from './fixtures/skinned-strip.js';
import { createFakeRenderer, installStudioDom } from './support/studio-dom.mjs';

const SCAN_ID = 'ab'.repeat(32);
const SKY_WIDTH = 8;
const SKY_HEIGHT = 4;

function flatRadianceFile() {
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${SKY_HEIGHT} +X ${SKY_WIDTH}\n`);
  const pixels = new Uint8Array(SKY_WIDTH * SKY_HEIGHT * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels.set([120, 140, 200, 129], offset);
  }
  const file = new Uint8Array(header.length + pixels.length);
  file.set(header, 0);
  file.set(pixels, header.length);
  return file;
}

function scanBytes() {
  const glb = skinnedStripAsset();
  return glb instanceof ArrayBuffer ? new Uint8Array(glb) : glb;
}

function plainRecipe() {
  return {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'ground', type: 'box' }],
    materials: [{ id: 'grass', tag: 'surface', color: [0.2, 0.5, 0.2], roughness: 0.8, metallic: 0 }],
    nodes: [{ id: 'floor', geometry: 'ground', material: 'grass', scale: [20, 0.1, 20] }],
  };
}

function scanRecipe(skyReference) {
  const recipe = plainRecipe();
  recipe.nodes.push({ id: 'rock', translation: [1, 0, 0], asset: { id: SCAN_ID } }, { id: 'rock-two', translation: [-1, 0, 0], asset: { id: SCAN_ID } });
  recipe.environment = { hdri: skyReference };
  return recipe;
}

function countingHooks() {
  const calls = { asset: [], environment: [] };
  return {
    calls,
    hooks: {
      async asset(id) {
        calls.asset.push(id);
        return scanBytes();
      },
      async environment(reference) {
        calls.environment.push(reference);
        return flatRadianceFile().buffer;
      },
    },
  };
}

test('a catalog loads the scans and the sky a recipe names, once, and the scene survives reload, undo and redo', async () => {
  const skyReference = '1a'.repeat(32);
  const { calls, hooks } = countingHooks();
  const catalog = createStudioCatalog(hooks);
  const recipe = scanRecipe(skyReference);
  assert.equal(catalog.needsLoading(plainRecipe()), false);
  assert.equal(catalog.needsLoading(recipe), true);

  await Promise.all([catalog.prepare(recipe), catalog.prepare(recipe)]);
  assert.deepEqual(calls.asset, [SCAN_ID], 'two loads of one scene fetch the scan once');
  assert.deepEqual(calls.environment, [skyReference]);
  assert.equal(catalog.needsLoading(recipe), false);

  const controller = createStudioController({ scene: createAgentScene(plainRecipe()), assets: catalog.pool });
  controller.loadRecipe(recipe);
  const placedParts = controller.scene.parts.filter(part => part.name.startsWith('rock'));
  assert.ok(placedParts.length >= 2, 'both placements draw');
  const exported = controller.exportRecipe();
  assert.equal(exported.environment.hdri, skyReference, 'the recipe keeps naming the sky by reference');
  assert.deepEqual(exported.nodes.filter(node => node.asset).map(node => node.asset.id), [SCAN_ID, SCAN_ID]);

  controller.selectNode('rock');
  assert.ok(controller.selectionSilhouette()?.length > 0, 'a selected scan is outlined along its own shape');
  assert.ok(placedParts.some(part => part.name === 'rock/0'), 'a scan draws as parts named after its node');
  controller.selectNode(null);

  controller.undo();
  assert.equal(controller.exportRecipe().nodes.some(node => node.asset), false);
  controller.redo();
  assert.equal(controller.exportRecipe().nodes.filter(node => node.asset).length, 2, 'redo rebuilds from the same pool');
  assert.deepEqual(calls.asset, [SCAN_ID]);

  const decoded = [...catalog.pool.values()];
  catalog.dispose();
  assert.equal(catalog.pool.size, 0);
  assert.equal(decoded.length, 1, 'still placements share copy 0');
  assert.equal(catalog.needsLoading(recipe), true, 'after dispose the scans load again');
});

test('a catalog says which hook is missing and refuses hooks and files it cannot use', async () => {
  const recipe = scanRecipe('2b'.repeat(32));
  await assert.rejects(createStudioCatalog().prepare(recipe), /catalog scan abababababab.*catalog: \{ asset: async reference => bytes \}/);
  const onlyScans = createStudioCatalog({ asset: async () => scanBytes() });
  await assert.rejects(onlyScans.prepare(recipe), /catalog HDRI 2b2b2b2b2b2b.*catalog: \{ environment:/);
  assert.equal(onlyScans.pool.size, 1, 'what loaded before the failure stays loaded');
  await assert.rejects(createStudioCatalog({ asset: async () => 'not bytes' }).prepare(recipe), /catalog\.asset returned string.*ArrayBuffer or a Uint8Array/);
  assert.throws(() => createStudioCatalog({ texture: async () => null }), /catalog\.texture is not a hook Studio calls\. Use asset, environment, look/);
  assert.throws(() => createStudioCatalog({ asset: 'scans/' }), /catalog\.asset must be a function/);
  assert.throws(() => createStudioCatalog([]), /catalog must be an object/);
});

function identityCubeText() {
  const rows = [];
  for (const blue of [0, 1]) {
    for (const green of [0, 1]) {
      for (const red of [0, 1]) {
        rows.push(`${red} ${green} ${blue}`);
      }
    }
  }
  return `TITLE "identity"\nLUT_3D_SIZE 2\n${rows.join('\n')}\n`;
}

test('a catalog loads the .cube look a recipe names, once, and the scene builds with it', async () => {
  const lookReference = '5e'.repeat(32);
  const recipe = plainRecipe();
  recipe.environment = { look: lookReference };
  const lookCalls = [];
  const catalog = createStudioCatalog({
    async look(reference) {
      lookCalls.push(reference);
      return identityCubeText();
    },
  });
  assert.equal(catalog.needsLoading(recipe), true);
  await assert.rejects(createStudioCatalog().prepare(recipe), /catalog look 5e5e5e5e5e5e.*catalog: \{ look:/);
  await assert.rejects(createStudioCatalog({ look: async () => new Uint8Array(4) }).prepare(recipe), /catalog\.look returned object.*Return the text of the \.cube file/);

  await catalog.prepare(recipe);
  await catalog.prepare(recipe);
  assert.deepEqual(lookCalls, [lookReference]);
  assert.equal(catalog.needsLoading(recipe), false);

  const controller = createStudioController({ scene: createAgentScene(plainRecipe()), assets: catalog.pool });
  controller.loadRecipe(recipe);
  assert.equal(controller.exportRecipe().environment.look, lookReference, 'the recipe keeps naming the look by reference');
  catalog.dispose();
});

// The fake browser never fires timers, and the GLB decoder hands the thread back through one when a slice runs long.
// A scheduler that yields at once keeps the decode moving, as a real page's would.
function installImmediateScheduler(testContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'scheduler');
  Object.defineProperty(globalThis, 'scheduler', { value: { yield: () => Promise.resolve() }, configurable: true, writable: true });
  testContext.after(() => {
    if (previous) {
      Object.defineProperty(globalThis, 'scheduler', previous);
    } else {
      delete globalThis.scheduler;
    }
  });
}

test('Studio opens on the template, then shows a recipe with catalog files once they load', async testContext => {
  installImmediateScheduler(testContext);
  const dom = installStudioDom(testContext);
  const skyReference = '3c'.repeat(32);
  const { calls, hooks } = countingHooks();
  const studio = createStudio(dom.container, { recipe: scanRecipe(skyReference), renderer: createFakeRenderer(), catalog: hooks });
  assert.equal(studio.exportRecipe().nodes.some(node => node.asset), false, 'the template shows while the files load');
  await studio.ready;
  assert.equal(studio.exportRecipe().nodes.filter(node => node.asset).length, 2);
  assert.equal(studio.dirty, false, 'opening the scene is not an edit');
  assert.equal(studio.controller.undo(), false, 'and leaves nothing to undo');

  await studio.openRecipe(plainRecipe());
  await studio.loadExternalTextFile(JSON.stringify(scanRecipe(skyReference)), { fileName: 'rocks.scene.json' });
  assert.equal(studio.exportRecipe().nodes.filter(node => node.asset).length, 2, 'a scene file with scans opens through the same catalog');
  assert.deepEqual(calls.asset, [SCAN_ID]);
  studio.dispose();
});

test('Studio keeps the template and reports why when a recipe needs catalog files it was given no way to load', async testContext => {
  const dom = installStudioDom(testContext);
  const studio = createStudio(dom.container, { recipe: scanRecipe('4d'.repeat(32)), renderer: createFakeRenderer() });
  await assert.rejects(studio.ready, /Studio was given no way to load it/);
  assert.equal(studio.exportRecipe().nodes.some(node => node.asset), false);
  await assert.rejects(studio.openRecipe(scanRecipe('4d'.repeat(32))), /Pass catalog: \{ asset:/);
  const plainStudio = createStudio(installStudioDom(testContext).container, { recipe: plainRecipe(), renderer: createFakeRenderer() });
  assert.equal(plainStudio.exportRecipe().nodes.length, 1, 'a recipe without catalog files still opens at once');
  await plainStudio.ready;
});

test('a recipe whose nodes are not a list loads nothing and is left to the normal validation', async () => {
  const catalog = createStudioCatalog({});
  for (const nodes of ['zzz', 7, {}, null]) {
    const recipe = { nodes };
    assert.equal(catalog.needsLoading(recipe), false);
    await catalog.prepare(recipe);
  }
});
