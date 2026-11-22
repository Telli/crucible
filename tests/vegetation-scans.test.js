import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageMetadata from '../package.json' with { type: 'json' };
import { createAgentScene, loadAllAgentSceneModules } from '../src/agent-scene.js';
import { sequenceFrameIds } from '../src/agent-texture-sequence.js';
import { gameImageIds } from '../src/game-assets.js';
import { VEGETATION_SCANS_PACK, fillVegetationScans, needsVegetationScans, vegetationScansFromPack } from '../src/agent-vegetation-scans.js';
import { loadPack } from '../scripts/agent-packs.mjs';
import { createAgentRuntime } from '../scripts/agent-runtime.mjs';

await loadAllAgentSceneModules();

const imageId = number => number.toString(16).padStart(64, '0');

function solidFrame(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data.set([...rgb, 255], offset);
  }
  return { width, height, data };
}

const BROADLEAF_SCANS = {
  bark: { colorMap: imageId(1), normalMap: imageId(2), roughnessMap: imageId(3) },
  leaves: { colorMap: imageId(4), normalMap: imageId(5), crownMap: imageId(6) },
};

function scanPool() {
  return new Map([
    [imageId(1), solidFrame(8, 8, [100, 80, 60])],
    [imageId(2), solidFrame(8, 8, [128, 128, 255])],
    [imageId(3), solidFrame(4, 4, [200, 200, 200])],
    [imageId(4), solidFrame(16, 16, [60, 120, 40])],
    [imageId(5), solidFrame(16, 16, [128, 128, 255])],
    [imageId(6), solidFrame(16, 16, [50, 110, 30])],
  ]);
}

function oakRecipe(vegetation) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    nodes: [{ id: 'oak', vegetation: { species: 'broadleaf', seed: 21, height: 8, ...vegetation } }],
    camera: { eye: [0, 2, 14], target: [0, 5, 0] },
  };
}

const partNamed = (scene, role) => scene.parts.find(part => part.name.endsWith(`/${role}`));

test('a recipe tree with scans draws its bark and leaf cards from the decoded catalog images (#2986)', () => {
  const scene = createAgentScene(oakRecipe({ scans: { broadleaf: BROADLEAF_SCANS } }), {}, { sequenceFrames: scanPool() });
  const bark = partNamed(scene, 'bark').material;
  assert.equal(bark.map.image.width, 8);
  assert.equal(bark.normalMap.image.width, 8);
  // Roughness is repacked into green, with red and blue at 255, the glTF metallic-roughness layout.
  assert.deepEqual(Array.from(bark.metallicRoughnessMap.image.data.slice(0, 4)), [255, 200, 255, 255]);
  const leaves = partNamed(scene, 'foliage').material;
  assert.equal(leaves.map.image.width, 16);
  assert.deepEqual(Array.from(leaves.map.image.data.slice(0, 3)), [60, 120, 40]);
  assert.equal(leaves.map.wrapS, 33071, 'cards clamp at their edges');
  assert.equal(leaves.normalMap.colorSpace, 'linear');
});

test('without scans the tree keeps its procedural bark and leaves (#2986)', () => {
  const scanned = createAgentScene(oakRecipe({ scans: { broadleaf: BROADLEAF_SCANS } }), {}, { sequenceFrames: scanPool() });
  const plain = createAgentScene(oakRecipe({}));
  assert.notEqual(partNamed(plain, 'bark').material.map.image.width, 8);
  assert.equal(partNamed(plain, 'bark').material.normalMap, undefined);
  assert.notDeepEqual(Array.from(partNamed(plain, 'foliage').material.map.image.data.slice(0, 3)), [60, 120, 40]);
  assert.equal(partNamed(plain, 'foliage').geometry.indices.length, partNamed(scanned, 'foliage').geometry.indices.length, 'scans change the look, not the leaves grown');
});

test('a season recolours a scanned card instead of swapping in the procedural sprite (#2986)', () => {
  const scene = createAgentScene(oakRecipe({ season: 0.5, scans: { broadleaf: BROADLEAF_SCANS } }), {}, { sequenceFrames: scanPool() });
  const [red, green] = partNamed(scene, 'foliage').material.map.image.data;
  assert.ok(red > 60 * 1.5, `autumn raises the red of the scan; got ${red}`);
  assert.ok(green < 120 * 1.1, `and keeps its green near the scan; got ${green}`);
  assert.equal(partNamed(scene, 'foliage').material.map.image.width, 16, 'still the scanned card');
});

test('the scan images travel with the recipe, so previews and web exports load them (#2986)', () => {
  const recipe = oakRecipe({ scans: { broadleaf: BROADLEAF_SCANS } });
  const expected = [1, 2, 3, 4, 5, 6].map(imageId).sort();
  assert.deepEqual(sequenceFrameIds(recipe).sort(), expected);
  assert.deepEqual(gameImageIds(recipe).sort(), expected);
});

test('bad scans fail with a message that names the field and the fix (#2986)', () => {
  assert.throws(() => createAgentScene(oakRecipe({ scans: { oak: BROADLEAF_SCANS } })), /vegetation\.scans\.oak.*broadleaf/);
  assert.throws(() => createAgentScene(oakRecipe({ scans: { broadleaf: { bark: { normalMap: imageId(2) } } } })), /vegetation\.scans\.broadleaf\.bark\.colorMap/);
  assert.throws(() => createAgentScene(oakRecipe({ scans: { broadleaf: { bark: { colorMap: 'bark.png' } } } })), /64 hexadecimal characters/);
  assert.throws(() => createAgentScene(oakRecipe({ scans: { broadleaf: BROADLEAF_SCANS } })), /scans\.broadleaf\.bark.*was not loaded/);
});

test('the server fills scans on trees that have none, for the species they grow (#2986)', () => {
  const scansBySpecies = vegetationScansFromPack([
    { id: 'broadleaf-bark-color', assetId: imageId(1) }, { id: 'broadleaf-leaf-color', assetId: imageId(4) },
    { id: 'bush-bark-color', assetId: imageId(7) }, { id: 'birch-leaf-normal', assetId: imageId(8) }, { id: 'readme', assetId: imageId(9) },
  ]);
  assert.deepEqual(scansBySpecies, { broadleaf: { bark: { colorMap: imageId(1) }, leaves: { colorMap: imageId(4) } }, bush: { bark: { colorMap: imageId(7) } } }, 'a part without a colour map is dropped');
  const recipe = {
    nodes: [
      { id: 'oak', vegetation: { species: 'broadleaf' } },
      { id: 'forest', vegetation: { mix: { bush: 1, grass: 2 }, scatter: { ground: 'ground' } } },
      { id: 'meadow', vegetation: { species: 'grass', scatter: { ground: 'ground' } } },
      { id: 'kept', vegetation: { species: 'broadleaf', scans: {} } },
    ],
  };
  assert.equal(needsVegetationScans(recipe), true);
  fillVegetationScans(recipe, scansBySpecies);
  assert.deepEqual(recipe.nodes[0].vegetation.scans, { broadleaf: scansBySpecies.broadleaf });
  assert.deepEqual(recipe.nodes[1].vegetation.scans, { bush: scansBySpecies.bush });
  assert.equal(recipe.nodes[2].vegetation.scans, undefined, 'grass has no scan');
  assert.deepEqual(recipe.nodes[3].vegetation.scans, {}, 'scans: {} keeps the tree procedural');
  const edits = [{ op: 'add-node', node: { id: 'pine', vegetation: { species: 'bush' } } }, { op: 'set', node: 'oak', vegetation: { season: 0.4 } }];
  fillVegetationScans(edits, scansBySpecies);
  assert.deepEqual(edits[0].node.vegetation.scans, { bush: scansBySpecies.bush });
  assert.equal(edits[1].vegetation.scans, undefined, 'an edit without species is left alone');
});

test('the vegetation-scans pack loads and gives each species its scans (#2986)', async () => {
  const folder = fileURLToPath(new URL('../packs/vegetation-scans', import.meta.url));
  const pack = await loadPack(folder, { packageVersion: packageMetadata.version });
  assert.equal(pack.name, VEGETATION_SCANS_PACK);
  assert.equal(pack.license, 'CC0-1.0');
  const scans = vegetationScansFromPack(pack.items.images);
  assert.deepEqual(Object.keys(scans).sort(), ['birch', 'broadleaf', 'bush', 'conifer', 'palm']);
  assert.deepEqual(Object.keys(scans.broadleaf.bark).sort(), ['colorMap', 'normalMap', 'roughnessMap']);
  assert.deepEqual(Object.keys(scans.broadleaf.leaves).sort(), ['colorMap', 'crownMap', 'normalMap']);
  assert.equal(scans.birch.bark, undefined, 'birch keeps its procedural white bark');
  assert.equal(scans.palm.leaves, undefined, 'palm keeps its procedural fronds');
  const recipe = oakRecipe({});
  fillVegetationScans(recipe, scans);
  assert.equal(sequenceFrameIds(recipe).length, 6);
});

test('scene_capabilities says whether the vegetation-scans pack is on (#2986)', async context => {
  const parent = mkdtempSync(join(tmpdir(), 'crucible-vegetation-scans-'));
  context.after(() => rmSync(parent, { recursive: true, force: true }));
  const empty = mkdtempSync(join(tmpdir(), 'crucible-no-packs-'));
  context.after(() => rmSync(empty, { recursive: true, force: true }));
  cpSync(fileURLToPath(new URL('../packs/vegetation-scans', import.meta.url)), join(parent, VEGETATION_SCANS_PACK), { recursive: true });
  const withPack = createAgentRuntime({ packs: parent, previewUrl: new URL('file:///unused.js') });
  const withoutPack = createAgentRuntime({ packs: empty, previewUrl: new URL('file:///unused.js') });
  context.after(() => Promise.all([withPack.close(), withoutPack.close()]));
  assert.match((await withPack.capabilities()).packs.vegetationScans, /^on:/);
  assert.match((await withoutPack.capabilities()).packs.vegetationScans, /^off:.*install the vegetation-scans pack/);
});
