import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { box } from '../src/geometry.js';
import { parseGltf } from '../src/gltf.js';
import { createAgentAssetCatalog } from '../scripts/agent-asset-catalog.mjs';
import { DRACO_EXTENSION, DRACO_MISSING_ADVICE, decompressDracoGlb, usesDraco } from '../scripts/agent-draco.mjs';

const draco = createRequire(import.meta.url)('draco3d');

function padded(buffer, fill) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

function glb(document, binary) {
  const json = padded(Buffer.from(JSON.stringify(document)), 0x20);
  const body = padded(binary, 0);
  const result = Buffer.alloc(28 + json.length + body.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  result.writeUInt32LE(body.length, 20 + json.length);
  result.writeUInt32LE(0x004e4942, 24 + json.length);
  body.copy(result, 28 + json.length);
  return result;
}

async function encodeBox() {
  const geometry = box(0);
  const encoderModule = await draco.createEncoderModule({});
  const encoder = new encoderModule.Encoder();
  const builder = new encoderModule.MeshBuilder();
  const mesh = new encoderModule.Mesh();
  const pointCount = geometry.positions.length / 3;
  builder.AddFacesToMesh(mesh, geometry.indices.length / 3, geometry.indices);
  const positionId = builder.AddFloatAttributeToMesh(mesh, encoderModule.POSITION, pointCount, 3, geometry.positions);
  const normalId = builder.AddFloatAttributeToMesh(mesh, encoderModule.NORMAL, pointCount, 3, geometry.normals);
  const encoded = new encoderModule.DracoInt8Array();
  const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
  const compressed = Buffer.alloc(length);
  for (let index = 0; index < length; index++) compressed.writeInt8(encoded.GetValue(index), index);
  encoderModule.destroy(encoded);
  encoderModule.destroy(mesh);
  encoderModule.destroy(builder);
  encoderModule.destroy(encoder);
  return { geometry, compressed, positionId, normalId };
}

const SPARSE_POSITION = [7, 8, 9];

async function dracoBoxGlb({ withSparse = false } = {}) {
  const { geometry, compressed, positionId, normalId } = await encodeBox();
  const pointCount = geometry.positions.length / 3;
  const compressedChunk = padded(compressed, 0);
  const sparseIndices = Buffer.from(new Uint16Array([0, 0]).buffer);
  const sparseValues = Buffer.from(new Float32Array(SPARSE_POSITION).buffer);
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: [DRACO_EXTENSION],
    extensionsRequired: [DRACO_EXTENSION],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'Box', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2,
      extensions: { [DRACO_EXTENSION]: { bufferView: 0, attributes: { POSITION: positionId, NORMAL: normalId } } } }] }],
    accessors: [
      { componentType: 5126, count: pointCount, type: 'VEC3', min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
      { componentType: 5126, count: pointCount, type: 'VEC3' },
      { componentType: 5125, count: geometry.indices.length, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: compressed.length }],
    buffers: [{ byteLength: compressedChunk.length }],
  };
  let binary = compressed;
  if (withSparse) {
    document.bufferViews.push({ buffer: 0, byteOffset: compressedChunk.length, byteLength: 2 });
    document.bufferViews.push({ buffer: 0, byteOffset: compressedChunk.length + 4, byteLength: sparseValues.length });
    document.accessors[0].sparse = { count: 1, indices: { bufferView: 1, componentType: 5123 }, values: { bufferView: 2 } };
    binary = Buffer.concat([compressedChunk, sparseIndices, sparseValues]);
    document.buffers[0].byteLength = binary.length;
  }
  return { geometry, bytes: glb(document, binary) };
}

function triangleKeys(positions, indices) {
  const keys = [];
  for (let triangle = 0; triangle < indices.length; triangle += 3) {
    const corners = [0, 1, 2].map(corner => {
      const vertex = indices[triangle + corner];
      return [0, 1, 2].map(axis => positions[vertex * 3 + axis].toFixed(4)).join(',');
    });
    keys.push(corners.sort().join('|'));
  }
  return keys.sort();
}

function documentOf(bytes) {
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
}

async function catalogFolder(context, files) {
  const directory = await mkdtemp(join(tmpdir(), 'crucible-draco-'));
  context.after(async () => {
    assert.equal(dirname(directory), tmpdir());
    await rm(directory, { recursive: true, force: true });
  });
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
  return directory;
}

test('a Draco GLB decodes to plain buffer views with the same triangles and no extension', async () => {
  const { geometry, bytes } = await dracoBoxGlb();
  assert.equal(usesDraco(documentOf(bytes)), true);
  const result = await decompressDracoGlb(bytes, { filename: 'box.glb' });
  assert.equal(result.primitives, 1);
  const document = documentOf(result.bytes);
  assert.equal(usesDraco(document), false);
  assert.equal(document.extensionsUsed, undefined);
  assert.equal(document.meshes[0].primitives[0].extensions, undefined);
  const asset = await parseGltf(result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.length));
  assert.equal(asset.parts.length, 1);
  const decoded = asset.parts[0].geometry;
  assert.deepEqual(triangleKeys(decoded.positions, decoded.indices), triangleKeys(geometry.positions, geometry.indices));
});

test('a sparse block on a Draco accessor survives decoding and substitutes in the plain loader', async () => {
  const { geometry, bytes } = await dracoBoxGlb({ withSparse: true });
  const result = await decompressDracoGlb(bytes, { filename: 'sparse.glb' });
  const asset = await parseGltf(result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.length));
  const decoded = asset.parts[0].geometry;
  assert.deepEqual(Array.from(decoded.positions.subarray(0, 3)), SPARSE_POSITION);
  assert.notDeepEqual(Array.from(geometry.positions.subarray(0, 3)), SPARSE_POSITION);
});

test('the catalog lists a Draco GLB and hands the preview page a decoded file', async context => {
  const { bytes } = await dracoBoxGlb();
  const directory = await catalogFolder(context, { 'box.glb': bytes });
  const catalog = await createAgentAssetCatalog(directory);
  const listed = catalog.list();
  assert.equal(listed.skipped, undefined);
  assert.equal(listed.assets.length, 1);
  const read = await catalog.read(listed.assets[0].assetId);
  assert.equal(usesDraco(documentOf(read)), false);
  assert.equal(await catalog.size(listed.assets[0].assetId), read.length);
});

test('a broken Draco stream is skipped with the reason instead of failing the catalog', async context => {
  const { bytes } = await dracoBoxGlb();
  const damaged = Buffer.from(bytes);
  const binaryStart = 28 + damaged.readUInt32LE(12);
  damaged.fill(0x7f, binaryStart + 8, binaryStart + 40);
  const directory = await catalogFolder(context, { 'damaged.glb': damaged });
  const listed = (await createAgentAssetCatalog(directory)).list();
  assert.equal(listed.assets.length, 0);
  assert.equal(listed.skipped.length, 1);
  assert.match(listed.skipped[0].reason, /^damaged\.glb: .*Draco/);
});

test('without a decoder the error tells the agent to install draco3d or re-export without Draco', async () => {
  const { bytes } = await dracoBoxGlb();
  const loadDecoder = () => Promise.reject(new Error(`This GLB uses ${DRACO_EXTENSION} and the draco3d decoder is not installed. ${DRACO_MISSING_ADVICE}`));
  await assert.rejects(decompressDracoGlb(bytes, { loadDecoder }), /npm install draco3d.*untick Compression/);
});
