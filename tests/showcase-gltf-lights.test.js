import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGltf } from '../src/gltf.js';
import { mergePartLights, showcaseEnvironment } from '../src/dense-lods.js';

const TRIANGLE_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

function glbWithPointLight() {
  const bytes = new Uint8Array(TRIANGLE_POSITIONS.buffer);
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'Triangle', mesh: 0 }, { name: 'Lamp', translation: [0, 2, 0], extensions: { KHR_lights_punctual: { light: 0 } } }],
    extensionsUsed: ['KHR_lights_punctual'],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point', intensity: 5 }] } },
    meshes: [{ name: 'Body', primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
  });
}

test('a showcase GLB with a point light reaches the environment it draws with (#2666)', async () => {
  const asset = await parseGltf(glbWithPointLight());
  const sky = { width: 1, height: 1 };
  const environment = showcaseEnvironment(asset.lights, undefined, sky);
  assert.equal(environment.pointLights.length, 1);
  assert.deepEqual(environment.pointLights[0].position, [0, 2, 0]);
  assert.equal(environment.map, sky);
});

test('a showcase scene.json renderer.environment still wins key by key over the GLB lights (#2666)', async () => {
  const asset = await parseGltf(glbWithPointLight());
  const environment = showcaseEnvironment(asset.lights, { pointLights: [], exposure: 2 }, null);
  assert.deepEqual(environment.pointLights, []);
  assert.equal(environment.exposure, 2);
});

test('the lights of every staged part of a showcase world reach the environment (#2666)', async () => {
  const firstPart = await parseGltf(glbWithPointLight());
  const laterPart = await parseGltf(glbWithPointLight());
  const merged = mergePartLights([firstPart.lights, laterPart.lights, {}]);
  assert.equal(merged.pointLights.length, 2);
  assert.equal(merged.keyIntensity, 0);
  assert.equal(merged.fillIntensity, 0);
});

test('a later staged part with a directional light still gives the world its key light (#2666)', () => {
  const sun = { keyColor: [3, 3, 3], lightDirection: [0, 1, 0], keyIntensity: 1, fillIntensity: 0 };
  const merged = mergePartLights([{}, sun]);
  assert.deepEqual(merged.lightDirection, [0, 1, 0]);
  assert.equal(merged.keyIntensity, 1);
  assert.deepEqual(mergePartLights([{}, {}]), {});
});
