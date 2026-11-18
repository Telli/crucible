import { readFile } from 'node:fs/promises';
import { parseGltf } from '../../src/gltf.js';
import { assembleSampleModel } from '../../src/model.js';

const SAMPLE_MODEL_URL = new URL('../../public/sample-model.glb', import.meta.url);

/** The sample microscope as the studio loads it: explodable parts with their layer, section and offset. Node has no image decoder, so textures decode as 4 by 4 stand-ins. */
export async function loadSampleParts() {
  globalThis.createImageBitmap ??= async () => ({ width: 4, height: 4, close() {} });
  const bytes = await readFile(SAMPLE_MODEL_URL);
  const asset = await parseGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {});
  return assembleSampleModel(asset.parts);
}

const TEXTURE_FIELDS = ['map', 'normalMap', 'metallicRoughnessMap', 'occlusionMap', 'emissiveMap'];

/** The same parts with their texture maps removed, for tests that read an export back with a loader that has no image decoder. */
export function withoutTextures(parts) {
  return parts.map(part => {
    const material = { ...part.material };
    for (const field of TEXTURE_FIELDS) delete material[field];
    return { ...part, material };
  });
}
