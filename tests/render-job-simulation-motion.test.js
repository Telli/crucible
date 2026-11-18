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
  const { MOTION_NOT_SET_HINT, recipePlaysSimulation } = await import('../src/motion-hint.js');
  assert.match(MOTION_NOT_SET_HINT.fix, /motionTime/);
  assert.equal(recipePlaysSimulation(particleRecipe), true);
  assert.equal(recipePlaysSimulation({ format: 'crucible.scene' }), false);
});
