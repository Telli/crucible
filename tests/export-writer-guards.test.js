import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCompressedImage } from '../src/compressed-texture.js';
import { createGlbWriter } from '../src/export-writer.js';
import { encodePng } from '../src/export-png.js';

const BC7 = 0x8e8c;

function bc7Level(size) {
  return { width: size, height: size, data: new Uint8Array(Math.ceil(size / 4) ** 2 * 16) };
}

test('a null mip level in a compressed chain names the field and level', () => {
  const levels = [bc7Level(4), bc7Level(2), null];
  assert.throws(() => describeCompressedImage(BC7, levels, 'baseColorTexture', 'srgb'), /baseColorTexture bc7 mip level 2 is missing/);
});

test('encodePng refuses a size that is not a whole number of at least 1', () => {
  for (const [width, height] of [[0, 4], [4, 0], [2.5, 2], [-2, 2], [NaN, 2]]) {
    assert.throws(() => encodePng(new Uint8Array(256), width, height), RangeError, `${width}x${height}`);
  }
});

test('encodePng refuses pixels shorter than the size needs', () => {
  assert.throws(() => encodePng(new Uint8Array(4), 4, 4), /64 pixel values/);
  assert.equal(encodePng(new Uint8Array(16), 2, 2).length > 0, true);
});

test('GLB accessors refuse non-finite data and ragged lengths', () => {
  const writer = createGlbWriter();
  assert.throws(() => writer.addAccessor(new Float32Array([0, NaN, 1]), 'VEC3'), /must be finite/);
  assert.throws(() => writer.addAccessor(new Float32Array([0, Infinity, 1]), 'VEC3'), /must be finite/);
  assert.throws(() => writer.addAccessor(new Float32Array(4), 'VEC3'), /multiple of 3/);
});

test('an empty GLB accessor has no null bounds', () => {
  const writer = createGlbWriter();
  const index = writer.addAccessor(new Float32Array(0), 'VEC3');
  const entry = writer.document.accessors[index];
  assert.equal('min' in entry, false);
  assert.equal('max' in entry, false);
  assert.doesNotMatch(JSON.stringify(writer.document), /null/);
});
