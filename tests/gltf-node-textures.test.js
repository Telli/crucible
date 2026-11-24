import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createTexturedRigFixture } from '../scripts/agent-asset-fixture.mjs';
import { parseGltf } from '../src/gltf.js';
import { skinnedStripAsset } from './fixtures/skinned-strip.js';

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test('parseGltf skips texture decoding in Node with { textures: false } while keeping factors and geometry', async () => {
  const document = JSON.parse(await readFile(new URL('./fixtures/textured-triangle.gltf', import.meta.url), 'utf8'));
  const image = Buffer.from(document.images[0].uri.split(',')[1], 'base64');
  const glb = skinnedStripAsset((asset, append) => {
    append(new Uint8Array(image), 'SCALAR');
    asset.images = [{ bufferView: asset.bufferViews.length - 1, mimeType: 'image/png' }];
    asset.textures = [{ source: 0 }];
    asset.materials[0].pbrMetallicRoughness = {
      baseColorFactor: [0.2, 0.4, 0.6, 0.8],
      metallicFactor: 0.35,
      roughnessFactor: 0.7,
      baseColorTexture: { index: 0 },
    };
  });

  const asset = await parseGltf(glb, { textures: false });
  assert.equal(asset.parts.length, 1);
  const [part] = asset.parts;
  assert.ok(part.geometry.positions.length > 0);
  assert.ok(part.skin);
  assert.equal(part.material.map, undefined);
  assert.deepEqual(part.material.color.map(value => Number(value.toFixed(2))), [0.2, 0.4, 0.6]);
  assert.equal(Number(part.material.metallic.toFixed(2)), 0.35);
  assert.equal(Number(part.material.roughness.toFixed(2)), 0.7);
  assert.equal(Number(part.material.opacity.toFixed(2)), 0.8);
  asset.dispose();
});

test('parseGltf throws an actionable error in Node on textured GLBs by default', async () => {
  const fixture = await createTexturedRigFixture();
  await assert.rejects(
    () => parseGltf(arrayBufferOf(fixture)),
    /\{ textures: false \}/,
  );
});

test('parseGltf rejects non-boolean options.textures', async () => {
  const fixture = await createTexturedRigFixture();
  await assert.rejects(
    () => parseGltf(arrayBufferOf(fixture), { textures: 'no' }),
    error => error instanceof TypeError && /options\.textures/.test(error.message),
  );
});
