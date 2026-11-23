import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { ENCODER_ARGUMENTS, KTX2_EXTENSION, TOKTX_ADVICE, createToktxEncoder, encodeGlbKtx2, findToktx, imageKindsOf, parseArguments } from '../scripts/encode-glb-ktx2.mjs';
import { readGlb, writeGlb } from '../scripts/recode-glb-textures.mjs';
import { transcodeKtx2Glb } from '../scripts/agent-ktx2.mjs';

const FIXTURES = new URL('./fixtures/ktx2/', import.meta.url);
const GEOMETRY = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

async function solidImage(width, height, format) {
  const raw = Buffer.alloc(width * height * 3, 90);
  return sharp(raw, { raw: { width, height, channels: 3 } })[format]().toBuffer();
}

const pad = bytes => Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);

// A colour map (WebP, 130 x 70, so neither edge is a multiple of 4), a normal map (PNG) and a roughness map (JPEG), with a meshopt view.
async function buildGlb() {
  const images = [await solidImage(130, 70, 'webp'), await solidImage(64, 64, 'png'), await solidImage(32, 32, 'jpeg')];
  const binary = Buffer.concat([pad(GEOMETRY), ...images.map(pad)]);
  let offset = pad(GEOMETRY).length;
  const bufferViews = [{ buffer: 1, byteOffset: 0, byteLength: 8, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: 0, byteLength: 8, byteStride: 4, count: 2, mode: 'ATTRIBUTES' } } }];
  for (const image of images) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: image.length });
    offset += pad(image).length;
  }
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: binary.length }, { byteLength: 8, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    bufferViews,
    images: [{ bufferView: 1, mimeType: 'image/webp' }, { bufferView: 2, mimeType: 'image/png' }, { bufferView: 3, mimeType: 'image/jpeg' }],
    textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }, { source: 1, sampler: 0 }, { source: 2 }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 } }, normalTexture: { index: 1 } }],
    extensionsUsed: ['EXT_meshopt_compression', 'EXT_texture_webp'],
    extensionsRequired: ['EXT_meshopt_compression', 'EXT_texture_webp'],
  };
  return writeGlb(json, binary);
}

function recordingEncoder(fixtures) {
  const calls = [];
  const encodeKtx2 = async (png, kind) => {
    const { width, height } = await sharp(png).metadata();
    calls.push({ kind, width, height });
    return fixtures[kind === 'normal' ? 'uastc' : 'etc1s'];
  };
  return { calls, encodeKtx2 };
}

test('an image is routed to colour, normal or data by the material slot that uses it', async () => {
  const { json } = readGlb(await buildGlb());
  assert.deepEqual([...imageKindsOf(json)], [[0, 'colour'], [1, 'normal'], [2, 'data']]);
});

test('textures become KTX2, edges are multiples of 4 and the meshopt data stays byte for byte', async () => {
  const fixtures = { etc1s: await readFile(new URL('2d_etc1s.ktx2', FIXTURES)), uastc: await readFile(new URL('2d_uastc.ktx2', FIXTURES)) };
  const { calls, encodeKtx2 } = recordingEncoder(fixtures);
  const result = await encodeGlbKtx2(await buildGlb(), { maxTexture: 2048, encodeKtx2 });
  const { json, binary } = readGlb(result.glb);
  assert.equal(result.images, 3);
  assert.deepEqual(calls.map(call => call.kind), ['colour', 'normal', 'data']);
  assert.deepEqual([calls[0].width, calls[0].height], [132, 72]);
  assert.ok(json.images.every(image => image.mimeType === 'image/ktx2'));
  assert.deepEqual(json.textures[0], { extensions: { [KTX2_EXTENSION]: { source: 0 } } });
  assert.deepEqual(json.textures[1], { sampler: 0, extensions: { [KTX2_EXTENSION]: { source: 1 } } });
  assert.ok(json.extensionsRequired.includes(KTX2_EXTENSION) && json.extensionsUsed.includes(KTX2_EXTENSION));
  assert.ok(!json.extensionsRequired.includes('EXT_texture_webp') && !json.extensionsUsed.includes('EXT_texture_webp'));
  const meshopt = json.bufferViews[0].extensions.EXT_meshopt_compression;
  assert.deepEqual([...binary.subarray(meshopt.byteOffset, meshopt.byteOffset + meshopt.byteLength)], [...GEOMETRY]);
  const decoded = await transcodeKtx2Glb(result.glb);
  assert.equal(decoded.images, 3);
});

test('a normal map is capped at 1024 pixels and a colour map at the requested size', async () => {
  const image = await solidImage(3000, 1500, 'png');
  const binary = pad(image);
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: image.length }],
    images: [{ bufferView: 0, mimeType: 'image/png' }], textures: [{ source: 0 }], materials: [{ normalTexture: { index: 0 } }],
  };
  const fixture = await readFile(new URL('2d_uastc.ktx2', FIXTURES));
  const { calls, encodeKtx2 } = recordingEncoder({ uastc: fixture, etc1s: fixture });
  await encodeGlbKtx2(writeGlb(json, binary), { maxTexture: 2048, encodeKtx2 });
  json.materials = [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }];
  await encodeGlbKtx2(writeGlb(json, binary), { maxTexture: 2048, encodeKtx2 });
  assert.deepEqual(calls.map(call => [call.kind, call.width, call.height]), [['normal', 1024, 512], ['colour', 2048, 1024]]);
});

test('a GLB without textures or with an image file next to it says what to pass', async () => {
  const encodeKtx2 = () => Buffer.alloc(0);
  const empty = writeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }] }, Buffer.alloc(4));
  await assert.rejects(encodeGlbKtx2(empty, { encodeKtx2 }), /no textures to encode/);
  const external = writeGlb({ asset: { version: '2.0' }, buffers: [{ byteLength: 4 }], images: [{ uri: 'a.png' }] }, Buffer.alloc(4));
  await assert.rejects(encodeGlbKtx2(external, { encodeKtx2 }), /Re-export the model as one \.glb/);
  await assert.rejects(encodeGlbKtx2(empty, {}), /needs encodeKtx2/);
});

test('findToktx names the install advice, and parseArguments rejects unknown options', () => {
  assert.throws(() => findToktx(undefined, { PATH: '' }, '/nowhere'), error => error.message.includes(TOKTX_ADVICE) && /was not found/.test(error.message));
  assert.throws(() => findToktx('/nowhere/toktx', {}, '/nowhere'), /does not exist/);
  assert.deepEqual(parseArguments(['a.glb', 'b.glb', '--max-texture', '1024', '--threads', '4']).options, { maxTexture: 1024, threads: 4, toktx: undefined });
  assert.throws(() => parseArguments(['a.glb', 'b.glb', '--bogus', '1']), /Unknown or invalid option/);
  assert.throws(() => parseArguments(['a.glb']), /Pass <input.glb> and <output.glb>/);
});

// Transfer function byte of the first data format descriptor (KTX2 header: dfdByteOffset at 48; block header 8 bytes after the total size).
const TRANSFER_SRGB = 2;
const TRANSFER_LINEAR = 1;
function transferFunctionOf(ktx2) {
  return ktx2[ktx2.readUInt32LE(48) + 4 + 8 + 2];
}

test('colour maps are tagged sRGB and data and normal maps linear', async () => {
  const oetfOf = kind => ENCODER_ARGUMENTS[kind][ENCODER_ARGUMENTS[kind].indexOf('--assign_oetf') + 1];
  assert.deepEqual(['colour', 'data', 'normal'].map(oetfOf), ['srgb', 'linear', 'linear']);
  let toktxPath;
  try {
    toktxPath = findToktx();
  } catch {
    return;
  }
  const encode = createToktxEncoder(toktxPath, 1);
  const png = await solidImage(16, 16, 'png');
  assert.equal(transferFunctionOf(await encode(png, 'colour')), TRANSFER_SRGB);
  assert.equal(transferFunctionOf(await encode(png, 'data')), TRANSFER_LINEAR);
  assert.equal(transferFunctionOf(await encode(png, 'normal')), TRANSFER_LINEAR);
});
