import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { createFootPlacement } from '../src/animation-graph.js';
import { createCrowdRig } from '../src/crowd-skinning.js';
import { createSkinPose, skinnedWorldBounds } from '../src/skinning.js';

const footJoints = { root: 'hip', middle: 'knee', end: 'ankle', groundOffset: () => 0.1 };

function triangleGeometry(skinIndices, skinWeights) {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]),
    skinIndices: Uint16Array.from(skinIndices),
    skinWeights: Float32Array.from(skinWeights),
  };
}

test('skinned bounds blend by normalized weights, as the renderer does, when the weights do not sum to one', () => {
  const pose = createSkinPose(1);
  pose.jointMatrices.set(mat4.fromTranslation(mat4.create(), [10, 0, 0]));
  const geometry = triangleGeometry(Array(12).fill(0), [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0]);
  const bounds = skinnedWorldBounds(geometry, pose, mat4.create());
  assert.deepEqual(bounds.minimum, [10, 0, 0]);
  assert.deepEqual(bounds.maximum, [11, 1, 0]);
});

test('a crowd rig refuses a skinned part whose joint index is past its joints, naming the part', () => {
  const skin = createSkinPose(2);
  const part = { name: 'coat', geometry: triangleGeometry(Array(12).fill(5), Array(12).fill(0.25)), matrix: mat4.create(), material: {}, skin };
  assert.throws(() => createCrowdRig([part]), /coat.*joint/);
});

test('a crowd rig refuses a skinned vertex whose weights total zero instead of packing NaN', () => {
  const skin = createSkinPose(2);
  const part = { name: 'coat', geometry: triangleGeometry(Array(12).fill(0), Array(12).fill(0)), matrix: mat4.create(), material: {}, skin };
  assert.throws(() => createCrowdRig([part]), /coat.*weight/);
});

test('a foot placement recovers after one frame whose foot position is not a number', () => {
  const foot = createFootPlacement({ ...footJoints, ankleHeight: 0 });
  foot.target(0, [0, 0, 0]);
  foot.target(0.016, [0, Number.NaN, 0]);
  const recovered = foot.target(0.032, [0, 0, 0]);
  assert.ok(Number.isFinite(recovered[1]), `foot y was ${recovered[1]}`);
});
