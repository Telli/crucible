import { faceNormals, vertexNormals } from './mesh-normals.js';

// Where a displace edit moves each vertex. A smooth surface moves each vertex along its angle-weighted normal. A vertex
// on a sharp edge or corner would move diagonally while its neighbours on each flat face move along that face's normal,
// and the surface folds over at the edge (#2224). So a sharp vertex goes to the meeting point of its sides' offset
// planes (a miter): each flat side keeps its shape and moves by the depth its own neighbours move by.
// A miter slides the vertex along the sides by that depth, so an inward move of more than the spacing would push the
// vertex past its neighbours and fold the surface again. Inward depth near a sharp vertex is therefore limited to half
// the shortest edge there, growing by SIDE_SLOPE per unit of distance along the surface, so it stays a slope. Outward,
// a sharp vertex may rise above its neighbours on a side by at most SIDE_SLOPE per unit of edge length, so no rim
// overhangs the face below it.
// A rim that may slide only a little cannot follow a face that wants to move far, and the face would stand a hard lip above it.
// So every move fades to zero toward a sharp vertex over a band measured along the surface in world units (the largest
// requested move wide, at most a quarter of the mesh), and the face eases into its rim at any segment count.

/** Adjacent faces that bend apart by more than 60 degrees make their shared vertices sharp. */
const SHARP_BEND_COSINE = Math.cos(60 * Math.PI / 180);
/** Face normals closer than this cosine (about 25 degrees) belong to the same flat side of a sharp vertex. */
const SAME_SIDE_COSINE = 0.9;
const MAX_SIDES = 3;
/** A miter longer than this many times the largest side depth (a very acute edge) is shortened, so a spike cannot shoot off. */
const MAX_MITER_RATIO = 2;
const SINGULAR_DETERMINANT = 1e-4;
/** How much deeper an inward move may get, and how far a sharp vertex may stand out from a neighbour, per unit of edge length. Below 1 so no strip tilts past 22 degrees from its side. */
const SIDE_SLOPE = 0.4;
/** The fade band beside a sharp edge is this many times the largest requested distance wide. */
const EDGE_BAND_PER_AMPLITUDE = 1;
/** The fade band never exceeds this fraction of the mesh size. */
const EDGE_BAND_MAX_EXTENT = 0.25;

/**
 * The move of every vertex as xyz triples, given the signed distance each one is asked to move (positive is outward).
 * Smooth vertices move distance * normal. Vertices on sharp edges are mitered, and inward distances near them are
 * limited (the `distances` array is clamped in place).
 */
export function displacementOffsets(mesh, distances) {
  const normals = vertexNormals(mesh);
  const sharpVertices = findSharpVertices(mesh);
  let limits = null;
  if (sharpVertices.size) {
    const neighbours = edgeNeighbours(mesh);
    const distanceToSharp = surfaceDistanceToSharp(neighbours, sharpVertices);
    fadeDistancesNearSharp(mesh, distances, distanceToSharp);
    limits = limitInwardDistances(mesh, distances, neighbours, distanceToSharp, sharpVertices);
  }
  const offsets = new Float64Array(mesh.vertexCount * 3);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    for (let axis = 0; axis < 3; axis++) offsets[vertex * 3 + axis] = distances[vertex] * normals[vertex * 3 + axis];
  }
  for (const [vertex, corner] of sharpVertices) {
    const miter = miterOffset(mesh, vertex, corner, distances, sharpVertices, limits[vertex]);
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

/** The edge neighbours of every vertex as a flat [neighbour, length, neighbour, length, ...] list. */
function edgeNeighbours(mesh) {
  const neighbours = Array.from({ length: mesh.vertexCount }, () => []);
  for (let edge = 0; edge < mesh.edgeCount; edge++) {
    const first = mesh.edgeVertices[edge * 2];
    const second = mesh.edgeVertices[edge * 2 + 1];
    const length = edgeLength(mesh, first, second);
    neighbours[first].push(second, length);
    neighbours[second].push(first, length);
  }
  return neighbours;
}

/** Distance along the surface from every vertex to the nearest sharp vertex. */
function surfaceDistanceToSharp(neighbours, sharpVertices) {
  const distanceToSharp = new Float64Array(neighbours.length).fill(Infinity);
  const waiting = new Uint8Array(neighbours.length);
  const queue = [...sharpVertices.keys()];
  for (const vertex of queue) {
    distanceToSharp[vertex] = 0;
    waiting[vertex] = 1;
  }
  // Label-correcting relaxation: a vertex is queued again, once, whenever a shorter route lowers its distance.
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head];
    waiting[vertex] = 0;
    const list = neighbours[vertex];
    for (let index = 0; index < list.length; index += 2) {
      const reached = distanceToSharp[vertex] + list[index + 1];
      if (reached >= distanceToSharp[list[index]]) continue;
      distanceToSharp[list[index]] = reached;
      if (waiting[list[index]]) continue;
      waiting[list[index]] = 1;
      queue.push(list[index]);
    }
  }
  return distanceToSharp;
}

/**
 * Fade the distances to zero toward every sharp vertex over a band of EDGE_BAND_PER_AMPLITUDE times the largest distance,
 * so a face eases into its rim instead of stepping up from it: a rim cannot follow a face that moves further than its
 * neighbours allow, and the face would stand a hard lip above it. The band is measured along the surface in world
 * units, so it is the same at any segment count, and it never exceeds EDGE_BAND_MAX_EXTENT of the mesh size.
 */
function fadeDistancesNearSharp(mesh, distances, distanceToSharp) {
  const amplitude = distances.reduce((largest, distance) => Math.max(largest, Math.abs(distance)), 0);
  const bandWidth = Math.min(EDGE_BAND_PER_AMPLITUDE * amplitude, EDGE_BAND_MAX_EXTENT * meshExtent(mesh));
  if (!(bandWidth > 0)) return;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    const along = distanceToSharp[vertex] / bandWidth;
    if (along < 1) distances[vertex] *= along * along * (3 - 2 * along);
  }
}

function meshExtent(mesh) {
  let extent = 0;
  for (let axis = 0; axis < 3; axis++) {
    let low = Infinity;
    let high = -Infinity;
    for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
      low = Math.min(low, mesh.positions[vertex * 3 + axis]);
      high = Math.max(high, mesh.positions[vertex * 3 + axis]);
    }
    extent = Math.max(extent, high - low);
  }
  return extent;
}

/**
 * Clamp inward distances (negative) to half the shortest edge at a sharp vertex plus SIDE_SLOPE per unit of distance from
 * it. Returns the limit of every vertex.
 */
function limitInwardDistances(mesh, distances, neighbours, distanceToSharp, sharpVertices) {
  const limits = new Float64Array(mesh.vertexCount);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) limits[vertex] = SIDE_SLOPE * distanceToSharp[vertex];
  for (const vertex of sharpVertices.keys()) limits[vertex] = Math.min(...neighbours[vertex].filter((_, index) => index % 2)) / 2;
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    if (distances[vertex] < -limits[vertex]) distances[vertex] = -limits[vertex];
  }
  return limits;
}

/**
 * The move that puts a sharp vertex on the offset plane of every side. A side moves by the mean distance of the smooth
 * vertices of its faces (the vertex's own distance when it has none), held within SIDE_SLOPE of each neighbour along an
 * edge and above the inward limit. Null when the sides are dependent.
 */
function miterOffset(mesh, vertex, { sides }, distances, sharpVertices, inwardLimit) {
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
  const largestDepth = Math.max(...depths.map(Math.abs));
  const length = Math.hypot(...offset);
  const scale = length > MAX_MITER_RATIO * largestDepth ? MAX_MITER_RATIO * largestDepth / length : 1;
  return offset.map(value => value * scale);
}

function sideDepth(mesh, vertex, faces, distances, sharpVertices, inwardLimit) {
  const seen = new Set();
  let sum = 0;
  let highest = Infinity;
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
      // Along an edge from the vertex, the neighbour sets how far above or below it the vertex may stand.
      if (step === 1 || step === size - 1) highest = Math.min(highest, distances[other] + SIDE_SLOPE * edgeLength(mesh, vertex, other));
    }
  }
  if (!seen.size) return distances[vertex];
  return Math.max(Math.min(sum / seen.size, highest), -inwardLimit);
}

const dot = (first, second) => first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
const cross = (first, second) => [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
const normalize = vector => vector.map(value => value / (Math.hypot(...vector) || 1));
