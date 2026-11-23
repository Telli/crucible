// Re-encodes the textures of a GLB as KTX2 (KHR_texture_basisu), the way the dataset packs do (#2982).
//
//   node scripts/encode-glb-ktx2.mjs <input.glb> <output.glb> [--max-texture 2048] [--toktx <path>] [--threads 2]
//
// Colour maps (base colour, emissive) and data maps (roughness, occlusion, ...) become ETC1S; normal maps become UASTC with RDO.
// Every image gets a full mip chain and an edge that is a multiple of 4. Meshopt geometry stays byte for byte, and PNG, JPEG and
// WebP sources are read (a WebP texture is found through EXT_texture_webp). KTX2 images already in the file are kept.
// The encoder is `toktx` from KTX-Software (https://github.com/KhronosGroup/KTX-Software/releases), so the toolchain stays out of
// the runtime: nothing here is imported by src/, and nothing is read from the network.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { requireFiniteInRange } from '../src/modeling-limits.js';
import { readGlb, repackBufferViews, writeGlb } from './recode-glb-textures.mjs';

export const KTX2_EXTENSION = 'KHR_texture_basisu';
export const TOKTX_ADVICE = 'Install toktx from KTX-Software (https://github.com/KhronosGroup/KTX-Software/releases), then put it on PATH or pass --toktx <path to toktx>, or set CRUCIBLE_TOKTX.';

const MAXIMUM_IMAGES = 256;
const MAXIMUM_NORMAL_EDGE = 1024;
const COLOUR_SLOTS = new Set(['baseColorTexture', 'emissiveTexture', 'sheenColorTexture', 'specularColorTexture']);
const NORMAL_SLOTS = new Set(['normalTexture', 'clearcoatNormalTexture']);
// The packs' encodings: ETC1S for colour and data maps, UASTC with RDO and zstd for normal maps.
export const ENCODER_ARGUMENTS = {
  colour: ['--encode', 'etc1s', '--clevel', '0', '--qlevel', '128', '--assign_oetf', 'srgb', '--assign_primaries', 'bt709'],
  data: ['--encode', 'etc1s', '--clevel', '0', '--qlevel', '128', '--assign_oetf', 'linear', '--assign_primaries', 'none'],
  normal: ['--encode', 'uastc', '--uastc_quality', '1', '--uastc_rdo_l', '2', '--zcmp', '18', '--assign_oetf', 'linear', '--assign_primaries', 'none'],
};

export function parseArguments(argv) {
  const options = { maxTexture: 2048, threads: 2, toktx: undefined };
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const name = argv[index];
    if (!name.startsWith('--')) {
      positional.push(name);
      continue;
    }
    const value = argv[++index];
    if (name === '--toktx' && value) options.toktx = value;
    else if ((name === '--max-texture' || name === '--threads') && Number.isFinite(Number(value))) options[name === '--threads' ? 'threads' : 'maxTexture'] = Number(value);
    else throw new Error(`Unknown or invalid option ${name}. Options: --max-texture <pixels>, --threads <count>, --toktx <path>.`);
  }
  requireFiniteInRange('encode-glb-ktx2', 'maxTexture', options.maxTexture, 4, 8192, true);
  requireFiniteInRange('encode-glb-ktx2', 'threads', options.threads, 1, 16, true);
  if (positional.length !== 2) throw new Error('Pass <input.glb> and <output.glb>.');
  return { input: positional[0], output: positional[1], options };
}

/** The toktx executable: the --toktx value or CRUCIBLE_TOKTX (an error when it is missing), else ~/.local/bin/ktx-software, else PATH. Throws with the install advice. */
export function findToktx(explicitPath, environment = process.env, homeFolder = homedir()) {
  const executable = process.platform === 'win32' ? 'toktx.exe' : 'toktx';
  const requested = explicitPath ?? environment.CRUCIBLE_TOKTX;
  if (requested) {
    if (existsSync(requested)) return requested;
    throw new Error(`The toktx executable ${requested} does not exist. ${TOKTX_ADVICE}`);
  }
  const installed = join(homeFolder, '.local', 'bin', 'ktx-software', executable);
  if (existsSync(installed)) return installed;
  for (const folder of (environment.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (folder && existsSync(join(folder, executable))) return join(folder, executable);
  }
  throw new Error(`toktx was not found. ${TOKTX_ADVICE}`);
}

/** An encoder with the signature (png, kind) => ktx2 bytes, running toktx on a temporary file pair. */
export function createToktxEncoder(toktxPath, threads = 2) {
  return (pngBytes, kind) => {
    const folder = mkdtempSync(join(tmpdir(), 'crucible-ktx-'));
    try {
      const pngPath = join(folder, 'image.png');
      const ktxPath = join(folder, 'image.ktx2');
      writeFileSync(pngPath, pngBytes);
      try {
        execFileSync(toktxPath, ['--t2', ...ENCODER_ARGUMENTS[kind], '--threads', String(threads), '--genmipmap', ktxPath, pngPath], { windowsHide: true, stdio: 'pipe' });
      } catch (error) {
        throw new Error(`toktx failed on a ${kind} map: ${String(error.stderr ?? error.message).trim().slice(0, 300)}`);
      }
      return readFileSync(ktxPath);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  };
}

function textureSlotsOf(material) {
  const slots = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Texture') && Number.isInteger(child?.index)) slots.push([key, child.index]);
      else visit(child);
    }
  };
  visit(material);
  return slots;
}

function sourceIndexOf(texture) {
  return texture.extensions?.EXT_texture_webp?.source ?? texture.source;
}

/** The kind of each image index: colour wins over normal, normal over data, as in the mesh_prep toolkit. */
export function imageKindsOf(json) {
  const rank = { colour: 2, normal: 1, data: 0 };
  const kinds = new Map();
  const note = (imageIndex, kind) => {
    if (!kinds.has(imageIndex) || rank[kind] > rank[kinds.get(imageIndex)]) kinds.set(imageIndex, kind);
  };
  for (const texture of json.textures ?? []) {
    const imageIndex = sourceIndexOf(texture);
    if (Number.isInteger(imageIndex)) note(imageIndex, 'data');
  }
  for (const material of json.materials ?? []) {
    for (const [slot, textureIndex] of textureSlotsOf(material)) {
      const imageIndex = sourceIndexOf(json.textures?.[textureIndex] ?? {});
      if (!Number.isInteger(imageIndex)) continue;
      if (COLOUR_SLOTS.has(slot)) note(imageIndex, 'colour');
      else if (NORMAL_SLOTS.has(slot)) note(imageIndex, 'normal');
    }
  }
  return kinds;
}

function multipleOfFour(edge) {
  return Math.max(4, Math.round(edge / 4) * 4);
}

/** A PNG with both edges a multiple of 4, at most `edgeLimit` on the long side, without an alpha channel when the image is opaque. */
export async function prepareSourcePng(imageBytes, edgeLimit) {
  const image = sharp(imageBytes);
  const { width, height } = await image.metadata();
  const scale = Math.min(1, edgeLimit / Math.max(width, height));
  const { isOpaque } = await image.stats();
  let resized = image.resize(multipleOfFour(width * scale), multipleOfFour(height * scale), { fit: 'fill' });
  if (isOpaque) resized = resized.removeAlpha();
  return resized.png().toBuffer();
}

function declareKtx2Textures(json, encodedImages) {
  for (const texture of json.textures ?? []) {
    const imageIndex = sourceIndexOf(texture);
    if (!encodedImages.has(imageIndex)) continue;
    const { EXT_texture_webp: _webp, ...otherExtensions } = texture.extensions ?? {};
    texture.extensions = { ...otherExtensions, [KTX2_EXTENSION]: { source: imageIndex } };
    delete texture.source;
  }
  const stillUsesWebp = (json.textures ?? []).some(texture => texture.extensions?.EXT_texture_webp);
  for (const listName of ['extensionsUsed', 'extensionsRequired']) {
    const list = new Set(json[listName] ?? []);
    list.add(KTX2_EXTENSION);
    if (!stillUsesWebp) list.delete('EXT_texture_webp');
    json[listName] = [...list];
  }
}

/**
 * Returns { glb, images, imageBytesBefore, imageBytesAfter, inputBytes }. `encodeKtx2(png, kind)` returns (or resolves to) the KTX2 file for one
 * prepared PNG; kind is 'colour', 'data' or 'normal'. It is injectable so a test can run without toktx.
 */
export async function encodeGlbKtx2(buffer, { maxTexture = 2048, encodeKtx2 }) {
  if (typeof encodeKtx2 !== 'function') throw new TypeError('encodeGlbKtx2 needs encodeKtx2(png, kind). Use createToktxEncoder(findToktx()).');
  const { json, binary } = readGlb(buffer);
  const images = json.images ?? [];
  if (images.length === 0) throw new Error('This GLB has no textures to encode.');
  if (images.length > MAXIMUM_IMAGES) throw new Error(`This GLB has ${images.length} images; the limit is ${MAXIMUM_IMAGES}. Split the file.`);
  const kinds = imageKindsOf(json);
  const replacementByView = new Map();
  const encodedImages = new Set();
  let imageBytesBefore = 0;
  for (const [imageIndex, image] of images.entries()) {
    if (image.uri !== undefined || image.bufferView === undefined) throw new Error(`Image ${imageIndex} is not inside the GLB. Re-export the model as one .glb with its images embedded.`);
    const view = json.bufferViews[image.bufferView];
    const original = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    imageBytesBefore += original.length;
    if (image.mimeType === 'image/ktx2') continue;
    const kind = kinds.get(imageIndex) ?? 'data';
    const edgeLimit = kind === 'normal' ? Math.min(maxTexture, MAXIMUM_NORMAL_EDGE) : maxTexture;
    replacementByView.set(image.bufferView, await encodeKtx2(await prepareSourcePng(original, edgeLimit), kind));
    image.mimeType = 'image/ktx2';
    encodedImages.add(imageIndex);
  }
  declareKtx2Textures(json, encodedImages);
  const { packed, imageBytesAfter } = repackBufferViews(json, binary, replacementByView);
  json.buffers[0].byteLength = packed.length;
  return { glb: writeGlb(json, packed), images: encodedImages.size, imageBytesBefore, imageBytesAfter, inputBytes: buffer.length };
}

async function main() {
  const { input, output, options } = parseArguments(process.argv.slice(2));
  const encodeKtx2 = createToktxEncoder(findToktx(options.toktx), options.threads);
  const result = await encodeGlbKtx2(readFileSync(input), { maxTexture: options.maxTexture, encodeKtx2 });
  writeFileSync(output, result.glb);
  console.log(JSON.stringify({ inputBytes: result.inputBytes, outputBytes: result.glb.length, images: result.images, imageBytesBefore: result.imageBytesBefore, imageBytesAfter: result.imageBytesAfter }));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) await main();
