import { decimateMesh } from './mesh-decimate.js';
import { createSurfaceDistance } from './mesh-surface-distance.js';
import { meshBounds } from './mesh-data.js';
import { meshFromGeometry } from './mesh-convert.js';
import { extractRender } from './mesh-render.js';
import { simplifyGeometrySteps, finishSteps } from './geometry-simplify.js';
import { requireFiniteInRange } from './modeling-limits.js';

// Levels of detail for runtime selection (issue 37). Level 0 is the input; each next level keeps the given ratio of
// the input's triangles. Every level reports the farthest its vertices lie from the input surface, in the input's
// units, so a renderer can choose the level whose error stays under a pixel at the distance it is drawn.

export const DEFAULT_LOD_RATIOS = Object.freeze([0.5, 0.25, 0.1]);
export const MAX_LOD_LEVELS = 8;

/** Throws a RangeError that says what to pass unless the ratios are 1 to 8 strictly decreasing numbers in (0, 1). */
export function checkRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length < 1 || ratios.length > MAX_LOD_LEVELS) {
    throw new RangeError(`ratios needs 1 to ${MAX_LOD_LEVELS} numbers.`);
  }
  ratios.forEach((ratio, index) => {
    if (typeof ratio !== 'number' || !(ratio > 0) || !(ratio < 1) || (index > 0 && ratio >= ratios[index - 1])) {
      throw new RangeError('ratios must be strictly decreasing numbers above 0 and below 1.');
    }
  });
}

function farthestFromSurface(mesh, surface) {
  const point = [0, 0, 0];
  const visited = new Uint8Array(mesh.vertexCount);
  let farthest = 0;
  for (const vertex of mesh.cornerVertices) {
    if (visited[vertex]) continue;
    visited[vertex] = 1;
    for (let axis = 0; axis < 3; axis++) point[axis] = mesh.positions[vertex * 3 + axis];
    farthest = Math.max(farthest, surface.query(point).distance);
  }
  return farthest;
}

/**
 * Decimate a polygon mesh into levels. Returns [{ level, ratio, mesh, triangles, targetTriangles, error, relativeError, path }],
 * where relativeError is the error over the diagonal of the input's bounds and path is 'decimate' (level 0 is 'input').
 */
export function generateMeshLods(mesh, options) {
  return finishSteps(generateMeshLodsSteps(mesh, options));
}

/** `generateMeshLods` as a generator that yields before each level, so a caller can run it in slices; returns the levels. */
function* generateMeshLodsSteps(mesh, { ratios = DEFAULT_LOD_RATIOS } = {}) {
  checkRatios(ratios);
  const surface = createSurfaceDistance(mesh);
  const bounds = meshBounds(mesh);
  // A mesh whose vertices all coincide has no extent; 1 keeps relativeError a number (0), like the attribute levels.
  const diagonal = Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis])) || 1;
  const levels = [{ level: 0, ratio: 1, mesh, triangles: surface.triangleCount, error: 0, relativeError: 0, path: 'input' }];
  let previousRatio = 1;
  let previous = mesh;
  for (const [index, ratio] of ratios.entries()) {
    yield;
    // Each level continues from the one before, so the work shrinks with the mesh.
    const reduced = decimateMesh(previous, { ratio: ratio / previousRatio });
    const error = farthestFromSurface(reduced.mesh, surface);
    levels.push({ level: index + 1, ratio, mesh: reduced.mesh, triangles: reduced.triangles.after, targetTriangles: Math.ceil(surface.triangleCount * ratio), error, relativeError: error / diagonal, path: 'decimate' });
    previous = reduced.mesh;
    previousRatio = ratio;
  }
  return levels;
}

/** A geometry with uvs, light uvs, colours or sky visibility: welding it into mesh data would lose them. */
function hasPerVertexLook(geometry) {
  return Boolean(geometry.uvs || geometry.lightUvs || geometry.colors || geometry.skyVisibility);
}

/**
 * Levels for a textured or coloured geometry: edge collapses that keep every vertex attribute as it was and never
 * touch a UV seam, a hard edge or an open border, and for a level that this leaves above 1.25 times its target, edge
 * collapses across seams that take the closest uv and normal (see geometry-simplify.js, #2985). `error` is the quadric
 * estimate of how far the surface moved, in the geometry's units; `relativeError` is that over the bounds diagonal;
 * `targetTriangles` is the count asked for and `path` is 'keep' or 'blend', the simplifier that made the level.
 */
function* generateAttributeLodsSteps(geometry, { ratios, blendSeams }) {
  checkRatios(ratios);
  const bounds = geometry.positions;
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < bounds.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], bounds[index + axis]);
      high[axis] = Math.max(high[axis], bounds[index + axis]);
    }
  }
  const diagonal = Math.hypot(...high.map((value, axis) => value - low[axis])) || 1;
  const levels = [{ level: 0, ratio: 1, triangles: geometry.indices.length / 3, error: 0, relativeError: 0, path: 'input', geometry }];
  const reducedLevels = yield* simplifyGeometrySteps(geometry, { ratios, blendSeams });
  reducedLevels.forEach((reduced, index) => {
    levels.push({ level: index + 1, ratio: reduced.ratio, triangles: reduced.triangles, targetTriangles: reduced.target, error: reduced.error, relativeError: reduced.error / diagonal, path: reduced.path, geometry: reduced.geometry });
  });
  return levels;
}

/**
 * Levels for renderer geometry, such as a recipe part from generateMeshGeometry or an imported asset's part. Each
 * level carries a geometry made by extractRender, with edges sharper than `smoothAngle` degrees kept hard. Geometry
 * with per-vertex uvs or colours takes `blendSeams` ('auto', 'never' or 'always') for its seam handling.
 */
export function generateGeometryLods(geometry, options) {
  return finishSteps(generateGeometryLodsSteps(geometry, options));
}

/**
 * `generateGeometryLods` as a generator for a viewer that must stay responsive (#2985): it yields every few milliseconds
 * of work, and the levels it returns are the same bytes as `generateGeometryLods` makes whenever the caller resumes it.
 * A geometry without per-vertex uvs or colours is cut between levels only; one with them is cut inside the simplifier.
 */
export function* generateGeometryLodsSteps(geometry, { ratios = DEFAULT_LOD_RATIOS, smoothAngle = 30, blendSeams = 'auto' } = {}) {
  requireFiniteInRange('generateGeometryLods', 'smoothAngle', smoothAngle, 0, 180);
  if (hasPerVertexLook(geometry)) return yield* generateAttributeLodsSteps(geometry, { ratios, blendSeams });
  const mesh = meshFromGeometry(geometry, { quads: false, tags: 'none' });
  const meshLevels = yield* generateMeshLodsSteps(mesh, { ratios });
  const levels = [];
  for (const { mesh: levelMesh, ...rest } of meshLevels) {
    if (rest.level > 0) yield;
    levels.push({ ...rest, geometry: rest.level === 0 ? geometry : extractRender(levelMesh, { sharpAngle: smoothAngle * Math.PI / 180 }).geometry });
  }
  return levels;
}

/**
 * Levels for an imported asset: each is the asset with every part's geometry replaced by that level's geometry,
 * so it can be handed to the scene as it is. Parts that share a geometry share its levels. Skinned and morphed
 * parts are refused, because decimation would break their per-vertex weights.
 */
export function generateAssetLods(asset, options = {}) {
  const parts = asset?.parts;
  if (!Array.isArray(parts) || !parts.length) throw new TypeError('An asset needs a parts array.');
  for (const part of parts) {
    if (part.skin || part.morph) throw new RangeError(`Part ${part.name ?? part.id ?? '?'} is skinned or morphed; LODs support static parts only.`);
  }
  for (const part of parts) {
    const geometry = part.geometry;
    if (!(geometry?.positions?.length > 0) || !(geometry.indices?.length > 0)) {
      throw new TypeError(`Part ${part.name ?? part.id ?? '?'} needs a geometry with positions and indices; pass the geometry of the part.`);
    }
  }
  const byGeometry = new Map();
  for (const part of parts) {
    if (!byGeometry.has(part.geometry)) byGeometry.set(part.geometry, generateGeometryLods(part.geometry, options));
  }
  const levelCount = byGeometry.get(parts[0].geometry).length;
  return Array.from({ length: levelCount }, (value, level) => {
    const levelParts = parts.map(part => ({ ...part, geometry: byGeometry.get(part.geometry)[level].geometry }));
    const reports = [...byGeometry.values()].map(levels => levels[level]);
    return {
      level,
      ratio: reports[0].ratio,
      triangles: reports.reduce((total, report) => total + report.triangles, 0),
      error: Math.max(...reports.map(report => report.error)),
      paths: [...new Set(reports.map(report => report.path))],
      asset: { ...asset, parts: levelParts },
    };
  });
}
