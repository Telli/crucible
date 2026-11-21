import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CHEST_PATH = new URL('../public/treasure-chest.glb', import.meta.url);
const ONE_MEGABYTE = 1024 * 1024;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

function readGlbDocument(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'treasure-chest.glb is a binary glTF');
  const jsonLength = view.getUint32(GLB_HEADER_BYTES, true);
  const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
  return JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength)));
}

test('the asset viewer demo chest is a small textured GLB', async () => {
  const bytes = await readFile(CHEST_PATH);
  assert.ok(bytes.length < ONE_MEGABYTE, `treasure-chest.glb is ${bytes.length} bytes; keep the demo under 1 MiB so the page opens fast`);
  const document = readGlbDocument(bytes);
  assert.equal(document.meshes.length, 5);
  assert.ok(document.materials.some(material => material.pbrMetallicRoughness?.baseColorTexture), 'the chest keeps its base color texture');
  assert.ok(document.materials.some(material => material.normalTexture), 'the chest keeps its normal map');
  for (const image of document.images) assert.equal(image.mimeType, 'image/jpeg');
});

test('the demo chest is credited as a CC0 Poly Haven model', async () => {
  const credits = await readFile(new URL('../public/textures/CREDITS.md', import.meta.url), 'utf8');
  assert.match(credits, /polyhaven\.com\/a\/treasure_chest/);
  assert.match(credits, /CC0/);
});
