import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJobSettings } from '../scripts/agent-render-jobs.mjs';

const particleRecipe = {
  format: 'crucible.scene',
  particles: { systems: [{ node: 'sparks', count: 100, rate: 30, lifetime: 2, speed: 3 }] },
};
const stillsJob = { kind: 'stills', width: 320, height: 180 };
const videoJob = { kind: 'video', width: 320, height: 180, duration: 1 };

nodeTest('a stills job of a particles-only recipe plays the motion clock from 0 without a motion setting', () => {
  assert.deepEqual(normalizeJobSettings(stillsJob, [], particleRecipe).motion, { start: 0 });
});

nodeTest('a video job of a particles-only recipe plays the motion clock from 0 without a motion setting', () => {
  assert.deepEqual(normalizeJobSettings(videoJob, [], particleRecipe).motion, { start: 0 });
});

nodeTest('an explicit motion start is kept', () => {
  assert.deepEqual(normalizeJobSettings({ ...stillsJob, motion: { start: 1 } }, [], particleRecipe).motion, { start: 1 });
});

nodeTest('physics and cloth recipes get the same default', () => {
  assert.deepEqual(normalizeJobSettings(videoJob, [], { format: 'crucible.scene', cloth: { duration: 3 } }).motion, { start: 0 });
  assert.deepEqual(normalizeJobSettings(videoJob, [], { format: 'crucible.scene', physics: { duration: 3, bodies: [] } }).motion, { start: 0 });
});

nodeTest('a job longer than the physics bake keeps the held pose instead of failing', () => {
  const longVideo = { ...videoJob, duration: 5 };
  const recipe = { format: 'crucible.scene', physics: { duration: 2, bodies: [] } };
  assert.equal(normalizeJobSettings(longVideo, [], recipe).motion, undefined);
  assert.throws(() => normalizeJobSettings({ ...longVideo, motion: { start: 0 } }, [], recipe), /physics bake duration/);
});

nodeTest('an image job and a recipe with nothing simulated get no implied motion', () => {
  assert.equal(normalizeJobSettings({ kind: 'image', width: 320, height: 180 }, [], particleRecipe).motion, undefined);
  assert.equal(normalizeJobSettings(stillsJob, [], { format: 'crucible.scene' }).motion, undefined);
});

nodeTest('the motion-not-set hint says what to pass', async () => {
  const { MOTION_NOT_SET_HINT, recipeMoves } = await import('../src/motion-hint.js');
  assert.match(MOTION_NOT_SET_HINT.fix, /motionTime/);
  assert.equal(recipeMoves(particleRecipe), true);
  assert.equal(recipeMoves({ format: 'crucible.scene' }), false);
});

const tracksRecipe = {
  format: 'crucible.scene',
  camera: { eye: [0, 1, 5], target: [0, 0, 0] },
  motion: { duration: 2, tracks: [{ kind: 'camera', property: 'eye', keyframes: [{ time: 0, value: [0, 1, 5] }, { time: 2, value: [5, 1, 0] }] }] },
};

nodeTest('a recipe whose only motion is tracks plays the motion clock from 0 without a motion setting', () => {
  assert.deepEqual(normalizeJobSettings(videoJob, [], tracksRecipe).motion, { start: 0 });
  assert.deepEqual(normalizeJobSettings(stillsJob, [], tracksRecipe).motion, { start: 0 });
});

nodeTest('a tracks job longer than the authored motion keeps the held pose instead of failing', () => {
  const longVideo = { ...videoJob, duration: 5 };
  assert.equal(normalizeJobSettings(longVideo, [], tracksRecipe).motion, undefined);
  assert.throws(() => normalizeJobSettings({ ...longVideo, motion: { start: 0 } }, [], tracksRecipe), /authored duration/);
});

nodeTest('the motion-not-set hint covers motion tracks, and an empty track list does not count', async () => {
  const { MOTION_NOT_SET_HINT, recipeMoves } = await import('../src/motion-hint.js');
  assert.match(MOTION_NOT_SET_HINT.message, /motion tracks/);
  assert.equal(recipeMoves(tracksRecipe), true);
  assert.equal(recipeMoves({ format: 'crucible.scene', motion: { duration: 2, tracks: [] } }), false);
  const holdTrack = { kind: 'node', id: 'box', property: 'translation', keyframes: [{ time: 0, value: [0, 0, 0] }] };
  assert.equal(recipeMoves({ format: 'crucible.scene', motion: { duration: 2, tracks: [holdTrack] } }), false, 'one keyframe never moves');
});
