// Edge collapse across UV seams for a scan whose atlas is cut into many islands (#2985).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sphere } from '../src/geometry.js';
import { simplifyGeometry, CollapseQueue, findLockedVertices, SEAM_FALLBACK_OVERSHOOT } from '../src/geometry-simplify.js';
import { generateGeometryLods, generateAssetLods } from '../src/mesh-lod.js';

const TRIANGLES_PER_ISLAND = 24;
const RATIOS = [0.5, 0.25, 0.1];

// A sphere whose triangles are cut into small islands: every island has its own copy of each vertex and its own
// planar uv patch, so nearly every vertex sits on a seam, like the atlas of a photogrammetry scan.
function seamHeavySphere() {
  const source = sphere(48, 32);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const copyOfVertexInIsland = new Map();
  for (let corner = 0; corner < source.indices.length; corner++) {
    const island = Math.floor(corner / 3 / TRIANGLES_PER_ISLAND);
    const vertex = source.indices[corner];
    const key = `${island}:${vertex}`;
    if (!copyOfVertexInIsland.has(key)) {
      copyOfVertexInIsland.set(key, positions.length / 3);
      positions.push(...source.positions.subarray(vertex * 3, vertex * 3 + 3));
      normals.push(...source.normals.subarray(vertex * 3, vertex * 3 + 3));
      uvs.push((island % 40) / 40 + source.positions[vertex * 3] * 0.01, Math.floor(island / 40) / 40 + source.positions[vertex * 3 + 1] * 0.01);
    }
    indices.push(copyOfVertexInIsland.get(key));
  }
  return { positions: Float32Array.from(positions), normals: Float32Array.from(normals), uvs: Float32Array.from(uvs), indices: Uint32Array.from(indices) };
}

function attributeKeys(geometry, vertexCount) {
  const keys = new Set();
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    keys.add([...geometry.positions.subarray(vertex * 3, vertex * 3 + 3), ...geometry.normals.subarray(vertex * 3, vertex * 3 + 3), ...geometry.uvs.subarray(vertex * 2, vertex * 2 + 2)].join(','));
  }
  return keys;
}

test('the never-blend path stalls on the seam-heavy fixture, which is what makes it seam-heavy', () => {
  const geometry = seamHeavySphere();
  const inputTriangles = geometry.indices.length / 3;
  const [firstLevel] = simplifyGeometry(geometry, { ratios: [0.5], blendSeams: 'never' });
  assert.equal(firstLevel.path, 'keep');
  assert.ok(firstLevel.triangles > inputTriangles * 0.9, `expected the never-blend level to keep over 90% of ${inputTriangles} triangles, got ${firstLevel.triangles}`);
});

test('every level of a seam-heavy geometry reaches its target within 25% and says it ran the blend path', () => {
  const geometry = seamHeavySphere();
  const levels = simplifyGeometry(geometry, { ratios: RATIOS });
  levels.forEach(level => {
    assert.equal(level.path, 'blend');
    assert.equal(level.target, Math.ceil(geometry.indices.length / 3 * level.ratio));
    assert.ok(level.triangles <= level.target * SEAM_FALLBACK_OVERSHOOT, `ratio ${level.ratio}: ${level.triangles} triangles for a target of ${level.target}`);
    assert.ok(level.triangles >= level.target * 0.75);
    assert.equal(level.geometry.indices.length / 3, level.triangles);
  });
});

test('blended levels are deterministic, copy attributes from the input and keep a growing finite error', () => {
  const geometry = seamHeavySphere();
  const first = simplifyGeometry(geometry, { ratios: RATIOS });
  const second = simplifyGeometry(geometry, { ratios: RATIOS });
  const inputKeys = attributeKeys(geometry, geometry.positions.length / 3);
  first.forEach((level, index) => {
    for (const field of ['positions', 'normals', 'uvs', 'indices']) assert.deepEqual(level.geometry[field], second[index].geometry[field], `${field} differs between runs`);
    assert.equal(level.error, second[index].error);
    const vertexCount = level.geometry.positions.length / 3;
    for (const key of attributeKeys(level.geometry, vertexCount)) assert.ok(inputKeys.has(key), 'a level vertex must be a vertex of the input, never a blend');
    for (const index of level.geometry.indices) assert.ok(index < vertexCount);
    if (index > 0) assert.ok(level.error >= first[index - 1].error);
  });
  assert.ok(first[2].error > 0 && Number.isFinite(first[2].error));
});

test('a geometry the never-blend path already reduces keeps that path under auto, and always forces the blend path', () => {
  const smooth = sphere(48, 32);
  assert.equal(simplifyGeometry(smooth, { ratios: [0.5] })[0].path, 'keep');
  assert.equal(simplifyGeometry(smooth, { ratios: [0.5], blendSeams: 'always' })[0].path, 'blend');
});

test('an open border stays locked on the blend path', () => {
  const geometry = seamHeavySphere();
  const open = { ...geometry, indices: geometry.indices.slice(0, geometry.indices.length - 3 * 200) };
  const [level] = simplifyGeometry(open, { ratios: [0.5], blendSeams: 'always' });
  const siteByPosition = new Map();
  const siteOfVertex = Uint32Array.from({ length: open.positions.length / 3 }, (unused, vertex) => {
    const key = open.positions.subarray(vertex * 3, vertex * 3 + 3).join(',');
    if (!siteByPosition.has(key)) siteByPosition.set(key, siteByPosition.size);
    return siteByPosition.get(key);
  });
  const locked = findLockedVertices(open.indices.map(vertex => siteOfVertex[vertex]), siteByPosition.size);
  const borderPositions = new Set([...siteByPosition].filter(([, site]) => locked[site]).map(([key]) => key));
  assert.ok(borderPositions.size > 0);
  const survivingPositions = new Set();
  for (let vertex = 0; vertex < level.geometry.positions.length / 3; vertex++) survivingPositions.add(level.geometry.positions.subarray(vertex * 3, vertex * 3 + 3).join(','));
  for (const position of borderPositions) assert.ok(survivingPositions.has(position), `border position ${position} was moved or dropped`);
  assert.ok(level.triangles < open.indices.length / 3);
});

test('generateGeometryLods reports the target and the simplifier of every level, and generateAssetLods the paths', () => {
  const geometry = seamHeavySphere();
  const levels = generateGeometryLods(geometry, { ratios: RATIOS });
  assert.deepEqual(levels.map(level => level.path), ['input', 'blend', 'blend', 'blend']);
  levels.slice(1).forEach(level => assert.ok(level.triangles <= level.targetTriangles * SEAM_FALLBACK_OVERSHOOT));
  const never = generateGeometryLods(geometry, { ratios: [0.5], blendSeams: 'never' });
  assert.equal(never[1].path, 'keep');
  const assetLevels = generateAssetLods({ parts: [{ name: 'scan', geometry }] }, { ratios: RATIOS });
  assert.deepEqual(assetLevels.map(level => level.paths), [['input'], ['blend'], ['blend'], ['blend']]);
});

test('simplifyGeometry names the blendSeams choices when given another value', () => {
  assert.throws(() => simplifyGeometry(seamHeavySphere(), { ratios: [0.5], blendSeams: 'yes' }), /blendSeams must be one of auto, never, always/);
});

test('the collapse queue pops cheapest first, reuses freed slots and keeps the exact flag of each candidate (#2985)', () => {
  const queue = new CollapseQueue(2);
  const costs = [5, 1, 4, 1, 3, 9, 0.5, 7];
  costs.forEach((cost, index) => queue.push(cost, cost / 2, index, index + 10, index, index + 20, index % 2));
  const popped = [];
  while (queue.size) {
    queue.pop();
    popped.push([queue.poppedCost, queue.poppedPositionCost, queue.poppedRemoved, queue.poppedKept, queue.poppedRemovedVersion, queue.poppedKeptVersion, queue.poppedExact]);
  }
  assert.deepEqual(popped.map(entry => entry[0]), [...costs].sort((first, second) => first - second));
  for (const [cost, positionCost, removed, kept, removedVersion, keptVersion, exact] of popped) {
    assert.equal(positionCost, cost / 2);
    assert.equal(kept, removed + 10);
    assert.equal(removedVersion, removed);
    assert.equal(keptVersion, removed + 20);
    assert.equal(exact, removed % 2);
  }
  queue.push(2, 1, 40, 50, 1, 2, 0);
  assert.equal(queue.peekCost(), 2);
  assert.equal(queue.poolUsed, costs.length);
});
