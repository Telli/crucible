import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrass } from '../src/grass.js';
import { createClutter } from '../src/clutter.js';

const area = { minX: 0, maxX: 8, minZ: 0, maxZ: 8 };

function allFinite(parts) {
  return parts.every(part => Array.from(part.geometry.positions).every(Number.isFinite));
}

test('grass refuses a clump size, clump strength or bend that would build NaN blades (#2460)', () => {
  assert.throws(() => createGrass({ area, clumpSize: 0 }), /createGrass: clumpSize was 0; pass a number/);
  assert.throws(() => createGrass({ area, clumpSize: -1 }), /clumpSize/);
  assert.throws(() => createGrass({ area, clumpStrength: NaN }), /clumpStrength must be between 0 and 1/);
  assert.throws(() => createGrass({ area, clumpStrength: 2 }), /clumpStrength/);
  assert.throws(() => createGrass({ area, bend: 3 }), /Grass bend must be \[minimum, maximum\]/);
  assert.throws(() => createGrass({ area, bend: [0.6, 0.2] }), /bend/);
  assert.ok(allFinite(createGrass({ area, density: 40 }).parts));
});

test('grass and clutter refuse infinite sizes (#2461)', () => {
  assert.throws(() => createGrass({ area, height: [0.2, Infinity] }), /Grass height must be finite/);
  assert.throws(() => createGrass({ area, width: Infinity }), /createGrass: width was Infinity/);
  assert.throws(() => createClutter({ area, rockSize: [0.1, Infinity], rocks: 1 }), /Clutter rockSize must be finite/);
  assert.throws(() => createClutter({ area, pebbleSize: [Infinity, Infinity] }), /pebbleSize/);
});

test('grass and clutter refuse an infinite tile size instead of building nothing (#2463)', () => {
  assert.throws(() => createGrass({ area, tileSize: Infinity }), /createGrass: tileSize was Infinity/);
  assert.throws(() => createClutter({ area, tileSize: Infinity }), /createClutter: tileSize was Infinity/);
});
