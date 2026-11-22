import test from 'node:test';
import assert from 'node:assert/strict';
import { CrucibleRenderer } from '../src/renderer.js';
import { chooseLevel } from '../src/render-culling.js';

test('a NaN or negative lodPixelError is refused instead of drawing the coarsest level everywhere (#2403)', () => {
  // What a NaN error did: every level passes the "too coarse?" test, so the last one wins.
  assert.equal(chooseLevel([0, 0.01, 0.1, 1], 1, 1000, NaN), 3);
  for (const lodPixelError of [NaN, -1, '2', null]) {
    assert.throws(() => new CrucibleRenderer({}, [], { lodPixelError }), /lodPixelError must be a number of 0 or more pixels, got/);
  }
});
