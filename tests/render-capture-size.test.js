import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { assertCapturedPngSize, captureClip, readPngSize } from '../scripts/render-capture-size.mjs';

function pngOfSize(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  const chunk = (type, data) => Buffer.concat([Buffer.alloc(4), Buffer.from(type), data, Buffer.alloc(4)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(1)))]);
}

test('a whole-frame capture clips to the requested size from the origin', () => {
  assert.deepEqual(captureClip({ region: undefined, width: 1920, height: 1200 }), { x: 0, y: 0, width: 1920, height: 1200, scale: 1 });
});

test('a region capture clips to the region', () => {
  const region = { x: 10, y: 20, width: 64, height: 48 };
  assert.deepEqual(captureClip({ region, width: 1920, height: 1200 }), { ...region, scale: 1 });
});

test('readPngSize reads the header and rejects other bytes', () => {
  assert.deepEqual(readPngSize(pngOfSize(1920, 1200)), { width: 1920, height: 1200 });
  assert.throws(() => readPngSize(Buffer.from('not a png at all, just text bytes')), /not a PNG/);
});

test('a PNG of the requested size passes the guard', () => {
  assert.doesNotThrow(() => assertCapturedPngSize({ bytes: pngOfSize(1920, 1200), width: 1920, height: 1200 }));
});

test('a PNG 87 rows short fails and names both sizes', () => {
  assert.throws(() => assertCapturedPngSize({ bytes: pngOfSize(1920, 1113), width: 1920, height: 1200 }), /1920x1113.*1920x1200/s);
});
