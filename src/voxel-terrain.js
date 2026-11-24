// Voxel terrain to smooth terrain: a grid of cells, each with an occupancy and a material, becomes a land mesh whose
// vertices carry a blended material colour, plus a water mesh. The occupancy is blurred into a signed field and meshed
// by surface nets (surface-nets.js), so slopes and banks come out smooth instead of stepped. Plain arithmetic in a fixed
// order, so the same input gives the same bytes.

import { placeCellVertices, quadsAroundEdges, splitSaddleVertices } from './surface-nets.js';
import { invalidField } from './field-error.js';

export const VOXEL_TERRAIN_LIMITS = Object.freeze({ maxCellsPerAxis: 512, maxCells: 16_777_216, maxCellSize: 1000, maxSmoothing: 4, defaultSmoothing: 1 });

// Linear RGB colour multipliers. `variation` is how strongly the brightness wanders from cell to cell.
export const VOXEL_TERRAIN_LOOKS = Object.freeze({
  grass: Object.freeze({ color: [0.085, 0.27, 0.04], variation: 0.22 }),
  rock: Object.freeze({ color: [0.2, 0.19, 0.18], variation: 0.38 }),
  sand: Object.freeze({ color: [0.5, 0.38, 0.19], variation: 0.2 }),
  dirt: Object.freeze({ color: [0.2, 0.11, 0.055], variation: 0.2 }),
  snow: Object.freeze({ color: [0.82, 0.86, 0.9], variation: 0.06 }),
  water: Object.freeze({ color: [0.02, 0.2, 0.24], variation: 0 }),
});
const DEFAULT_PALETTE = Object.freeze(['grass', 'rock', 'sand', 'water']);
const WATER_NAME = 'water';
const WATER_DROP = 0.1;
const WETNESS_THRESHOLD = 0.08;
const WATER_MINIMUM_UP = 0.6;
const LAND_MATERIAL = Object.freeze({ tag: 'surface', color: [1, 1, 1], metallic: 0, roughness: 0.92, emission: 0 });
const WATER_MATERIAL = Object.freeze({ tag: 'water', color: [0.02, 0.2, 0.24], metallic: 0.2, roughness: 0.06, emission: 0 });
const EDGE_MODES = ['open', 'closed'];
const SADDLE_FIX_HINT = 'Raise smoothing, or fill the single-cell diagonal contact in the occupancy.';
// Closed edges: the side walls and base get one flat earth colour (linear RGB), cut hard from the top surface colours.
const WALL_COLOR = Object.freeze([0.2, 0.062, 0.016]);
const WALL_SNAP = 0.75;
const WALL_TOLERANCE = 0.02;
const WALL_STEEPNESS = 0.5;
const COLOR_WINDOW = 2;
const COLOR_KERNEL_RADIUS = 1.5;
const COLOR_FALLBACK_RADIUS = 3;

/** Reads and checks the input once. Every error names the field, what was received and what to pass. */
export function normalizeVoxelTerrain(input) {
  if (input === null || typeof input !== 'object') throw invalidField('voxelTerrain', input, 'an object with grid, cellSize, occupancy and materials');
  const grid = gridOf(input.grid);
  const cellCount = grid[0] * grid[1] * grid[2];
  const cellSize = input.cellSize ?? 1;
  if (!Number.isFinite(cellSize) || cellSize <= 0 || cellSize > VOXEL_TERRAIN_LIMITS.maxCellSize) {
    throw invalidField('cellSize', input.cellSize, `a number above 0 and at most ${VOXEL_TERRAIN_LIMITS.maxCellSize}, such as 4`);
  }
  const palette = paletteOf(input.palette ?? DEFAULT_PALETTE, input.looks);
  const origin = input.origin ?? [0, 0, 0];
  if (!Array.isArray(origin) || origin.length !== 3 || !origin.every(Number.isFinite)) throw invalidField('origin', input.origin, 'three numbers, the world position of the grid minimum corner, such as [0, 0, 0]');
  const smoothing = input.smoothing ?? VOXEL_TERRAIN_LIMITS.defaultSmoothing;
  if (!Number.isInteger(smoothing) || smoothing < 0 || smoothing > VOXEL_TERRAIN_LIMITS.maxSmoothing) {
    throw invalidField('smoothing', input.smoothing, `a whole number from 0 to ${VOXEL_TERRAIN_LIMITS.maxSmoothing}`);
  }
  const edges = input.edges ?? 'open';
  if (!EDGE_MODES.includes(edges)) throw invalidField('edges', input.edges, `one of ${EDGE_MODES.join(', ')}`);
  checkOccupancy(input.occupancy, cellCount, grid);
  checkMaterials(input.materials, cellCount, grid, palette.names.length);
  return { grid, cellSize, palette, origin, smoothing, edges, occupancy: input.occupancy, materials: input.materials };
}

function gridOf(value) {
  const message = `three whole numbers from 2 to ${VOXEL_TERRAIN_LIMITS.maxCellsPerAxis} (cells along x, y, z; y is up), such as [256, 64, 256]`;
  if (!Array.isArray(value) || value.length !== 3) throw invalidField('grid', value, message);
  for (const count of value) {
    if (!Number.isInteger(count) || count < 2 || count > VOXEL_TERRAIN_LIMITS.maxCellsPerAxis) throw invalidField('grid', value, message);
  }
  if (value[0] * value[1] * value[2] > VOXEL_TERRAIN_LIMITS.maxCells) {
    throw invalidField('grid', value, `a grid of at most ${VOXEL_TERRAIN_LIMITS.maxCells} cells in all; split the landscape into tiles`);
  }
  return value;
}

function paletteOf(names, looks) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 255 || !names.every(name => typeof name === 'string')) {
    throw invalidField('palette', names, 'a list of 1 to 255 material names, such as ["grass", "rock", "sand", "water"]');
  }
  if (new Set(names).size !== names.length) throw invalidField('palette', names, 'material names that each appear once');
  const known = { ...VOXEL_TERRAIN_LOOKS, ...(looks ?? {}) };
  const resolved = names.map(name => {
    const look = known[name];
    const valid = look && Array.isArray(look.color) && look.color.length === 3 && look.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 1);
    if (!valid) throw invalidField(`palette["${name}"]`, name, `one of ${Object.keys(VOXEL_TERRAIN_LOOKS).join(', ')}, or a name with looks.${name} = { color: [r, g, b] } in 0 to 1`);
    return { color: look.color, variation: Number.isFinite(look.variation) ? look.variation : 0.15 };
  });
  return { names, looks: resolved, waterIndex: names.indexOf(WATER_NAME) };
}

function checkOccupancy(occupancy, cellCount, grid) {
  const hint = `an array of ${cellCount} numbers from 0 (empty) to 1 (full), x fastest, then y, then z (grid ${grid.join('x')})`;
  if (!ArrayBuffer.isView(occupancy) && !Array.isArray(occupancy)) throw invalidField('occupancy', occupancy, hint);
  if (occupancy.length !== cellCount) throw invalidField('occupancy.length', occupancy.length, hint);
  for (let cell = 0; cell < cellCount; cell++) {
    const value = occupancy[cell];
    if (!(value >= 0 && value <= 1)) throw invalidField(`occupancy[${cell}]`, value, 'a number from 0 (empty) to 1 (full)');
  }
}

function checkMaterials(materials, cellCount, grid, paletteSize) {
  const hint = `an array of ${cellCount} palette indexes, one per cell, in the same order as occupancy (grid ${grid.join('x')})`;
  if (!ArrayBuffer.isView(materials) && !Array.isArray(materials)) throw invalidField('materials', materials, hint);
  if (materials.length !== cellCount) throw invalidField('materials.length', materials.length, hint);
  for (let cell = 0; cell < cellCount; cell++) {
    const index = materials[cell];
    if (!Number.isInteger(index) || index < 0 || index >= paletteSize) throw invalidField(`materials[${cell}]`, index, `a whole number from 0 to ${paletteSize - 1}, an index into palette`);
  }
}

// The padded grid holds one extra cell on every side so the surface reaches the bounds: replicated for open edges,
// empty for closed ones. Padded index (x, y, z) is cell (x - 1, y - 1, z - 1).
function paddedLayout(grid) {
  const dims = grid.map(count => count + 2);
  return { dims, total: dims[0] * dims[1] * dims[2] };
}

function cellIndexOf(grid, x, y, z) {
  return (z * grid[1] + y) * grid[0] + x;
}

function clampIndex(value, count) {
  return Math.min(count - 1, Math.max(0, value));
}

function paddedField(grid, layout, edges, valueOfCell) {
  const [dimsX, dimsY, dimsZ] = layout.dims;
  const field = new Float32Array(layout.total);
  let cursor = 0;
  for (let z = 0; z < dimsZ; z++) {
    for (let y = 0; y < dimsY; y++) {
      for (let x = 0; x < dimsX; x++) {
        const inside = x > 0 && x <= grid[0] && y > 0 && y <= grid[1] && z > 0 && z <= grid[2];
        if (inside || edges === 'open') {
          const cell = cellIndexOf(grid, clampIndex(x - 1, grid[0]), clampIndex(y - 1, grid[1]), clampIndex(z - 1, grid[2]));
          field[cursor] = valueOfCell(cell);
        }
        cursor++;
      }
    }
  }
  return field;
}

// One pass of [1, 2, 1] / 4 along each axis, edges clamped.
function blurField(field, dims, passes) {
  let source = field;
  for (let pass = 0; pass < passes; pass++) {
    for (let axis = 0; axis < 3; axis++) source = blurAlong(source, dims, axis);
  }
  return source;
}

function blurAlong(source, dims, axis) {
  const stride = axis === 0 ? 1 : axis === 1 ? dims[0] : dims[0] * dims[1];
  const count = dims[axis];
  const target = new Float32Array(source.length);
  for (let index = 0; index < source.length; index++) {
    const along = Math.floor(index / stride) % count;
    const before = along > 0 ? source[index - stride] : source[index];
    const after = along < count - 1 ? source[index + stride] : source[index];
    target[index] = 0.25 * before + 0.5 * source[index] + 0.25 * after;
  }
  return target;
}

function signedDistancesOf(blurred) {
  const distances = new Float32Array(blurred.length);
  for (let index = 0; index < blurred.length; index++) distances[index] = 0.5 - blurred[index];
  return distances;
}

/** Surface nets on one padded field. Returns double-precision positions and quads. */
function meshField(distances, layout, cellSize, paddedOrigin) {
  const grid = { points: layout.dims, edge: cellSize };
  const { cellVertex, positions: cellPositions } = placeCellVertices(distances, grid, paddedOrigin);
  const insidePoints = [];
  const outsidePoints = [];
  const builtQuads = quadsAroundEdges(distances, grid, cellVertex, insidePoints, outsidePoints);
  const split = splitSaddleVertices(builtQuads, insidePoints, cellPositions, outsidePoints, SADDLE_FIX_HINT);
  return { quads: split.quads, positions: split.positions };
}

/** Keeps the quads that pass `keep`, renumbers the vertices they use in first-use order and triangulates them. */
function compactMesh(mesh, keep) {
  const remap = new Map();
  const positions = [];
  const indices = [];
  const gap = (first, second) => {
    let total = 0;
    for (let axis = 0; axis < 3; axis++) {
      const difference = mesh.positions[first * 3 + axis] - mesh.positions[second * 3 + axis];
      total += difference * difference;
    }
    return total;
  };
  const renumber = vertex => {
    if (!remap.has(vertex)) {
      remap.set(vertex, remap.size);
      positions.push(mesh.positions[vertex * 3], mesh.positions[vertex * 3 + 1], mesh.positions[vertex * 3 + 2]);
    }
    return remap.get(vertex);
  };
  mesh.quads.forEach((quad, quadIndex) => {
    if (!keep(quadIndex)) return;
    const [first, second, third, fourth] = quad.map(renumber);
    const oldGap = (a, b) => gap(quad[a], quad[b]);
    if (oldGap(0, 2) <= oldGap(1, 3)) indices.push(first, second, third, first, third, fourth);
    else indices.push(first, second, fourth, second, third, fourth);
  });
  return { positions, indices: Uint32Array.from(indices) };
}

function pointOf(positions, vertex, cellSize, paddedOrigin) {
  return [0, 1, 2].map(axis => (positions[vertex * 3 + axis] - paddedOrigin[axis]) / cellSize);
}

function sampleField(field, layout, point) {
  const [dimsX, dimsY, dimsZ] = layout.dims;
  const base = point.map((value, axis) => clampIndex(Math.floor(value), layout.dims[axis] - 1));
  const fraction = point.map((value, axis) => Math.min(1, Math.max(0, value - base[axis])));
  let total = 0;
  for (let corner = 0; corner < 8; corner++) {
    const offsetX = corner & 1;
    const offsetY = (corner >> 1) & 1;
    const offsetZ = (corner >> 2) & 1;
    const weight = (offsetX ? fraction[0] : 1 - fraction[0]) * (offsetY ? fraction[1] : 1 - fraction[1]) * (offsetZ ? fraction[2] : 1 - fraction[2]);
    total += weight * field[(clampIndex(base[2] + offsetZ, dimsZ) * dimsY + clampIndex(base[1] + offsetY, dimsY)) * dimsX + clampIndex(base[0] + offsetX, dimsX)];
  }
  return total;
}

function trilinearGradient(blurred, layout, point) {
  const [dimsX, dimsY, dimsZ] = layout.dims;
  const base = point.map((value, axis) => clampIndex(Math.floor(value), layout.dims[axis] - 1));
  const fraction = point.map((value, axis) => Math.min(1, Math.max(0, value - base[axis])));
  const at = (x, y, z) => blurred[(clampIndex(z, dimsZ) * dimsY + clampIndex(y, dimsY)) * dimsX + clampIndex(x, dimsX)];
  const gradient = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const offsetX = corner & 1;
    const offsetY = (corner >> 1) & 1;
    const offsetZ = (corner >> 2) & 1;
    const weight = (offsetX ? fraction[0] : 1 - fraction[0]) * (offsetY ? fraction[1] : 1 - fraction[1]) * (offsetZ ? fraction[2] : 1 - fraction[2]);
    if (weight === 0) continue;
    const x = base[0] + offsetX;
    const y = base[1] + offsetY;
    const z = base[2] + offsetZ;
    // The field is 0.5 - blurred, so the outward direction is minus the blurred gradient.
    gradient[0] -= weight * (at(x + 1, y, z) - at(x - 1, y, z));
    gradient[1] -= weight * (at(x, y + 1, z) - at(x, y - 1, z));
    gradient[2] -= weight * (at(x, y, z + 1) - at(x, y, z - 1));
  }
  const length = Math.hypot(...gradient) || 1;
  return gradient.map(component => component / length);
}

function normalsOf(positions, blurred, layout, cellSize, paddedOrigin) {
  const normals = new Float32Array(positions.length);
  const point = [0, 0, 0];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    for (let axis = 0; axis < 3; axis++) point[axis] = (positions[vertex * 3 + axis] - paddedOrigin[axis]) / cellSize;
    normals.set(trilinearGradient(blurred, layout, point), vertex * 3);
  }
  return normals;
}

function planarUvs(positions) {
  const uvs = new Float32Array(positions.length / 3 * 2);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    uvs[vertex * 2] = positions[vertex * 3];
    uvs[vertex * 2 + 1] = positions[vertex * 3 + 2];
  }
  return uvs;
}

// Integer hash to [0, 1): deterministic, no state.
function hashUnit(x, y, z) {
  let hash = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function smoothUnit(fraction) {
  return fraction * fraction * (3 - 2 * fraction);
}

// Value noise over cell coordinates: smooth brightness drift so flat ground reads as ground.
function valueNoise(x, y, z, frequency) {
  const scaled = [x * frequency, y * frequency, z * frequency];
  const base = scaled.map(Math.floor);
  const fraction = scaled.map((value, axis) => smoothUnit(value - base[axis]));
  let total = 0;
  for (let corner = 0; corner < 8; corner++) {
    const offsets = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    const weight = offsets.reduce((product, offset, axis) => product * (offset ? fraction[axis] : 1 - fraction[axis]), 1);
    total += weight * hashUnit(base[0] + offsets[0], base[1] + offsets[1], base[2] + offsets[2]);
  }
  return total;
}

/** Material weights around a vertex: occupancy of each land cell near it, fading with distance, summed per material. */
function vertexColors(positions, input, layout, paddedOrigin) {
  const { grid, cellSize, palette, occupancy, materials } = input;
  const colors = new Float32Array(positions.length);
  const dominant = new Uint8Array(positions.length / 3);
  const weights = new Float64Array(palette.names.length);
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const cellPosition = [0, 1, 2].map(axis => (positions[vertex * 3 + axis] - paddedOrigin[axis]) / cellSize - 1);
    weights.fill(0);
    let total = accumulateWeights(weights, cellPosition, COLOR_KERNEL_RADIUS, input);
    if (total <= 1e-6) total = accumulateWeights(weights, cellPosition, COLOR_FALLBACK_RADIUS, input);
    const color = [0, 0, 0];
    let variation = 0;
    const strongest = strongestIndex(weights);
    for (let index = 0; index < weights.length; index++) {
      const share = total > 0 ? weights[index] / total : (index === strongest ? 1 : 0);
      for (let channel = 0; channel < 3; channel++) color[channel] += share * palette.looks[index].color[channel];
      variation += share * palette.looks[index].variation;
    }
    const world = [0, 1, 2].map(axis => positions[vertex * 3 + axis]);
    const drift = (valueNoise(world[0] / cellSize, world[1] / cellSize, world[2] / cellSize, 0.35) - 0.5) * 2
      + (valueNoise(world[0] / cellSize, world[1] / cellSize, world[2] / cellSize, 1.7) - 0.5);
    const brightness = Math.max(0.2, 1 + variation * drift);
    for (let channel = 0; channel < 3; channel++) colors[vertex * 3 + channel] = Math.min(1, color[channel] * brightness);
    dominant[vertex] = strongest;
  }
  return { colors, dominant };
}

function strongestIndex(weights) {
  let strongest = 0;
  for (let index = 1; index < weights.length; index++) {
    if (weights[index] > weights[strongest]) strongest = index;
  }
  return strongest;
}

function accumulateWeights(weights, cellPosition, radius, { grid, palette, occupancy, materials }) {
  const centre = cellPosition.map(Math.round);
  let total = 0;
  for (let z = centre[2] - COLOR_WINDOW; z <= centre[2] + COLOR_WINDOW; z++) {
    for (let y = centre[1] - COLOR_WINDOW; y <= centre[1] + COLOR_WINDOW; y++) {
      for (let x = centre[0] - COLOR_WINDOW; x <= centre[0] + COLOR_WINDOW; x++) {
        const distance = Math.hypot(x - cellPosition[0], y - cellPosition[1], z - cellPosition[2]);
        if (distance >= radius) continue;
        const cell = cellIndexOf(grid, clampIndex(x, grid[0]), clampIndex(y, grid[1]), clampIndex(z, grid[2]));
        const material = materials[cell];
        if (material === palette.waterIndex || occupancy[cell] <= 0) continue;
        const weight = occupancy[cell] * (radius - distance);
        weights[material] += weight;
        total += weight;
      }
    }
  }
  return total;
}

function identityMatrix() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function geometryOf(compact, normals, uvs, colors = null) {
  const geometry = { positions: Float32Array.from(compact.positions), normals, uvs, indices: compact.indices };
  if (colors) geometry.colors = colors;
  return geometry;
}

// The padding cells lie half a cell outside the grid, so the outermost vertices can sit up to half a cell beyond it.
// They are pressed onto the boundary, which keeps the mesh inside the grid bounds.
function clampToBounds(positions, { grid, cellSize, origin }) {
  for (let offset = 0; offset < positions.length; offset++) {
    const axis = offset % 3;
    positions[offset] = Math.min(origin[axis] + grid[axis] * cellSize, Math.max(origin[axis], positions[offset]));
  }
}

// Closed edges: the rounded shoulder where the surface meets a side of the box is pressed flat onto that side (and onto the
// base), so the wall is a true plane and the line where it meets the top surface follows the surface instead of a cell grid.
function snapToWalls(positions, { grid, cellSize, origin }) {
  for (let offset = 0; offset < positions.length; offset++) {
    const axis = offset % 3;
    const low = origin[axis];
    const high = origin[axis] + grid[axis] * cellSize;
    if (positions[offset] - low <= WALL_SNAP * cellSize) positions[offset] = low;
    else if (axis !== 1 && high - positions[offset] <= WALL_SNAP * cellSize) positions[offset] = high;
  }
}

function landPart(input, layout, paddedOrigin) {
  const { grid, palette, occupancy, materials, smoothing, edges, cellSize } = input;
  const solid = paddedField(grid, layout, edges, cell => (materials[cell] === palette.waterIndex ? 0 : occupancy[cell]));
  const blurred = blurField(solid, layout.dims, smoothing);
  const mesh = meshField(signedDistancesOf(blurred), layout, cellSize, paddedOrigin);
  if (mesh.quads.length === 0) return null;
  const compact = compactMesh(mesh, () => true);
  clampToBounds(compact.positions, input);
  if (edges === 'closed') snapToWalls(compact.positions, input);
  const normals = normalsOf(compact.positions, blurred, layout, cellSize, paddedOrigin);
  const { colors, dominant } = vertexColors(compact.positions, input, layout, paddedOrigin);
  const walled = edges === 'closed' ? splitWalls(compact, normals, colors, dominant, input) : { positions: compact.positions, normals, colors, dominant, indices: compact.indices, wallTriangles: 0 };
  const geometry = geometryOf({ positions: walled.positions, indices: walled.indices }, walled.normals, planarUvs(walled.positions), walled.colors);
  return { part: { name: 'Voxel terrain', geometry, matrix: identityMatrix(), material: { ...LAND_MATERIAL } }, dominant: walled.dominant, wallTriangles: walled.wallTriangles };
}

// A triangle that lies near one side of the grid box (or its base) and faces that side is a wall face. Wall triangles get their
// own copies of their vertices with the earth colour and are listed last in the index buffer, so a wall never shares a
// vertex, and therefore never blends colour, with the top surface.
function splitWalls(compact, normals, colors, dominant, { grid, cellSize, origin }) {
  const positions = Float32Array.from(compact.positions);
  const { indices } = compact;
  const tolerance = WALL_TOLERANCE * cellSize;
  const onSide = (vertex, axis, side) => Math.abs(positions[vertex * 3 + axis] - (side === 0 ? origin[axis] : origin[axis] + grid[axis] * cellSize)) <= tolerance;
  const planes = [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]];
  const faceDirection = triangle => {
    const corner = index => [0, 1, 2].map(axis => positions[indices[triangle * 3 + index] * 3 + axis]);
    const [first, second, third] = [corner(0), corner(1), corner(2)];
    const edgeA = second.map((value, axis) => value - first[axis]);
    const edgeB = third.map((value, axis) => value - first[axis]);
    const normal = [edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1], edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2], edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]];
    const length = Math.hypot(...normal) || 1;
    return normal.map(component => Math.abs(component) / length);
  };
  // A wall triangle lies close to one side of the box and faces that side (a rounded top rim, which faces up, stays top).
  const planeOf = triangle => {
    const direction = faceDirection(triangle);
    return planes.findIndex(([axis, side]) => direction[axis] >= WALL_STEEPNESS && [0, 1, 2].every(corner => onSide(indices[triangle * 3 + corner], axis, side)));
  };
  const topIndices = [];
  const wallIndices = [];
  const wallPlanes = [];
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const plane = planeOf(triangle);
    const target = plane >= 0 ? wallIndices : topIndices;
    if (plane >= 0) wallPlanes.push(plane);
    for (let corner = 0; corner < 3; corner++) target.push(indices[triangle * 3 + corner]);
  }
  const vertexCount = positions.length / 3;
  const copyOf = new Map();
  const extra = [];
  const wallCopies = wallIndices.map(vertex => {
    if (!copyOf.has(vertex)) {
      copyOf.set(vertex, vertexCount + extra.length);
      extra.push(vertex);
    }
    return copyOf.get(vertex);
  });
  const total = vertexCount + extra.length;
  const widen = (source, width) => {
    const result = new Float32Array(total * width);
    result.set(source);
    extra.forEach((vertex, slot) => result.set(source.subarray(vertex * width, vertex * width + width), (vertexCount + slot) * width));
    return result;
  };
  const wallColors = widen(colors, 3);
  extra.forEach((vertex, slot) => wallColors.set(WALL_COLOR, (vertexCount + slot) * 3));
  // A wall is flat: each copy takes the outward direction of the wall faces that use it, not a normal blended with the top.
  const wallNormals = widen(normals, 3);
  extra.forEach((vertex, slot) => wallNormals.fill(0, (vertexCount + slot) * 3, (vertexCount + slot) * 3 + 3));
  wallCopies.forEach((copy, position) => {
    const [axis, side] = planes[wallPlanes[Math.floor(position / 3)]];
    wallNormals[copy * 3 + axis] += side === 0 ? -1 : 1;
  });
  extra.forEach((vertex, slot) => {
    const offset = (vertexCount + slot) * 3;
    const length = Math.hypot(wallNormals[offset], wallNormals[offset + 1], wallNormals[offset + 2]) || 1;
    for (let channel = 0; channel < 3; channel++) wallNormals[offset + channel] /= length;
  });
  const wallDominant = new Uint8Array(total);
  wallDominant.set(dominant);
  extra.forEach((vertex, slot) => { wallDominant[vertexCount + slot] = dominant[vertex]; });
  return {
    positions: widen(positions, 3),
    normals: wallNormals,
    colors: wallColors,
    dominant: wallDominant,
    indices: Uint32Array.from([...topIndices, ...wallCopies]),
    wallTriangles: wallIndices.length / 3,
  };
}

// A ground cell that is only partly full has no room for the water that lies against it, because a cell holds one
// material. Such a cell counts as water-filled when water touches it from above or from the side, and so does every
// partly full cell joined to it at the same height, so the water surface reaches the shore instead of ending on a
// column of cells.
function floodedCells({ grid, palette, occupancy, materials }) {
  const flooded = new Uint8Array(occupancy.length);
  const queue = [];
  const isWater = cell => materials[cell] === palette.waterIndex && occupancy[cell] > 0;
  const tryFlood = cell => {
    if (flooded[cell] || isWater(cell) || occupancy[cell] <= 0 || occupancy[cell] >= 1) return;
    flooded[cell] = 1;
    queue.push(cell);
  };
  const neighbours = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
  const spread = (cell, offsets) => {
    const x = cell % grid[0];
    const y = Math.floor(cell / grid[0]) % grid[1];
    const z = Math.floor(cell / (grid[0] * grid[1]));
    for (const [stepX, stepY, stepZ] of offsets) {
      const nextX = x + stepX;
      const nextY = y + stepY;
      const nextZ = z + stepZ;
      if (nextX >= 0 && nextX < grid[0] && nextY >= 0 && nextY < grid[1] && nextZ >= 0 && nextZ < grid[2]) tryFlood(cellIndexOf(grid, nextX, nextY, nextZ));
    }
  };
  for (let cell = 0; cell < occupancy.length; cell++) {
    if (isWater(cell)) spread(cell, neighbours);
  }
  for (let head = 0; head < queue.length; head++) spread(queue[head], neighbours.slice(0, 4));
  return flooded;
}

// Water is a flat top. The sides of the water volume, where it runs into a bank, are not drawn.
function facesUp({ quads, positions }, quadIndex) {
  const [first, second, third, fourth] = quads[quadIndex].map(vertex => positions.slice(vertex * 3, vertex * 3 + 3));
  const diagonalA = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const diagonalB = [fourth[0] - second[0], fourth[1] - second[1], fourth[2] - second[2]];
  const normal = [
    diagonalA[1] * diagonalB[2] - diagonalA[2] * diagonalB[1],
    diagonalA[2] * diagonalB[0] - diagonalA[0] * diagonalB[2],
    diagonalA[0] * diagonalB[1] - diagonalA[1] * diagonalB[0],
  ];
  return normal[1] / (Math.hypot(...normal) || 1) >= WATER_MINIMUM_UP;
}

// The water volume is blurred together with the bank, so its surface climbs a little up the bank and pokes through the
// land at a grazing angle. A vertex is pressed down to the lowest vertex within two cells of it (when that is no more than a
// cell lower), which gives each body one flat level and leaves separate levels alone.
function flattenBankVertices(positions, cellSize) {
  const bucketOf = (x, z) => `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
  const lowest = new Map();
  for (let offset = 0; offset < positions.length; offset += 3) {
    const key = bucketOf(positions[offset], positions[offset + 2]);
    lowest.set(key, Math.min(lowest.get(key) ?? Infinity, positions[offset + 1]));
  }
  const flattened = positions.slice();
  for (let offset = 0; offset < positions.length; offset += 3) {
    const bucketX = Math.floor(positions[offset] / cellSize);
    const bucketZ = Math.floor(positions[offset + 2] / cellSize);
    let level = positions[offset + 1];
    for (let stepZ = -2; stepZ <= 2; stepZ++) {
      for (let stepX = -2; stepX <= 2; stepX++) {
        const neighbour = lowest.get(`${bucketX + stepX},${bucketZ + stepZ}`);
        if (neighbour !== undefined && neighbour >= positions[offset + 1] - cellSize) level = Math.min(level, neighbour);
      }
    }
    flattened[offset + 1] = level;
  }
  for (let offset = 0; offset < positions.length; offset++) positions[offset] = flattened[offset];
}

function waterPart(input, layout, paddedOrigin) {
  const { grid, palette, occupancy, materials, smoothing, edges, cellSize } = input;
  if (palette.waterIndex < 0) return null;
  const hasWater = materials.some((material, cell) => material === palette.waterIndex && occupancy[cell] > 0);
  if (!hasWater) return null;
  const flooded = floodedCells(input);
  const volume = paddedField(grid, layout, edges, cell => (flooded[cell] ? 1 : occupancy[cell]));
  const blurred = blurField(volume, layout.dims, smoothing);
  const mesh = meshField(signedDistancesOf(blurred), layout, cellSize, paddedOrigin);
  const wetness = blurField(paddedField(grid, layout, edges, cell => (flooded[cell] ? 1 : materials[cell] === palette.waterIndex ? occupancy[cell] : 0)), layout.dims, smoothing);
  // A water quad is kept where the water cells' own blurred occupancy is present at its vertices. Over land the water
  // surface stays a little under the land mesh, so the shoreline is where the land crosses the water, not a grid edge.
  const keep = quadIndex => {
    let total = 0;
    for (const vertex of mesh.quads[quadIndex]) total += sampleField(wetness, layout, pointOf(mesh.positions, vertex, cellSize, paddedOrigin));
    return total / 4 >= WETNESS_THRESHOLD && facesUp(mesh, quadIndex);
  };
  const compact = compactMesh(mesh, keep);
  if (compact.indices.length === 0) return null;
  clampToBounds(compact.positions, input);
  flattenBankVertices(compact.positions, cellSize);
  for (let vertex = 0; vertex < compact.positions.length / 3; vertex++) compact.positions[vertex * 3 + 1] -= WATER_DROP * cellSize;
  const normals = new Float32Array(compact.positions.length);
  for (let vertex = 0; vertex < compact.positions.length / 3; vertex++) normals[vertex * 3 + 1] = 1;
  const geometry = geometryOf(compact, normals, planarUvs(compact.positions));
  return { name: 'Voxel water', geometry, matrix: identityMatrix(), material: { ...WATER_MATERIAL } };
}

/**
 * Mesh a voxel landscape. `grid` is the cell count along x, y (up) and z; `occupancy` holds 0 to 1 per cell and
 * `materials` a palette index per cell, both x fastest, then y, then z. Returns `{ parts, materialIds, bounds, stats }`:
 * a land part whose vertex colours blend the materials of the cells around each vertex (no seam between grass and rock)
 * and, when the palette has water cells, a water part at the top of each water body.
 */
export function createVoxelTerrain(input) {
  const normalized = normalizeVoxelTerrain(input);
  const { grid, cellSize, origin } = normalized;
  const layout = paddedLayout(grid);
  const paddedOrigin = origin.map(value => value - cellSize / 2);
  const started = performance.now();
  const land = landPart(normalized, layout, paddedOrigin);
  const water = waterPart(normalized, layout, paddedOrigin);
  const parts = [land?.part, water].filter(Boolean);
  if (parts.length === 0) throw invalidField('occupancy', 'no surface', 'at least one cell with occupancy above 0.5 whose neighbour is emptier; the grid is empty or full');
  const bounds = { min: [...origin], max: origin.map((value, axis) => value + grid[axis] * cellSize) };
  const vertexTotal = parts.reduce((total, part) => total + part.geometry.positions.length / 3, 0);
  const triangleTotal = parts.reduce((total, part) => total + part.geometry.indices.length / 3, 0);
  return { parts, materialIds: land?.dominant ?? new Uint8Array(0), palette: normalized.palette.names, bounds, stats: { vertices: vertexTotal, triangles: triangleTotal, wallTriangles: land?.wallTriangles ?? 0, milliseconds: performance.now() - started } };
}
