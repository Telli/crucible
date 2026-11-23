import { geometryBoundingSphere } from './render-culling.js';

// Puddles keep clear of thin raised things (road markings, kerbs, posts, props): water does not pool in a ring that hugs them.
// The renderer gives the wet shader the ground-plane footprints of those parts, and the shader fades puddles out near each one.

export const KEEP_OUT_LIMIT = 24;
/** A part whose footprint is narrower than this (metres) on either side of the ground plane is a thing standing on the ground, not the ground. */
export const KEEP_OUT_THIN_FOOTPRINT = 1.5;

/** The footprints (minimum x, minimum z, maximum x, maximum z) of the first KEEP_OUT_LIMIT thin parts, and how many there are. */
export function wetnessKeepOutBoxes(parts) {
  const boxes = new Float32Array(KEEP_OUT_LIMIT * 4);
  let count = 0;
  for (const part of parts) {
    if (count === KEEP_OUT_LIMIT) break;
    if (part.skin || part.morph || part.crowd || !part.matrix) continue;
    const box = geometryBoundingSphere(part.geometry);
    const matrix = part.matrix;
    let minimumX = Infinity;
    let minimumZ = Infinity;
    let maximumX = -Infinity;
    let maximumZ = -Infinity;
    for (let corner = 0; corner < 8; corner++) {
      const x = corner & 1 ? box.maximum[0] : box.minimum[0];
      const y = corner & 2 ? box.maximum[1] : box.minimum[1];
      const z = corner & 4 ? box.maximum[2] : box.minimum[2];
      const worldX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      const worldZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
      minimumX = Math.min(minimumX, worldX);
      maximumX = Math.max(maximumX, worldX);
      minimumZ = Math.min(minimumZ, worldZ);
      maximumZ = Math.max(maximumZ, worldZ);
    }
    if (!Number.isFinite(minimumX + minimumZ + maximumX + maximumZ)) continue;
    if (Math.min(maximumX - minimumX, maximumZ - minimumZ) >= KEEP_OUT_THIN_FOOTPRINT) continue;
    boxes.set([minimumX, minimumZ, maximumX, maximumZ], count * 4);
    count++;
  }
  return { boxes, count };
}
