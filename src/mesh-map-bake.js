import { invalidField } from './field-error.js';
import { MESH_MAP_NAMES } from './agent-scene-capabilities.js';
import { createMeshQueryIndex, withoutDegenerateTriangles } from './mesh-query.js';
import { dilateTexels } from './material-vertex-group-map.js';

// Mesh maps: ambient occlusion, curvature and thickness of a mesh written per texel in its UV space, and optionally the
// normals of a second, high mesh seen from the low one. A material graph reads them with {"meshMap":{"name":"curvature"}},
// so edge wear, cavity dirt and translucency follow the surface at texture density instead of vertex density.
//
//   curvature  0.5 on a flat surface, up to 1 on a convex edge and down to 0 in a concave one. It compares the face
//              normal of a texel with the normals of the texels `radius` texels away, so a fold shows as a band of
//              about 2 * radius texels no matter how few vertices the fold has.
//   ao         the share of `rays` cosine-weighted rays above the surface that hit the mesh within `distance`.
//   thickness  the mean distance of `rays` cosine-weighted rays below the surface to the mesh behind it, as a share
//              of `distance`; a ray that leaves the mesh counts as the whole distance.
//   normal     the face normal of the high mesh the texel normal points at, in the tangent space of the low mesh.
//
// Every map is deterministic: the same mesh and options give the same bytes. The work is bounded before any ray is
// cast: texels times rays may not pass MESH_MAP_LIMITS.maxRayCasts.

export { MESH_MAP_NAMES };
export const MESH_MAP_LIMITS = Object.freeze({
  resolution: Object.freeze([1, 2048]),
  rays: Object.freeze([1, 64]),
  radius: Object.freeze([1, 8]),
  gain: Object.freeze([0.1, 16]),
  maxRayCasts: 16_000_000,
});
export const MESH_MAP_DEFAULTS = Object.freeze({ rays: 16, radius: 2, gain: 2, seed: 0 });

const AMBIENT_DISTANCE_SHARE = 0.25;
const RAY_START_OFFSET = 1e-4;
const GOLDEN_RATIO_CONJUGATE = 0.6180339887498949;
const NEIGHBOUR_REACH = 2;
const INSIDE_TOLERANCE = 1e-6;
const NEIGHBOUR_OFFSETS = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]);

function numberInRange(value, [low, high], label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
    throw invalidField(label, value, `a number from ${low} to ${high}`);
  }
  return value;
}

function integerInRange(value, range, label) {
  if (!Number.isInteger(value)) throw invalidField(label, value, `a whole number from ${range[0]} to ${range[1]}`);
  return numberInRange(value, range, label);
}

function triangleCorners(geometry) {
  if (!geometry?.positions || geometry.positions.length < 9) {
    throw invalidField('geometry', geometry, 'a mesh with positions (Float32Array of x, y, z) and at least one triangle');
  }
  if (geometry.indices) return geometry.indices;
  const corners = new Uint32Array(Math.floor(geometry.positions.length / 9) * 3);
  for (let corner = 0; corner < corners.length; corner++) corners[corner] = corner;
  return corners;
}

function checkedSettings(options) {
  const resolution = integerInRange(options.resolution ?? 512, MESH_MAP_LIMITS.resolution, 'resolution');
  const rays = integerInRange(options.rays ?? MESH_MAP_DEFAULTS.rays, MESH_MAP_LIMITS.rays, 'rays');
  const radius = integerInRange(options.radius ?? MESH_MAP_DEFAULTS.radius, MESH_MAP_LIMITS.radius, 'radius');
  const gain = numberInRange(options.gain ?? MESH_MAP_DEFAULTS.gain, MESH_MAP_LIMITS.gain, 'gain');
  const seed = integerInRange(options.seed ?? MESH_MAP_DEFAULTS.seed, [0, 2147483647], 'seed');
  if (options.distance !== undefined) numberInRange(options.distance, [1e-9, 1e9], 'distance');
  return { resolution, rays, radius, gain, seed, distance: options.distance };
}

function meshExtent(positions) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], positions[offset + axis]);
      high[axis] = Math.max(high[axis], positions[offset + axis]);
    }
  }
  return Math.hypot(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
}

function faceNormalDirection(positions, corners, triangle) {
  const first = corners[triangle * 3] * 3;
  const second = corners[triangle * 3 + 1] * 3;
  const third = corners[triangle * 3 + 2] * 3;
  const edgeOneX = positions[second] - positions[first];
  const edgeOneY = positions[second + 1] - positions[first + 1];
  const edgeOneZ = positions[second + 2] - positions[first + 2];
  const edgeTwoX = positions[third] - positions[first];
  const edgeTwoY = positions[third + 1] - positions[first + 1];
  const edgeTwoZ = positions[third + 2] - positions[first + 2];
  const x = edgeOneY * edgeTwoZ - edgeOneZ * edgeTwoY;
  const y = edgeOneZ * edgeTwoX - edgeOneX * edgeTwoZ;
  const z = edgeOneX * edgeTwoY - edgeOneY * edgeTwoX;
  return [x, y, z];
}

function faceNormal(positions, corners, triangle) {
  const [x, y, z] = faceNormalDirection(positions, corners, triangle);
  const length = Math.hypot(x, y, z);
  return length === 0 ? [0, 0, 0] : [x / length, y / length, z / length];
}

function surfaceArea(positions, corners, triangle) {
  const [x, y, z] = faceNormalDirection(positions, corners, triangle);
  return 0.5 * Math.hypot(x, y, z);
}

/**
 * The texels each triangle covers: for every texel the triangle it sits in (-1 for none) and its position on the
 * surface. A texel is covered by the triangle that contains its centre; where UV islands overlap, the later one wins.
 */
function rasterizeSurface(geometry, corners, resolution) {
  const { positions, uvs } = geometry;
  const triangleOf = new Int32Array(resolution * resolution).fill(-1);
  const texelSizes = new Float32Array(Math.floor(corners.length / 3));
  const points = new Float32Array(resolution * resolution * 3);
  for (let triangle = 0; triangle * 3 + 2 < corners.length; triangle++) {
    const vertices = [corners[triangle * 3], corners[triangle * 3 + 1], corners[triangle * 3 + 2]];
    const [[ax, ay], [bx, by], [cx, cy]] = vertices.map(vertex => [uvs[vertex * 2] * resolution, uvs[vertex * 2 + 1] * resolution]);
    const area = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (Math.abs(area) < INSIDE_TOLERANCE) continue;
    texelSizes[triangle] = Math.sqrt(surfaceArea(positions, corners, triangle) / Math.abs(area));
    const firstColumn = Math.max(0, Math.floor(Math.min(ax, bx, cx) - 1));
    const lastColumn = Math.min(resolution - 1, Math.ceil(Math.max(ax, bx, cx)));
    const firstRow = Math.max(0, Math.floor(Math.min(ay, by, cy) - 1));
    const lastRow = Math.min(resolution - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let row = firstRow; row <= lastRow; row++) {
      for (let column = firstColumn; column <= lastColumn; column++) {
        const pointX = column + 0.5;
        const pointY = row + 0.5;
        const weightB = ((pointX - ax) * (cy - ay) - (cx - ax) * (pointY - ay)) / area;
        const weightC = ((bx - ax) * (pointY - ay) - (pointX - ax) * (by - ay)) / area;
        const weightA = 1 - weightB - weightC;
        if (weightA < -INSIDE_TOLERANCE || weightB < -INSIDE_TOLERANCE || weightC < -INSIDE_TOLERANCE) continue;
        const texel = row * resolution + column;
        triangleOf[texel] = triangle;
        for (let axis = 0; axis < 3; axis++) {
          points[texel * 3 + axis] = weightA * positions[vertices[0] * 3 + axis] + weightB * positions[vertices[1] * 3 + axis] + weightC * positions[vertices[2] * 3 + axis];
        }
      }
    }
  }
  return { triangleOf, points, texelSizes };
}

function triangleNormals(positions, corners) {
  const count = Math.floor(corners.length / 3);
  const normals = new Float32Array(count * 3);
  for (let triangle = 0; triangle < count; triangle++) normals.set(faceNormal(positions, corners, triangle), triangle * 3);
  return normals;
}

function curvatureAt(surface, normals, texel, resolution, radius, gain) {
  const { triangleOf, points, texelSizes } = surface;
  const column = texel % resolution;
  const row = (texel - column) / resolution;
  const own = triangleOf[texel] * 3;
  let sum = 0;
  let count = 0;
  for (const [columnStep, rowStep] of NEIGHBOUR_OFFSETS) {
    const neighbourColumn = column + columnStep * radius;
    const neighbourRow = row + rowStep * radius;
    if (neighbourColumn < 0 || neighbourRow < 0 || neighbourColumn >= resolution || neighbourRow >= resolution) continue;
    const neighbour = neighbourRow * resolution + neighbourColumn;
    if (triangleOf[neighbour] < 0) continue;
    const deltaX = points[neighbour * 3] - points[texel * 3];
    const deltaY = points[neighbour * 3 + 1] - points[texel * 3 + 1];
    const deltaZ = points[neighbour * 3 + 2] - points[texel * 3 + 2];
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    // Texels of another UV island that only sit beside this one in the atlas are not neighbours on the surface.
    if (distance < 1e-12 || distance > NEIGHBOUR_REACH * radius * Math.max(texelSizes[triangleOf[texel]], texelSizes[triangleOf[neighbour]])) continue;
    const other = triangleOf[neighbour] * 3;
    // How far the normal turns toward the direction of travel: positive over a convex fold, negative over a concave one.
    sum += ((normals[other] - normals[own]) * deltaX + (normals[other + 1] - normals[own + 1]) * deltaY + (normals[other + 2] - normals[own + 2]) * deltaZ) / distance;
    count++;
  }
  if (count === 0) return 0.5;
  return 0.5 + 0.5 * Math.min(1, Math.max(-1, (gain * sum) / count));
}

function hemisphereDirection(normal, ringShare, turnShare, sign) {
  const [normalX, normalY, normalZ] = normal;
  // Any vector not parallel to the normal gives the tangent frame.
  const helperIsX = Math.abs(normalX) < 0.9;
  const helperX = helperIsX ? 1 : 0;
  const helperY = helperIsX ? 0 : 1;
  let tangentX = helperY * normalZ;
  let tangentY = -helperX * normalZ;
  let tangentZ = helperX * normalY - helperY * normalX;
  const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
  tangentX /= tangentLength;
  tangentY /= tangentLength;
  tangentZ /= tangentLength;
  const bitangentX = normalY * tangentZ - normalZ * tangentY;
  const bitangentY = normalZ * tangentX - normalX * tangentZ;
  const bitangentZ = normalX * tangentY - normalY * tangentX;
  const radius = Math.sqrt(ringShare);
  const angle = 2 * Math.PI * turnShare;
  const sideways = radius * Math.cos(angle);
  const forwards = radius * Math.sin(angle);
  const upwards = sign * Math.sqrt(Math.max(0, 1 - ringShare));
  return [
    tangentX * sideways + bitangentX * forwards + normalX * upwards,
    tangentY * sideways + bitangentY * forwards + normalY * upwards,
    tangentZ * sideways + bitangentZ * forwards + normalZ * upwards,
  ];
}

// A small deterministic hash of a texel and a seed, 0 to 1, so each texel turns its stratified rays by its own angle.
function texelTurn(texel, seed) {
  let state = (Math.imul(texel + 1, 0x9e3779b1) ^ Math.imul(seed + 1, 0x85ebca6b)) >>> 0;
  state = Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) >>> 0;
  state = Math.imul(state ^ (state >>> 12), 0x297a2d39) >>> 0;
  return ((state ^ (state >>> 15)) >>> 0) / 4294967296;
}

function createSurfaceIndex(geometry, corners) {
  const surface = withoutDegenerateTriangles({ positions: geometry.positions, indices: corners });
  if (surface.indices.length === 0) {
    throw invalidField('geometry', 'a mesh of zero-area triangles', 'a mesh with at least one triangle that has area');
  }
  return {
    surface,
    index: createMeshQueryIndex({ positions: new Float32Array(surface.positions), indices: surface.indices }),
  };
}

function checkRayWork(coveredTexels, rays) {
  if (coveredTexels * rays > MESH_MAP_LIMITS.maxRayCasts) {
    throw new RangeError(`Mesh map would cast ${coveredTexels * rays} rays (${coveredTexels} covered texels times ${rays} rays); the limit is ${MESH_MAP_LIMITS.maxRayCasts}. Pass a smaller resolution or fewer rays.`);
  }
}

// Casts `rays` stratified rays from every covered texel and returns the mean of `measure(hitDistanceOrNull)`.
function castFromTexels({ surface, normals, texelCount, resolution, rays, seed, reach, sign }, measure) {
  const { index } = createSurfaceIndex(surface.geometry, surface.corners);
  const values = new Float32Array(texelCount);
  try {
    for (let texel = 0; texel < texelCount; texel++) {
      const triangle = surface.triangleOf[texel];
      if (triangle < 0) continue;
      const normal = [normals[triangle * 3], normals[triangle * 3 + 1], normals[triangle * 3 + 2]];
      if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) continue;
      const startShare = reach * RAY_START_OFFSET;
      const origin = [0, 1, 2].map(axis => surface.points[texel * 3 + axis] + normal[axis] * sign * startShare);
      const turnOffset = texelTurn(texel, seed);
      let total = 0;
      for (let ray = 0; ray < rays; ray++) {
        const direction = hemisphereDirection(normal, (ray + 0.5) / rays, (turnOffset + ray * GOLDEN_RATIO_CONJUGATE) % 1, sign);
        const found = index.firstHit(origin, direction, reach);
        total += measure(found ? found.distance : null);
      }
      values[texel] = total / rays;
    }
  } finally {
    index.dispose();
  }
  return values;
}

function scalarMapValues(name, context, settings) {
  const { surface, normals, resolution } = context;
  const texelCount = resolution * resolution;
  if (name === 'curvature') {
    const values = new Float32Array(texelCount);
    for (let texel = 0; texel < texelCount; texel++) {
      if (surface.triangleOf[texel] >= 0) values[texel] = curvatureAt(surface, normals, texel, resolution, settings.radius, settings.gain);
    }
    return values;
  }
  const extent = meshExtent(surface.geometry.positions);
  const cast = { surface, normals, texelCount, resolution, rays: settings.rays, seed: settings.seed };
  if (name === 'ao') {
    const reach = settings.distance ?? extent * AMBIENT_DISTANCE_SHARE;
    return castFromTexels({ ...cast, reach, sign: 1 }, hitDistance => (hitDistance === null ? 0 : 1));
  }
  const reach = settings.distance ?? extent;
  return castFromTexels({ ...cast, reach, sign: -1 }, hitDistance => (hitDistance === null ? 1 : Math.min(1, hitDistance / reach)));
}

function toRgbaMap(values, triangleOf, resolution) {
  const texelCount = resolution * resolution;
  const texels = new Uint8Array(texelCount);
  const covered = new Uint8Array(texelCount);
  for (let texel = 0; texel < texelCount; texel++) {
    if (triangleOf[texel] < 0) continue;
    texels[texel] = Math.round(Math.min(1, Math.max(0, values[texel])) * 255);
    covered[texel] = 1;
  }
  dilateTexels(texels, covered, resolution);
  const data = new Uint8ClampedArray(texelCount * 4);
  for (let texel = 0; texel < texelCount; texel++) {
    data[texel * 4] = texels[texel];
    data[texel * 4 + 1] = texels[texel];
    data[texel * 4 + 2] = texels[texel];
    data[texel * 4 + 3] = 255;
  }
  return Object.freeze({ width: resolution, height: resolution, data });
}

function checkUvs(geometry, corners, name) {
  if (!geometry.uvs) {
    throw invalidField('meshMap', name, 'a mesh with UVs; add UVs with a uv mesh edit, since a mesh map is written in UV space');
  }
  const vertexCount = geometry.positions.length / 3;
  if (geometry.uvs.length < vertexCount * 2) throw invalidField('uvs', geometry.uvs.length, `two numbers for each of the ${vertexCount} vertices`);
  for (const corner of corners) {
    if (corner >= vertexCount) throw invalidField('indices', corner, `vertex indices below ${vertexCount}`);
  }
}

function prepareSurface(geometry, name, settings) {
  const corners = triangleCorners(geometry);
  checkUvs(geometry, corners, name);
  const { triangleOf, points, texelSizes } = rasterizeSurface(geometry, corners, settings.resolution);
  const covered = triangleOf.reduce((count, triangle) => count + (triangle >= 0 ? 1 : 0), 0);
  if (name === 'ao' || name === 'thickness') checkRayWork(covered, settings.rays);
  return { geometry, corners, triangleOf, points, texelSizes };
}

/**
 * One scalar mesh map of `geometry` as `{ width, height, data }` RGBA bytes with the value (0 to 255) in the red
 * channel, row 0 at v = 0, like a baked graph. `name` is curvature, ao or thickness. `geometry` is `{ positions,
 * indices?, uvs }`. Options: resolution (1 to 2048, 512), rays (1 to 64, 16; ao and thickness), radius (texels, 1 to 8, 2;
 * curvature), gain (0.1 to 16, 2; curvature), distance (metres; a quarter of the bounding box diagonal for ao, the whole
 * diagonal for thickness) and seed. Throws, with what to pass instead, on a mesh without UVs or a number out of range.
 */
export function bakeMeshMap(geometry, name, options = {}) {
  if (!MESH_MAP_NAMES.includes(name)) throw invalidField('meshMap name', name, `one of ${MESH_MAP_NAMES.join(', ')}; a high-to-low normal map comes from bakeHighToLowNormalMap`);
  const settings = checkedSettings(options);
  const surface = prepareSurface(geometry, name, settings);
  const normals = triangleNormals(geometry.positions, surface.corners);
  const values = scalarMapValues(name, { surface, normals, resolution: settings.resolution }, settings);
  return toRgbaMap(values, surface.triangleOf, settings.resolution);
}

function tangentFrame(geometry, corners, triangle, normal) {
  const [first, second, third] = [corners[triangle * 3], corners[triangle * 3 + 1], corners[triangle * 3 + 2]];
  const { positions, uvs } = geometry;
  const edgeOne = [0, 1, 2].map(axis => positions[second * 3 + axis] - positions[first * 3 + axis]);
  const edgeTwo = [0, 1, 2].map(axis => positions[third * 3 + axis] - positions[first * 3 + axis]);
  const deltaUOne = uvs[second * 2] - uvs[first * 2];
  const deltaVOne = uvs[second * 2 + 1] - uvs[first * 2 + 1];
  const deltaUTwo = uvs[third * 2] - uvs[first * 2];
  const deltaVTwo = uvs[third * 2 + 1] - uvs[first * 2 + 1];
  const determinant = deltaUOne * deltaVTwo - deltaUTwo * deltaVOne;
  if (Math.abs(determinant) < 1e-20) return null;
  const tangent = [0, 1, 2].map(axis => (edgeOne[axis] * deltaVTwo - edgeTwo[axis] * deltaVOne) / determinant);
  const alongNormal = tangent[0] * normal[0] + tangent[1] * normal[1] + tangent[2] * normal[2];
  const flattened = tangent.map((value, axis) => value - normal[axis] * alongNormal);
  const length = Math.hypot(...flattened);
  if (length === 0) return null;
  const unitTangent = flattened.map(value => value / length);
  const bitangent = [
    normal[1] * unitTangent[2] - normal[2] * unitTangent[1],
    normal[2] * unitTangent[0] - normal[0] * unitTangent[2],
    normal[0] * unitTangent[1] - normal[1] * unitTangent[0],
  ];
  return { tangent: unitTangent, bitangent };
}

/**
 * The normals of `highMesh` as seen from `geometry`, in tangent space and encoded 0 to 255 as 0.5 + 0.5 * n, as an RGBA
 * `{ width, height, data }` map (flat blue where nothing of the high mesh is in reach). Each texel casts a ray from `cage`
 * metres above the low surface, against its face normal, and takes the face normal of the first high triangle it meets.
 * Options: resolution (1 to 2048, 512), cage (metres, default a tenth of the bounding box diagonal of the low mesh).
 */
export function bakeHighToLowNormalMap(geometry, highMesh, options = {}) {
  const resolution = integerInRange(options.resolution ?? 512, MESH_MAP_LIMITS.resolution, 'resolution');
  if (options.cage !== undefined) numberInRange(options.cage, [1e-9, 1e9], 'cage');
  const highCorners = triangleCorners(highMesh);
  const { surface: highSurface, index } = createSurfaceIndex(highMesh, highCorners);
  const surface = prepareSurface(geometry, 'normal', { resolution });
  const normals = triangleNormals(geometry.positions, surface.corners);
  const highNormals = triangleNormals(new Float32Array(highSurface.positions), highSurface.indices);
  const cage = options.cage ?? meshExtent(geometry.positions) * 0.1;
  const texelCount = resolution * resolution;
  checkRayWork(surface.triangleOf.reduce((count, triangle) => count + (triangle >= 0 ? 1 : 0), 0), 1);
  const data = new Uint8ClampedArray(texelCount * 4);
  const flat = [0.5, 0.5, 1];
  try {
    for (let texel = 0; texel < texelCount; texel++) {
      const triangle = surface.triangleOf[texel];
      let encoded = flat;
      const normal = triangle < 0 ? null : [normals[triangle * 3], normals[triangle * 3 + 1], normals[triangle * 3 + 2]];
      const frame = normal ? tangentFrame(geometry, surface.corners, triangle, normal) : null;
      if (frame) {
        const origin = [0, 1, 2].map(axis => surface.points[texel * 3 + axis] + normal[axis] * cage);
        const found = index.firstHit(origin, normal.map(value => -value), cage * 2);
        if (found) {
          const high = [highNormals[found.triangle * 3], highNormals[found.triangle * 3 + 1], highNormals[found.triangle * 3 + 2]];
          const alongNormal = high[0] * normal[0] + high[1] * normal[1] + high[2] * normal[2];
          // A high face seen from behind (a two-sided hit) is flipped to face the low surface.
          const facing = alongNormal < 0 ? -1 : 1;
          const local = [
            facing * (high[0] * frame.tangent[0] + high[1] * frame.tangent[1] + high[2] * frame.tangent[2]),
            facing * (high[0] * frame.bitangent[0] + high[1] * frame.bitangent[1] + high[2] * frame.bitangent[2]),
            facing * alongNormal,
          ];
          encoded = local.map(value => 0.5 + 0.5 * value);
        }
      }
      for (let channel = 0; channel < 3; channel++) data[texel * 4 + channel] = Math.round(Math.min(1, Math.max(0, encoded[channel])) * 255);
      data[texel * 4 + 3] = 255;
    }
  } finally {
    index.dispose();
  }
  return Object.freeze({ width: resolution, height: resolution, data });
}

const mapsByGeometry = new WeakMap();

/**
 * `bakeMeshMap` with the default options at `resolution`, cached per geometry, name and resolution so a part keeps the
 * same map between rebuilds. The material graph's `meshMap` node reads these.
 */
export function meshMapForGeometry(geometry, name, resolution) {
  let maps = mapsByGeometry.get(geometry);
  if (!maps) {
    maps = new Map();
    mapsByGeometry.set(geometry, maps);
  }
  const key = `${name}|${resolution}`;
  const remembered = maps.get(key);
  if (remembered) return remembered;
  const map = bakeMeshMap(geometry, name, { resolution });
  maps.set(key, map);
  return map;
}
