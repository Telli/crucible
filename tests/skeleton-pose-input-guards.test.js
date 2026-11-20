import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseGltf } from '../src/gltf.js';
import { createSkeletonPose, createAssetPose, morphClipFromGltfAnimation } from '../src/skeleton-pose.js';

const restJoint = (name, parent, y) => ({ name, parent, translation: [0, y, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const chainRig = { joints: [restJoint('a', -1, 0), restJoint('b', 0, 1), restJoint('c', 1, 1)] };

test('an aim solver refuses a zero forward axis instead of silently never aiming', () => {
  const aim = { type: 'aim', joint: 'b', target: [1, 1, 1] };
  assert.throws(() => createSkeletonPose({ rig: chainRig, ik: [{ ...aim, forward: [0, 0, 0] }] }), /forward/);
  assert.throws(() => createSkeletonPose({ rig: chainRig, ik: [{ ...aim, worldForward: [0, 0, 0] }] }), /forward/);
});

test('a two-bone solver refuses a zero bendToward direction', () => {
  const twoBone = { type: 'two-bone', root: 'a', middle: 'b', end: 'c', target: [1, 1, 0] };
  assert.throws(() => createSkeletonPose({ rig: chainRig, ik: [{ ...twoBone, bendToward: [0, 0, 0] }] }), /bendToward/);
});

test('a morph-only additive layer refuses a reference time that is not finite, so weights never become NaN', async () => {
  const bytes = readFileSync(new URL('./fixtures/RobotExpressive.glb', import.meta.url));
  const asset = await parseGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { maxVertices: 500000 });
  const dance = asset.animations.find(animation => animation.name === 'Dance');
  const morphs = morphClipFromGltfAnimation(dance, { loop: true });
  assert.throws(() => createAssetPose(asset, { layers: [{ morphs, additive: true, reference: Number.NaN }] }), /reference/);
});

test('a rig joint with a NaN translation, a NaN rotation or a zero quaternion is refused instead of posing NaN', () => {
  const withBroken = patch => ({ joints: [restJoint('a', -1, 0), { ...restJoint('b', 0, 1), ...patch }] });
  assert.throws(() => createSkeletonPose({ rig: withBroken({ translation: [0, Number.NaN, 0] }) }), /joint b needs/);
  assert.throws(() => createSkeletonPose({ rig: withBroken({ rotation: [Number.NaN, 0, 0, 1] }) }), /joint b needs/);
  assert.throws(() => createSkeletonPose({ rig: withBroken({ rotation: [0, 0, 0, 0] }) }), /joint b needs/);
  assert.throws(() => createSkeletonPose({ rig: withBroken({ scale: [Number.NaN, 1, 1] }) }), /joint b needs/);
  assert.doesNotThrow(() => createSkeletonPose({ rig: withBroken({}) }));
});

test('a custom solver whose create returns no joints list or no solve function is refused with a message naming both', () => {
  const custom = created => ({ rig: chainRig, ik: [{ type: 'custom', create: () => created }] });
  assert.throws(() => createSkeletonPose(custom({ solve() {} })), /joints, solve/);
  assert.throws(() => createSkeletonPose(custom({ joints: [1] })), /joints, solve/);
  assert.throws(() => createSkeletonPose(custom({ joints: [9], solve() {} })), /joints, solve/);
  assert.equal(createSkeletonPose(custom({ joints: [1], solve() {} })).solvedJointNames[0], 'b');
});

test('an aim solver with joints that is not a list, or a null IK entry, says what to pass', () => {
  assert.throws(() => createSkeletonPose({ rig: chainRig, ik: [{ type: 'aim', joints: 'b', target: [0, 1, 0] }] }), /joints must be a list/);
  assert.throws(() => createSkeletonPose({ rig: chainRig, ik: [null] }), /IK 0 must be an object/);
});
