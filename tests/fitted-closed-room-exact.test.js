import test from 'node:test';
import assert from 'node:assert/strict';
import { CLOSED_ROOM_MAXIMUM_TRIANGLES, CLOSED_ROOM_SHARE, closedRoomShare, freeOrigin, hitsFrontFace, partMatrixLookup, worldTriangles } from '../src/closed-room.js';
import { fittedClosedRoomShare, fittedRoomHasWalls } from '../src/fitted-closed-room.js';

// The fitted closed-room test as it was before #2842 (every ray against every triangle, the world triangles built again for each subset),
// kept here so the faster version is compared with it number for number.

function triangleCountOf(part) {
  return part.geometry.indices.length / 3;
}

function isOpaque(part) {
  return !['blend', 'add'].includes(part.material?.alphaMode);
}

function oldLightestParts(parts) {
  const kept = new Set();
  let total = 0;
  for (const part of [...parts].sort((first, second) => triangleCountOf(first) - triangleCountOf(second))) {
    total += triangleCountOf(part);
    if (total > CLOSED_ROOM_MAXIMUM_TRIANGLES) {
      break;
    }
    kept.add(part);
  }
  return parts.filter(part => kept.has(part));
}

function oldPartCentre(part, matrix) {
  const { positions } = part.geometry;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index++) {
    minimum[index % 3] = Math.min(minimum[index % 3], positions[index]);
    maximum[index % 3] = Math.max(maximum[index % 3], positions[index]);
  }
  const middle = minimum.map((value, axis) => (value + maximum[axis]) / 2);
  return [0, 1, 2].map(axis => matrix[axis] * middle[0] + matrix[4 + axis] * middle[1] + matrix[8 + axis] * middle[2] + matrix[12 + axis]);
}

function oldPartsNearTheRest(parts, worldMatrices) {
  const centres = parts.map(part => oldPartCentre(part, worldMatrices.get(part) ?? worldMatrices.get(part.name)));
  const spreads = [0, 1, 2].map(axis => {
    const values = centres.map(centre => centre[axis]).sort((first, second) => first - second);
    return [values[Math.floor((values.length - 1) * 0.2)], values[Math.ceil((values.length - 1) * 0.8)]];
  });
  const margin = 1.5 * Math.max(...spreads.map(([low, high]) => high - low));
  return parts.filter((part, index) => spreads.every(([low, high], axis) => centres[index][axis] >= low - margin && centres[index][axis] <= high + margin));
}

function oldWallShare(parts, worldMatrices) {
  const triangles = worldTriangles(parts.filter(isOpaque), worldMatrices);
  if (!triangles) {
    return null;
  }
  const origin = freeOrigin(triangles);
  if (!origin) {
    return null;
  }
  const direction = [0, 0, 0];
  let hits = 0;
  for (let ray = 0; ray < 36; ray++) {
    const angle = ((ray + 0.5) / 36) * Math.PI * 2;
    direction[0] = Math.cos(angle);
    direction[1] = 0;
    direction[2] = Math.sin(angle);
    for (let triangle = 0; triangle < triangles.triangleCount; triangle++) {
      if (hitsFrontFace(triangles.corners, triangle * 9, origin, direction)) {
        hits++;
        break;
      }
    }
  }
  return hits / 36;
}

function oldFittedShare(parts, worldMatrices) {
  const kept = oldLightestParts(parts.filter(isOpaque));
  const share = closedRoomShare(kept, worldMatrices);
  if (share === null || share >= CLOSED_ROOM_SHARE) {
    return share;
  }
  return Math.max(share, closedRoomShare(oldPartsNearTheRest(kept, worldMatrices), worldMatrices) ?? 0);
}

function oldFittedHasWalls(parts, worldMatrices) {
  const kept = oldLightestParts(parts.filter(isOpaque));
  const share = Math.max(oldWallShare(kept, worldMatrices) ?? 0, oldWallShare(oldPartsNearTheRest(kept, worldMatrices), worldMatrices) ?? 0);
  return share >= 0.8;
}

// Scene builders.

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function geometryOf(positionList, indexList) {
  return { positions: new Float32Array(positionList), indices: new Uint32Array(indexList) };
}

const BOX_CORNERS = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
const BOX_QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];

// A cube from -1 to 1 whose faces look inward or outward; an inward one is a room when a ray starts inside it.
function boxGeometry(facingInward) {
  const indexList = [];
  for (const [first, second, third, fourth] of BOX_QUADS) {
    if (facingInward) {
      indexList.push(first, third, second, first, fourth, third);
    } else {
      indexList.push(first, second, third, first, third, fourth);
    }
  }
  return geometryOf(BOX_CORNERS.flat(), indexList);
}

// A flat quad in the x/y plane with no thickness.
function quadGeometry(flipped) {
  const corners = [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0];
  return geometryOf(corners, flipped ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
}

function sphereGeometry(rings, segments) {
  const positionList = [];
  for (let ring = 0; ring <= rings; ring++) {
    const polar = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment++) {
      const azimuth = (segment / segments) * Math.PI * 2;
      positionList.push(Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth));
    }
  }
  const indexList = [];
  const stride = segments + 1;
  for (let ring = 0; ring < rings; ring++) {
    for (let segment = 0; segment < segments; segment++) {
      const first = ring * stride + segment;
      indexList.push(first, first + stride, first + 1, first + 1, first + stride, first + stride + 1);
    }
  }
  return geometryOf(positionList, indexList);
}

// Column-major matrix: translate * rotateY * rotateX * scale.
function matrixOf({ translation = [0, 0, 0], scale = [1, 1, 1], yaw = 0, pitch = 0 }) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const rotation = [
    [cosYaw, sinYaw * sinPitch, sinYaw * cosPitch],
    [0, cosPitch, -sinPitch],
    [-sinYaw, cosYaw * sinPitch, cosYaw * cosPitch],
  ];
  const matrix = new Array(16).fill(0);
  for (let column = 0; column < 3; column++) {
    for (let row = 0; row < 3; row++) {
      matrix[column * 4 + row] = rotation[row][column] * scale[column];
    }
  }
  matrix[12] = translation[0];
  matrix[13] = translation[1];
  matrix[14] = translation[2];
  matrix[15] = 1;
  return matrix;
}

function partOf(name, geometry, placement, alphaMode) {
  return { name, geometry, matrix: matrixOf(placement), ...(alphaMode ? { material: { alphaMode } } : {}) };
}

// Six flat wall quads of a 10 x 6 x 10 room, each its own part, facing the middle.
function wallQuadParts() {
  const quad = quadGeometry(false);
  return [
    partOf('south', quad, { translation: [0, 0, -5], scale: [5, 3, 1] }),
    partOf('north', quad, { translation: [0, 0, 5], scale: [5, 3, 1], yaw: Math.PI }),
    partOf('west', quad, { translation: [-5, 0, 0], scale: [5, 3, 1], yaw: Math.PI / 2 }),
    partOf('east', quad, { translation: [5, 0, 0], scale: [5, 3, 1], yaw: -Math.PI / 2 }),
    partOf('floor', quad, { translation: [0, -3, 0], scale: [5, 5, 1], pitch: -Math.PI / 2 }),
    partOf('roof', quad, { translation: [0, 3, 0], scale: [5, 5, 1], pitch: Math.PI / 2 }),
  ];
}

function expectSame(parts, label) {
  const matrices = partMatrixLookup(parts);
  const expectedShare = oldFittedShare(parts, matrices);
  const expectedWalls = oldFittedHasWalls(parts, matrices);
  assert.strictEqual(fittedClosedRoomShare(parts, matrices), expectedShare, `${label}: share`);
  assert.strictEqual(fittedRoomHasWalls(parts, matrices), expectedWalls, `${label}: walls`);
  return { share: expectedShare, walls: expectedWalls };
}

test('a one-part room (an inward-facing box) gives the same share and walls', () => {
  const result = expectSame([partOf('room', boxGeometry(true), { scale: [5, 3, 5] })], 'room');
  assert.strictEqual(result.share, 1);
  assert.strictEqual(result.walls, true);
});

test('a solid outward-facing box gives the same share and walls', () => {
  const result = expectSame([partOf('block', boxGeometry(false), { scale: [5, 3, 5] })], 'block');
  assert.strictEqual(result.share, 0);
});

test('a room of six flat wall quads gives the same share and walls', () => {
  const result = expectSame(wallQuadParts(), 'six quads');
  assert.strictEqual(result.share, 1);
  assert.strictEqual(result.walls, true);
});

test('the same room without a roof or a wall gives the same numbers', () => {
  const quads = wallQuadParts();
  const withoutRoof = expectSame(quads.filter(part => part.name !== 'roof'), 'no roof');
  assert.ok(withoutRoof.share < 1);
  const withoutWall = expectSame(quads.filter(part => part.name !== 'east'), 'no east wall');
  assert.strictEqual(withoutWall.walls, false);
});

test('a room with a lawn far beside it gives the same numbers', () => {
  const lawn = partOf('lawn', quadGeometry(false), { translation: [60, -3, 0], scale: [40, 40, 1], pitch: -Math.PI / 2 });
  const result = expectSame([...wallQuadParts(), lawn], 'room and lawn');
  assert.strictEqual(result.walls, true);
});

test('a scene over the triangle budget (heavy props inside a light room) gives the same numbers', () => {
  const heavy = sphereGeometry(150, 200);
  const props = [-2.5, 0, 2.5].map((offset, index) => partOf(`heavy-${index}`, heavy, { translation: [offset, -2, offset / 2], scale: [0.8, 0.8, 0.8] }));
  const parts = [...wallQuadParts(), ...props];
  const total = parts.reduce((sum, part) => sum + triangleCountOf(part), 0);
  assert.ok(total > CLOSED_ROOM_MAXIMUM_TRIANGLES);
  assert.strictEqual(closedRoomShare(parts, partMatrixLookup(parts)), null);
  const result = expectSame(parts, 'heavy props');
  assert.strictEqual(result.share, 1);
});

test('blend and add parts are left out of both versions the same way', () => {
  const parts = [...wallQuadParts(), partOf('glass', boxGeometry(false), { scale: [4, 2, 4] }, 'blend'), partOf('glow', boxGeometry(false), { scale: [4, 2, 4] }, 'add')];
  expectSame(parts, 'blend and add');
  expectSame(parts.filter(part => part.material), 'only blend and add');
});

test('rotated and non-uniformly scaled matrices give the same numbers', () => {
  const parts = [
    partOf('room', boxGeometry(true), { scale: [7, 2.5, 4], yaw: 0.6, pitch: 0.2, translation: [1, 2, -3] }),
    partOf('prop', sphereGeometry(10, 14), { scale: [0.4, 1.5, 0.9], yaw: 1.1, translation: [2, 1, -2] }),
  ];
  expectSame(parts, 'rotated');
});

test('a small part sitting on the middle of the bounds gives the same numbers', () => {
  expectSame([...wallQuadParts(), partOf('table', boxGeometry(false), { scale: [0.6, 0.6, 0.6] })], 'part in the middle');
});

test('an open scene of scattered props gives the same numbers', () => {
  const random = makeRandom(7);
  const sphere = sphereGeometry(12, 16);
  const parts = Array.from({ length: 14 }, (unused, index) => partOf(`prop-${index}`, sphere, {
    translation: [(random() - 0.5) * 40, random() * 3, (random() - 0.5) * 40],
    scale: [0.5 + random(), 0.5 + random(), 0.5 + random()],
  }));
  const result = expectSame(parts, 'scattered props');
  assert.ok(result.share < CLOSED_ROOM_SHARE);
});

test('an empty list gives the same numbers', () => {
  const matrices = partMatrixLookup([]);
  assert.strictEqual(fittedClosedRoomShare([], matrices), null);
  assert.strictEqual(fittedRoomHasWalls([], matrices), false);
  assert.strictEqual(oldFittedShare([], matrices), null);
  assert.strictEqual(oldFittedHasWalls([], matrices), false);
});

test('thirty fixed-seed random scenes give the same numbers', () => {
  const geometries = [boxGeometry(true), boxGeometry(false), quadGeometry(false), quadGeometry(true), sphereGeometry(8, 12)];
  const shares = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const random = makeRandom(seed * 1000 + 3);
    const parts = seed % 3 === 0 ? wallQuadParts() : [];
    const extraCount = 1 + Math.floor(random() * 8);
    for (let index = 0; index < extraCount; index++) {
      const placement = {
        translation: [(random() - 0.5) * 24, (random() - 0.5) * 8, (random() - 0.5) * 24],
        scale: [0.3 + random() * 6, 0.3 + random() * 4, 0.3 + random() * 6],
        yaw: random() * Math.PI * 2,
        pitch: random() < 0.5 ? 0 : random() * Math.PI,
      };
      const alphaMode = random() < 0.15 ? 'blend' : undefined;
      parts.push(partOf(`part-${index}`, geometries[Math.floor(random() * geometries.length)], placement, alphaMode));
    }
    shares.add(expectSame(parts, `seed ${seed}`).share);
  }
  assert.ok(shares.size > 3, 'the random scenes should give a spread of shares');
});
