import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene, loadAllAgentSceneModules } from '../src/agent-scene.js';
import { changesUvs } from '../src/agent-scene-assets.js';

await loadAllAgentSceneModules();

const IDS = Object.fromEntries(['color', 'normal', 'roughness'].map((role, index) => [role, 'abcdef'[index].repeat(64)]));
const MAPS = { colorMap: IDS.color, normalMap: IDS.normal, roughnessMap: IDS.roughness };

function frame(pixel) {
  const data = new Uint8ClampedArray(16);
  for (let offset = 0; offset < data.length; offset += 4) data.set(pixel, offset);
  return { width: 2, height: 2, data };
}

const images = new Map(Object.values(IDS).map(id => [id, frame([128, 128, 255, 255])]));

function sceneWith(material, nodeFields = {}, geometry = { id: 'quad', type: 'grid', segments: 2 }) {
  return createAgentScene({
    format: 'crucible.scene', schemaVersion: 1,
    geometries: [geometry],
    materials: [{ id: 'ground', ...material }],
    nodes: [{ id: 'ground', geometry: geometry.id, material: 'ground', ...nodeFields }],
    camera: { eye: [0, 3, 3], target: [0, 0, 0], fov: 45 },
  }, {}, { sequenceFrames: images });
}

function uvsOf(scene) {
  return Array.from(scene.parts[0].geometry.uvs);
}

const plainUvs = uvsOf(sceneWith({}));

test('a material without the UV fields draws the very same geometry and UVs as before', () => {
  const plain = sceneWith({ ...MAPS });
  assert.deepEqual(uvsOf(plain), plainUvs);
  const identity = sceneWith({ ...MAPS, uvScale: 1, uvOffset: [0, 0], uvRotation: 0 });
  assert.deepEqual(uvsOf(identity), plainUvs);
  assert.equal(identity.parts[0].geometry.positions.length, plain.parts[0].geometry.positions.length);
});

test('uvScale repeats every map: one number scales both axes, a pair scales each', () => {
  const scene = sceneWith({ ...MAPS, uvScale: 50 });
  assert.deepEqual(uvsOf(scene), plainUvs.map(value => value * 50));
  const { material } = scene.parts[0];
  assert.ok(material.map && material.normalMap && material.metallicRoughnessMap, 'every map reads the one transformed UV set');
  const pair = uvsOf(sceneWith({ ...MAPS, uvScale: [2, 3] }));
  plainUvs.forEach((value, index) => assert.ok(Math.abs(pair[index] - value * (index % 2 === 0 ? 2 : 3)) < 1e-6));
});

test('uvOffset and uvRotation follow KHR_texture_transform: scale, then rotate, then offset', () => {
  const offset = uvsOf(sceneWith({ ...MAPS, uvOffset: [0.25, -0.5] }));
  plainUvs.forEach((value, index) => assert.ok(Math.abs(offset[index] - (value + (index % 2 === 0 ? 0.25 : -0.5))) < 1e-6));
  const rotated = uvsOf(sceneWith({ ...MAPS, uvScale: [2, 2], uvRotation: 90, uvOffset: [1, 0] }));
  for (let index = 0; index < plainUvs.length; index += 2) {
    const [u, v] = [plainUvs[index] * 2, plainUvs[index + 1] * 2];
    assert.ok(Math.abs(rotated[index] - (v + 1)) < 1e-5, 'u becomes v after a quarter turn');
    assert.ok(Math.abs(rotated[index + 1] - -u) < 1e-5, 'v becomes -u after a quarter turn');
  }
});

test('worldScale gives one tile the same metres whatever the mesh size', () => {
  const small = uvsOf(sceneWith({ ...MAPS, worldScale: 2 }, { scale: [10, 10, 10] }));
  const large = uvsOf(sceneWith({ ...MAPS, worldScale: 2 }, { scale: [100, 100, 100] }));
  const range = uvs => Math.max(...uvs) - Math.min(...uvs);
  const unit = range(plainUvs);
  assert.ok(Math.abs(range(small) - unit * 5) < 1e-3, 'a mesh 10 times the base size at 2 m a tile gives 5 tiles per base unit');
  assert.ok(Math.abs(range(large) / range(small) - 10) < 1e-3, 'ten times the mesh is ten times the tiles');
});

test('the UV transform is checked: ranges, shapes, maps and UVs are named in the error', () => {
  assert.throws(() => sceneWith({ ...MAPS, uvScale: 0 }), /uvScale: got 0; expected a number from 0.001 to 10000/);
  assert.throws(() => sceneWith({ ...MAPS, uvScale: [1, 20000] }), /uvScale\[1\]: got 20000; expected a number from 0.001 to 10000/);
  assert.throws(() => sceneWith({ ...MAPS, uvScale: [1, 2, 3] }), /uvScale: got \[1,2,3\]; expected two numbers \[u, v\]/);
  assert.throws(() => sceneWith({ ...MAPS, uvOffset: 'left' }), /uvOffset: got "left"; expected two numbers/);
  assert.throws(() => sceneWith({ ...MAPS, uvRotation: 720 }), /uvRotation: got 720; expected a number from -360 to 360/);
  assert.throws(() => sceneWith({ ...MAPS, worldScale: -1 }), /worldScale: got -1; expected a number from 0.001 to 100000/);
  assert.throws(() => sceneWith({ ...MAPS, uvScale: 4, worldScale: 2 }), /worldScale: got 2; expected nothing next to uvScale/);
  assert.throws(() => sceneWith({ uvScale: 4 }), /uvScale: got 4; expected a material that sets colorMap/);
});

test('changesUvs is false only for a transform that leaves the UVs alone', () => {
  assert.equal(changesUvs({}), false);
  assert.equal(changesUvs({ uvScale: [1, 1], uvOffset: [0, 0], uvRotation: 0 }), false);
  assert.equal(changesUvs({ uvScale: [1, 2] }), true);
  assert.equal(changesUvs({ worldScale: 1 }), true);
});

test('a chunked terrain, whose mesh follows the camera, keeps its tile size too', () => {
  const terrain = { id: 'hills', type: 'terrain', size: 400, resolution: 16, chunks: 4, levels: 3, amplitude: 10, seed: 5 };
  const scene = sceneWith({ ...MAPS, worldScale: 4 }, {}, terrain);
  const uvs = uvsOf(scene);
  const widest = Math.max(...uvs) - Math.min(...uvs);
  assert.ok(Math.abs(widest - 100) < 1, `400 m at 4 m a tile is 100 tiles across, got ${widest}`);
});
