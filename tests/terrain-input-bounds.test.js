import test from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from '../src/terrain.js';
import { createHeightfieldGeometry, sampleRasterGrid } from '../src/heightfield.js';

const FLAT = () => 0;

test('createTerrain refuses a grid with too many cells per side before allocating it (#2348)', () => {
  assert.throws(
    () => createTerrain({ size: 100, resolution: 1_000_000, chunks: 1, levels: 1, height: FLAT }),
    /resolution.*chunks|cells per side/i,
  );
  assert.throws(
    () => createTerrain({ size: 100, resolution: 1024, chunks: 8, levels: 1, height: FLAT }),
    /cells per side/,
  );
});

test('createTerrain refuses a chunk count that would exhaust memory (#2348)', () => {
  assert.throws(() => createTerrain({ size: 100, resolution: 1, chunks: 3000, levels: 1, height: FLAT }), /chunks must be at most/);
});

test('createTerrain still builds a grid at the bound (#2348)', () => {
  const terrain = createTerrain({ size: 100, resolution: 16, chunks: 4, levels: 1, height: FLAT });
  assert.equal(terrain.parts.length, 16);
});

function raster(overrides = {}) {
  return { values: new Float32Array(16).fill(1), width: 4, height: 4, box: { x_min: 0, x_max: 4, y_min: 0, y_max: 4 }, ...overrides };
}

function sampleGrid(rasterValue, options = {}) {
  return sampleRasterGrid(rasterValue, { columns: 2, rows: 2, eastAt: column => 1 + column, northAt: row => 1 + row, ...options });
}

test('sampleRasterGrid names the field when values do not match width * height (#2349)', () => {
  assert.throws(() => sampleGrid(raster({ values: new Float32Array(4) })), /values.*16/);
});

test('sampleRasterGrid refuses a box with no extent or a non-finite edge (#2349)', () => {
  assert.throws(() => sampleGrid(raster({ box: { x_min: 1, x_max: 1, y_min: 0, y_max: 4 } })), /box/);
  assert.throws(() => sampleGrid(raster({ box: { x_min: 0, x_max: Number.NaN, y_min: 0, y_max: 4 } })), /box/);
});

test('sampleRasterGrid refuses sampling options that cannot give a mean (#2349)', () => {
  assert.throws(() => sampleGrid(raster(), { cellSize: 1, samplesPerSide: 0 }), /samplesPerSide/);
  assert.throws(() => sampleGrid(raster(), { cellSize: 1, samplesPerSide: 1.5 }), /samplesPerSide/);
  assert.throws(() => sampleGrid(raster(), { rows: 0 }), /rows/);
  assert.throws(() => sampleGrid(raster(), { columns: 2.5 }), /columns/);
  assert.throws(() => sampleGrid(raster(), { cellSize: -1, samplesPerSide: 2 }), /cellSize/);
});

test('sampleRasterGrid keeps a flat raster flat for whole sample counts (#2349)', () => {
  const output = sampleGrid(raster(), { cellSize: 1, samplesPerSide: 3 });
  for (const value of output) assert.ok(Math.abs(value - 1) < 1e-12);
});

test('createHeightfieldGeometry gives unit finite normals for one column or one row (#2350)', () => {
  const box = { x_min: 0, x_max: 1, y_min: 0, y_max: 1 };
  const column = createHeightfieldGeometry({ columns: 1, rows: 3, eastAt: () => 0, northAt: row => row, heights: [0, 1, 0], uvBox: box });
  const strip = createHeightfieldGeometry({ columns: 3, rows: 1, eastAt: columnIndex => columnIndex, northAt: () => 0, heights: [0, 1, 0], uvBox: box });
  for (const geometry of [column, strip]) {
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const length = Math.hypot(geometry.normals[vertex * 3], geometry.normals[vertex * 3 + 1], geometry.normals[vertex * 3 + 2]);
      assert.ok(Math.abs(length - 1) < 1e-6, `normal ${vertex} has length ${length}`);
    }
  }
});
