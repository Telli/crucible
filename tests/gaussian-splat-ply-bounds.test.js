import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGaussianSplatPly, parseGaussianSplatPlyAsync } from '../src/gaussian-splat-ply.js';

const PROPERTY_NAMES = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
const IDENTITY_VALUES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];

// One splat per row of 14 values, written as 64 bit doubles so a value can pass the finite check and still overflow float32.
function buildDoublePly(rows, headerComment = '') {
  const commentLines = headerComment ? [headerComment] : [];
  const header = ['ply', 'format binary_little_endian 1.0', ...commentLines, `element vertex ${rows.length}`, ...PROPERTY_NAMES.map(name => `property double ${name}`), 'end_header', ''].join('\n');
  const headerBytes = new TextEncoder().encode(header);
  const file = new Uint8Array(headerBytes.length + rows.length * PROPERTY_NAMES.length * 8);
  file.set(headerBytes, 0);
  const view = new DataView(file.buffer);
  rows.forEach((row, rowIndex) => {
    row.forEach((value, column) => view.setFloat64(headerBytes.length + (rowIndex * PROPERTY_NAMES.length + column) * 8, value, true));
  });
  return file;
}

function rowAt(x, y, z) {
  return [x, y, z, ...IDENTITY_VALUES.slice(3)];
}

test('a position past the float32 range is dropped and named, not loaded as infinity', async () => {
  const file = buildDoublePly([rowAt(1, 2, 3), rowAt(1e300, 0, 0), rowAt(0, -1e300, 0), rowAt(4, 5, 6)]);
  for (const data of [parseGaussianSplatPly(file), await parseGaussianSplatPlyAsync(file)]) {
    assert.equal(data.count, 2);
    assert.deepEqual(Array.from(data.positions), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(data.bounds, { minimum: [1, 2, 3], maximum: [4, 5, 6] });
    assert.deepEqual(data.skipped, { count: 2, fields: ['x', 'y'] });
  }
});

test('a PLY whose only position overflows float32 throws and names the field', () => {
  assert.throws(() => parseGaussianSplatPly(buildDoublePly([rowAt(0, 0, 1e300)])), /no usable splat.*z/);
});

test('a PLY header longer than 64 KiB names the header limit instead of calling the file not a PLY', () => {
  const file = buildDoublePly([rowAt(0, 0, 0)], `comment ${'a'.repeat(70_000)}`);
  assert.throws(() => parseGaussianSplatPly(file), /header is longer than 65536 bytes/);
});

test('a file that is not a PLY still says so, even when it is large', () => {
  assert.throws(() => parseGaussianSplatPly(new Uint8Array(100_000).fill(65)), /Not a PLY file/);
});
