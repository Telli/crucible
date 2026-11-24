import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTree, resolveTreePreset } from '../src/vegetation.js';
import { createCoverageMips, createLeafPixels, SPRAY_KINDS } from '../src/vegetation-textures.js';
import { addLeafSurface, atlasCellRect } from '../src/vegetation-geometry.js';
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

function geometryHash(tree, levelCount = tree.levels.length) {
  const hash = createHash('sha256');
  for (const level of tree.levels.slice(0, levelCount)) {
    for (const part of level.parts) {
      const { positions } = part.geometry;
      hash.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
    }
  }
  return hash.digest('hex').slice(0, 12);
}

const SPRAY_COLOR = [64, 110, 36];
const ATLAS_SIZE = 256;
const CELL_SIZE = ATLAS_SIZE / 2;
const MAXIMUM_HULL_FILL = 0.75;
const MAXIMUM_MIP_DRIFT = 0.05;
const SMALLEST_MIP_SIZE = 16;
function cross(origin, first, second) {
  return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
}

function convexHullArea(points) {
  const sorted = [...points].sort((first, second) => first[0] - second[0] || first[1] - second[1]);
  const half = (ordered) => {
    const chain = [];
    for (const point of ordered) {
      while (chain.length > 1 && cross(chain[chain.length - 2], chain[chain.length - 1], point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  const hull = half(sorted).concat(half([...sorted].reverse()));
  let twiceArea = 0;
  hull.forEach((point, index) => {
    const next = hull[(index + 1) % hull.length];
    twiceArea += point[0] * next[1] - next[0] * point[1];
  });
  return Math.abs(twiceArea) / 2;
}

function sprayHullFill(pixels, cellIndex) {
  const left = (cellIndex % 2) * CELL_SIZE;
  const top = Math.floor(cellIndex / 2) * CELL_SIZE;
  const opaquePoints = [];
  for (let y = 0; y < CELL_SIZE; y++) {
    for (let x = 0; x < CELL_SIZE; x++) {
      if (pixels.data[((top + y) * ATLAS_SIZE + left + x) * 4 + 3] >= OPAQUE_ALPHA) opaquePoints.push([x, y]);
    }
  }
  return opaquePoints.length / convexHullArea(opaquePoints);
}

// Opaque share of the alpha plane at each mip level of the card's coverage-preserving chain, from the full size down to 16 px.
function opaqueShareByMip(pixels) {
  return createCoverageMips(pixels).filter(level => level.width >= SMALLEST_MIP_SIZE).map(level => {
    let opaque = 0;
    for (let offset = 3; offset < level.data.length; offset += 4) if (level.data[offset] >= OPAQUE_ALPHA) opaque++;
    return opaque / (level.width * level.height);
  });
}

for (const kind of SPRAY_KINDS) {
  test(`${kind}: a 256 px atlas of four open sprays that survive the mip chain, painted the same every time`, () => {
    for (const seed of [1, 2, 3]) {
      const atlas = createLeafPixels(kind, SPRAY_COLOR, seed);
      assert.equal(atlas.width, ATLAS_SIZE);
      assert.equal(atlas.height, ATLAS_SIZE);
      for (let cell = 0; cell < 4; cell++) {
        const fill = sprayHullFill(atlas, cell);
        assert.ok(fill <= MAXIMUM_HULL_FILL, `${kind} seed ${seed} spray ${cell} is ${fill.toFixed(2)} opaque inside its hull; leave more gaps`);
        assert.ok(fill > 0.1, `${kind} seed ${seed} spray ${cell} is nearly empty`);
      }
      const [full, ...smaller] = opaqueShareByMip(atlas);
      smaller.forEach((share, level) => {
        assert.ok(Math.abs(share - full) <= MAXIMUM_MIP_DRIFT, `${kind} seed ${seed} mip ${level + 1} is ${share.toFixed(3)} opaque against ${full.toFixed(3)}`);
      });
      // Compare the bytes in one step: a failing deepEqual on 256 KB of pixels prints a diff that can take gigabytes.
      assert.ok(Buffer.from(createLeafPixels(kind, SPRAY_COLOR, seed).data).equals(Buffer.from(atlas.data)), `${kind} painter is deterministic`);
    }
  });
}

test('the sprig card is still a fifth leaf, and addLeafSurface maps a variant cell of the atlas', () => {
  assert.ok(opaqueShare(createLeafPixels('sprig', SPRAY_COLOR, 1)) < 0.35);
  const vertices = [];
  const builder = { addVertex: (position, normal, u, v) => vertices.push([u, v]) - 1, addTriangle() {} };
  const surface = { origin: [0, 0, 0], frame: { forward: [0, 1, 0], right: [1, 0, 0], normal: [0, 0, 1] }, length: 1, width: 1, rows: [[0, 1], [1, 1]], canopyNormal: [0, 1, 0], backFaces: false };
  addLeafSurface(builder, surface);
  assert.deepEqual(vertices, [[0, 1], [1, 1], [0, 0], [1, 0]]);
  vertices.length = 0;
  addLeafSurface(builder, { ...surface, uvRect: atlasCellRect(1) });
  assert.deepEqual(vertices, [[0.5, 1], [1, 1], [0.5, 0.5], [1, 0.5]]);
  assert.deepEqual(atlasCellRect(2), { minU: 0, maxU: 0.5, minV: 0, maxV: 0.5 });
});

test('broad-leaved tree presets carry twig cards and crown placement, plain species keep sprig cards', () => {
  for (const preset of ['oak', 'ash', 'aspen', 'birch']) {
    const { preset: grown } = resolveTreePreset({ preset });
    assert.equal(grown.leaf.texture, 'twig', preset);
    assert.ok((grown.leaf.placement.twigs ?? grown.bareTwigs).length >= 1, `${preset} carries its leaves on twigs`);
    assert.equal(grown.leaf.placement.cardFan, undefined, preset);
  }
  for (const species of ['broadleaf', 'birch', 'bush']) {
    const { preset: grown } = resolveTreePreset({ species });
    assert.equal(grown.leaf.texture, 'sprig', species);
    assert.equal(grown.leaf.placement, undefined, species);
  }
});

test('plain species grow the same geometry as before twig cards', () => {
  // Levels 0 and 1 only: the far levels now keep the species' own leaf card (#3051). The bush keeps its clumps at every level.
  assert.deepEqual(['broadleaf', 'birch'].map(species => geometryHash(createTree(species, 4), 2)), ['6c932dbfcea7', 'd1b1b3c5dc22']);
  assert.equal(geometryHash(createTree('bush', 4)), '505a750a3783');
});

test('mesh leaves of the presets grow the same geometry as before twig cards', () => {
  assert.equal(geometryHash(createTree({ preset: 'oak', leaves: 'mesh' }, 4)), '64c95f794d68');
  assert.equal(geometryHash(createTree({ preset: 'birch', leaves: 'mesh' }, 4)), '03ae450f7a88');
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

function foliageTriangles(options, seed = 4) {
  const foliage = createTree(options, seed).levels[0].parts.find(part => part.role === 'foliage');
  return foliage.geometry.indices.length / 3;
}

test('tree.leafCount scales the twigs per parent and so the leaf cards of a crowned tree', () => {
  for (const preset of ['oak', 'birch']) {
    const sparse = foliageTriangles({ preset, tree: { leafCount: preset === 'birch' ? 0.5 : 1.5 } });
    const normal = foliageTriangles({ preset });
    const dense = foliageTriangles({ preset, tree: { leafCount: 10 } });
    // The birch preset is already near the one-twig floor, so it can only stay level with its default.
    assert.ok(preset === 'birch' ? sparse <= normal : sparse < normal * 0.6, `${preset}: a low leafCount gives ${sparse} triangles against ${normal}`);
    assert.ok(dense > normal * 2, `${preset}: leafCount 10 gives ${dense} triangles against ${normal}`);
  }
});

test('tree.leafStart moves where the twigs begin along their parent', () => {
  const early = createTree({ preset: 'oak', tree: { leafStart: 0.05 } }, 4).levels[0].parts.find(part => part.role === 'foliage').geometry.positions;
  const late = createTree({ preset: 'oak', tree: { leafStart: 0.9 } }, 4).levels[0].parts.find(part => part.role === 'foliage').geometry.positions;
  assert.ok(!Buffer.from(early.buffer, early.byteOffset, early.byteLength).equals(Buffer.from(late.buffer, late.byteOffset, late.byteLength)), 'leafStart changes the crown');
});

test('a crowned tree whose twigs would pass the leaf site limit stops before growing them', () => {
  assert.throws(
    () => createTree({ preset: 'oak', tree: { levels: 3, branches: [20, 8, 6], leafCount: 20 } }, 4),
    error => error instanceof RangeError && /at most 20000 leaf sites; lower tree.leafCount/.test(error.message),
  );
});

test('crowned oak and ash leaf twigs are the twigs their bare tree shows', () => {
  const oak = createTree({ preset: 'oak' }, 4);
  const bare = oak.bareParts(0).find(part => part.role === 'bark').geometry.positions.length;
  assert.ok(bare > oak.levels[0].parts.find(part => part.role === 'bark').geometry.positions.length, 'the bare tree adds its twigs to the bark');
});
