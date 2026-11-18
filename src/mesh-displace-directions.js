import { faceNormals, vertexNormals } from './mesh-normals.js';

// Where a displace edit moves each vertex. A smooth surface moves each vertex along its angle-weighted normal. A vertex
// on a sharp edge or corner would move diagonally while its neighbours on each flat face move along that face's normal,
// and the surface folds over at the edge (#2224). So a sharp vertex goes to the meeting point of its sides' offset
// planes (a miter): each flat side keeps its shape and moves by the depth its own neighbours move by.
// A miter slides the vertex along the sides by that depth, so a move of more than the spacing would push the vertex past
// its neighbours and fold the surface again, and a rim that rises on its own leaves a hard lip above the face next to it.
// So every move fades to zero toward a sharp vertex over a band measured along the surface in world units (twice the
// largest requested move wide), the face eases into its rim at any segment count, and the depth of a rim stays within
// half its shortest edge inward.

/** Adjacent faces that bend apart by more than 60 degrees make their shared vertices sharp. */
const SHARP_BEND_COSINE = Math.cos(60 * Math.PI / 180);
/** Face normals closer than this cosine (about 25 degrees) belong to the same flat side of a sharp vertex. */
const SAME_SIDE_COSINE = 0.9;
const MAX_SIDES = 3;
/** A miter longer than this many times the largest side depth (a very acute edge) is shortened, so a spike cannot shoot off. */
const MAX_MITER_RATIO = 2;
const SINGULAR_DETERMINANT = 1e-4;
/** The fade band beside a sharp edge is this many times the largest requested distance wide. */
const EDGE_BAND_PER_AMPLITUDE = 2;

/**
 * The move of every vertex as xyz triples, given the signed distance each one is asked to move (positive is outward).
 * Smooth vertices move distance * normal. Vertices on sharp edges are mitered, and inward distances near them are
 * limited (the `distances` array is clamped in place).
 */
export function displacementOffsets(mesh, distances) {
  const normals = vertexNormals(mesh);
  const sharpVertices = findSharpVertices(mesh);
  if (sharpVertices.size) easeDistancesNearSharp(mesh, distances, sharpVertices);
  const offsets = new Float64Array(mesh.vertexCount * 3);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    for (let axis = 0; axis < 3; axis++) offsets[vertex * 3 + axis] = distances[vertex] * normals[vertex * 3 + axis];
  }
  for (const [vertex, corner] of sharpVertices) {
    const miter = miterOffset(mesh, vertex, corner, distances, sharpVertices);
    if (miter) offsets.set(miter, vertex * 3);
  }
  return offsets;
}

/** Map of vertex to { sides } for vertices where flat sides meet at a sharp bend. */
function findSharpVertices(mesh) {
  const { normals: faceNormal, areas } = faceNormals(mesh);
  const facesOfVertex = Array.from({ length: mesh.vertexCount }, () => []);
  for (let face = 0; face < mesh.faceCount; face++) {
    if (!areas[face]) continue;
    for (let corner = mesh.faceOffsets[face]; corner < mesh.faceOffsets[face + 1]; corner++) {
      facesOfVertex[mesh.cornerVertices[corner]].push(face);
    }
  }
  const sharpVertices = new Map();
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const sides = sharpSides(facesOfVertex[vertex], faceNormal);
    if (sides) sharpVertices.set(vertex, { sides });
  }
  return sharpVertices;
}

/** The distinct flat sides at a vertex ({ normal, faces }), or null when the vertex is smooth or has too many sides to miter. */
function sharpSides(faces, faceNormal) {
  let sharp = false;
  const sides = [];
  for (const face of faces) {
    const normal = [faceNormal[face * 3], faceNormal[face * 3 + 1], faceNormal[face * 3 + 2]];
    let matched = false;
    for (const side of sides) {
      const cosine = side.representative[0] * normal[0] + side.representative[1] * normal[1] + side.representative[2] * normal[2];
      if (cosine < SHARP_BEND_COSINE) sharp = true;
      if (cosine >= SAME_SIDE_COSINE) {
        for (let axis = 0; axis < 3; axis++) side.sum[axis] += normal[axis];
        side.faces.push(face);
        matched = true;
      }
    }
    if (!matched) sides.push({ representative: normal, sum: [...normal], faces: [face] });
  }
  if (!sharp || sides.length < 2 || sides.length > MAX_SIDES) return null;
  return sides.map(side => {
    const length = Math.hypot(...side.sum);
    return { normal: side.sum.map(value => value / length), faces: side.faces };
  });
}

function edgeLength(mesh, first, second) {
  return Math.hypot(...[0, 1, 2].map(axis => mesh.positions[first * 3 + axis] - mesh.positions[second * 3 + axis]));
}

/**
 * Ease the distances toward every sharp vertex, in place. They fade to zero over a band EDGE_BAND_PER_AMPLITUDE times the
 * largest distance wide, so a face eases into its rim instead of stepping up from it: a rim cannot follow a face that
 * moves further than its neighbours allow, and the face would stand a hard lip above it. The band is measured along the
 * surface in world units, so it is the same at any segment count, and the largest distance bounds it. Each sharp vertex
 * also gets an inwardLimit of half its shortest edge, which keeps a vertex from sliding past a close neighbour.
 */
function easeDistancesNearSharp(mesh, distances, sharpVertices) {
  const bandWidth = EDGE_BAND_PER_AMPLITUDE * distances.reduce((largest, distance) => Math.max(largest, Math.abs(distance)), 0);
  const lengths = Float64Array.from({ length: mesh.edgeCount }, (_, edge) => edgeLength(mesh, mesh.edgeVertices[edge * 2], mesh.edgeVertices[edge * 2 + 1]));
  const shortest = new Float64Array(mesh.vertexCount).fill(Infinity);
  const distanceToSharp = new Float64Array(mesh.vertexCount).fill(Infinity);
  for (const vertex of sharpVertices.keys()) distanceToSharp[vertex] = 0;
  // Relax every edge both ways until no vertex gets closer; routes longer than the band cannot matter.
  for (let changed = true; changed;) {
    changed = false;
    for (let edge = 0; edge < mesh.edgeCount * 2; edge++) {
      const from = mesh.edgeVertices[edge];
      const to = mesh.edgeVertices[edge ^ 1];
      const reached = distanceToSharp[from] + lengths[edge >> 1];
      shortest[to] = Math.min(shortest[to], lengths[edge >> 1]);
      if (reached >= Math.min(distanceToSharp[to], bandWidth)) continue;
      distanceToSharp[to] = reached;
      changed = true;
    }
  }
  for (const [vertex, corner] of sharpVertices) corner.inwardLimit = shortest[vertex] / 2;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const along = Math.min(distanceToSharp[vertex] / bandWidth || 1, 1);
    distances[vertex] *= along * along * (3 - 2 * along);
  }
}

/**
 * The move that puts a sharp vertex on the offset plane of every side. A side moves by the mean distance of the smooth
 * vertices of its faces (the vertex's own distance when it has none), kept above the inward limit. Null when the sides are dependent.
 */
function miterOffset(mesh, vertex, { sides, inwardLimit }, distances, sharpVertices) {
  const depths = sides.map(side => sideDepth(mesh, vertex, side.faces, distances, sharpVertices, inwardLimit));
  // Three planes n_i . x = depth_i meet at x = sum(depth_i * (n_j x n_k)) / (n_1 . (n_2 x n_3)); two sides get the third plane
  // along their edge, which holds no depth.
  const normals = sides.map(side => side.normal);
  if (normals.length === 2) normals.push(normalize(cross(normals[0], normals[1])));
  const determinant = dot(normals[0], cross(normals[1], normals[2]));
  if (!(Math.abs(determinant) >= SINGULAR_DETERMINANT)) return null;
  const offset = [0, 0, 0];
  for (let side = 0; side < 3; side++) {
    const across = cross(normals[(side + 1) % 3], normals[(side + 2) % 3]);
    for (let axis = 0; axis < 3; axis++) offset[axis] += (depths[side] ?? 0) * across[axis] / determinant;
  }
  const longest = MAX_MITER_RATIO * Math.max(...depths.map(Math.abs));
  const length = Math.hypot(...offset);
  return length > longest ? offset.map(value => value * longest / length) : offset;
}

function sideDepth(mesh, vertex, faces, distances, sharpVertices, inwardLimit) {
  const seen = new Set();
  let sum = 0;
  for (const face of faces) {
    const start = mesh.faceOffsets[face];
    const size = mesh.faceOffsets[face + 1] - start;
    let own = 0;
    while (mesh.cornerVertices[start + own] !== vertex) own++;
    for (let step = 1; step < size; step++) {
      const other = mesh.cornerVertices[start + (own + step) % size];
      if (sharpVertices.has(other) || seen.has(other)) continue;
      seen.add(other);
      sum += distances[other];
    }
  }
  if (!seen.size) return distances[vertex];
  return Math.max(sum / seen.size, -inwardLimit);
}

const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
const cross = (first, second) => [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
const normalize = vector => vector.map(value => value / (Math.hypot(...vector) || 1));
