// scripts/compare-volume-render.mjs (#1735): the numbers it prints for two small pictures, and that it reports a problem as JSON with exit 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePng } from '../src/export-png.js';

function picture(width, height, valueAt) {
  const pixels = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    const value = valueAt(pixel % width, Math.floor(pixel / width));
    pixels.set([value, value, value, 255], pixel * 4);
  }
  return encodePng(pixels, width, height);
}

function compare(...args) {
  const run = spawnSync(process.execPath, ['scripts/compare-volume-render.mjs', ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('identical pictures score zero, and a change inside the volume shows in the inside luminance only', () => {
  const folder = mkdtempSync(join(tmpdir(), 'compare-volume-'));
  try {
    const left = column => (column < 4 ? 200 : 0); // the volume is the left half
    writeFileSync(join(folder, 'reference.png'), picture(8, 4, left));
    writeFileSync(join(folder, 'same.png'), picture(8, 4, left));
    writeFileSync(join(folder, 'dimmer.png'), picture(8, 4, column => (column < 4 ? 100 : 0)));
    writeFileSync(join(folder, 'wrong-size.png'), picture(4, 4, left));
    const same = compare(join(folder, 'reference.png'), join(folder, 'same.png'));
    assert.equal(same.rmse, 0);
    assert.equal(same.maskShare, 0.5);
    const dimmer = compare(join(folder, 'reference.png'), join(folder, 'dimmer.png'));
    assert.ok(dimmer.rmse > 0 && dimmer.relativeRmse > 0.5 && dimmer.relativeRmse < 1);
    assert.ok(dimmer.meanAbsoluteLuminanceDifference.inside > 0.3);
    assert.equal(dimmer.meanAbsoluteLuminanceDifference.outside, 0);
    assert.match(compare(join(folder, 'reference.png'), join(folder, 'wrong-size.png')).error, /differ in size/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('a candidate in linear float output (.f32, rows bottom to top) is compared as it is, values above 1 included (#1749)', () => {
  const folder = mkdtempSync(join(tmpdir(), 'compare-volume-linear-'));
  try {
    const width = 8;
    const height = 4;
    const referenceLinear = ((200 / 255 + 0.055) / 1.055) ** 2.4;
    // The reference lights its top picture row, which is the last row of a float frame.
    writeFileSync(join(folder, 'reference.png'), picture(width, height, (column, row) => (row === 0 ? 200 : 0)));
    const topRowFrame = brightness => {
      const floats = new Float32Array(width * height * 4);
      for (let column = 0; column < width; column++) floats.set([brightness, brightness, brightness, 1], ((height - 1) * width + column) * 4);
      return Buffer.from(floats.buffer);
    };
    writeFileSync(join(folder, 'same.f32'), topRowFrame(referenceLinear));
    writeFileSync(join(folder, 'bright.f32'), topRowFrame(3));
    writeFileSync(join(folder, 'short.f32'), Buffer.alloc(16));
    assert.ok(compare(join(folder, 'reference.png'), join(folder, 'same.f32')).rmse < 1e-6, 'the float frame is flipped to picture order');
    const bright = compare(join(folder, 'reference.png'), join(folder, 'bright.f32'));
    assert.ok(bright.meanAbsoluteLuminanceDifference.inside > 2, 'a value of 3 against a reference of 0.58 differs by about 2.4 inside the lit row');
    assert.equal(bright.meanAbsoluteLuminanceDifference.outside, 0);
    assert.match(compare(join(folder, 'reference.png'), join(folder, 'short.f32')).error, /float32 RGBA frame is 512/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
