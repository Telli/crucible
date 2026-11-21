import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { flushOrderOf } from '../src/depth-layer.js';
import { findFlushPairs } from '../src/flush-search.js';
import { forgetSearch } from '../src/flush-search-reuse.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const GRID_SIZE = 40;
const PATCH_SIZE = 4;

function movedTo(x, y, z) {
  const matrix = [...IDENTITY];
  matrix[12] = x;
  matrix[13] = y;
  matrix[14] = z;
  return matrix;
}

// A flat sheet of quads on y = 0, so two sheets laid one over the other fight.
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

const sheet = sheetGeometry(GRID_SIZE);
const patch = sheetGeometry(PATCH_SIZE);

function sheetPart(name, matrix, geometry = sheet) {
  return { name, geometry, matrix: new Float32Array(matrix), material: {} };
}

function coldSearch(parts) {
  forgetSearch();
  return findFlushPairs(parts);
}

function pairsOf(result) {
  return result.pairs.map(pair => `${pair.first},${pair.second},${pair.gap},${pair.area},${pair.flush},${pair.opposite}`);
}

test('adding a part searches only the triangles near it and finds the pairs a cold search finds', () => {
  const base = sheetPart('base', IDENTITY);
  const lower = sheetPart('lower', movedTo(0, 0.001, 0));
  forgetSearch();
  const first = findFlushPairs([base, lower]);
  assert.ok(first.pairs.length > 0, 'two sheets one millimetre apart fight');
  assert.equal(first.searched, first.count, 'the first search is cold and looks at everything');

  const far = sheetPart('far', movedTo(GRID_SIZE / 2, 0.0005, GRID_SIZE / 2), patch);
  const edited = [base, lower, far];
  const incremental = findFlushPairs(edited);
  assert.ok(incremental.searched < incremental.count / 2, `searched ${incremental.searched} of ${incremental.count} triangles`);
  assert.deepEqual(pairsOf(incremental), pairsOf(coldSearch(edited)));
});

test('a part added before the others and one that grows the scene still match a cold search', () => {
  const base = sheetPart('base', IDENTITY);
  const lower = sheetPart('lower', movedTo(0, 0.001, 0));
  forgetSearch();
  findFlushPairs([base, lower]);

  const first = sheetPart('first', movedTo(5, 0.0007, 5));
  const withFirst = [first, base, lower];
  assert.deepEqual(pairsOf(findFlushPairs(withFirst)), pairsOf(coldSearch(withFirst)));

  const distant = sheetPart('distant', movedTo(900, 0, 900));
  const grown = [first, base, lower, distant];
  assert.deepEqual(pairsOf(findFlushPairs(grown)), pairsOf(coldSearch(grown)));
});

test('removing and moving parts match a cold search', () => {
  const base = sheetPart('base', IDENTITY);
  const lower = sheetPart('lower', movedTo(0, 0.001, 0));
  const extra = sheetPart('extra', movedTo(3, 0.0004, 3));
  forgetSearch();
  findFlushPairs([base, lower, extra]);

  const withoutLower = [base, extra];
  assert.deepEqual(pairsOf(findFlushPairs(withoutLower)), pairsOf(coldSearch(withoutLower)));

  forgetSearch();
  findFlushPairs([base, lower, extra]);
  const moved = [base, lower, sheetPart('extra', movedTo(3, 0.0009, 4))];
  const incremental = findFlushPairs(moved);
  assert.deepEqual(pairsOf(incremental), pairsOf(coldSearch(moved)));
});

test('an unchanged scene is not searched again', () => {
  const parts = [sheetPart('base', IDENTITY), sheetPart('lower', movedTo(0, 0.001, 0))];
  forgetSearch();
  findFlushPairs(parts);
  assert.equal(findFlushPairs(parts).searched, 0);
});

test('a scene edit that adds a node leaves the draw orders of the untouched parts as they were', () => {
  const recipe = {
    format: 'crucible.scene',
    schemaVersion: 1,
    geometries: [{ id: 'slab', type: 'box' }],
    materials: [{ id: 'paint', color: [0.5, 0.5, 0.5] }],
    nodes: [
      { id: 'floor', geometry: 'slab', material: 'paint', scale: [10, 0.2, 10] },
      { id: 'rug', geometry: 'slab', material: 'paint', translation: [0, 0.0005, 0], scale: [4, 0.2, 4] },
    ],
  };
  forgetSearch();
  const scene = createAgentScene(recipe);
  const before = scene.parts.map(part => [part, flushOrderOf(part)]);
  assert.ok(before.some(([, order]) => order), 'the rug fights the floor, so a part has an order');
  scene.apply([{ type: 'add-node', node: { id: 'box', geometry: 'slab', material: 'paint', translation: [2, 3, 2] } }], { expectedRevision: scene.revision });
  for (const [part, order] of before) {
    assert.equal(flushOrderOf(part), order, `${part.name} keeps its order object, so the renderer keeps its batch`);
  }
});
