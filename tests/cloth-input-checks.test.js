import test from 'node:test';
import assert from 'node:assert/strict';
import { bakeCloth, createCloth } from '../src/cloth.js';

function smallSheet() {
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]);
  const triangles = Uint32Array.from([0, 2, 1, 1, 2, 3]);
  return { positions, triangles };
}

test('createCloth refuses out-of-range numeric options and names the option', () => {
  const { positions, triangles } = smallSheet();
  const bad = [
    ['damping', -50], ['damping', Number.NaN], ['friction', Number.NaN], ['friction', 2], ['thickness', Number.NaN], ['thickness', -1],
    ['stiffness', Number.NaN], ['stiffness', 2], ['bend', -1], ['density', -1],
  ];
  for (const [option, value] of bad) {
    assert.throws(() => createCloth(positions, triangles, { [option]: value }), new RegExp(`Cloth ${option} must be`), `${option} ${value}`);
  }
});

test('createCloth still takes the recipe ranges', () => {
  const { positions, triangles } = smallSheet();
  const options = { damping: 100, friction: 1, thickness: 0.5, stiffness: 1, bend: 0, density: 10 };
  assert.doesNotThrow(() => bakeCloth(positions, triangles, { ...options, frameCount: 3 }));
});

test('createCloth names a triangle index that is not a particle instead of blaming the wind', () => {
  const { positions } = smallSheet();
  assert.throws(() => createCloth(positions, Uint32Array.from([0, 1, 999])), /triangle 0 uses particle 999; the sheet has 4/);
  assert.throws(() => createCloth(positions, Uint32Array.from([0, 1, 2, 3])), /3 indices each/);
});
