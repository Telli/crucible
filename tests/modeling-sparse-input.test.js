import assert from 'node:assert/strict';
import test from 'node:test';
import { curve, extrude, tube } from '../src/modeling.js';

const path = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];

test('curve names a hole in taper, points, handles and profile instead of failing later', () => {
  assert.throws(() => curve(path, { taper: [1, , 1] }), /taper must be a finite float/);
  assert.throws(() => curve([[0, 0, 0], [1, , 0], [2, 0, 0]]), /point must be a finite float/);
  assert.throws(() => curve([{ position: [0, 0, 0], handleOut: [1, , 0] }, { position: [1, 0, 0] }]), /handleOut must be a finite float/);
  assert.throws(() => curve(path, { profile: [[0, 0], , [1, 0], [0, 1]] }), /profile points need 2 components/);
});

test('a hole in a point list is refused by tube and extrude', () => {
  assert.throws(() => tube([[0, 0, 0], , [1, 0, 0]]), /path points need 3 components/);
  assert.throws(() => extrude([[0, 0], [1, 0], , [0, 1]]), /contour points need 2 components/);
});
