import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findFlushPairs } from '../src/flush-search.js';
import { forgetSearch } from '../src/flush-search-reuse.js';
import { markLiveGeometry } from '../src/live-geometry.js';

// The incremental flush search (issue #2787) must return what a cold search of the same scene returns, for every layout of parts.
// A random walk of edits checks it after every step against a cold search of cloned geometry.

const BOX_INDICES = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function boxGeometry(width, height, depth, degenerate = 'none') {
  const positions = [];
  for (let corner = 0; corner < 8; corner++) {
    positions.push(corner & 1 ? width / 2 : -width / 2, corner & 2 ? height / 2 : -height / 2, corner & 4 ? depth / 2 : -depth / 2);
  }
  const indices = [...BOX_INDICES];
  if (degenerate === 'last') indices.push(0, 0, 1);
  if (degenerate === 'middle') indices.splice(15, 0, 2, 2, 3);
  if (degenerate === 'first') indices.unshift(4, 4, 5);
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) };
}

function matrixAt(x, y, z, scale, rotation) {
  const matrix = new Float32Array(16);
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  matrix[0] = scale[0] * cosine;
  matrix[2] = -scale[0] * sine;
  matrix[5] = scale[1];
  matrix[8] = scale[2] * sine;
  matrix[10] = scale[2] * cosine;
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  matrix[15] = 1;
  return matrix;
}

function boxPart(name, x, y, z, size = 1) {
  return { name, geometry: boxGeometry(size, size, size), matrix: matrixAt(x, y, z, [1, 1, 1], 0), material: {} };
}

function clonedParts(parts) {
  return parts.map(source => ({
    ...source,
    geometry: { positions: Float32Array.from(source.geometry.positions), indices: Uint32Array.from(source.geometry.indices) },
    matrix: Float32Array.from(source.matrix),
  }));
}

function summaryOf(result) {
  const rows = result.pairs.flatMap(pair => [pair.first, pair.second]).map(row => [
    row, result.owner[row], result.local[row], result.areas[row], [...result.corners.subarray(row * 9, row * 9 + 9)],
  ]);
  return { count: result.count, unchecked: result.unchecked.length, truncated: result.truncated, pairs: result.pairs, rows };
}

function assertColdEqual(incremental, parts, options, label) {
  forgetSearch();
  const cold = findFlushPairs(clonedParts(parts), options);
  assert.deepEqual(summaryOf(incremental), summaryOf(cold), label);
  return cold;
}

function walkEdits(seed, stepCount, options) {
  const random = seededRandom(seed);
  const pick = count => Math.floor(random() * count);
  const geometries = [
    boxGeometry(1, 1, 1), boxGeometry(2, 1, 1), boxGeometry(1, 0.2, 3),
    boxGeometry(1, 1, 1, 'last'), boxGeometry(1, 1, 1, 'middle'), boxGeometry(2, 1, 1, 'first'),
  ];
  let counter = 0;
  const randomMatrix = rotates => matrixAt(pick(6), pick(3) * 0.5, pick(6), [pick(3) * 0.5 + 1, 1, 1], rotates && random() < 0.2 ? Math.PI / 2 : 0);
  const newPart = () => ({ name: `part-${counter++}`, geometry: geometries[pick(geometries.length)], matrix: randomMatrix(true), material: { doubleSided: random() < 0.2 } });
  let parts = Array.from({ length: 8 }, newPart);
  forgetSearch();
  findFlushPairs(parts, options);
  let pairCount = 0;
  for (let step = 0; step < stepCount; step++) {
    const operation = pick(8);
    const index = pick(parts.length);
    if (operation === 0) {
      parts = [...parts, newPart()];
    } else if (operation === 1 && parts.length > 3) {
      parts = parts.filter((_, at) => at !== index);
    } else if (operation === 2) {
      parts = parts.map((part, at) => (at === index ? { ...part, matrix: randomMatrix(false) } : part));
    } else if (operation === 3) {
      parts = [...parts, { ...parts[index], name: `copy-${counter++}`, matrix: randomMatrix(false) }];
    } else if (operation === 4) {
      const reordered = parts.slice();
      const [moved] = reordered.splice(index, 1);
      reordered.splice(pick(reordered.length + 1), 0, moved);
      parts = reordered;
    } else if (operation === 5) {
      parts = parts.map((part, at) => (at === index ? { ...part, material: { doubleSided: !part.material.doubleSided } } : part));
    } else if (operation === 6) {
      const inserted = parts.slice();
      inserted.splice(index, 0, newPart());
      parts = inserted;
    } else {
      const other = pick(parts.length);
      parts = parts.map((part, at) => (at === index || at === other ? { ...part, matrix: randomMatrix(false) } : part));
    }
    const incremental = findFlushPairs(parts, options);
    const cold = assertColdEqual(incremental, parts, options, `seed ${seed} step ${step} operation ${operation}`);
    pairCount += cold.pairs.length;
    forgetSearch();
    findFlushPairs(parts, options);
  }
  return pairCount;
}

test('the incremental flush search equals a cold search after every edit of a random walk', () => {
  let pairCount = 0;
  for (const seed of [4, 11, 23]) pairCount += walkEdits(seed, 100);
  assert.ok(pairCount > 1000, `the walk meets many pairs (${pairCount})`);
});

test('the incremental flush search equals a cold search when a pair budget forces it to start over', () => {
  walkEdits(5, 60, { pairBudget: 30 });
  const options = { pairBudget: 30 };
  const crowd = Array.from({ length: 30 }, (_, index) => boxPart(`crowd-${index}`, (index % 3) * 0.01, 0, 0));
  forgetSearch();
  findFlushPairs(crowd.slice(0, 29), options);
  const incremental = findFlushPairs(crowd, options);
  const cold = assertColdEqual(incremental, crowd, options, 'pair budget exceeded by an added part');
  assert.equal(cold.truncated, true, 'the budget does run out');
});

test('the incremental flush search equals a cold search when a tested pair limit forces it to start over', () => {
  walkEdits(6, 60, { testedPairLimit: 40 });
});

test('the incremental flush search equals a cold search when more parts change than it builds on', () => {
  const base = Array.from({ length: 20 }, (_, index) => boxPart(`base-${index}`, index * 0.7, 0, 0));
  forgetSearch();
  findFlushPairs(base);
  const added = Array.from({ length: 300 }, (_, index) => boxPart(`added-${index}`, index * 0.05, 0.001, 0.2, 0.5));
  const edited = [...base, ...added];
  const incremental = findFlushPairs(edited);
  assert.ok(incremental.pairs.length > 0);
  assertColdEqual(incremental, edited, undefined, '300 added parts');
});

test('a live geometry rewritten in place between two searches is searched at its new place', () => {
  const sheet = boxGeometry(1, 0.02, 1);
  const live = markLiveGeometry({ positions: Float32Array.from(sheet.positions), indices: Uint32Array.from(sheet.indices) });
  const backdrops = [0, 1, 2].map(index => ({ name: `backdrop-${index}`, geometry: boxGeometry(1, 0.02, 1), matrix: matrixAt(index * 1.5, 0.001, 0, [1, 1, 1], 0), material: {} }));
  const cloth = { name: 'cloth', geometry: live, matrix: matrixAt(0, 0, 0, [1, 1, 1], 0), material: {} };
  for (let offset = 0; offset < live.positions.length; offset += 3) live.positions[offset] += 40;
  const parts = [...backdrops, cloth];
  forgetSearch();
  const before = findFlushPairs(parts);
  const touchesCloth = (result, pair) => result.owner[pair.first] === 3 || result.owner[pair.second] === 3;
  assert.equal(before.pairs.filter(pair => touchesCloth(before, pair)).length, 0, 'the cloth starts far away');
  for (let offset = 0; offset < live.positions.length; offset += 3) live.positions[offset] -= 40;
  const incremental = findFlushPairs(parts);
  assert.ok(incremental.pairs.some(pair => touchesCloth(incremental, pair)), 'the cloth now overlaps a backdrop');
  assertColdEqual(incremental, parts, undefined, 'live geometry moved in place');
});
