import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fittedClosedRoomShare, fittedRoomHasWalls } from '../src/fitted-closed-room.js';
import { partMatrixLookup } from '../src/closed-room.js';
import { findFlushPairs } from '../src/flush-search.js';
import { forgetSearch } from '../src/flush-search-reuse.js';
import { markLiveGeometry } from '../src/live-geometry.js';

// An edit that adds one part must not read the triangles of parts it cannot have changed (issue #2787), and everything it
// returns must be what a search of a fresh copy of the same scene returns.

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function placed(x, y, z, scale = [1, 1, 1]) {
  const matrix = [...IDENTITY];
  matrix[0] = scale[0];
  matrix[5] = scale[1];
  matrix[10] = scale[2];
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return new Float32Array(matrix);
}

function sheetGeometry(size) {
  const positions = [];
  const indices = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const base = positions.length / 3;
      positions.push(column, 0, row, column, 0, row + 1, column + 1, 0, row + 1, column + 1, 0, row);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function boxGeometry() {
  const positions = [];
  for (let corner = 0; corner < 8; corner++) positions.push(corner & 1 ? 0.5 : -0.5, corner & 2 ? 0.5 : -0.5, corner & 4 ? 0.5 : -0.5);
  const indices = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function copiedGeometry(geometry) {
  return { positions: Float32Array.from(geometry.positions), indices: Uint32Array.from(geometry.indices) };
}

function copiedParts(parts) {
  return parts.map(source => ({ ...source, geometry: copiedGeometry(source.geometry), matrix: Float32Array.from(source.matrix) }));
}

function part(name, geometry, matrix) {
  return { name, geometry, matrix, material: {} };
}

function countingIndices(indices, counter) {
  return new Proxy(indices, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) counter.reads++;
      return Reflect.get(target, key);
    },
  });
}

function pairsOf(result) {
  return result.pairs.map(pair => `${pair.first},${pair.second},${pair.gap},${pair.area},${pair.flush},${pair.opposite}`);
}

test('adding a part reads only the triangles it can touch and those of the pairs kept, and finds what a cold search finds', () => {
  const bigSheet = sheetGeometry(40);
  const counter = { reads: 0 };
  const bigSheetGeometry = { positions: bigSheet.positions, indices: countingIndices(bigSheet.indices, counter) };
  const farSheet = part('far-sheet', bigSheetGeometry, placed(500, 0, 500));
  const farPatch = part('far-patch', sheetGeometry(2), placed(500, 0.001, 500));
  const nearSheet = part('near-sheet', sheetGeometry(4), placed(0, 0, 0));
  const nearPatch = part('near-patch', sheetGeometry(2), placed(0, 0.001, 0));
  forgetSearch();
  const first = findFlushPairs([farSheet, farPatch, nearSheet, nearPatch]);
  assert.ok(first.pairs.length > 0, 'a patch a millimetre above a sheet fights');
  assert.ok(counter.reads >= bigSheet.indices.length, 'the first search reads the whole sheet');

  const added = part('added', sheetGeometry(2), placed(1, 0.0005, 1));
  const edited = [farSheet, farPatch, nearSheet, nearPatch, added];
  counter.reads = 0;
  const incremental = findFlushPairs(edited);
  assert.ok(counter.reads < bigSheet.indices.length / 10, `read ${counter.reads} indices of the far sheet, which has ${bigSheet.indices.length}`);

  const coldParts = copiedParts([part('far-sheet', bigSheet, farSheet.matrix), ...edited.slice(1)]);
  forgetSearch();
  const cold = findFlushPairs(coldParts);
  assert.deepEqual(pairsOf(incremental), pairsOf(cold));
  assert.equal(incremental.count, cold.count);
  for (const pair of incremental.pairs) {
    for (const row of [pair.first, pair.second]) {
      assert.equal(incremental.owner[row], cold.owner[row]);
      assert.equal(incremental.local[row], cold.local[row]);
      assert.equal(incremental.areas[row], cold.areas[row]);
      assert.deepEqual([...incremental.corners.subarray(row * 9, row * 9 + 9)], [...cold.corners.subarray(row * 9, row * 9 + 9)]);
    }
  }
});

function roomParts(extra = []) {
  const box = boxGeometry();
  const walls = [
    ['floor', placed(0, -0.1, 0, [8, 0.2, 8])],
    ['ceiling', placed(0, 3.1, 0, [8, 0.2, 8])],
    ['wall-a', placed(-4, 1.5, 0, [0.2, 3, 8])],
    ['wall-b', placed(4, 1.5, 0, [0.2, 3, 8])],
    ['wall-c', placed(0, 1.5, -4, [8, 3, 0.2])],
    ['wall-d', placed(0, 1.5, 4, [8, 3, 0.2])],
  ].map(([name, matrix]) => part(name, box, matrix));
  return [...walls, ...extra];
}

function countingPositions(positions, counter) {
  return {
    get positions() {
      counter.reads++;
      return positions;
    },
    indices: boxGeometry().indices,
  };
}

test('the closed-room test of a scene with one more part is what a fresh test of that scene gives, without reading the other parts again', () => {
  const counter = { reads: 0 };
  const watched = part('prop', countingPositions(boxGeometry().positions, counter), placed(1, 0.5, 1));
  const parts = roomParts([watched]);
  fittedClosedRoomShare(parts, partMatrixLookup(parts));
  fittedRoomHasWalls(parts, partMatrixLookup(parts));

  const lamp = part('lamp', boxGeometry(), placed(-1, 2.5, -1, [0.3, 0.3, 0.3]));
  const edited = [...parts, lamp];
  counter.reads = 0;
  const share = fittedClosedRoomShare(edited, partMatrixLookup(edited));
  const walls = fittedRoomHasWalls(edited, partMatrixLookup(edited));
  assert.equal(counter.reads, 0, 'the prop was neither read for its corners nor for its centre again');

  const fresh = copiedParts(edited);
  assert.equal(share, fittedClosedRoomShare(fresh, partMatrixLookup(fresh)));
  assert.equal(walls, fittedRoomHasWalls(fresh, partMatrixLookup(fresh)));
});

test('a part moved between two closed-room tests is traced at its new matrix', () => {
  const parts = roomParts();
  const before = fittedClosedRoomShare(parts, partMatrixLookup(parts));
  const opened = parts.map(room => (room.name === 'ceiling' ? { ...room, matrix: placed(0, 30, 0, [8, 0.2, 8]) } : room));
  const after = fittedClosedRoomShare(opened, partMatrixLookup(opened));
  const fresh = copiedParts(opened);
  assert.equal(after, fittedClosedRoomShare(fresh, partMatrixLookup(fresh)));
  assert.notEqual(after, before, 'lifting the ceiling away opens the room');
});

function withTrailingDegenerateTriangle(geometry) {
  return { positions: geometry.positions, indices: Uint32Array.from([...geometry.indices, 0, 0, 1]) };
}

function withMiddleDegenerateTriangle(geometry) {
  const indices = [...geometry.indices];
  indices.splice(6, 0, 0, 0, 1);
  return { positions: geometry.positions, indices: Uint32Array.from(indices) };
}

function rowsOf(result, row) {
  return [result.owner[row], result.local[row], result.areas[row], [...result.corners.subarray(row * 9, row * 9 + 9)]];
}

function assertSameAsCold(incremental, edited) {
  const fresh = copiedParts(edited);
  forgetSearch();
  const cold = findFlushPairs(fresh);
  assert.deepEqual(pairsOf(incremental), pairsOf(cold));
  assert.equal(incremental.count, cold.count);
  for (const pair of incremental.pairs) {
    for (const row of [pair.first, pair.second]) assert.deepEqual(rowsOf(incremental, row), rowsOf(cold, row));
  }
}

test('a part added right after an unchanged part that ends in a zero-area triangle keeps its own first row', () => {
  const base = part('base', sheetGeometry(2), placed(0, 0, 0));
  const neighbour = part('neighbour', withTrailingDegenerateTriangle(sheetGeometry(2)), placed(2, 0, 0));
  forgetSearch();
  findFlushPairs([base, neighbour]);
  const added = part('added', sheetGeometry(2), placed(0, 0.001, 0));
  const edited = [base, neighbour, added];
  const incremental = findFlushPairs(edited);
  assert.ok(incremental.pairs.length > 0, 'the added sheet fights the base sheet');
  assertSameAsCold(incremental, edited);
});

test('a zero-area triangle in the middle of an unchanged part does not disturb the part added after it', () => {
  const base = part('base', sheetGeometry(2), placed(0, 0, 0));
  const neighbour = part('neighbour', withMiddleDegenerateTriangle(sheetGeometry(2)), placed(2, 0, 0));
  forgetSearch();
  findFlushPairs([base, neighbour]);
  const added = part('added', sheetGeometry(2), placed(0, 0.001, 0));
  const edited = [base, neighbour, added];
  assertSameAsCold(findFlushPairs(edited), edited);
});

test('the closed-room test measures the centre of a live geometry from its current positions', () => {
  const box = boxGeometry();
  const cloth = markLiveGeometry(boxGeometry());
  const props = [1, 2, 3, 4, 5].map(index => part(`prop-${index}`, box, placed(index - 3, 0.5, 0, [0.3, 0.3, 0.3])));
  const parts = roomParts([...props, part('cloth', cloth, placed(0, 0.5, 1))]);
  const measure = list => [fittedClosedRoomShare(list, partMatrixLookup(list)), fittedRoomHasWalls(list, partMatrixLookup(list))];
  measure(parts);
  for (let offset = 0; offset < cloth.positions.length; offset += 3) cloth.positions[offset] += 500;
  assert.deepEqual(measure(parts), measure(copiedParts(parts)));
});
