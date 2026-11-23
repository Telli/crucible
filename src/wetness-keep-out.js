import { geometryBoundingSphere } from './render-culling.js';

// Puddles keep clear of thin raised things (road markings, kerbs, posts, props): water does not pool in a ring that hugs them.
// The renderer gives the wet shader the ground-plane footprints of those parts, and the shader fades puddles out near each one.
// It also gives the height of the ground plane, so puddles fill the same low spots whether the ground sits at y 0 or y 3.

export const KEEP_OUT_LIMIT = 24;
/** A part whose footprint is narrower than this (metres) on either side of the ground plane is a thing standing on the ground, not the ground. */
export const KEEP_OUT_THIN_FOOTPRINT = 1.5;

/** The world-space bounds of a part's geometry box, or null when the part has no matrix or a non-finite corner. */
function worldBoundsOfPart(part) {
  if (part.skin || part.morph || part.crowd || !part.matrix) return null;
  const box = geometryBoundingSphere(part.geometry);
  const matrix = part.matrix;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let corner = 0; corner < 8; corner++) {
    const x = corner & 1 ? box.maximum[0] : box.minimum[0];
    const y = corner & 2 ? box.maximum[1] : box.minimum[1];
    const z = corner & 4 ? box.maximum[2] : box.minimum[2];
    for (let axis = 0; axis < 3; axis++) {
      const world = matrix[axis] * x + matrix[4 + axis] * y + matrix[8 + axis] * z + matrix[12 + axis];
      minimum[axis] = Math.min(minimum[axis], world);
      maximum[axis] = Math.max(maximum[axis], world);
    }
  }
  return [...minimum, ...maximum].every(Number.isFinite) ? { minimum, maximum } : null;
}

/** The footprints (minimum x, minimum z, maximum x, maximum z) of the first KEEP_OUT_LIMIT thin parts, and how many there are. */
export function wetnessKeepOutBoxes(parts) {
  const boxes = new Float32Array(KEEP_OUT_LIMIT * 4);
  let count = 0;
  for (const part of parts) {
    if (count === KEEP_OUT_LIMIT) break;
    const bounds = worldBoundsOfPart(part);
    if (!bounds) continue;
    const { minimum, maximum } = bounds;
    if (Math.min(maximum[0] - minimum[0], maximum[2] - minimum[2]) >= KEEP_OUT_THIN_FOOTPRINT) continue;
    boxes.set([minimum[0], minimum[2], maximum[0], maximum[2]], count * 4);
    count++;
  }
  return { boxes, count };
}

/**
 * The height of the ground plane the puddles lie on: the top of the part with the widest footprint (0 when no part qualifies).
 * The shader measures the depth of the water from this height, so a scene whose ground is raised or sunk floods like one at y 0.
 */
export function wetnessGroundHeight(parts) {
  let widestFootprint = 0;
  let height = 0;
  for (const part of parts) {
    const bounds = worldBoundsOfPart(part);
    if (!bounds) continue;
    const { minimum, maximum } = bounds;
    const footprint = (maximum[0] - minimum[0]) * (maximum[2] - minimum[2]);
    if (footprint > widestFootprint) {
      widestFootprint = footprint;
      height = maximum[1];
    }
  }
  return height;
}
