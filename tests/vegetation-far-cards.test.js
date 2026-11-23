import test from 'node:test';
import assert from 'node:assert/strict';
import { createTree } from '../src/vegetation.js';
import { crownSolidity } from '../scripts/tree-proof-lib.mjs';

// The far levels keep each species' own leaf card and the width of level 1 (#3051).
const SEEDS = [1, 4];
const CARD_PRESETS = ['oak', 'ash', 'aspen', 'birch', 'pine', 'palm'];
const WIDTH_PRESETS = ['oak', 'aspen', 'birch', 'pine', 'palm'];
const WIDTH_TOLERANCE = 1.16;
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
      // Compare by identity: a failing assert.equal on two materials prints a diff of their 64 KB texture pixels, which
      // grew one test run past 27 GB.
      assert.ok(part.material === tree.levels[1].parts[FOLIAGE_PART].material, `${preset} level ${level} must share the leaf card of level 1`);
      assert.ok(part.material !== tree.materials.crown, `${preset} level ${level} drew the clump card`);
      assert.ok(part.geometry.indices.length > 0);
    }
  }
});

test('far levels use fewer, bigger cards than level 1', () => {
  const tree = createTree({ preset: 'palm' }, 4);
  const triangles = level => tree.levels[level].parts[FOLIAGE_PART].geometry.indices.length / 3;
  assert.ok(triangles(2) < triangles(1) && triangles(3) < triangles(1), 'each far level has fewer foliage triangles than level 1');
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

// Cards of a leaf-card level: six vertices each (three rows of two), base row first.
const VERTICES_PER_CARD = 6;

function cardsOf(tree, level) {
  const { positions } = tree.levels[level].parts[FOLIAGE_PART].geometry;
  const cards = [];
  for (let first = 0; first + VERTICES_PER_CARD * 3 <= positions.length; first += VERTICES_PER_CARD * 3) {
    const vertex = index => [0, 1, 2].map(axis => positions[first + index * 3 + axis]);
    const baseLeft = vertex(0);
    const baseRight = vertex(1);
    const tipLeft = vertex(4);
    const tipRight = vertex(5);
    const base = baseLeft.map((value, axis) => (value + baseRight[axis]) / 2);
    const tip = tipLeft.map((value, axis) => (value + tipRight[axis]) / 2);
    const along = tip.map((value, axis) => value - base[axis]);
    const length = Math.hypot(...along);
    cards.push({ base, centre: base.map((value, axis) => (value + tip[axis]) / 2), length, slope: along[1] / length });
  }
  return cards;
}

const meanOf = (cards, property) => cards.reduce((sum, card) => sum + card[property], 0) / cards.length;

test('far cards stand alone: no two share a base, so none reads as a cross', () => {
  const MINIMUM_BASE_GAP = 0.01;
  for (const preset of ['palm', 'pine']) {
    const tree = createTree({ preset }, 4);
    for (const level of [2, 3]) {
      const cards = cardsOf(tree, level);
      for (let first = 0; first < cards.length; first++) {
        for (let second = first + 1; second < cards.length; second++) {
          const gap = Math.hypot(...cards[first].base.map((value, axis) => value - cards[second].base[axis]));
          assert.ok(gap > MINIMUM_BASE_GAP, `${preset} level ${level} has two cards on one base`);
        }
      }
    }
  }
});

test('the centre of a far crown holds at least the share of cards it holds at level 1', () => {
  for (const preset of ['oak', 'birch', 'ash']) {
    for (const seed of SEEDS) {
      const tree = createTree({ preset }, seed);
      const { positions } = tree.levels[1].parts[FOLIAGE_PART].geometry;
      let reach = 0;
      for (let index = 0; index < positions.length; index += 3) reach = Math.max(reach, Math.hypot(positions[index], positions[index + 2]));
      const innerShare = level => {
        const cards = cardsOf(tree, level);
        return cards.filter(card => Math.hypot(card.centre[0], card.centre[2]) < reach * 0.3).length / cards.length;
      };
      for (const level of [2, 3]) {
        assert.ok(innerShare(level) >= innerShare(1), `${preset} seed ${seed} level ${level} leaves the crown centre bare`);
      }
    }
  }
});

// One tree's mean slope moves by about 0.05 with the seed, because a far level has a tenth of the cards, so the limit holds for the mean of
// several seeds, which is what a forest of that species shows.
test('far cards droop like level 1 on average over eight seeds, and a far palm keeps fine fronds', () => {
  const SLOPE_TOLERANCE = 0.05;
  const PALM_LENGTH_FACTOR = 1.5;
  const SLOPE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const preset of ['oak', 'ash', 'aspen', 'birch', 'palm']) {
    const differences = { 2: 0, 3: 0 };
    for (const seed of SLOPE_SEEDS) {
      const tree = createTree({ preset }, seed);
      const nearSlope = meanOf(cardsOf(tree, 1), 'slope');
      for (const level of [2, 3]) differences[level] += (meanOf(cardsOf(tree, level), 'slope') - nearSlope) / SLOPE_SEEDS.length;
    }
    for (const level of [2, 3]) {
      assert.ok(Math.abs(differences[level]) <= SLOPE_TOLERANCE, `${preset} level ${level} cards point ${differences[level].toFixed(3)} off level 1 on average`);
    }
  }
  const palm = createTree({ preset: 'palm' }, 4);
  const lengthFactor = meanOf(cardsOf(palm, 3), 'length') / meanOf(cardsOf(palm, 1), 'length');
  assert.ok(lengthFactor <= PALM_LENGTH_FACTOR, `a level 3 frond is ${lengthFactor.toFixed(2)} times as long as at level 1`);
});

test('a twig-crown tree keeps its fanned pair at far levels, two cards to a site, so none stands edge-on', () => {
  for (const preset of ['oak', 'birch', 'ash']) {
    const tree = createTree({ preset }, 4);
    for (const level of [2, 3]) {
      const cards = cardsOf(tree, level);
      assert.equal(cards.length % 2, 0, `${preset} level ${level} has an odd number of cards`);
      for (let index = 0; index < cards.length; index += 2) {
        const gap = Math.hypot(...cards[index].base.map((value, axis) => value - cards[index + 1].base[axis]));
        assert.ok(gap < 1e-6, `${preset} level ${level} card ${index} is not paired with the next`);
      }
    }
  }
});
