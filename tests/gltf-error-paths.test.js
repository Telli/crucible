import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGltf } from '../src/gltf.js';

function triangleDocument(edit = () => {}) {
  const bytes = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const document = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    bufferViews: [{ buffer: 0, byteLength: bytes.length }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
  };
  edit(document);
  return JSON.stringify(document);
}

test('a node with a mesh index that does not exist names nodes[i].mesh', async () => {
  const source = triangleDocument(document => { document.nodes.push({ mesh: 5 }); });
  await assert.rejects(() => parseGltf(source), /nodes\[1\]\.mesh 5/);
});

test('an accessor with a negative count names accessors[i].count', async () => {
  const source = triangleDocument(document => {
    document.accessors.push({ componentType: 5126, count: -2, type: 'SCALAR' });
  });
  await assert.rejects(() => parseGltf(source), /accessors\[1\]\.count -2/);
});

test('a child index that does not exist names nodes[i].children[j]', async () => {
  const source = triangleDocument(document => { document.nodes[0].children = [9]; });
  await assert.rejects(() => parseGltf(source), /nodes\[0\]\.children\[0\] 9/);
});

test('a node listed as a child twice names the second listing and the node', async () => {
  const source = triangleDocument(document => {
    document.nodes.push({}, {});
    document.nodes[0].children = [1];
    document.nodes[2].children = [1];
  });
  await assert.rejects(() => parseGltf(source), /nodes\[2\]\.children\[0\].*node 1 has two parents/);
});

test('a POSITION given as a string index is skipped with a POSITION warning instead of loading', async () => {
  const source = triangleDocument(document => { document.meshes[0].primitives[0].attributes.POSITION = '0'; });
  await assert.rejects(() => parseGltf(source), /Skipped primitive 0 of mesh 0: its POSITION accessor is missing/);
});
