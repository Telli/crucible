import test from 'node:test';
import assert from 'node:assert/strict';
import { createBarkPixels, createLeafPixels } from '../src/vegetation-textures.js';
import { bakeImpostorAtlas } from '../src/vegetation-impostors.js';
import { createTree } from '../src/vegetation.js';

test('leaf texture kinds that only exist on Object.prototype are refused by name', () => {
  for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.throws(() => createLeafPixels(kind, [64, 110, 36]), /Unknown leaf texture kind/, kind);
  }
});

test('bark texture kinds that only exist on Object.prototype are refused by name', () => {
  for (const kind of ['constructor', 'toString', '__proto__', 'valueOf']) {
    assert.throws(() => createBarkPixels(kind), /Unknown bark texture kind/, kind);
  }
});

test('an impostor bake refuses a frame size that gives an empty, infinite or huge atlas', () => {
  const variant = createTree('bush', 1);
  for (const frameSize of [0, -8, NaN, Infinity, 4, 1000000, 32.5, '32']) {
    assert.throws(() => bakeImpostorAtlas(variant, { frameSize }), /bakeImpostorAtlas: frameSize/, String(frameSize));
  }
  assert.equal(bakeImpostorAtlas(variant, { frameSize: 16 }).width, 128);
});
