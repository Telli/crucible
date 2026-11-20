import test from 'node:test';
import assert from 'node:assert/strict';
import { closedRoomShare, partMatrixLookup, worldTriangles } from '../src/closed-room.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const triangle = (firstCorner, secondCorner, thirdCorner) => ({ positions: new Float32Array([...firstCorner, ...secondCorner, ...thirdCorner]), indices: new Uint32Array([0, 1, 2]) });
const facingCentre = () => [
  { name: 'near', matrix: IDENTITY, geometry: triangle([-9, -9, -5], [9, -9, -5], [0, 9, -5]) },
  { name: 'far', matrix: IDENTITY, geometry: triangle([-9, -9, 5], [0, 9, 5], [9, -9, 5]) },
];

test('a missing world matrix names the part and the lookup to pass', () => {
  const parts = facingCentre();
  assert.throws(() => worldTriangles(parts, new Map([['near', IDENTITY]])), /No world matrix for part "far"; pass partMatrixLookup\(parts\)/);
});

test('a complete lookup returns the same share whether it is keyed by part or by name', () => {
  const parts = facingCentre();
  assert.equal(closedRoomShare(parts, new Map(parts.map(part => [part.name, IDENTITY]))), 0.375);
  assert.equal(closedRoomShare(parts, partMatrixLookup(parts)), 0.375);
});
