// A normal for reading a mask (slope, up-facing share), welded by position. A mesh splits a vertex wherever its shading
// normal jumps, so two vertices at one position carry two normals and a mask read from them follows the crease lines
// as stair steps. Here every vertex takes the average of the normals at its position that bend away from its own by
// less than WELD_ANGLE, so a gentle crease (terrain, a rock) reads as one smooth surface, while a real hard edge (the
// 90 degrees of a cube) stays hard. The shading normals are never changed: this is a separate array for masks.

// Position grid for "the same position": 10 micrometres, far below any modelled detail, and exact for split vertices,
// which copy their position bit for bit.
const POSITION_GRID = 1e5;
const WELD_ANGLE = Math.PI / 3;
const WELD_COSINE = Math.cos(WELD_ANGLE);

const weldedByGeometry = new WeakMap();

function positionKey(positions, vertex) {
  const offset = vertex * 3;
  return `${Math.round(positions[offset] * POSITION_GRID)},${Math.round(positions[offset + 1] * POSITION_GRID)},${Math.round(positions[offset + 2] * POSITION_GRID)}`;
}

function angleAt(positions, corner, previous, next) {
  const firstX = positions[previous * 3] - positions[corner * 3];
  const firstY = positions[previous * 3 + 1] - positions[corner * 3 + 1];
  const firstZ = positions[previous * 3 + 2] - positions[corner * 3 + 2];
  const secondX = positions[next * 3] - positions[corner * 3];
  const secondY = positions[next * 3 + 1] - positions[corner * 3 + 1];
  const secondZ = positions[next * 3 + 2] - positions[corner * 3 + 2];
  const crossX = firstY * secondZ - firstZ * secondY;
  const crossY = firstZ * secondX - firstX * secondZ;
  const crossZ = firstX * secondY - firstY * secondX;
  return Math.atan2(Math.hypot(crossX, crossY, crossZ), firstX * secondX + firstY * secondY + firstZ * secondZ);
}

// The sum of the triangle angles at each vertex: how much surface a vertex's normal stands for.
function vertexWeights(geometry, vertexCount) {
  const weights = new Float64Array(vertexCount);
  const { indices, positions } = geometry;
  const cornerCount = indices ? indices.length : vertexCount;
  for (let start = 0; start + 2 < cornerCount; start += 3) {
    const triangle = indices ? [indices[start], indices[start + 1], indices[start + 2]] : [start, start + 1, start + 2];
    for (let slot = 0; slot < 3; slot++) {
      weights[triangle[slot]] += angleAt(positions, triangle[slot], triangle[(slot + 1) % 3], triangle[(slot + 2) % 3]);
    }
  }
  return weights;
}

function verticesByPosition(positions, vertexCount) {
  const groups = new Map();
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const key = positionKey(positions, vertex);
    const group = groups.get(key);
    if (group) group.push(vertex);
    else groups.set(key, [vertex]);
  }
  return groups;
}

function normalsDiffer(normals, first, second) {
  return normals[first * 3] !== normals[second * 3] || normals[first * 3 + 1] !== normals[second * 3 + 1] || normals[first * 3 + 2] !== normals[second * 3 + 2];
}

function weldGroup(group, normals, weights, welded) {
  for (const vertex of group) {
    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let matched = 0;
    for (const other of group) {
      const dot = normals[vertex * 3] * normals[other * 3] + normals[vertex * 3 + 1] * normals[other * 3 + 1] + normals[vertex * 3 + 2] * normals[other * 3 + 2];
      const lengths = Math.hypot(normals[vertex * 3], normals[vertex * 3 + 1], normals[vertex * 3 + 2]) * Math.hypot(normals[other * 3], normals[other * 3 + 1], normals[other * 3 + 2]);
      if (lengths === 0 || dot < WELD_COSINE * lengths) continue;
      matched++;
      const share = weights[other] / Math.hypot(normals[other * 3], normals[other * 3 + 1], normals[other * 3 + 2]);
      sumX += normals[other * 3] * share;
      sumY += normals[other * 3 + 1] * share;
      sumZ += normals[other * 3 + 2] * share;
    }
    const length = Math.hypot(sumX, sumY, sumZ);
    if (matched < 2 || length === 0) continue;
    welded[vertex * 3] = sumX / length;
    welded[vertex * 3 + 1] = sumY / length;
    welded[vertex * 3 + 2] = sumZ / length;
  }
}

/**
 * The vertex normals of a render geometry welded by position, for slope and up-facing masks: vertices at one position
 * share the angle-weighted average of their normals that lie within 60 degrees of their own. A vertex alone at its
 * position, or whose position-mates all carry the same normal, keeps its normal bit for bit, so a mesh without
 * creases gets back `geometry.normals` itself. Returns undefined for a geometry without normals. Cached per geometry;
 * the cost is one pass over the triangles and one over the vertices, and the answer depends only on the mesh.
 */
export function weldedMaskNormals(geometry) {
  const normals = geometry.normals;
  if (!normals) return undefined;
  const remembered = weldedByGeometry.get(geometry);
  if (remembered) return remembered;
  const vertexCount = geometry.positions.length / 3;
  const welded = new Float32Array(normals);
  let anySplit = false;
  let weights;
  for (const group of verticesByPosition(geometry.positions, vertexCount).values()) {
    if (group.length < 2 || !group.some(vertex => normalsDiffer(normals, vertex, group[0]))) continue;
    weights ||= vertexWeights(geometry, vertexCount);
    weldGroup(group, normals, weights, welded);
    anySplit = true;
  }
  const result = anySplit ? welded : normals;
  weldedByGeometry.set(geometry, result);
  return result;
}
