import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGltf } from '../src/gltf.js';
import { createAgentScene, loadAllAgentSceneModules } from '../src/agent-scene.js';
import { assetCopyKey } from '../src/agent-scene-assets.js';
import { skinnedStripAsset } from './fixtures/skinned-strip.js';

const ASSET_ID = 'cd'.repeat(32);
const SIZE = 256;

await loadAllAgentSceneModules();

// A 2 by 2 base colour that is not symmetric: red top left, green top right, blue bottom left, white bottom right.
const BASE_COLOR_PIXELS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];

function textureOf(pixels, colorSpace) {
  const data = new Uint8ClampedArray(16);
  pixels.forEach((pixel, index) => data.set([...pixel, 255], index * 4));
  return { image: { width: 2, height: 2, data }, colorSpace, uvChannel: 0 };
}

// The strip fixture with a textured scan material: a base colour, a roughness map (green 51 is 0.2) and a normal map.
async function scanAssets({ withNormalMap = true, withBaseColor = true } = {}) {
  const asset = await parseGltf(skinnedStripAsset(gltf => { gltf.materials[0].name = 'Rock'; }));
  const part = asset.parts[0];
  part.geometry.uvs = new Float32Array([0.05, 0.05, 0.95, 0.05, 0.05, 0.95, 0.95, 0.95, 0.5, 0.5, 0.25, 0.75].slice(0, (part.geometry.positions.length / 3) * 2));
  part.material = {
    ...part.material,
    ...(withBaseColor ? { map: textureOf(BASE_COLOR_PIXELS, 'srgb') } : {}),
    metallicRoughnessMap: textureOf([[255, 51, 0], [255, 51, 0], [255, 51, 0], [255, 51, 0]], 'linear'),
    ...(withNormalMap ? { normalMap: textureOf([[128, 128, 255], [128, 128, 255], [128, 128, 255], [128, 128, 255]], 'linear') } : {}),
  };
  return { assets: new Map([[assetCopyKey(ASSET_ID, 0), asset]]), asset };
}

function recipeWith(assetField) {
  return {
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [], materials: [],
    nodes: [
      { id: 'rock', asset: { id: ASSET_ID, ...assetField } },
      { id: 'plain', translation: [3, 0, 0], asset: { id: ASSET_ID } },
    ],
  };
}

async function build(assetField, options) {
  const { assets, asset } = await scanAssets(options);
  const scene = createAgentScene(recipeWith(assetField), {}, { assets });
  const materialOf = prefix => scene.parts.find(part => part.name.startsWith(prefix)).material;
  return { scene, asset, rock: materialOf('rock/'), plain: materialOf('plain/') };
}

const pixelAt = (descriptor, column, row) => Array.from(descriptor.image.data.slice((row * descriptor.image.width + column) * 4, (row * descriptor.image.width + column) * 4 + 4));
// Bilinear sampling and the sRGB round trip move a channel by a few levels.
function assertNear(actual, expected) {
  expected.forEach((value, channel) => assert.ok(Math.abs(actual[channel] - value) <= 30, `channel ${channel}: ${actual[channel]} is not near ${value}`));
}
const colorGraph = color => ({ pattern: { resolution: SIZE, graph: { color } } });
const readBase = { base: { output: 'color' } };

test('a graph on a placed scan reads the scan base colour at the same uv', async () => {
  const { rock, plain } = await build(colorGraph(readBase));
  assert.equal(rock.map.image.width, SIZE);
  // Bilinear sampling of a 2 by 2 texture: the middle of each quadrant is the texel itself, row 0 is the top.
  assertNear(pixelAt(rock.map, SIZE / 4, SIZE / 4), [255, 0, 0]);
  assertNear(pixelAt(rock.map, (SIZE * 3) / 4, SIZE / 4), [0, 255, 0]);
  assertNear(pixelAt(rock.map, SIZE / 4, (SIZE * 3) / 4), [0, 0, 255]);
  assert.equal(plain.map.image.width, 2, 'a placement without a graph keeps the scan texture');
});

test('a graph keeps the scan roughness and normal maps for the outputs it does not write', async () => {
  const { rock, asset } = await build(colorGraph(readBase));
  assert.equal(rock.normalMap, asset.parts[0].material.normalMap);
  assert.equal(pixelAt(rock.metallicRoughnessMap, 10, 10)[1], 51, 'roughness is read back from the scan');
  assert.equal(rock.map.uvChannel, 0);
});

test('a layer on top keeps the scan colour where its mask is 0 and shows the top where it is 1', async () => {
  const layer = mask => ({ layer: { base: readBase, top: [1, 1, 1], mask, edge: 0.5, softness: 0 } });
  const plainRead = (await build(colorGraph(readBase))).rock.map;
  const none = (await build(colorGraph(layer(0)))).rock.map;
  const full = (await build(colorGraph(layer(1)))).rock.map;
  assert.deepEqual(Array.from(none.image.data), Array.from(plainRead.image.data));
  assert.deepEqual(pixelAt(full, SIZE / 4, SIZE / 4), [255, 255, 255, 255]);
});

test('the surface mask works on an imported part', async () => {
  const mask = { surface: { output: 'normalY', space: 'world' } };
  const layer = edge => ({ layer: { base: readBase, top: [1, 1, 1], mask, edge, softness: 0 } });
  const low = (await build(colorGraph(layer(0.05)))).rock.map;
  const high = (await build(colorGraph(layer(0.95)))).rock.map;
  assert.notDeepEqual(Array.from(low.image.data), Array.from(high.image.data));
});

test('a placement with no graph is untouched', async () => {
  const { plain, asset } = await build(colorGraph(readBase));
  assert.equal(plain.map, asset.parts[0].material.map);
  assert.equal(plain.assetGraph, undefined);
});

test('a placed asset graph names what it does not take', async () => {
  await assert.rejects(build(colorGraph({ base: { output: 'normal' } }), { withNormalMap: false }), /no normalMap/);
  await assert.rejects(build(colorGraph({ base: { output: 'color' } }), { withBaseColor: false }), /no map/);
  await assert.rejects(build({ pattern: { graph: { height: 0.5 } } }), /asset\.pattern\.graph\.height.*normal map/);
  await assert.rejects(build({ pattern: { graph: { color: { image: { asset: 'ab'.repeat(32) } } } } }), /without image nodes/);
  await assert.rejects(build({ pattern: { graph: { color: readBase } }, flatten: { unlit: true } }), /asset\.pattern.*flatten/);
  await assert.rejects(build({ materials: [{ name: 'Rock', id: 'rock-heat', pattern: { graph: { color: readBase } } }] }), /materials\[0\]\.pattern.*without an id/);
  await assert.rejects(build({ pattern: { graph: { color: readBase }, mapping: 'box' } }), /mapping/);
});

test('a base node on a recipe material is refused with where to put it', () => {
  const recipe = { format: 'crucible.scene', schemaVersion: 1, geometries: [{ id: 'box', type: 'box' }], materials: [{ id: 'stone', pattern: { type: 'graph', graph: { color: readBase } } }], nodes: [{ id: 'box', geometry: 'box', material: 'stone' }] };
  assert.throws(() => createAgentScene(recipe), /base node.*asset\.materials\[\]\.pattern or asset\.pattern/);
});

test('a graph over the work budget is refused when the placement is built', async () => {
  const heavy = { pattern: { resolution: 1024, graph: { color: { noise: { scale: 8, octaves: 6 } }, roughness: { noise: { scale: 9, octaves: 6 } }, metallic: { noise: { scale: 7, octaves: 6 } }, emission: { noise: { scale: 6, octaves: 6 } }, opacity: { noise: { scale: 5, octaves: 6 } }, clearcoat: { noise: { scale: 4, octaves: 6 } }, transmission: { noise: { scale: 3, octaves: 6 } } } } };
  await assert.rejects(build(heavy), /work units/);
});

test('a graph on one named material leaves the other materials of the placement alone', async () => {
  const { rock } = await build({ materials: [{ name: 'Rock', pattern: { resolution: SIZE, graph: { color: readBase } } }] });
  assert.equal(rock.map.image.width, SIZE);
});
