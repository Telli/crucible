import test from 'node:test';
import assert from 'node:assert/strict';
import { TREE_PRESETS } from '../src/vegetation-presets.js';
import { LEVEL_SETTINGS, TREE_LEVEL_DISTANCES } from '../src/vegetation-species.js';
import {
  PRESET_NAMES, fieldOfViewForHeightFraction, formatProofTable, horizonCells, levelCameraEye, levelProbes, measureTreeLevels,
  paintedLeafLengthCentimeters, solidityFromMask,
} from '../scripts/tree-proof-lib.mjs';

test('the proof covers the seven presets the library ships', () => {
  assert.deepEqual(PRESET_NAMES, Object.keys(TREE_PRESETS));
  assert.deepEqual([...PRESET_NAMES].sort(), ['ash', 'aspen', 'birch', 'bush', 'oak', 'palm', 'pine']);
});

test('level probes sit just inside and just outside every switch distance', () => {
  const probes = levelProbes(TREE_LEVEL_DISTANCES, 0.05);
  assert.equal(probes.length, TREE_LEVEL_DISTANCES.length * 2);
  assert.deepEqual(probes.map(probe => probe.level), [0, 1, 1, 2, 2, 3]);
  assert.deepEqual(probes.map(probe => probe.side), ['below', 'above', 'below', 'above', 'below', 'above']);
  assert.ok(Math.abs(probes[0].distance - 36.1) < 1e-9);
  assert.ok(Math.abs(probes[1].distance - 39.9) < 1e-9);
  for (let index = 1; index < probes.length; index++) assert.ok(probes[index].distance > probes[index - 1].distance);
  assert.equal(probes.at(-1).level, LEVEL_SETTINGS.length - 1);
  assert.throws(() => levelProbes([95, 38]), /increasing distances/);
  assert.throws(() => levelProbes([38], 1.5), /fraction between 0 and 1/);
});

test('solidity is the opaque share of the row span of the crown', () => {
  // Row 0: ##.# is 3 opaque in a span of 4. Row 1 is empty and adds nothing. Row 2: .#.. is 1 in a span of 1.
  const mask = Uint8Array.from([1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
  assert.deepEqual(solidityFromMask(mask, 4, 3), { opaque: 4, silhouette: 5, solidity: 0.8 });
  assert.equal(solidityFromMask(new Uint8Array(6), 3, 2).solidity, 0);
  assert.equal(solidityFromMask(new Uint8Array(4).fill(1), 2, 2).solidity, 1);
  assert.throws(() => solidityFromMask(new Uint8Array(5), 2, 3), /pass width \* height = 6/);
});

test('the horizon cells are the baked views that rise less than about 14 degrees', () => {
  const cells = horizonCells();
  assert.ok(cells.length > 8 && cells.length < 64);
  assert.equal(horizonCells(2).length, 64);
  assert.equal(horizonCells(0).length, 0);
});

test('painted leaf length follows the card height, the texture and the level scale', () => {
  const [shortest, longest] = paintedLeafLengthCentimeters({ texture: 'sprig', cardHeightMeters: 1.1, leafScale: 1 });
  assert.ok(Math.abs(shortest - 18.9) < 0.1 && Math.abs(longest - 34.4) < 0.1);
  const [scaledShortest] = paintedLeafLengthCentimeters({ texture: 'sprig', cardHeightMeters: 1.1, leafScale: 1.7 });
  assert.ok(Math.abs(scaledShortest / shortest - 1.7) < 1e-9);
  assert.throws(() => paintedLeafLengthCentimeters({ texture: 'moss', cardHeightMeters: 1 }), /texture must be one of/);
  assert.throws(() => paintedLeafLengthCentimeters({ texture: 'sprig', cardHeightMeters: 0 }), /positive number of meters/);
});

test('the field of view makes the tree fill the share of the picture that the photo shows', () => {
  const fov = fieldOfViewForHeightFraction({ treeHeight: 10, distance: 20, heightFraction: 0.5 });
  const visibleHeight = 2 * 20 * Math.tan(fov * Math.PI / 360);
  assert.ok(Math.abs(visibleHeight - 20) < 1e-9);
  assert.throws(() => fieldOfViewForHeightFraction({ treeHeight: 10, distance: 20, heightFraction: 1.2 }), /at most 1/);
});

test('the level camera stands exactly the probe distance from the tree base', () => {
  const eye = levelCameraEye({ treeHeight: 12, distance: 38 });
  assert.equal(eye[1], 6);
  assert.ok(Math.abs(Math.hypot(eye[0], eye[1], eye[2]) - 38) < 1e-9);
  assert.throws(() => levelCameraEye({ treeHeight: 12, distance: 5 }), /above half the tree height/);
});

test('an oak measures four levels with the triangles of its geometry and a solidity between 0 and 1', () => {
  const rows = measureTreeLevels({ preset: 'oak', seed: 4, frameSize: 32 });
  assert.equal(rows.length, LEVEL_SETTINGS.length);
  assert.deepEqual(rows.slice(0, 3).map(row => row.foliageTriangles), [4296, 1432, 156]);
  for (const row of rows) assert.ok(row.solidity > 0 && row.solidity <= 1);
  assert.equal(rows[2].leafCentimeters, null);
  const [shortest, longest] = rows[0].leafCentimeters;
  assert.ok(shortest > 15 && longest < 40);
  assert.ok(rows[1].leafCentimeters[0] > shortest * 1.6);
  const text = formatProofTable(rows);
  assert.match(text, /^preset\s+level\s+foliage tris\s+bark tris\s+solidity\s+leaf cm/);
  assert.equal(text.split('\n').length, rows.length + 1);
});
