import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUserPasses, enlargedBlockOrigin } from '../src/user-pass.js';

const FRAGMENT = 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv); }';

test('normalizeUserPasses validates and preserves pass offset in pass pixels', () => {
  const [pass] = normalizeUserPasses([{ name: 'pixel', fragment: FRAGMENT, scale: 0.125, offset: [0.375, -0.25] }]);
  assert.deepEqual(pass.offset, [0.375, -0.25]);

  const [plain] = normalizeUserPasses([{ name: 'plain', fragment: FRAGMENT, scale: 0.25 }]);
  assert.equal(plain.offset, undefined);

  assert.throws(() => normalizeUserPasses([{ name: 'bad', fragment: FRAGMENT, offset: [0.5] }]), RangeError);
  assert.throws(() => normalizeUserPasses([{ name: 'bad', fragment: FRAGMENT, offset: [0, NaN] }]), RangeError);
  assert.throws(() => normalizeUserPasses([{ name: 'bad', fragment: FRAGMENT, offset: 'left' }]), RangeError);
});

test('enlargedBlockOrigin shifts block enlargement by offset pass pixels (+gl_FragCoord)', () => {
  assert.deepEqual(enlargedBlockOrigin([2, 3], 8, undefined), [2, 3]);
  assert.deepEqual(enlargedBlockOrigin([2, 3], 8, [0.5, -0.25]), [-2, 5]);
});
