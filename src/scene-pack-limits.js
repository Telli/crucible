// What one web pack may carry (docs/pack.md, "Limits"). A page downloads every texel and every sky pixel, so the pack
// refuses past a budget and says what to change. This module imports nothing: Studio and the Node compiler share it.

/**
 * Texels of texture images (colour, normal, roughness and metal, occlusion and height maps) one pack carries: 1,048,576 is a
 * 1024 by 1024 image, 4 MiB of raw RGBA bytes. An image used by several parts counts once.
 */
export const PACK_MAX_IMAGE_TEXELS = 1_048_576;
const IMAGE_SLOTS = Object.freeze(['map', 'normalMap', 'metallicRoughnessMap', 'occlusionMap', 'heightMap']);
const BYTES_PER_TEXEL = 4;
const BYTES_PER_MEGABYTE = 1_048_576;

/** The unique texture images on the parts: their total texels, and the part that first uses the most of them. */
export function countImageTexels(parts) {
  const seen = new Set();
  const texelsByPart = new Map();
  let texels = 0;
  for (const part of parts) {
    for (const slot of IMAGE_SLOTS) {
      const image = part.material?.[slot]?.image;
      if (!image || seen.has(image.data)) continue;
      seen.add(image.data);
      const imageTexels = image.width * image.height;
      texels += imageTexels;
      texelsByPart.set(part.name, (texelsByPart.get(part.name) ?? 0) + imageTexels);
    }
  }
  let largest = null;
  for (const [name, partTexels] of texelsByPart) {
    if (largest === null || partTexels > largest.texels) largest = { name, texels: partTexels };
  }
  return { texels, largest };
}

/** Throws when the texture images of the parts are over the budget; the message names the part that holds the most. */
export function checkImageBudget(parts, maxImageTexels = PACK_MAX_IMAGE_TEXELS) {
  const { texels, largest } = countImageTexels(parts);
  if (texels <= maxImageTexels) return;
  const megabytes = (texels * BYTES_PER_TEXEL / BYTES_PER_MEGABYTE).toFixed(2);
  const limitMegabytes = (maxImageTexels * BYTES_PER_TEXEL / BYTES_PER_MEGABYTE).toFixed(2);
  throw new TypeError(`The textures on the parts hold ${texels} texels (${megabytes} MB), over the ${maxImageTexels} (${limitMegabytes} MB) one pack carries, because the page downloads every texel. Part "${largest.name}" holds the most (${largest.texels} texels). Use a smaller colorMap or normal map for it, or take the texture off the parts that need it least.`);
}
