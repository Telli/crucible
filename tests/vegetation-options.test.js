import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowerPatch, createGrassClump, scatterVegetation } from '../src/vegetation.js';

const AREA = { minX: 0, maxX: 20, minZ: 0, maxZ: 20 };

function scatter(options) {
  return () => scatterVegetation({ area: AREA, mix: { grass: 1 }, density: 0.5, ...options });
}

test('scatter variants must be a whole number of at least 1', () => {
  for (const variants of [0, NaN, 1.5, -2, 1000]) {
    assert.throws(scatter({ variants }), /Scatter variants must be a whole number from 1 to 16/, `variants ${variants}`);
  }
});

test('scatter mix needs finite weights and one positive weight', () => {
  assert.throws(scatter({ mix: { grass: 0 } }), /needs a positive weight/);
  assert.throws(scatter({ mix: {} }), /needs a positive weight/);
  assert.throws(scatter({ mix: { grass: NaN } }), /needs a positive weight/);
  assert.throws(scatter({ mix: { grass: -1 } }), /needs a positive weight/);
});

test('scatter spacing and density that would exhaust memory fail with what to pass', () => {
  for (const spacing of [0, -1, NaN, Infinity]) {
    assert.throws(scatter({ spacing }), /Scatter spacing must be from/, `spacing ${spacing}`);
  }
  assert.throws(scatter({ density: Infinity }), /Scatter density must be from/);
  assert.throws(scatter({ density: NaN }), /Scatter density must be from/);
  assert.throws(scatter({ spacing: 1e-4 }), /Scatter grid cells must be from 0 to 16000000/);
});

test('scatter scale must be positive', () => {
  assert.throws(scatter({ scale: [-1, 1] }), /Scatter scale minimum must be from 0.001/);
});

test('valid scatter options still place instances', () => {
  const result = scatter({ variants: 2, spacing: 2, scale: [0.5, 1.5], seed: 3 })();
  assert.ok(result.instances.length > 10);
  assert.ok(result.instances.every(instance => instance.scale >= 0.5 && instance.scale <= 1.5));
});

test('grass clump and flower patch counts and heights are bounded', () => {
  for (const blades of [0, -3, NaN, 2.5, 1e9]) {
    assert.throws(() => createGrassClump({ blades }), /Grass blade count must be a whole number from 1 to 2048/, `blades ${blades}`);
  }
  assert.throws(() => createGrassClump({ height: NaN }), /Grass blade height must be from/);
  for (const flowers of [0, -3, NaN, 1e9]) {
    assert.throws(() => createFlowerPatch({ flowers }), /Flower count must be a whole number from 1 to 256/, `flowers ${flowers}`);
  }
  assert.throws(() => createFlowerPatch({ height: 0 }), /Flower height must be from/);
  assert.ok(createGrassClump({ blades: 3 }).bounds.maximum.every(Number.isFinite));
});

test('scatter scale maximum must be finite and at least the minimum', () => {
  for (const scale of [[1, Infinity], [1, NaN], [2, 1]]) {
    assert.throws(scatter({ scale }), /Scatter scale maximum must be from/, `scale ${scale}`);
  }
});

test('scatter mix refuses an infinite weight and names the species', () => {
  assert.throws(scatter({ mix: { grass: Infinity, bush: 1 } }), /Scatter mix weight for grass must be finite/);
});

test('tree height must be from 0.01 to 1000 meters', async () => {
  const { createTree } = await import('../src/vegetation.js');
  for (const height of [NaN, 0, -3, Infinity, 1e6, 'tall']) {
    assert.throws(() => createTree({ species: 'broadleaf', height }), /Tree height must be from 0.01 to 1000/, `height ${height}`);
  }
  assert.ok(createTree({ species: 'bush', height: 1000 }).bounds.maximum.every(Number.isFinite));
  assert.ok(createTree('broadleaf', 3).bounds.maximum.every(Number.isFinite));
});

test('grass blade radius must be finite and from 0 to 100', () => {
  for (const radius of [NaN, -1, Infinity, '0.1']) {
    assert.throws(() => createGrassClump({ radius }), /Grass blade radius must be from 0 to 100/, `radius ${radius}`);
  }
  assert.ok(createGrassClump({ radius: 0 }).bounds.maximum.every(Number.isFinite));
});

test('scatter, grass and flower seeds must be finite numbers', () => {
  for (const seed of [NaN, Infinity, 'x']) {
    assert.throws(scatter({ seed }), /scatterVegetation seed must be a finite number/, `scatter ${seed}`);
    assert.throws(() => createGrassClump({ seed }), /createGrassClump seed must be a finite number/, `grass ${seed}`);
    assert.throws(() => createFlowerPatch({ seed }), /createFlowerPatch seed must be a finite number/, `flower ${seed}`);
  }
  assert.equal(scatter({ seed: -4.5 })().instances.length > 0, true);
});
