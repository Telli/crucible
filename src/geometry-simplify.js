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
/**
 * The steppable functions below are generators that yield after about this much work (a triangle, a corner or a
 * collapse each), so a caller can run them in slices and stay responsive. The slicing only decides where a pause may
 * fall: the work in between is the same, so the result is the same bytes however it is cut.
 */
export const SIMPLIFY_STEP_WORK = 256;

/** Runs a steppable generator without pausing and returns its result. */
export function finishSteps(steps) {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
/** A level counts as missed when it keeps more than this many times its target triangles (#2985). */
export const SEAM_FALLBACK_OVERSHOOT = 1.25;
/** The `blendSeams` choices of simplifyGeometry. */
/** Under `blendSeams: 'auto'`, a geometry where this share of the vertices repeats the position of another (a seam copy) skips the never-blend pass, which would stall on it. */
export const SEAM_HEAVY_SHARE = 0.3;
export const BLEND_SEAMS_MODES = Object.freeze(['auto', 'never', 'always']);
/** How much a uv or normal difference counts against a collapse across a seam, as a share of the bounds diagonal per unit of difference. */
const SEAM_UV_WEIGHT = 0.1;
const SEAM_NORMAL_WEIGHT = 0.005;
/** The most triangles and vertices one geometry may have: the edge map and the heap grow with them. */
export const MAXIMUM_SIMPLIFY_TRIANGLES = 2000000;
export const MAXIMUM_SIMPLIFY_VERTICES = 2000000;

/**
 * The collapse candidates, cheapest first, in typed arrays and no object per candidate. A binary heap orders (cost,
 * candidate id) pairs, so a sift moves two numbers; the rest of a candidate (the part of the cost that is surface
 * distance, the two sites and their versions) sits in a pool slot that stays put until the
 * candidate is popped. After `pop` the cheapest candidate is in the `popped*` fields.
 */
class CollapseQueue {
  constructor(capacity = 1024) {
    this.size = 0;
    this.poolUsed = 0;
    this.freeCount = 0;
    this.capacity = 0;
    this.allocate(capacity);
    this.poppedCost = 0;
    this.poppedPositionCost = 0;
    this.poppedRemoved = 0;
    this.poppedKept = 0;
    this.poppedRemovedVersion = 0;
    this.poppedKeptVersion = 0;
  }

  allocate(capacity) {
    const grown = {
      heapCosts: new Float64Array(capacity),
      heapIds: new Uint32Array(capacity),
      freeIds: new Uint32Array(capacity),
      positionCosts: new Float64Array(capacity),
      removed: new Uint32Array(capacity),
      kept: new Uint32Array(capacity),
      removedVersions: new Uint32Array(capacity),
      keptVersions: new Uint32Array(capacity),
    };
    for (const [name, array] of Object.entries(grown)) {
      if (this[name]) array.set(this[name]);
      this[name] = array;
    }
    this.capacity = capacity;
  }

  push(cost, positionCost, removed, kept, removedVersion, keptVersion) {
    if (this.size === this.capacity) this.allocate(this.capacity * 2);
    const id = this.freeCount ? this.freeIds[--this.freeCount] : this.poolUsed++;
    this.positionCosts[id] = positionCost;
    this.removed[id] = removed;
    this.kept[id] = kept;
    this.removedVersions[id] = removedVersion;
    this.keptVersions[id] = keptVersion;
    const { heapCosts, heapIds } = this;
    let index = this.size++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heapCosts[parent] <= cost) break;
      heapCosts[index] = heapCosts[parent];
      heapIds[index] = heapIds[parent];
      index = parent;
    }
    heapCosts[index] = cost;
    heapIds[index] = id;
  }

  pop() {
    const { heapCosts, heapIds } = this;
    const id = heapIds[0];
    this.poppedCost = heapCosts[0];
    this.poppedPositionCost = this.positionCosts[id];
    this.poppedRemoved = this.removed[id];
    this.poppedKept = this.kept[id];
    this.poppedRemovedVersion = this.removedVersions[id];
    this.poppedKeptVersion = this.keptVersions[id];
    this.freeIds[this.freeCount++] = id;
    const last = --this.size;
    if (last === 0) return;
    const cost = heapCosts[last];
    const lastId = heapIds[last];
    let index = 0;
    for (;;) {
      let child = index * 2 + 1;
      if (child >= last) break;
      if (child + 1 < last && heapCosts[child + 1] < heapCosts[child]) child++;
      if (heapCosts[child] >= cost) break;
      heapCosts[index] = heapCosts[child];
      heapIds[index] = heapIds[child];
      index = child;
    }
    heapCosts[index] = cost;
    heapIds[index] = lastId;
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

/**
 * Counts how many triangles use each undirected edge, in an open-addressing table of typed arrays. `slotOf(first, second)`
 * finds (or, with `create`, adds) the slot of an edge; `counts[slot]` is its triangle count.
 */
function createEdgeCounter(indexCount) {
  let size = 16;
  while (size < indexCount * 2) size *= 2;
  const firsts = new Uint32Array(size);
  const seconds = new Uint32Array(size);
  const counts = new Uint8Array(size);
  const slotOf = (first, second) => {
    const [low, high] = first < second ? [first, second] : [second, first];
    let slot = (Math.imul(low, 73856093) ^ Math.imul(high, 19349663)) >>> 0 & (size - 1);
    while (counts[slot] !== 0 && (firsts[slot] !== low || seconds[slot] !== high)) slot = (slot + 1) & (size - 1);
    firsts[slot] = low;
    seconds[slot] = high;
    return slot;
  };
  return { counts, slotOf };
}

/** Vertices that touch an edge used by other than two triangles: they stay exactly as they are. */
export function findLockedVertices(indices, vertexCount) {
  return finishSteps(findLockedVerticesSteps(indices, vertexCount));
}

function* findLockedVerticesSteps(indices, vertexCount) {
  const { counts, slotOf } = createEdgeCounter(indices.length);
  for (let corner = 0; corner < indices.length; corner += 3) {
    if (corner % (3 * SIMPLIFY_STEP_WORK) === 0) yield;
    for (let side = 0; side < 3; side++) {
      const slot = slotOf(indices[corner + side], indices[corner + (side + 1) % 3]);
      if (counts[slot] < 255) counts[slot]++;
    }
  }
  const locked = new Uint8Array(vertexCount);
  for (let corner = 0; corner < indices.length; corner += 3) {
    if (corner % (3 * SIMPLIFY_STEP_WORK) === 0) yield;
    for (let side = 0; side < 3; side++) {
      const first = indices[corner + side];
      const second = indices[corner + (side + 1) % 3];
      if (counts[slotOf(first, second)] !== 2) {
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

function* buildQuadricsSteps(positions, indices, vertexCount) {
  const quadrics = new Float64Array(vertexCount * 10);
  for (let corner = 0; corner < indices.length; corner += 3) {
    if (corner % (3 * SIMPLIFY_STEP_WORK) === 0) yield;
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

/** One site per distinct position (by bit pattern, so -0 and 0 are one), numbered in order of first use: the vertices of a seam share a site. */
function weldPositions(positions) {
  const vertexCount = positions.length / 3;
  const bits = Uint32Array.from(new Uint32Array(positions.buffer, positions.byteOffset, positions.length));
  for (let index = 0; index < positions.length; index++) if (positions[index] === 0) bits[index] = 0;
  let tableSize = 16;
  while (tableSize < vertexCount * 2) tableSize *= 2;
  const table = new Int32Array(tableSize).fill(-1);
  const siteOfVertex = new Uint32Array(vertexCount);
  const firstVertexOfSite = [];
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const [x, y, z] = [bits[vertex * 3], bits[vertex * 3 + 1], bits[vertex * 3 + 2]];
    let slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) >>> 0 & (tableSize - 1);
    for (;;) {
      const site = table[slot];
      if (site < 0) {
        table[slot] = firstVertexOfSite.length;
        siteOfVertex[vertex] = firstVertexOfSite.length;
        firstVertexOfSite.push(vertex);
        break;
      }
      const other = firstVertexOfSite[site];
      if (bits[other * 3] === x && bits[other * 3 + 1] === y && bits[other * 3 + 2] === z) {
        siteOfVertex[vertex] = site;
        break;
      }
      slot = (slot + 1) & (tableSize - 1);
    }
  }
  const sitePositions = new Float32Array(firstVertexOfSite.length * 3);
  firstVertexOfSite.forEach((vertex, site) => {
    for (let axis = 0; axis < 3; axis++) sitePositions[site * 3 + axis] = positions[vertex * 3 + axis] + 0;
  });
  return { siteOfVertex, sitePositions };
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
  constructor(geometry, { blendSeams = false, weld: knownWeld = null } = {}) {
    this.geometry = geometry;
    this.blendSeams = blendSeams;
    this.sourceVertexCount = geometry.positions.length / 3;
    const weld = blendSeams ? knownWeld ?? weldPositions(geometry.positions) : null;
    this.positions = weld ? weld.sitePositions : geometry.positions;
    this.vertexCount = this.positions.length / 3;
    this.triangles = weld ? Uint32Array.from(geometry.indices, vertex => weld.siteOfVertex[vertex]) : Uint32Array.from(geometry.indices);
    this.corners = weld ? Uint32Array.from(geometry.indices) : this.triangles;
    const attributeScale = boundsDiagonal(geometry.positions);
    this.uvWeightSquared = (SEAM_UV_WEIGHT * attributeScale) ** 2;
    this.normalWeightSquared = (SEAM_NORMAL_WEIGHT * attributeScale) ** 2;
    this.stamps = new Uint32Array(this.vertexCount);
    this.stampCounter = 0;
    this.keptBuffer = new Uint32Array(64);
    this.removedBuffer = new Uint32Array(64);
    this.movedFrom = new Uint32Array(64);
    this.movedTo = new Uint32Array(64);
    this.closestVertex = 0;
    this.triangleAlive = new Uint8Array(this.triangles.length / 3).fill(1);
    this.aliveCount = this.triangles.length / 3;
    this.versions = new Uint32Array(this.vertexCount);
    this.queue = new CollapseQueue();
    this.worstError = 0;
  }

  /** The work the constructor leaves for steps: locked vertices, quadrics, the triangles around each vertex and the first queue. */
  *prepare() {
    this.locked = yield* findLockedVerticesSteps(this.triangles, this.vertexCount);
    this.quadrics = yield* buildQuadricsSteps(this.positions, this.triangles, this.vertexCount);
    this.vertexTriangles = Array.from({ length: this.vertexCount }, () => []);
    for (let triangle = 0; triangle < this.triangleAlive.length; triangle++) {
      if (triangle % SIMPLIFY_STEP_WORK === 0) yield;
      for (let side = 0; side < 3; side++) this.vertexTriangles[this.triangles[triangle * 3 + side]].push(triangle);
    }
    for (let triangle = 0; triangle < this.triangleAlive.length; triangle++) {
      if (triangle % SIMPLIFY_STEP_WORK === 0) yield;
      for (let side = 0; side < 3; side++) {
        const [first, second] = [this.triangles[triangle * 3 + side], this.triangles[triangle * 3 + (side + 1) % 3]];
        // The welded path queues each edge once: the quadric and attribute costs it computes are what dominate its time.
        if (this.blendSeams && first > second && this.hasDirectedEdge(second, first)) continue;
        this.pushEdge(first, second);
      }
    }
    return this;
  }

  /** Whether an alive triangle around `from` runs from `from` to `to` (the partner of a shared edge runs the other way). */
  hasDirectedEdge(from, to) {
    for (const triangle of this.vertexTriangles[from]) {
      const base = triangle * 3;
      for (let side = 0; side < 3; side++) {
        if (this.triangles[base + side] === from && this.triangles[base + (side + 1) % 3] === to) return true;
      }
    }
    return false;
  }

  /** Queue both directions of an edge: the vertex that goes must not be locked. */
  pushEdge(first, second) {
    if (this.blendSeams && !this.locked[first] && !this.locked[second]) {
      this.pushCheaperDirection(first, second);
      return;
    }
    if (!this.locked[first]) this.pushCollapse(first, second);
    if (!this.locked[second]) this.pushCollapse(second, first);
  }

  /** The welded path queues one direction per edge, the one that moves the surface less: half the entries to order and half the attribute costs to work out. */
  pushCheaperDirection(first, second) {
    const forward = this.surfaceCost(first, second);
    const backward = this.surfaceCost(second, first);
    if (forward <= backward) this.pushCollapse(first, second, forward);
    else this.pushCollapse(second, first, backward);
  }

  surfaceCost(removed, kept) {
    const positions = this.positions;
    return quadricError(this.quadrics, removed, kept, positions[kept * 3], positions[kept * 3 + 1], positions[kept * 3 + 2]);
  }

  pushCollapse(removed, kept, knownSurfaceCost) {
    const positionCost = knownSurfaceCost ?? this.surfaceCost(removed, kept);
    const cost = this.blendSeams ? positionCost + this.attributePenalty(removed, kept) : positionCost;
    this.queue.push(cost, positionCost, removed, kept, this.versions[removed], this.versions[kept]);
  }

  /**
   * Writes the distinct vertices (with their attributes) that the alive triangles around a site use into `buffer`, in the
   * order the triangles list them, and returns how many. The buffers are reused, so no array is made per call.
   */
  collectVertices(site, buffer) {
    let count = 0;
    const triangles = this.vertexTriangles[site];
    for (let listed = 0; listed < triangles.length; listed++) {
      const base = triangles[listed] * 3;
      for (let side = 0; side < 3; side++) {
        if (this.triangles[base + side] !== site) continue;
        const vertex = this.corners[base + side];
        let known = false;
        for (let seen = 0; seen < count; seen++) {
          if (buffer[seen] === vertex) {
            known = true;
            break;
          }
        }
        if (known) continue;
        if (count === buffer.length) buffer = this.growBuffer(buffer);
        buffer[count++] = vertex;
      }
    }
    return count;
  }

  growMoved() {
    for (const field of ['movedFrom', 'movedTo']) {
      const grown = new Uint32Array(this[field].length * 2);
      grown.set(this[field]);
      this[field] = grown;
    }
  }

  growBuffer(buffer) {
    const grown = new Uint32Array(buffer.length * 2);
    grown.set(buffer);
    if (buffer === this.keptBuffer) this.keptBuffer = grown;
    else this.removedBuffer = grown;
    return grown;
  }

  /** How far two vertices differ in uv and normal, squared, in position units (the bounds diagonal scales the difference). */
  attributeDistance(first, second) {
    let squared = 0;
    const uvs = this.geometry.uvs;
    if (uvs) {
      const [du, dv] = [uvs[first * 2] - uvs[second * 2], uvs[first * 2 + 1] - uvs[second * 2 + 1]];
      squared += this.uvWeightSquared * (du * du + dv * dv);
    }
    const normals = this.geometry.normals;
    if (normals) {
      const [dx, dy, dz] = [normals[first * 3] - normals[second * 3], normals[first * 3 + 1] - normals[second * 3 + 1], normals[first * 3 + 2] - normals[second * 3 + 2]];
      squared += this.normalWeightSquared * (dx * dx + dy * dy + dz * dz);
    }
    return squared;
  }

  /** The smallest attribute distance from `vertex` to the first `count` vertices of the kept buffer; `closestVertex` holds which one (the first wins a tie). */
  closestDistance(vertex, count) {
    let bestDistance = Infinity;
    for (let candidate = 0; candidate < count; candidate++) {
      const distance = this.attributeDistance(vertex, this.keptBuffer[candidate]);
      if (distance < bestDistance) {
        this.closestVertex = this.keptBuffer[candidate];
        bestDistance = distance;
      }
    }
    return bestDistance;
  }

  /** The squared attribute distance a collapse adds: each copy of the removed site moves to the closest copy of the kept one. */
  attributePenalty(removed, kept) {
    const keptCount = this.collectVertices(kept, this.keptBuffer);
    const removedCount = this.collectVertices(removed, this.removedBuffer);
    let penalty = 0;
    for (let copy = 0; copy < removedCount; copy++) penalty += this.closestDistance(this.removedBuffer[copy], keptCount);
    return penalty;
  }

  /** The collapse keeps the surface a manifold and turns no neighbouring face over. */
  isSafe(removed, kept) {
    const { positions, triangles } = this;
    const stamp = this.nextStamp();
    let shared = 0;
    for (const triangle of this.vertexTriangles[removed]) {
      const base = triangle * 3;
      const [first, second, third] = [triangles[base], triangles[base + 1], triangles[base + 2]];
      const containsKept = first === kept || second === kept || third === kept;
      if (containsKept) shared++;
      for (let side = 0; side < 3; side++) {
        const corner = triangles[base + side];
        if (corner !== removed && corner !== kept) this.stamps[corner] = stamp;
      }
      if (containsKept) continue;
      const before = triangleNormal(positions, first, second, third, -1, -1);
      const after = triangleNormal(positions, first, second, third, removed, kept);
      const beforeLength = Math.hypot(before[0], before[1], before[2]);
      const afterLength = Math.hypot(after[0], after[1], after[2]);
      if (afterLength === 0 || beforeLength === 0) return false;
      const agreement = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (beforeLength * afterLength);
      if (agreement < MINIMUM_NORMAL_AGREEMENT) return false;
    }
    if (shared !== 2) return false;
    // The link condition: the two vertices may share only the two apexes of the faces they share.
    let commonNeighbours = 0;
    for (const triangle of this.vertexTriangles[kept]) {
      for (let side = 0; side < 3; side++) {
        const corner = triangles[triangle * 3 + side];
        if (this.stamps[corner] === stamp) {
          this.stamps[corner] = 0;
          commonNeighbours++;
        }
      }
    }
    return commonNeighbours === 2;
  }

  /** A fresh mark for `stamps`: a vertex is in the current set when its stamp equals it. */
  nextStamp() {
    this.stampCounter++;
    return this.stampCounter;
  }

  collapse(removed, kept) {
    const keptCount = this.blendSeams ? this.collectVertices(kept, this.keptBuffer) : 0;
    let movedCount = 0;
    const removedTriangles = this.vertexTriangles[removed];
    for (let listed = 0; listed < removedTriangles.length; listed++) {
      const triangle = removedTriangles[listed];
      const base = triangle * 3;
      const [first, second, third] = [this.triangles[base], this.triangles[base + 1], this.triangles[base + 2]];
      if (first === kept || second === kept || third === kept) {
        this.triangleAlive[triangle] = 0;
        this.aliveCount--;
        for (const corner of [first, second, third]) {
          if (corner === removed) continue;
          const list = this.vertexTriangles[corner];
          list.splice(list.indexOf(triangle), 1);
        }
      } else {
        for (let side = 0; side < 3; side++) {
          if (this.triangles[base + side] !== removed) continue;
          if (this.blendSeams) {
            const vertex = this.corners[base + side];
            let moved = 0;
            while (moved < movedCount && this.movedFrom[moved] !== vertex) moved++;
            if (moved === movedCount) {
              this.closestDistance(vertex, keptCount);
              if (movedCount === this.movedFrom.length) this.growMoved();
              this.movedFrom[movedCount] = vertex;
              this.movedTo[movedCount++] = this.closestVertex;
            }
            this.corners[base + side] = this.movedTo[moved];
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
    const requeued = this.nextStamp();
    for (const triangle of this.vertexTriangles[kept]) {
      for (let side = 0; side < 3; side++) {
        const corner = this.triangles[triangle * 3 + side];
        if (corner === kept || (this.blendSeams && this.stamps[corner] === requeued)) continue;
        this.stamps[corner] = requeued;
        this.pushEdge(kept, corner);
      }
    }
  }

  /** Collapse the cheapest edges until `targetTriangles` are left or no safe collapse remains. */
  *reduceTo(targetTriangles) {
    const queue = this.queue;
    let popped = 0;
    while (this.aliveCount > targetTriangles && queue.size) {
      if (++popped % SIMPLIFY_STEP_WORK === 0) yield;
      queue.pop();
      const { poppedRemoved: removed, poppedKept: kept } = queue;
      if (queue.poppedRemovedVersion !== this.versions[removed] || queue.poppedKeptVersion !== this.versions[kept]) continue;
      if (!this.isSafe(removed, kept)) continue;
      this.worstError = Math.max(this.worstError, queue.poppedPositionCost);
      this.collapse(removed, kept);
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

function* runLevels(collapser, ratios, inputTriangles, levelIndexes) {
  const results = new Map();
  const lastIndex = Math.max(...levelIndexes);
  for (let index = 0; index <= lastIndex; index++) {
    const target = Math.max(MINIMUM_TRIANGLES, Math.ceil(inputTriangles * ratios[index]));
    yield* collapser.reduceTo(target);
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
  return finishSteps(simplifyGeometrySteps(geometry, options));
}

/**
 * `simplifyGeometry` as a generator that yields every `SIMPLIFY_STEP_WORK` units of work and returns the levels, so a
 * viewer can run it in slices of a few milliseconds between frames (#2985). Same arguments, same bytes: errors in the
 * arguments throw on the first `next()`.
 */
export function* simplifyGeometrySteps(geometry, options) {
  const { ratios = [0.25, 0.0625], blendSeams = 'auto' } = options ?? {};
  validateGeometry(geometry);
  validateRatios(ratios);
  validateBlendSeams(blendSeams);
  const inputTriangles = geometry.indices.length / 3;
  const allLevels = ratios.map((ratio, index) => index);
  const welded = blendSeams === 'auto' ? weldPositions(geometry.positions) : null;
  const seamHeavy = welded !== null && welded.sitePositions.length / 3 < geometry.positions.length / 3 * (1 - SEAM_HEAVY_SHARE);
  const keptLevels = blendSeams === 'always' || seamHeavy ? new Map() : yield* runLevels(yield* new Collapser(geometry).prepare(), ratios, inputTriangles, allLevels);
  const missed = allLevels.filter(index => blendSeams === 'always' || seamHeavy || (blendSeams === 'auto' && keptLevels.get(index).triangles > keptLevels.get(index).target * SEAM_FALLBACK_OVERSHOOT));
  const blendedLevels = missed.length ? yield* runLevels(yield* new Collapser(geometry, { blendSeams: true, weld: welded }).prepare(), ratios, inputTriangles, missed) : new Map();
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
