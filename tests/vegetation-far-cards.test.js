import test from 'node:test';
import assert from 'node:assert/strict';
import { createTree } from '../src/vegetation.js';
import { crownSolidity } from '../scripts/tree-proof-lib.mjs';

// The far levels keep each species' own leaf card and the width of level 1 (#3051).
const SEEDS = [1, 4];
const CARD_PRESETS = ['oak', 'ash', 'aspen', 'birch', 'pine', 'palm'];
const WIDTH_PRESETS = ['oak', 'aspen', 'birch', 'pine', 'palm'];
const WIDTH_TOLERANCE = 1.15;
const SOLIDITY_STEP = 0.1;
const FOLIAGE_PART = 1;

function foliageWidth(tree, level) {
  const { positions } = tree.levels[level].parts[FOLIAGE_PART].geometry;
  const minimum = [Infinity, Infinity];
  const maximum = [-Infinity, -Infinity];
  for (let index = 0; index < positions.length; index += 3) {
    [0, 2].forEach((axis, slot) => {
      minimum[slot] = Math.min(minimum[slot], positions[index + axis]);
      maximum[slot] = Math.max(maximum[slot], positions[index + axis]);
    });
  }
  return Math.max(maximum[0] - minimum[0], maximum[1] - minimum[1]);
}

test('far levels draw the species leaf card, not the generic clump card', () => {
  for (const preset of CARD_PRESETS) {
    const tree = createTree({ preset }, 4);
    for (const level of [2, 3]) {
      const part = tree.levels[level].parts[FOLIAGE_PART];
      assert.equal(part.material, tree.levels[1].parts[FOLIAGE_PART].material, `${preset} level ${level} must share the leaf card of level 1`);
      assert.notEqual(part.material, tree.materials.crown, `${preset} level ${level} drew the clump card`);
      assert.ok(part.geometry.indices.length > 0);
    }
  }
});

test('far levels use fewer, bigger cards than level 1', () => {
  const tree = createTree({ preset: 'palm' }, 4);
  const triangles = level => tree.levels[level].parts[FOLIAGE_PART].geometry.indices.length / 3;
  assert.ok(triangles(2) < triangles(1) && triangles(3) < triangles(2), 'each far level has fewer foliage triangles');
  assert.ok(triangles(3) >= 100, 'a far palm keeps a card for each of its fronds, not a blob');
});

test('far crowns keep the width of level 1', () => {
  for (const preset of WIDTH_PRESETS) {
    for (const seed of SEEDS) {
      const tree = createTree({ preset }, seed);
      const nearWidth = foliageWidth(tree, 1);
      for (const level of [2, 3]) {
        const ratio = foliageWidth(tree, level) / nearWidth;
        assert.ok(ratio <= WIDTH_TOLERANCE && ratio >= 1 / WIDTH_TOLERANCE, `${preset} seed ${seed} level ${level} is ${ratio.toFixed(2)} times as wide as level 1`);
      }
    }
  }
});

test('crown solidity changes by at most 0.1 across each level switch', () => {
  for (const preset of ['oak', 'birch', 'palm']) {
    const tree = createTree({ preset }, 4);
    const solidity = [0, 1, 2, 3].map(level => crownSolidity(tree, level));
    for (let level = 1; level < solidity.length; level++) {
      const step = Math.abs(solidity[level] - solidity[level - 1]);
      assert.ok(step <= SOLIDITY_STEP, `${preset} solidity moves ${step.toFixed(2)} from level ${level - 1} to ${level}`);
    }
  }
});

test('a bush and a tree of mesh leaves keep their crown clumps at the far levels', () => {
  const bush = createTree('bush', 4);
  assert.deepEqual([2, 3].map(level => bush.levels[level].parts[FOLIAGE_PART].geometry.indices.length / 3), [126, 126]);
  for (const level of [2, 3]) assert.equal(bush.levels[level].parts[FOLIAGE_PART].material, bush.materials.crown);
  const mesh = createTree({ preset: 'oak', leaves: 'mesh' }, 4);
  // 26 blobs of 80 triangles each, the same at both far levels.
  assert.deepEqual([2, 3].map(level => mesh.levels[level].parts[FOLIAGE_PART].geometry.indices.length / 3), [2080, 2080]);
});
