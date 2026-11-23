import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTree, resolveTreePreset } from '../src/vegetation.js';
import { createLeafPixels } from '../src/vegetation-textures.js';
import { measureTreeLevels } from '../scripts/tree-proof-lib.mjs';

const OPAQUE_ALPHA = 128;
// Real leaf of an oak or birch, in centimeters, and the factor a painted leaf may exceed it by (#3041).
const LONGEST_REAL_LEAF_CENTIMETERS = 12;
const LEAF_LENGTH_FACTOR = 2;

function opaqueShare(pixels) {
  let opaque = 0;
  for (let offset = 3; offset < pixels.data.length; offset += 4) {
    if (pixels.data[offset] >= OPAQUE_ALPHA) opaque++;
  }
  return opaque / (pixels.width * pixels.height);
}

function geometryHash(tree) {
  const hash = createHash('sha256');
  for (const level of tree.levels) {
    for (const part of level.parts) {
      const { positions } = part.geometry;
      hash.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

test('the twig card is 256 px and mostly leaf where the sprig card was a fifth leaf', () => {
  const twig = createLeafPixels('twig', [64, 110, 36], 1);
  assert.equal(twig.width, 256);
  assert.equal(twig.height, 256);
  assert.ok(opaqueShare(twig) >= 0.6, `the twig card is ${opaqueShare(twig).toFixed(2)} opaque; paint more leaves`);
  assert.ok(opaqueShare(createLeafPixels('sprig', [64, 110, 36], 1)) < 0.35);
  // Compare the bytes in one step: a failing deepEqual on 256 KB of pixels prints a diff that can take gigabytes.
  assert.ok(Buffer.from(createLeafPixels('twig', [64, 110, 36], 1).data).equals(Buffer.from(twig.data)), 'the twig painter is deterministic');
});

test('broad-leaved tree presets carry twig cards and crown placement, plain species keep sprig cards', () => {
  for (const preset of ['oak', 'ash', 'aspen', 'birch']) {
    const { preset: grown } = resolveTreePreset({ preset });
    assert.equal(grown.leaf.texture, 'twig', preset);
    assert.equal(grown.leaf.placement.depth, 2, preset);
  }
  for (const species of ['broadleaf', 'birch', 'bush']) {
    const { preset: grown } = resolveTreePreset({ species });
    assert.equal(grown.leaf.texture, 'sprig', species);
    assert.equal(grown.leaf.placement, undefined, species);
  }
});

test('plain species grow the same geometry as before twig cards', () => {
  assert.deepEqual(['broadleaf', 'birch', 'bush'].map(species => geometryHash(createTree(species, 4))), ['8d529c72e840', '6da290072153', '505a750a3783']);
});

test('mesh leaves of the presets grow the same geometry as before twig cards', () => {
  assert.equal(geometryHash(createTree({ preset: 'oak', leaves: 'mesh' }, 4)), '17a157e4cc5b');
  assert.equal(geometryHash(createTree({ preset: 'birch', leaves: 'mesh' }, 4)), '0d0f4977de74');
});

for (const preset of ['oak', 'birch']) {
  test(`${preset}: dense crown inside the triangle budget, real leaf size, steady across the level switch`, () => {
    const [near, middle] = measureTreeLevels({ preset, frameSize: 64 });
    assert.ok(near.solidity >= 0.8, `${preset} level 0 solidity ${near.solidity.toFixed(2)}`);
    assert.ok(near.foliageTriangles <= 10000, `${preset} level 0 has ${near.foliageTriangles} foliage triangles`);
    assert.ok(Math.abs(near.solidity - middle.solidity) <= 0.1, `solidity moves ${near.solidity.toFixed(2)} to ${middle.solidity.toFixed(2)} across the level 0 to 1 switch`);
    for (const row of [near, middle]) {
      const longest = row.leafCentimeters[1];
      assert.ok(longest <= LONGEST_REAL_LEAF_CENTIMETERS * LEAF_LENGTH_FACTOR, `${preset} level ${row.level} paints ${longest.toFixed(0)} cm leaves`);
    }
  });
}

test('crown placement keeps more leaf sites toward the outside of the crown than the inside', () => {
  const tree = createTree({ preset: 'oak' }, 4);
  const positions = tree.levels[0].parts.find(part => part.role === 'foliage').geometry.positions;
  const cardCenters = [];
  for (let index = 0; index < positions.length; index += 12) {
    cardCenters.push([positions[index], positions[index + 1], positions[index + 2]]);
  }
  const center = [0, 1, 2].map(axis => cardCenters.reduce((sum, point) => sum + point[axis], 0) / cardCenters.length);
  const distances = cardCenters.map(point => Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2])).sort((first, second) => first - second);
  const median = distances[Math.floor(distances.length / 2)];
  const outerHalf = distances.filter(distance => distance >= median).reduce((sum, distance) => sum + distance, 0) / (distances.length / 2);
  assert.ok(outerHalf > median * 1.15, `the outer half of the cards sits at ${outerHalf.toFixed(2)} m against a median of ${median.toFixed(2)} m`);
});
