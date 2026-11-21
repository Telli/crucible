// Curvature per texel, measured in 3D so a UV seam does not hide a fold. Every covered texel has a point on the surface and
// the face normal of its triangle. A texel's curvature is the mean, over the other texels within `radius` metres of it, of
// how far the normal turns toward the direction of travel: (n_other - n) . d / |d|, with d the offset between the two
// points. It is positive over a convex fold, negative over a concave one and 0 on a flat surface. A bevel then reads as one
// band, because a texel in the middle of the bevel strip reaches the flat faces on both sides as long as `radius` covers
// half of the strip, where a comparison inside one UV island saw only the strip's own normal there and left a gap.
//
// The neighbours come from a hash grid of the points with cells `radius` wide. A cell keeps at most MAXIMUM_PER_CELL points
// (every n-th one, in texel order), which bounds the work at high resolution and keeps the result deterministic.

const MAXIMUM_PER_CELL = 8;
const MINIMUM_FACING = -0.5;
const FOLD_TURN = 0.02;
const FULL_SHARE = 0.04;
const GRID_CELLS_PER_AXIS = 1024;

function buildGrid(triangleOf, points, lowCorner, cellSize) {
  const cellOf = new Map();
  for (let texel = 0; texel < triangleOf.length; texel++) {
    if (triangleOf[texel] < 0) continue;
    const key = gridKey(points, texel, lowCorner, cellSize);
    const members = cellOf.get(key);
    if (members) members.push(texel);
    else cellOf.set(key, [texel]);
  }
  for (const [key, members] of cellOf) {
    if (members.length <= MAXIMUM_PER_CELL) continue;
    const stride = Math.ceil(members.length / MAXIMUM_PER_CELL);
    cellOf.set(key, members.filter((_, position) => position % stride === 0));
  }
  return cellOf;
}

function cellIndex(value, low, cellSize) {
  return Math.min(GRID_CELLS_PER_AXIS - 1, Math.max(0, Math.floor((value - low) / cellSize)));
}

function cellKeyOf(cellX, cellY, cellZ) {
  return cellX + GRID_CELLS_PER_AXIS * (cellY + GRID_CELLS_PER_AXIS * cellZ);
}

function gridKey(points, texel, lowCorner, cellSize) {
  return cellKeyOf(
    cellIndex(points[texel * 3], lowCorner[0], cellSize),
    cellIndex(points[texel * 3 + 1], lowCorner[1], cellSize),
    cellIndex(points[texel * 3 + 2], lowCorner[2], cellSize),
  );
}

function curvatureOfTexel(texel, context) {
  const { triangleOf, points, normals, grid, lowCorner, radius, gain } = context;
  const ownNormalOffset = triangleOf[texel] * 3;
  const ownX = points[texel * 3];
  const ownY = points[texel * 3 + 1];
  const ownZ = points[texel * 3 + 2];
  const cellX = cellIndex(ownX, lowCorner[0], radius);
  const cellY = cellIndex(ownY, lowCorner[1], radius);
  const cellZ = cellIndex(ownZ, lowCorner[2], radius);
  let foldSum = 0;
  let foldCount = 0;
  let count = 0;
  for (let stepZ = -1; stepZ <= 1; stepZ++) {
    for (let stepY = -1; stepY <= 1; stepY++) {
      for (let stepX = -1; stepX <= 1; stepX++) {
        const members = grid.get(cellKeyOf(cellX + stepX, cellY + stepY, cellZ + stepZ));
        if (!members) continue;
        for (const other of members) {
          if (other === texel) continue;
          const deltaX = points[other * 3] - ownX;
          const deltaY = points[other * 3 + 1] - ownY;
          const deltaZ = points[other * 3 + 2] - ownZ;
          const distance = Math.hypot(deltaX, deltaY, deltaZ);
          if (distance < 1e-12 || distance > radius) continue;
          const otherNormalOffset = triangleOf[other] * 3;
          const facing = normals[otherNormalOffset] * normals[ownNormalOffset] + normals[otherNormalOffset + 1] * normals[ownNormalOffset + 1] + normals[otherNormalOffset + 2] * normals[ownNormalOffset + 2];
          // The far side of a thin plate is not a neighbour on this surface.
          if (facing < MINIMUM_FACING) continue;
          count++;
          const turnX = normals[otherNormalOffset] - normals[ownNormalOffset];
          const turnY = normals[otherNormalOffset + 1] - normals[ownNormalOffset + 1];
          const turnZ = normals[otherNormalOffset + 2] - normals[ownNormalOffset + 2];
          if (Math.hypot(turnX, turnY, turnZ) < FOLD_TURN) continue;
          foldSum += (turnX * deltaX + turnY * deltaY + turnZ * deltaZ) / distance;
          foldCount++;
        }
      }
    }
  }
  if (foldCount === 0) return 0.5;
  // The strength is the mean turn of the neighbours that sit across a fold, not of all of them, so the middle of a bevel
  // strip (few neighbours across the fold) reads as strongly as its borders. It fades out only when under FULL_SHARE of
  // the neighbourhood is across a fold, which is the tail of the band beyond the reach.
  const presence = Math.min(1, foldCount / count / FULL_SHARE);
  return 0.5 + 0.5 * Math.min(1, Math.max(-1, (gain * presence * foldSum) / foldCount));
}

/**
 * Curvature 0 to 1 for each covered texel (0.5 flat, up on convex folds, down on concave ones) and 0 for the rest.
 * `surface` is { triangleOf, points } from the rasterizer, `normals` the face normals, `lowCorner` the bounding box corner
 * and `radius` the reach in metres, at least the bounding box diagonal over GRID_CELLS_PER_AXIS.
 */
export function surfaceCurvature(surface, normals, { lowCorner, radius, gain }) {
  const { triangleOf, points } = surface;
  const grid = buildGrid(triangleOf, points, lowCorner, radius);
  const context = { triangleOf, points, normals, grid, lowCorner, radius, gain };
  const values = new Float32Array(triangleOf.length);
  for (let texel = 0; texel < values.length; texel++) {
    if (triangleOf[texel] >= 0) values[texel] = curvatureOfTexel(texel, context);
  }
  return values;
}

export const CURVATURE_GRID_CELLS_PER_AXIS = GRID_CELLS_PER_AXIS;
