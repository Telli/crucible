import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGltf } from '../src/gltf.js';

const triangleBytes = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);

/** A one-triangle glTF; `change(document)` edits the JSON before it is serialized. */
function triangleJson(change) {
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    buffers: [{ byteLength: 36, uri: `data:application/octet-stream;base64,${Buffer.from(triangleBytes).toString('base64')}` }],
  };
  change(document);
  return JSON.stringify(document);
}

const animateNode = document => {
  document.animations = [{ channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }], samplers: [{ input: 1, output: 2 }] }];
};

test('a null or absent list still loads', async () => {
  await parseGltf(triangleJson(document => {
    document.nodes[0].children = null;
    document.extensionsUsed = null;
    document.extensionsRequired = null;
  }));
});

test('a list field that is not an array fails by its glTF path, not with a TypeError', async () => {
  const cases = [
    ['nodes[0].children', document => { document.nodes[0].children = 0; }],
    ['animations[0].channels', document => { animateNode(document); document.animations[0].channels = {}; }],
    ['animations[0].samplers', document => { animateNode(document); document.animations[0].samplers = true; }],
    ['extensionsUsed', document => { document.extensionsUsed = 'KHR_lights_punctual'; }],
    ['extensionsRequired', document => { document.extensionsRequired = 5; }],
  ];
  for (const [path, change] of cases) {
    await assert.rejects(() => parseGltf(triangleJson(change)), error => error.constructor === Error && error.message.includes(`Invalid glTF ${path}: expected an array`), path);
  }
});

test('a null animation channel fails by its glTF path', async () => {
  const text = triangleJson(document => {
    animateNode(document);
    document.animations[0].channels.push(null);
  });
  await assert.rejects(() => parseGltf(text), error => error.constructor === Error && error.message.includes('animations[0].channels[1]'));
});

test('a node or mesh name that is not a string fails by its glTF path, not with a TypeError', async () => {
  const nodeName = triangleJson(document => { document.nodes[0].name = 7; });
  await assert.rejects(() => parseGltf(nodeName), error => error.constructor === Error && error.message.includes('nodes[0].name 7'));
  const meshName = triangleJson(document => { document.meshes[0].name = ['a']; });
  await assert.rejects(() => parseGltf(meshName), error => error.constructor === Error && error.message.includes('meshes[0].name'));
});
