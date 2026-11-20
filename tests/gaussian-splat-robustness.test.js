import assert from 'node:assert/strict';
import test from 'node:test';
import { createGaussianSplats, createGaussianSplatsAsync } from '../src/gaussian-splats.js';
import { createSplatSorter } from '../src/gaussian-splat-sort.js';

function buildSplatData(rotation = [1, 0, 0, 0]) {
  return {
    count: 1,
    positions: new Float32Array(3),
    colors: new Uint8Array(4),
    scales: Float32Array.of(1, 2, 3),
    rotations: Float32Array.from(rotation),
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] },
  };
}

function packedCovariance(data) {
  return Array.from(new Float32Array(createGaussianSplats(data).packed.words.buffer).subarray(4, 10));
}

test('a rotation that is not unit length packs the same covariance as its unit version', () => {
  const unit = packedCovariance(buildSplatData([Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  const doubled = packedCovariance(buildSplatData([2 * Math.SQRT1_2, 0, 0, 2 * Math.SQRT1_2]));
  doubled.forEach((value, index) => assert.ok(Math.abs(value - unit[index]) < 1e-5, `entry ${index}: ${value} against ${unit[index]}`));
});

test('an all zero rotation packs the covariance of no rotation', () => {
  const none = packedCovariance(buildSplatData());
  assert.deepEqual(packedCovariance(buildSplatData([0, 0, 0, 0])), none);
});

for (const [name, build] of [['createGaussianSplats', createGaussianSplats], ['createGaussianSplatsAsync', createGaussianSplatsAsync]]) {
  test(`${name} refuses bounds that are missing or not finite before drawing`, async () => {
    const badBounds = [undefined, { minimum: [0, 0, 0] }, { minimum: [0, 0], maximum: [1, 1, 1] }, { minimum: [0, 0, NaN], maximum: [1, 1, 1] }];
    for (const bounds of badBounds) {
      await assert.rejects(async () => build({ ...buildSplatData(), bounds }), error => error instanceof TypeError && /data\.bounds/.test(error.message) && /minimum, maximum/.test(error.message));
    }
  });
}

test('the sorter re-sorts when the view turns round under a tiny uniform scale', () => {
  const positions = Float32Array.of(0, 0, -1e6, 0, 0, -3e6);
  const sorter = createSplatSorter(positions, 2, { minimum: [0, 0, -3e6], maximum: [0, 0, -1e6] });
  const scale = 1e-8;
  const forward = Float32Array.of(scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1);
  const turned = Float32Array.of(scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, -scale, 0, 0, 0, 0, 1);
  assert.deepEqual(Array.from(sorter.sort(forward).order.subarray(0, 2)), [1, 0]);
  const result = sorter.sort(turned);
  assert.equal(result.changed, true, 'a turned view must be reported as changed');
  assert.equal(result.visibleCount, 0, 'both splats are now behind the camera');
});
