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

/** Adjacent faces that bend apart by more than 60 degrees make their shared vertices sharp. */
const SHARP_BEND_COSINE = Math.cos(60 * Math.PI / 180);
/** Face normals closer than this cosine (about 25 degrees) belong to the same flat side of a sharp vertex. */
const SAME_SIDE_COSINE = 0.9;
const MAX_SIDES = 3;
/** A miter longer than this many times the largest side depth (a very acute edge) is shortened, so a spike cannot shoot off. */
const MAX_MITER_RATIO = 2;
const SINGULAR_DETERMINANT = 1e-9;
/** How much deeper an inward move may get, and how far a sharp vertex may stand out from a neighbour, per unit of edge length. Below 1 so no strip tilts past 22 degrees from its side. */
const SIDE_SLOPE = 0.4;

/**
 * The move of every vertex as xyz triples, given the signed distance each one is asked to move (positive is outward).
 * Smooth vertices move distance * normal. Vertices on sharp edges are mitered, and inward distances near them are
 * limited (the `distances` array is clamped in place).
 */
export function displacementOffsets(mesh, distances) {
  const normals = vertexNormals(mesh);
  const sharpVertices = findSharpVertices(mesh);
  const limits = sharpVertices.size ? limitInwardDistances(mesh, distances, sharpVertices) : null;
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

/** Map of vertex to { sides, shortestEdge } for vertices where flat sides meet at a sharp bend. */
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
    if (sides) sharpVertices.set(vertex, { sides, shortestEdge: shortestEdge(mesh, vertex, facesOfVertex[vertex]) });
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

function shortestEdge(mesh, vertex, faces) {
  let shortest = Infinity;
  for (const face of faces) {
    const start = mesh.faceOffsets[face];
    const end = mesh.faceOffsets[face + 1];
    for (let corner = start; corner < end; corner++) {
      if (mesh.cornerVertices[corner] !== vertex) continue;
      const neighbours = [mesh.cornerVertices[corner === start ? end - 1 : corner - 1], mesh.cornerVertices[corner + 1 === end ? start : corner + 1]];
      for (const neighbour of neighbours) shortest = Math.min(shortest, edgeLength(mesh, vertex, neighbour) || Infinity);
    }
  }
  return shortest;
}

function edgeLength(mesh, first, second) {
  return Math.hypot(...[0, 1, 2].map(axis => mesh.positions[first * 3 + axis] - mesh.positions[second * 3 + axis]));
}

/**
 * Clamp inward distances (negative) to half the shortest edge at a sharp vertex plus SIDE_SLOPE per unit of distance from
 * it. Returns the limit of every vertex.
 */
function limitInwardDistances(mesh, distances, sharpVertices) {
  const limits = new Float64Array(mesh.vertexCount).fill(Infinity);
  const queue = [];
  for (const [vertex, corner] of sharpVertices) {
    limits[vertex] = corner.shortestEdge / 2;
    queue.push(vertex);
  }
  const neighbours = Array.from({ length: mesh.vertexCount }, () => []);
  for (let edge = 0; edge < mesh.edgeCount; edge++) {
    const first = mesh.edgeVertices[edge * 2];
    const second = mesh.edgeVertices[edge * 2 + 1];
    const length = edgeLength(mesh, first, second);
    neighbours[first].push(second, length);
    neighbours[second].push(first, length);
  }
  // Label-correcting relaxation: a vertex is queued again whenever a shorter route lowers its limit.
  for (let head = 0; head < queue.length; head++) {
    const vertex = queue[head];
    const list = neighbours[vertex];
    for (let index = 0; index < list.length; index += 2) {
      const reached = limits[vertex] + SIDE_SLOPE * list[index + 1];
      if (reached >= limits[list[index]]) continue;
      limits[list[index]] = reached;
      queue.push(list[index]);
    }
  }
  for (let vertex = 0; vertex < mesh.vertexCount; vertex++) {
    if (distances[vertex] < -limits[vertex]) distances[vertex] = -limits[vertex];
  }
  return limits;
}

/**
 * The move that puts a sharp vertex on the offset plane of every side. A side moves by the mean distance of the smooth
 * vertices next to the vertex along its edges (the vertex's own distance when it has none), held within SIDE_SLOPE of
 * each of them and above the inward limit. Null when the sides are dependent.
 */
function miterOffset(mesh, vertex, { sides }, distances, sharpVertices, inwardLimit) {
  const depths = sides.map(side => sideDepth(mesh, vertex, side.faces, distances, sharpVertices, inwardLimit));
  const gram = sides.map(first => sides.map(second => first.normal[0] * second.normal[0] + first.normal[1] * second.normal[1] + first.normal[2] * second.normal[2]));
  const weights = solve(gram, depths);
  if (!weights) return null;
  const offset = [0, 0, 0];
  for (let side = 0; side < sides.length; side++) {
    for (let axis = 0; axis < 3; axis++) offset[axis] += weights[side] * sides[side].normal[axis];
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
    const end = mesh.faceOffsets[face + 1];
    for (let corner = start; corner < end; corner++) {
      if (mesh.cornerVertices[corner] !== vertex) continue;
      for (const neighbour of [mesh.cornerVertices[corner === start ? end - 1 : corner - 1], mesh.cornerVertices[corner + 1 === end ? start : corner + 1]]) {
        if (sharpVertices.has(neighbour) || seen.has(neighbour)) continue;
        seen.add(neighbour);
        sum += distances[neighbour];
        highest = Math.min(highest, distances[neighbour] + SIDE_SLOPE * edgeLength(mesh, vertex, neighbour));
      }
    }
  }
  if (!seen.size) return distances[vertex];
  return Math.max(Math.min(sum / seen.size, highest), -inwardLimit);
}

/** Solve gram * weights = depths for 2 or 3 sides by Cramer's rule; null when the matrix is singular. */
function solve(gram, depths) {
  const determinant = determinantOf(gram);
  if (Math.abs(determinant) < SINGULAR_DETERMINANT) return null;
  return depths.map((_, column) => determinantOf(gram.map((row, rowIndex) => row.map((value, index) => (index === column ? depths[rowIndex] : value)))) / determinant);
}

function determinantOf(matrix) {
  if (matrix.length === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  return matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
    - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
    + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
}
