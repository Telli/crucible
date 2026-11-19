import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRadianceHdr } from '../src/hdri.js';

function flatHdr(width, height, rgbe) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'latin1');
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) Buffer.from(rgbe).copy(pixels, index * 4);
  return Buffer.concat([header, pixels]);
}

test('a block average keeps the sky colour', async () => {
  const { downsampleHdr } = await import('../scripts/downsample-hdr.mjs');
  const result = parseRadianceHdr(downsampleHdr(flatHdr(8, 4, [128, 64, 32, 129]), 4, 2));
  assert.equal(result.width, 4);
  assert.equal(result.height, 2);
  assert.ok(Math.abs(result.data[0] - 1) < 0.02);
  assert.ok(Math.abs(result.data[1] - 0.5) < 0.02);
});

test('a target larger than the source or not a whole number is refused', async () => {
  const { downsampleHdr } = await import('../scripts/downsample-hdr.mjs');
  const source = flatHdr(8, 4, [128, 64, 32, 129]);
  assert.throws(() => downsampleHdr(source, 16, 4), /width was 16; pass a whole number from 1 to 8/);
  assert.throws(() => downsampleHdr(source, 4, 8), /height was 8; pass a whole number from 1 to 4/);
  assert.throws(() => downsampleHdr(source, 2.5, 2), /width was 2.5/);
  assert.throws(() => downsampleHdr(source, 4, 0), /height was 0/);
});
