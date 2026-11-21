import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccessorReader } from '../src/gltf-accessors.js';

const BYTE = 5121;
const SHORT = 5123;

function readMatrices({ type, componentType, bytes, count }) {
  const document = {
    bufferViews: [{ buffer: 0, byteLength: bytes.length }],
    accessors: [{ bufferView: 0, componentType, type, count }],
  };
  return createAccessorReader(document, () => bytes).readAccessor(0);
}

test('MAT2 of unsigned bytes pads each column to 4 bytes and reads the two matrices unpadded', () => {
  const bytes = Uint8Array.from([1, 2, 0, 0, 3, 4, 0, 0, 5, 6, 0, 0, 7, 8, 0, 0]);
  const attribute = readMatrices({ type: 'MAT2', componentType: BYTE, bytes, count: 2 });
  assert.deepEqual([...attribute.array], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('MAT3 of unsigned bytes pads each column to 4 bytes', () => {
  const bytes = Uint8Array.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0]);
  const attribute = readMatrices({ type: 'MAT3', componentType: BYTE, bytes, count: 1 });
  assert.deepEqual([...attribute.array], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('MAT3 of unsigned shorts pads each 6 byte column to 8 bytes and reads two matrices', () => {
  const padded = new Uint16Array([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 11, 12, 13, 0, 14, 15, 16, 0, 17, 18, 19, 0]);
  const bytes = new Uint8Array(padded.buffer);
  const attribute = readMatrices({ type: 'MAT3', componentType: SHORT, bytes, count: 2 });
  assert.deepEqual([...attribute.array], [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
});

test('MAT2 of shorts and MAT4 of bytes already fill their columns and read as stored', () => {
  const shorts = new Uint8Array(new Uint16Array([1, 2, 3, 4]).buffer);
  assert.deepEqual([...readMatrices({ type: 'MAT2', componentType: SHORT, bytes: shorts, count: 1 }).array], [1, 2, 3, 4]);
  const bytes = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  assert.deepEqual([...readMatrices({ type: 'MAT4', componentType: BYTE, bytes, count: 1 }).array], [...bytes]);
});

test('a padded MAT3 accessor that needs more bytes than its view holds fails by name', () => {
  const unpaddedBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.throws(() => readMatrices({ type: 'MAT3', componentType: BYTE, bytes: unpaddedBytes, count: 1 }), /exceeds its buffer view/);
});
