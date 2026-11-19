import test from 'node:test';
import assert from 'node:assert/strict';
import { castsShadow } from '../src/renderer.js';

const partWith = (material, flags = {}) => ({ material, ...flags });

test('a water sheet does not cast a sun shadow by default, so it cannot draw dark blocks on itself (#2035)', () => {
  assert.equal(castsShadow(partWith({ tag: 'water' })), false);
  assert.equal(castsShadow(partWith({ tag: 'water', alphaMode: 'blend', opacity: 0.4 })), false);
});

test('castShadow true still makes a water sheet cast', () => {
  assert.equal(castsShadow(partWith({ tag: 'water' }, { castShadow: true })), true);
});

test('other materials keep casting by default', () => {
  assert.equal(castsShadow(partWith({ tag: 'surface' })), true);
  assert.equal(castsShadow(partWith({})), true);
  assert.equal(castsShadow(partWith({ tag: 'foliage' })), true);
});
