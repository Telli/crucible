import { createMeshData, meshBounds } from './mesh-data.js';
import { lintMesh } from './mesh-lint.js';
import { edgeCornerTable } from './mesh-topology.js';
import { createSurfaceDistance, triangulatedSurface } from './mesh-surface-distance.js';
import { requireFiniteInRange } from './modeling-limits.js';
import { placeCellVertices, quadsAroundEdges, splitSaddleVertices } from './surface-nets.js';

// Voxel remesh: sample the signed distance to the surface on a grid, then place one vertex in each cell the surface
// crosses (surface nets) and join the four cells around each crossing grid edge into a quad. The result is a closed
// quad surface with even cells. Only cells near the surface take a BVH query; the rest are inside or outside by a
// flood fill from the grid corner. Tags and attributes of the input are not carried over.

export const MAX_REMESH_RESOLUTION = 192;
export const MAX_REMESH_CELLS = 4_194_304;
const BAND_VOXELS = 2;
const PADDING_VOXELS = 3;
// The outermost layer of grid points is never in the band, so the flood fill from the corner always reaches all of the
// outside. Rounding when a surface lies exactly on a grid plane used to put the band on that layer and cut the flood off.
const OUTER_LAYER = 1;
const SURFACE_TOLERANCE = 1e-3;

function assertOutward(mesh) {
  const inverted = lintMesh(mesh).problems.find(problem => problem.kind === 'inverted-part');
  if (inverted) throw new RangeError(`remesh needs outward-facing normals: ${inverted.count} inverted part. ${inverted.fix}`);
}

// An edge with one quad is a hole, and a hole would pass for a solid in every later edit, so it fails. Saddle edges with
// four quads are split before this check, or fail there when no pairing separates them (splitSaddleVertices).
export function assertNoHoles(mesh) {
  const table = edgeCornerTable(mesh);
  for (let edge = 0; edge < mesh.edgeCount; edge++) {
    if (table.edgeOffsets[edge + 1] - table.edgeOffsets[edge] < 2) {
      throw new RangeError('remesh could not close the surface on this grid. Try another resolution or voxelSize.');
    }
  }
}

function assertClosed(mesh) {
  const table = edgeCornerTable(mesh);
  for (let edge = 0; edge < mesh.edgeCount; edge++) {
    if (table.edgeOffsets[edge + 1] - table.edgeOffsets[edge] !== 2) {
      throw new RangeError('remesh needs a closed surface: every edge must join exactly two faces. Run fill_holes first.');
    }
  }
}

/** Grid size for a voxel edge length; checked before anything is allocated. */
export function remeshGridSize(mesh, { voxelSize, resolution }) {
  const bounds = meshBounds(mesh);
  const extent = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const longest = Math.max(...extent);
  if ((voxelSize === undefined) === (resolution === undefined)) throw new RangeError('remesh takes either voxelSize or resolution.');
  if (voxelSize !== undefined) requireFiniteInRange('remesh', 'voxelSize', voxelSize, 1e-12, 1e12);
  if (resolution !== undefined) requireFiniteInRange('remesh', 'resolution', resolution, 1e-12, 1e12);
  if (!(longest > 0)) throw new RangeError('remesh needs a mesh with volume.');
  const edge = voxelSize ?? longest / resolution;
  const points = extent.map(value => Math.ceil(value / edge) + 1 + PADDING_VOXELS * 2);
  const cells = points.reduce((product, count) => product * (count - 1), 1);
  if (longest / edge > MAX_REMESH_RESOLUTION || cells > MAX_REMESH_CELLS) {
    throw new RangeError(`remesh would use ${cells} cells and ${Math.ceil(longest / edge)} along the longest side, over the limits of ${MAX_REMESH_CELLS} cells and ${MAX_REMESH_RESOLUTION} per side. Use a larger voxelSize or a lower resolution.`);
  }
  return { bounds, edge, points, cells };
}

function markBand(surface, grid) {
  const { positions, indices } = surface;
  const [pointsX, pointsY, pointsZ] = grid.points;
  const marked = new Uint8Array(pointsX * pointsY * pointsZ);
  const low = [0, 0, 0];
  const high = [0, 0, 0];
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    for (let axis = 0; axis < 3; axis++) {
      const values = [0, 1, 2].map(corner => positions[indices[triangle * 3 + corner] * 3 + axis]);
      const origin = grid.bounds.min[axis] - PADDING_VOXELS * grid.edge;
      low[axis] = Math.max(OUTER_LAYER, Math.floor((Math.min(...values) - origin) / grid.edge) - BAND_VOXELS);
      high[axis] = Math.min(grid.points[axis] - 1 - OUTER_LAYER, Math.ceil((Math.max(...values) - origin) / grid.edge) + BAND_VOXELS);
    }
    for (let z = low[2]; z <= high[2]; z++) {
      for (let y = low[1]; y <= high[1]; y++) {
        const row = (z * pointsY + y) * pointsX;
        marked.fill(1, row + low[0], row + high[0] + 1);
      }
    }
  }
  return marked;
}

/** Marks the unmarked points reachable from the grid corner as outside; the remaining unmarked points are inside. */
function floodOutside(marked, points) {
  const [pointsX, pointsY, pointsZ] = points;
  const outside = new Uint8Array(marked.length);
  const stack = [0];
  outside[0] = 1;
  const strides = [1, pointsX, pointsX * pointsY];
  while (stack.length) {
    const point = stack.pop();
    const coordinates = [point % pointsX, Math.floor(point / pointsX) % pointsY, Math.floor(point / (pointsX * pointsY))];
    for (let axis = 0; axis < 3; axis++) {
      for (const step of [-1, 1]) {
        const next = coordinates[axis] + step;
        if (next < 0 || next >= [pointsX, pointsY, pointsZ][axis]) continue;
        const neighbor = point + step * strides[axis];
        if (marked[neighbor] || outside[neighbor]) continue;
        outside[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return outside;
}

// A grid point on the surface (a cube face on a grid plane) has a distance of zero with a sign decided by rounding.
// Reading it as just outside keeps neighbouring points consistent, so no cell sees a diagonal sign pattern.
function onSurfaceAsOutside(distance, edge) {
  const tolerance = SURFACE_TOLERANCE * edge;
  return Math.abs(distance) < tolerance ? tolerance : distance;
}

function sampleDistances(mesh, surface, grid) {
  const [pointsX, pointsY] = grid.points;
  const marked = markBand(surface, grid);
  const outside = floodOutside(marked, grid.points);
  const distances = new Float32Array(marked.length);
  const query = createSurfaceDistance(mesh, { signed: true }).query;
  const farValue = (BAND_VOXELS + 1) * grid.edge;
  const origin = grid.bounds.min.map(value => value - PADDING_VOXELS * grid.edge);
  const point = [0, 0, 0];
  for (let index = 0; index < marked.length; index++) {
    if (!marked[index]) {
      distances[index] = outside[index] ? farValue : -farValue;
      continue;
    }
    point[0] = origin[0] + (index % pointsX) * grid.edge;
    point[1] = origin[1] + (Math.floor(index / pointsX) % pointsY) * grid.edge;
    point[2] = origin[2] + Math.floor(index / (pointsX * pointsY)) * grid.edge;
    distances[index] = onSurfaceAsOutside(query(point).distance, grid.edge);
  }
  return { distances, origin };
}

/**
 * Rebuild a closed mesh as a quad surface on a grid of `voxelSize` (or `resolution` cells along the longest side).
 * Returns the mesh and the grid it used. `buildQuads` replaces the quad builder so a test can feed it a broken surface.
 */
export function remeshMesh(mesh, options, buildQuads = quadsAroundEdges) {
  assertClosed(mesh);
  assertOutward(mesh);
  const grid = remeshGridSize(mesh, options);
  const surface = triangulatedSurface(mesh);
  const { distances, origin } = sampleDistances(mesh, surface, grid);
  const placed = placeCellVertices(distances, grid, origin);
  const insidePoints = [];
  const outsidePoints = [];
  const builtQuads = buildQuads(distances, grid, placed.cellVertex, insidePoints, outsidePoints);
  const { quads, positions } = splitSaddleVertices(builtQuads, insidePoints, placed.positions, outsidePoints);
  if (!quads.length) throw new RangeError('remesh found no surface: the voxel size is larger than the mesh.');
  const faceOffsets = Uint32Array.from({ length: quads.length + 1 }, (value, index) => index * 4);
  const remeshed = createMeshData({ positions: Float32Array.from(positions), faceOffsets, cornerVertices: Uint32Array.from(quads.flat()) });
  assertNoHoles(remeshed);
  return { mesh: remeshed, voxelSize: grid.edge, cells: grid.cells };
}
