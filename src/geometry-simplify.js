// Edge collapse for renderer geometry that keeps every vertex attribute (normals, uvs, light uvs, colours, sky
// visibility) exactly as it was: a collapse moves the removed vertex onto a vertex that stays, so no attribute is
// ever blended or invented. Vertices on a border of the index buffer (an open edge, a UV seam, a hard edge) never
// move or disappear, so textures and shading breaks stay where they were. The cost of a collapse is the quadric error
// of Garland and Heckbert (the same measure `mesh-decimate.js` uses on mesh data, which drops uvs).
// Used for scans and textured models that `generateGeometryLods` could not reduce before (#1163).
// A scan whose UV atlas is cut into many islands has a seam at almost every vertex, so that never-blend path stops
// near 96% of the triangles (#2985). For those levels a second path welds vertices that share a position, so a seam is
// no longer a border, and collapses across it: the triangles of the removed vertex then take, per corner, the attributes
// of the kept vertex's copy that is closest in uv and normal, and the cost adds that attribute distance (in position
// units) to the quadric error. Only a true open border or a non-manifold edge of the welded surface stays locked.
// Every plane counts once (not by face area), so the square root of a quadric cost is a distance in the units of the
// positions and scales with the mesh: tiny triangles do not make a collapse look cheaper.

import { findNonFiniteVertex } from './triangle-math.js';

const PER_VERTEX_ATTRIBUTES = [['normals', 3], ['uvs', 2], ['lightUvs', 2], ['colors', 3], ['skyVisibility', 1], ['tangents', 4]];
const MINIMUM_NORMAL_AGREEMENT = 0.2;
const MINIMUM_TRIANGLES = 4;
/** A level counts as missed when it keeps more than this many times its target triangles (#2985). */
export const SEAM_FALLBACK_OVERSHOOT = 1.25;
/** The `blendSeams` choices of simplifyGeometry. */
export const BLEND_SEAMS_MODES = Object.freeze(['auto', 'never', 'always']);
/** How much a uv or normal difference counts against a collapse across a seam, as a share of the bounds diagonal per unit of difference. */
const SEAM_UV_WEIGHT = 0.05;
const SEAM_NORMAL_WEIGHT = 0.05;
/** The most triangles and vertices one geometry may have: the edge map and the heap grow with them. */
export const MAXIMUM_SIMPLIFY_TRIANGLES = 2000000;
export const MAXIMUM_SIMPLIFY_VERTICES = 2000000;

class MinHeap {
  constructor() {
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }

  push(entry) {
    const entries = this.entries;
    let index = entries.length;
    entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (entries[parent].cost <= entry.cost) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = entry;
  }

  pop() {
    const entries = this.entries;
    const top = entries[0];
    const last = entries.pop();
    if (entries.length) {
      let index = 0;
      for (;;) {
        let child = index * 2 + 1;
        if (child >= entries.length) break;
        if (child + 1 < entries.length && entries[child + 1].cost < entries[child].cost) child++;
        if (entries[child].cost >= last.cost) break;
        entries[index] = entries[child];
        index = child;
      }
      entries[index] = last;
    }
    return top;
  }
}

function validateGeometry(geometry) {
  if (!(geometry?.positions instanceof Float32Array) || !(geometry.indices instanceof Uint32Array || geometry.indices instanceof Uint16Array)) {
    throw new TypeError('simplifyGeometry needs a geometry with Float32Array positions and Uint16Array or Uint32Array indices.');
  }
  if (geometry.indices.length % 3 !== 0) throw new RangeError('simplifyGeometry needs indices that hold whole triangles.');
  if (geometry.positions.length % 3 !== 0) {
    throw new RangeError(`simplifyGeometry needs positions with three numbers per vertex, got a length of ${geometry.positions.length}: pass x, y, z for every vertex.`);
  }
  const triangleCount = geometry.indices.length / 3;
  const vertexCount = geometry.positions.length / 3;
  if (triangleCount > MAXIMUM_SIMPLIFY_TRIANGLES || vertexCount > MAXIMUM_SIMPLIFY_VERTICES) {
    throw new RangeError(`simplifyGeometry takes at most ${MAXIMUM_SIMPLIFY_TRIANGLES} triangles and ${MAXIMUM_SIMPLIFY_VERTICES} vertices per geometry, got ${triangleCount} triangles and ${vertexCount} vertices: split the part into smaller geometries or skip levels for it.`);
  }
  for (const field of ['joints', 'weights', 'morphTargets']) {
    if (geometry[field]) throw new RangeError(`simplifyGeometry cannot reduce skinned or morphed geometry (${field}); its per-vertex weights would break.`);
  }
  validateIndexValues(geometry.indices, vertexCount);
  const badVertex = findNonFiniteVertex(geometry.positions);
  if (badVertex >= 0) throw new RangeError(`simplifyGeometry found a NaN or infinite position at vertex ${badVertex}: pass finite x, y, z for every vertex.`);
}

function validateIndexValues(indices, vertexCount) {
  for (let position = 0; position < indices.length; position++) {
    if (indices[position] >= vertexCount) {
      throw new RangeError(`simplifyGeometry found index ${indices[position]} at indices[${position}] but the geometry has ${vertexCount} vertices: every index must be below the vertex count.`);
    }
  }
}

function validateRatios(ratios) {
  if (!Array.isArray(ratios) || ratios.length < 1) throw new RangeError('ratios needs at least one number between 0 and 1, strictly decreasing, for example [0.25, 0.06].');
  ratios.forEach((ratio, index) => {
    if (typeof ratio !== 'number' || !(ratio > 0) || !(ratio < 1) || (index > 0 && ratio >= ratios[index - 1])) {
      throw new RangeError('ratios must be strictly decreasing numbers above 0 and below 1, for example [0.25, 0.06].');
    }
  });
}

/** Vertices that touch an edge used by other than two triangles: they stay exactly as they are. */
export function findLockedVertices(indices, vertexCount) {
  const edgeCounts = new Map();
  const edgeKey = (first, second) => (first < second ? first * vertexCount + second : second * vertexCount + first);
  for (let corner = 0; corner < indices.length; corner += 3) {
    for (let side = 0; side < 3; side++) {
      const key = edgeKey(indices[corner + side], indices[corner + (side + 1) % 3]);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  const locked = new Uint8Array(vertexCount);
  for (let corner = 0; corner < indices.length; corner += 3) {
    for (let side = 0; side < 3; side++) {
      const first = indices[corner + side];
      const second = indices[corner + (side + 1) % 3];
      if (edgeCounts.get(edgeKey(first, second)) !== 2) {
        locked[first] = 1;
        locked[second] = 1;
      }
    }
  }
  return locked;
}

// A quadric is the symmetric 4x4 matrix of a plane sum, stored as ten numbers: aa ab ac ad bb bc bd cc cd dd.
function addPlane(quadrics, vertex, nx, ny, nz, planeOffset) {
  const base = vertex * 10;
  quadrics[base] += nx * nx;
  quadrics[base + 1] += nx * ny;
  quadrics[base + 2] += nx * nz;
  quadrics[base + 3] += nx * planeOffset;
  quadrics[base + 4] += ny * ny;
  quadrics[base + 5] += ny * nz;
  quadrics[base + 6] += ny * planeOffset;
  quadrics[base + 7] += nz * nz;
  quadrics[base + 8] += nz * planeOffset;
  quadrics[base + 9] += planeOffset * planeOffset;
}

function quadricError(quadrics, first, second, x, y, z) {
  const a = first * 10;
  const b = second * 10;
  const summedQuadricTerm = index => quadrics[a + index] + quadrics[b + index];
  const value = summedQuadricTerm(0) * x * x + 2 * summedQuadricTerm(1) * x * y + 2 * summedQuadricTerm(2) * x * z + 2 * summedQuadricTerm(3) * x
    + summedQuadricTerm(4) * y * y + 2 * summedQuadricTerm(5) * y * z + 2 * summedQuadricTerm(6) * y
    + summedQuadricTerm(7) * z * z + 2 * summedQuadricTerm(8) * z + summedQuadricTerm(9);
  return Math.max(0, value);
}

function buildQuadrics(positions, indices, vertexCount) {
  const quadrics = new Float64Array(vertexCount * 10);
  for (let corner = 0; corner < indices.length; corner += 3) {
    const [first, second, third] = [indices[corner], indices[corner + 1], indices[corner + 2]];
    const ax = positions[second * 3] - positions[first * 3];
    const ay = positions[second * 3 + 1] - positions[first * 3 + 1];
    const az = positions[second * 3 + 2] - positions[first * 3 + 2];
    const bx = positions[third * 3] - positions[first * 3];
    const by = positions[third * 3 + 1] - positions[first * 3 + 1];
    const bz = positions[third * 3 + 2] - positions[first * 3 + 2];
    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;
    const doubleArea = Math.hypot(nx, ny, nz);
    if (doubleArea === 0) continue;
    nx /= doubleArea;
    ny /= doubleArea;
    nz /= doubleArea;
    const planeDistance = -(nx * positions[first * 3] + ny * positions[first * 3 + 1] + nz * positions[first * 3 + 2]);
    for (const vertex of [first, second, third]) addPlane(quadrics, vertex, nx, ny, nz, planeDistance);
  }
  return quadrics;
}

function triangleNormal(positions, first, second, third, replaced, replacement) {
  const point = vertex => (vertex === replaced ? replacement : vertex);
  const [pa, pb, pc] = [point(first) * 3, point(second) * 3, point(third) * 3];
  const ax = positions[pb] - positions[pa];
  const ay = positions[pb + 1] - positions[pa + 1];
  const az = positions[pb + 2] - positions[pa + 2];
  const bx = positions[pc] - positions[pa];
  const by = positions[pc + 1] - positions[pa + 1];
  const bz = positions[pc + 2] - positions[pa + 2];
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** One site per distinct position, numbered in order of first use: the vertices of a seam share a site. */
function weldPositions(positions) {
  const siteOfVertex = new Uint32Array(positions.length / 3);
  const sitePositions = [];
  const siteByPosition = new Map();
  for (let vertex = 0; vertex < siteOfVertex.length; vertex++) {
    const [x, y, z] = [positions[vertex * 3] + 0, positions[vertex * 3 + 1] + 0, positions[vertex * 3 + 2] + 0];
    const key = `${x},${y},${z}`;
    let site = siteByPosition.get(key);
    if (site === undefined) {
      site = siteByPosition.size;
      siteByPosition.set(key, site);
      sitePositions.push(x, y, z);
    }
    siteOfVertex[vertex] = site;
  }
  return { siteOfVertex, sitePositions: Float32Array.from(sitePositions) };
}

function boundsDiagonal(positions) {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], positions[index + axis]);
      high[axis] = Math.max(high[axis], positions[index + axis]);
    }
  }
  return Math.hypot(...high.map((value, axis) => value - low[axis])) || 1;
}

/**
 * Edge collapse over vertices. With `blendSeams` the vertices are welded by position into sites, the topology and the
 * quadrics live on sites, and `corners` keeps which original vertex (with its attributes) each triangle corner uses.
 * Without it every vertex is its own site and `corners` is the triangle list itself.
 */
class Collapser {
  constructor(geometry, { blendSeams = false } = {}) {
    this.geometry = geometry;
    this.blendSeams = blendSeams;
    this.sourceVertexCount = geometry.positions.length / 3;
    const weld = blendSeams ? weldPositions(geometry.positions) : null;
    this.positions = weld ? weld.sitePositions : geometry.positions;
    this.vertexCount = this.positions.length / 3;
    this.triangles = weld ? Uint32Array.from(geometry.indices, vertex => weld.siteOfVertex[vertex]) : Uint32Array.from(geometry.indices);
    this.corners = weld ? Uint32Array.from(geometry.indices) : this.triangles;
    this.attributeScale = boundsDiagonal(geometry.positions);
    this.triangleAlive = new Uint8Array(this.triangles.length / 3).fill(1);
    this.aliveCount = this.triangles.length / 3;
    this.locked = findLockedVertices(this.triangles, this.vertexCount);
    this.quadrics = buildQuadrics(this.positions, this.triangles, this.vertexCount);
    this.versions = new Uint32Array(this.vertexCount);
    this.vertexTriangles = Array.from({ length: this.vertexCount }, () => []);
    for (let triangle = 0; triangle < this.triangleAlive.length; triangle++) {
      for (let side = 0; side < 3; side++) this.vertexTriangles[this.triangles[triangle * 3 + side]].push(triangle);
    }
    this.heap = new MinHeap();
    this.worstError = 0;
    const queuedEdges = new Set();
    for (let triangle = 0; triangle < this.triangleAlive.length; triangle++) {
      for (let side = 0; side < 3; side++) {
        const [first, second] = [this.triangles[triangle * 3 + side], this.triangles[triangle * 3 + (side + 1) % 3]];
        // The welded path queues each edge once: the quadric and attribute costs it computes are what dominate its time.
        const edgeKey = Math.min(first, second) * this.vertexCount + Math.max(first, second);
        if (this.blendSeams && queuedEdges.has(edgeKey)) continue;
        queuedEdges.add(edgeKey);
        this.pushEdge(first, second);
      }
    }
  }

  /** Queue both directions of an edge: the vertex that goes must not be locked. */
  pushEdge(first, second) {
    if (!this.locked[first]) this.pushCollapse(first, second);
    if (!this.locked[second]) this.pushCollapse(second, first);
  }

  pushCollapse(removed, kept) {
    const positions = this.positions;
    const positionCost = quadricError(this.quadrics, removed, kept, positions[kept * 3], positions[kept * 3 + 1], positions[kept * 3 + 2]);
    const cost = this.blendSeams ? positionCost + this.attributePenalty(removed, kept) : positionCost;
    this.heap.push({ cost, positionCost, removed, kept, removedVersion: this.versions[removed], keptVersion: this.versions[kept] });
  }

  /** The distinct vertices (with their attributes) that the alive triangles around a site use, in the order the triangles list them. */
  verticesAround(site) {
    const vertices = [];
    for (const triangle of this.vertexTriangles[site]) {
      for (let side = 0; side < 3; side++) {
        if (this.triangles[triangle * 3 + side] !== site) continue;
        const vertex = this.corners[triangle * 3 + side];
        if (!vertices.includes(vertex)) vertices.push(vertex);
      }
    }
    return vertices;
  }

  /** How far two vertices differ in uv and normal, squared, in position units (the bounds diagonal scales the difference). */
  attributeDistance(first, second) {
    let squared = 0;
    const { uvs, normals } = this.geometry;
    if (uvs) squared += (SEAM_UV_WEIGHT * this.attributeScale) ** 2 * ((uvs[first * 2] - uvs[second * 2]) ** 2 + (uvs[first * 2 + 1] - uvs[second * 2 + 1]) ** 2);
    if (normals) {
      let difference = 0;
      for (let axis = 0; axis < 3; axis++) difference += (normals[first * 3 + axis] - normals[second * 3 + axis]) ** 2;
      squared += (SEAM_NORMAL_WEIGHT * this.attributeScale) ** 2 * difference;
    }
    return squared;
  }

  /** The vertex among `candidates` whose uv and normal are closest to `vertex`; the lowest index wins a tie. */
  closestVertex(vertex, candidates) {
    let best = candidates[0];
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = this.attributeDistance(vertex, candidate);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return { vertex: best, distance: bestDistance };
  }

  /** The squared attribute distance a collapse adds: each copy of the removed site moves to the closest copy of the kept one. */
  attributePenalty(removed, kept) {
    const keptVertices = this.verticesAround(kept);
    let penalty = 0;
    for (const vertex of this.verticesAround(removed)) penalty += this.closestVertex(vertex, keptVertices).distance;
    return penalty;
  }

  /** The collapse keeps the surface a manifold and turns no neighbouring face over. */
  isSafe(removed, kept) {
    const around = this.vertexTriangles[removed];
    const neighbours = new Set();
    let shared = 0;
    for (const triangle of around) {
      const corners = [this.triangles[triangle * 3], this.triangles[triangle * 3 + 1], this.triangles[triangle * 3 + 2]];
      const containsKept = corners.includes(kept);
      if (containsKept) shared++;
      for (const corner of corners) if (corner !== removed && corner !== kept) neighbours.add(corner);
      if (containsKept) continue;
      const before = triangleNormal(this.positions, corners[0], corners[1], corners[2], -1, -1);
      const after = triangleNormal(this.positions, corners[0], corners[1], corners[2], removed, kept);
      const beforeLength = Math.hypot(...before);
      const afterLength = Math.hypot(...after);
      if (afterLength === 0 || beforeLength === 0) return false;
      const agreement = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (beforeLength * afterLength);
      if (agreement < MINIMUM_NORMAL_AGREEMENT) return false;
    }
    if (shared !== 2) return false;
    // The link condition: the two vertices may share only the two apexes of the faces they share.
    let commonNeighbours = 0;
    for (const triangle of this.vertexTriangles[kept]) {
      for (let side = 0; side < 3; side++) {
        const corner = this.triangles[triangle * 3 + side];
        if (neighbours.delete(corner)) commonNeighbours++;
      }
    }
    return commonNeighbours === 2;
  }

  collapse(removed, kept) {
    const keptVertices = this.blendSeams ? this.verticesAround(kept) : null;
    const takenBy = new Map();
    for (const triangle of this.vertexTriangles[removed]) {
      const base = triangle * 3;
      const corners = [this.triangles[base], this.triangles[base + 1], this.triangles[base + 2]];
      if (corners.includes(kept)) {
        this.triangleAlive[triangle] = 0;
        this.aliveCount--;
        for (const corner of corners) {
          if (corner === removed) continue;
          const list = this.vertexTriangles[corner];
          list.splice(list.indexOf(triangle), 1);
        }
      } else {
        for (let side = 0; side < 3; side++) {
          if (this.triangles[base + side] !== removed) continue;
          if (keptVertices) {
            const vertex = this.corners[base + side];
            if (!takenBy.has(vertex)) takenBy.set(vertex, this.closestVertex(vertex, keptVertices).vertex);
            this.corners[base + side] = takenBy.get(vertex);
          }
          this.triangles[base + side] = kept;
        }
        this.vertexTriangles[kept].push(triangle);
      }
    }
    this.vertexTriangles[removed] = [];
    for (let index = 0; index < 10; index++) this.quadrics[kept * 10 + index] += this.quadrics[removed * 10 + index];
    this.versions[removed]++;
    this.versions[kept]++;
    const requeued = new Set();
    for (const triangle of this.vertexTriangles[kept]) {
      for (let side = 0; side < 3; side++) {
        const corner = this.triangles[triangle * 3 + side];
        if (corner === kept || (this.blendSeams && requeued.has(corner))) continue;
        requeued.add(corner);
        this.pushEdge(kept, corner);
      }
    }
  }

  /** Collapse the cheapest edges until `targetTriangles` are left or no safe collapse remains. */
  reduceTo(targetTriangles) {
    while (this.aliveCount > targetTriangles && this.heap.size) {
      const entry = this.heap.pop();
      if (entry.removedVersion !== this.versions[entry.removed] || entry.keptVersion !== this.versions[entry.kept]) continue;
      if (!this.isSafe(entry.removed, entry.kept)) continue;
      this.worstError = Math.max(this.worstError, entry.positionCost);
      this.collapse(entry.removed, entry.kept);
    }
  }

  /** The surviving triangles as new geometry with the vertices that they use, in their old order. */
  snapshot() {
    const remap = new Int32Array(this.sourceVertexCount).fill(-1);
    const used = [];
    const indices = [];
    for (let triangle = 0; triangle < this.triangleAlive.length; triangle++) {
      if (!this.triangleAlive[triangle]) continue;
      for (let side = 0; side < 3; side++) {
        const vertex = this.corners[triangle * 3 + side];
        if (remap[vertex] < 0) {
          remap[vertex] = used.length;
          used.push(vertex);
        }
        indices.push(remap[vertex]);
      }
    }
    const level = { ...this.geometry, positions: new Float32Array(used.length * 3), indices: Uint32Array.from(indices) };
    used.forEach((vertex, slot) => level.positions.set(this.geometry.positions.subarray(vertex * 3, vertex * 3 + 3), slot * 3));
    for (const [field, size] of PER_VERTEX_ATTRIBUTES) {
      const source = this.geometry[field];
      if (!source) continue;
      if (source.length !== this.sourceVertexCount * size) throw new RangeError(`Geometry ${field} must hold ${size} numbers for every vertex.`);
      level[field] = new source.constructor(used.length * size);
      used.forEach((vertex, slot) => level[field].set(source.subarray(vertex * size, (vertex + 1) * size), slot * size));
    }
    return level;
  }
}

function validateBlendSeams(blendSeams) {
  if (!BLEND_SEAMS_MODES.includes(blendSeams)) {
    throw new RangeError(`blendSeams must be one of ${BLEND_SEAMS_MODES.join(', ')}, got ${String(blendSeams)}: pass 'auto' to collapse across seams only for levels the never-blend path misses.`);
  }
}

function runLevels(collapser, ratios, inputTriangles, levelIndexes) {
  const results = new Map();
  const lastIndex = Math.max(...levelIndexes);
  for (let index = 0; index <= lastIndex; index++) {
    const target = Math.max(MINIMUM_TRIANGLES, Math.ceil(inputTriangles * ratios[index]));
    collapser.reduceTo(target);
    if (levelIndexes.includes(index)) {
      results.set(index, { ratio: ratios[index], target, triangles: collapser.aliveCount, error: Math.sqrt(collapser.worstError), geometry: collapser.snapshot() });
    }
  }
  return results;
}

/**
 * Reduce a geometry to each ratio of its triangles. Returns one entry per ratio,
 * `{ ratio, target, triangles, error, path, geometry }`, where `target` is the triangle count asked for, `path` is
 * `'keep'` (every vertex attribute kept as it was, seams never touched) or `'blend'` (collapses across seams, each
 * moved corner taking the attributes of the closest vertex that stays), and `error` is the square root of the largest
 * quadric cost of any collapse so far: the distance, in the geometry's units, that those collapses moved the surface (an
 * estimate that grows from level to level; it leaves out the uv and normal change of a blend level).
 * `blendSeams` picks the path: `'auto'` (default) runs `keep` and redoes a level with `blend` when it keeps more than
 * 1.25 times its target, `'never'` runs only `keep`, `'always'` only `blend`. A level may keep more triangles
 * than asked when the border vertices and the shape leave no safe collapse.
 */
export function simplifyGeometry(geometry, options) {
  const { ratios = [0.25, 0.0625], blendSeams = 'auto' } = options ?? {};
  validateGeometry(geometry);
  validateRatios(ratios);
  validateBlendSeams(blendSeams);
  const inputTriangles = geometry.indices.length / 3;
  const allLevels = ratios.map((ratio, index) => index);
  const keptLevels = blendSeams === 'always' ? new Map() : runLevels(new Collapser(geometry), ratios, inputTriangles, allLevels);
  const missed = allLevels.filter(index => blendSeams === 'always' || (blendSeams === 'auto' && keptLevels.get(index).triangles > keptLevels.get(index).target * SEAM_FALLBACK_OVERSHOOT));
  const blendedLevels = missed.length ? runLevels(new Collapser(geometry, { blendSeams: true }), ratios, inputTriangles, missed) : new Map();
  let largestError = 0;
  return allLevels.map(index => {
    const keepLevel = keptLevels.get(index);
    const blendLevel = blendedLevels.get(index);
    const useBlend = blendLevel && (!keepLevel || blendLevel.triangles < keepLevel.triangles);
    const level = useBlend ? { ...blendLevel, path: 'blend' } : { ...keepLevel, path: 'keep' };
    // Levels may come from two collapsers, but the error a renderer reads must never fall from one level to the next.
    largestError = Math.max(largestError, level.error);
    return { ...level, error: largestError };
  });
}
