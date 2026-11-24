import { forEachChunk } from './cooperative.js';

// Open-addressing tables sized to twice their entry count (a power of two): memory is about 48 bytes per checked triangle at most.
function tableSizeFor(entryCount) {
  let size = 16;
  while (size < entryCount * 2) size *= 2;
  return size;
}

function hashWords(first, second, third) {
  let hash = Math.imul(first, 0x9e3779b1) ^ Math.imul(second, 0x85ebca77) ^ Math.imul(third, 0xc2b2ae3d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 13;
  return hash >>> 0;
}

/**
 * For every vertex, the lowest-numbered vertex that sits at exactly the same position. Nothing is merged or rewritten: the ids only
 * let the checks see a mesh whose seams repeat their vertices (one per UV island or normal) as the closed surface it is.
 */
export async function weldedVertexIds(positions, checkpoint) {
  const vertexCount = positions.length / 3;
  const size = tableSizeFor(vertexCount);
  const mask = size - 1;
  const table = new Int32Array(size).fill(-1);
  const ids = new Uint32Array(vertexCount);
  const scratch = new Float32Array(3);
  const scratchBits = new Uint32Array(scratch.buffer);
  await forEachChunk(vertexCount, checkpoint, (from, to) => {
    for (let vertex = from; vertex < to; vertex++) {
      const offset = vertex * 3;
      // Adding 0 turns -0 into 0, so both hash alike.
      scratch[0] = positions[offset] + 0;
      scratch[1] = positions[offset + 1] + 0;
      scratch[2] = positions[offset + 2] + 0;
      let slot = hashWords(scratchBits[0], scratchBits[1], scratchBits[2]) & mask;
      for (;;) {
        const holder = table[slot];
        if (holder < 0) {
          table[slot] = vertex;
          ids[vertex] = vertex;
          break;
        }
        const holderOffset = holder * 3;
        if (positions[holderOffset] === positions[offset] && positions[holderOffset + 1] === positions[offset + 1] && positions[holderOffset + 2] === positions[offset + 2]) {
          ids[vertex] = holder;
          break;
        }
        slot = (slot + 1) & mask;
      }
    }
  });
  return ids;
}

/** How many triangles repeat an earlier triangle's three corner positions in the same winding; a back face with the opposite winding is not one. */
async function countDuplicateTriangles(indices, ids, checkpoint) {
  const triangleCount = indices.length / 3;
  const size = tableSizeFor(triangleCount);
  const mask = size - 1;
  // Each entry stores its three corner ids, turned to start at the lowest, plus one, so zero marks an empty slot.
  const table = new Uint32Array(size * 3);
  let duplicates = 0;
  await forEachChunk(triangleCount, checkpoint, (from, to) => {
    for (let triangle = from; triangle < to; triangle++) {
      const firstCorner = ids[indices[triangle * 3]];
      const secondCorner = ids[indices[triangle * 3 + 1]];
      const thirdCorner = ids[indices[triangle * 3 + 2]];
      const lowest = Math.min(firstCorner, secondCorner, thirdCorner);
      const turned = firstCorner === lowest ? [firstCorner, secondCorner, thirdCorner] : secondCorner === lowest ? [secondCorner, thirdCorner, firstCorner] : [thirdCorner, firstCorner, secondCorner];
      const first = turned[0] + 1;
      const second = turned[1] + 1;
      const third = turned[2] + 1;
      let slot = hashWords(first, second, third) & mask;
      for (;;) {
        const entry = slot * 3;
        if (table[entry] === 0) {
          table[entry] = first;
          table[entry + 1] = second;
          table[entry + 2] = third;
          break;
        }
        if (table[entry] === first && table[entry + 1] === second && table[entry + 2] === third) {
          duplicates++;
          break;
        }
        slot = (slot + 1) & mask;
      }
    }
  });
  return duplicates;
}

/** How many distinct edges (a pair of corner positions) are shared by more than two triangles. */
async function countNonManifoldEdges(indices, ids, checkpoint) {
  const triangleCount = indices.length / 3;
  const size = tableSizeFor(triangleCount * 3);
  const mask = size - 1;
  const lowEnds = new Uint32Array(size);
  const highEnds = new Uint32Array(size);
  const uses = new Uint32Array(size);
  let nonManifold = 0;
  function useEdge(first, second) {
    if (first === second) return;
    const low = Math.min(first, second) + 1;
    const high = Math.max(first, second) + 1;
    let slot = hashWords(low, high, 0) & mask;
    for (;;) {
      if (lowEnds[slot] === 0) {
        lowEnds[slot] = low;
        highEnds[slot] = high;
        uses[slot] = 1;
        return;
      }
      if (lowEnds[slot] === low && highEnds[slot] === high) {
        uses[slot]++;
        if (uses[slot] === 3) nonManifold++;
        return;
      }
      slot = (slot + 1) & mask;
    }
  }
  await forEachChunk(triangleCount, checkpoint, (from, to) => {
    for (let triangle = from; triangle < to; triangle++) {
      const first = ids[indices[triangle * 3]];
      const second = ids[indices[triangle * 3 + 1]];
      const third = ids[indices[triangle * 3 + 2]];
      useEdge(first, second);
      useEdge(second, third);
      useEdge(third, first);
    }
  });
  return nonManifold;
}

/**
 * Counts the triangles that repeat another triangle and the edges that more than two triangles share, both judged by position so a
 * seam that repeats its vertices does not hide them. Returns null without reading anything when the mesh has more triangles than
 * maxTriangles, so a hostile file cannot make the check allocate without bound.
 */
export async function countMeshFindings(positions, indices, maxTriangles, checkpoint) {
  const triangleCount = indices.length / 3;
  if (triangleCount > maxTriangles) return null;
  const ids = await weldedVertexIds(positions, checkpoint);
  const duplicateTriangles = await countDuplicateTriangles(indices, ids, checkpoint);
  const nonManifoldEdges = await countNonManifoldEdges(indices, ids, checkpoint);
  return { duplicateTriangles, nonManifoldEdges };
}

/** The sentence a load warning carries for the findings, or undefined when there are none. */
export function describeMeshFindings({ duplicateTriangles, nonManifoldEdges }) {
  const parts = [];
  if (duplicateTriangles) parts.push(`${duplicateTriangles} duplicate triangle(s) (same corner positions and winding as an earlier one)`);
  if (nonManifoldEdges) parts.push(`${nonManifoldEdges} non-manifold edge(s) (shared by more than two triangles)`);
  return parts.length ? parts.join(' and ') : undefined;
}

/** Runs the caller's glTF-Validator on the bytes and throws, naming the first errors, when it reports any. */
export async function assertValidatorPasses(validator, bytes, fetchResource) {
  if (!validator || typeof validator.validateBytes !== 'function') {
    throw new TypeError('strict needs the glTF-Validator: pass options.validator = await import(\'gltf-validator\') (the npm package gltf-validator, which Crucible does not bundle), or drop strict.');
  }
  const report = await validator.validateBytes(bytes, {
    maxIssues: 20,
    externalResourceFunction: fetchResource,
  });
  const errorCount = report?.issues?.numErrors ?? 0;
  if (errorCount > 0) {
    const shown = (report.issues.messages ?? []).filter(message => message.severity === 0).slice(0, 5).map(message => `${message.code} at ${message.pointer}`);
    throw new Error(`glTF-Validator reported ${errorCount} error(s)${shown.length ? `: ${shown.join('; ')}` : ''}. Fix the file, or load it without strict.`);
  }
}
