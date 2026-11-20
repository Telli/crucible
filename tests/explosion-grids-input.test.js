import test from 'node:test';
import assert from 'node:assert/strict';
import { registerExplosionGrids } from '../src/explosion-grids.js';

test('registerExplosionGrids refuses a fuel it has no options for instead of baking a made-up blast', () => {
  for (const fuel of ['bogus', undefined, 'constructor']) {
    assert.throws(() => registerExplosionGrids(fuel, 1), /registerExplosionGrids: fuel is .*use one of dry, oily/);
  }
});
