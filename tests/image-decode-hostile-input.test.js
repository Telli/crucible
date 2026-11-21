import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { box } from '../src/geometry.js';
import { exportGlb } from '../src/export.js';
import { keyLightFromHdri, parseRadianceHdr } from '../src/hdri.js';

function hdrHeader(width, height) {
  return new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
}

test('parseRadianceHdr names what to pass when given something that is not bytes', () => {
  for (const input of ['#?RADIANCE', null, undefined, {}, 12, [35, 63]]) {
    assert.throws(() => parseRadianceHdr(input), /parseRadianceHdr needs an ArrayBuffer or Uint8Array/, String(input));
  }
});

test('parseRadianceHdr refuses a header that claims more pixels than the file can hold, before allocating them', () => {
  const oneRow = [128, 64, 0, 129, 1, 1, 1, 255, 1, 1, 1, 63];
  const file = Uint8Array.from([...hdrHeader(16384, 16384), ...oneRow]);
  assert.throws(() => parseRadianceHdr(file), /truncated: the header says 16384x16384 but the file holds 12 bytes/);
  assert.throws(() => parseRadianceHdr(file.buffer), /16384x16384/);
});

test('parseRadianceHdr still reads the smallest valid file', () => {
  const file = Uint8Array.from([...hdrHeader(1, 1), 128, 64, 0, 129]);
  assert.deepEqual(Array.from(parseRadianceHdr(file).data), [1, 0.5, 0]);
});

test('keyLightFromHdri says what bounds to pass instead of a raw TypeError', () => {
  const sunMap = { width: 4, height: 4, channels: 3, rotation: 0, intensity: 1, data: new Float32Array(48) };
  for (const bounds of [undefined, null, {}, { min: [0, 0, 0] }, { min: [0, 0], max: [1, 1, 1] }, { min: [0, 0, 0], max: [1, NaN, 1] }]) {
    assert.throws(() => keyLightFromHdri(sunMap, bounds), /keyLightFromHdri bounds must be \{ min, max \}/, JSON.stringify(bounds));
  }
});

test('GLB export refuses an oversized texture by its size before reading its pixels', () => {
  const part = { name: 'Plate', geometry: box(), matrix: mat4.create(), material: { color: [1, 1, 1], metallic: 0, roughness: 1 } };
  const uvs = new Float32Array(part.geometry.positions.length / 3 * 2);
  const image = { width: 100000, height: 100000, data: new Uint8Array(4) };
  const textured = { ...part, geometry: { ...part.geometry, uvs }, material: { ...part.material, map: { image } } };
  assert.throws(() => exportGlb([textured]), /100000x100000, above maxTextureSize 2048/);
});
