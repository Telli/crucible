import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraSampler } from '../src/camera-track.js';

const twoFrames = [[[0, 0, 1], [0, 0, 0]], [[0, 0, 3], [0, 0, 0]]];

test('createCameraSampler blends neighbouring frames', () => {
  const sampler = createCameraSampler({ fps: 2, frames: twoFrames });
  assert.equal(sampler.duration, 1);
  assert.deepEqual(sampler.sample(0.25).eye, [0, 0, 2]);
});

test('createCameraSampler rejects empty frames and bad fps with a message that says what to pass (#1407)', () => {
  assert.throws(() => createCameraSampler({ frames: [] }), /at least one \[eye, target\]/);
  assert.throws(() => createCameraSampler({ fps: 0, frames: twoFrames }), /fps must be a positive finite number/);
  assert.throws(() => createCameraSampler({ fps: -24, frames: twoFrames }), /fps must be a positive finite number/);
});

test('createCameraSampler rejects malformed frames and a non-finite sample time (#1407)', () => {
  assert.throws(() => createCameraSampler({ frames: [[[0, 0], [0, 0, 0]]] }), /frames\[0\]/);
  assert.throws(() => createCameraSampler({ frames: twoFrames }).sample(NaN), /finite number of seconds/);
});

test('createCameraSampler rejects frames whose eye equals the target and an fps that gives an infinite duration (#1574)', async () => {
  const sameEyeAndTarget = [[[0, 0, 1], [0, 0, 0]], [[2, 3, 4], [2, 3, 4]]];
  assert.throws(() => createCameraSampler({ frames: sameEyeAndTarget }), /frames\[1\] eye and target are the same point/);
  assert.throws(() => createCameraSampler({ fps: 1e-320, frames: twoFrames }), /too small for 2 frames to have a finite duration/);
});

test('createCameraSampler rejects a sparse frames array naming the empty index (#2359)', () => {
  const sparse = [, [[0, 0, 1], [0, 0, 0]]];
  assert.throws(() => createCameraSampler({ frames: sparse }), /frames\[0\] must be \[eye, target\]/);
});

test('both sampler forms reject a sample time that is not a finite number (#2360)', () => {
  const pathKeys = { duration: 2, eye: [0, 0, 5], target: [0, 0, 0] };
  for (const sampler of [createCameraSampler(pathKeys), createCameraSampler({ frames: twoFrames })]) {
    for (const bad of [null, '1', undefined, Infinity, -Infinity, NaN]) {
      assert.throws(() => sampler.sample(bad), /finite number of seconds/, `time ${String(bad)}`);
    }
    assert.doesNotThrow(() => sampler.sample(1));
  }
});
