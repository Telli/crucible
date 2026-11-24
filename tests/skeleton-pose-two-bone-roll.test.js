import assert from 'node:assert/strict';
import test from 'node:test';
import { quat, vec3 } from 'gl-matrix';

import { createSkeletonPose } from '../src/skeleton-pose.js';

function armRig() {
  return {
    joints: [
      { name: 'shoulder', parent: -1, translation: [0, 1.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      // Bent slightly forward (+Z) in pose via small elbow rotation later
      { name: 'upper', parent: 0, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'lower', parent: 1, translation: [0, -0.4, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      { name: 'hand', parent: 2, translation: [0, -0.35, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ],
  };
}

function bendNormal(rootPosition, middlePosition, endPosition) {
  const upperBone = vec3.subtract([], middlePosition, rootPosition);
  const lowerBone = vec3.subtract([], endPosition, middlePosition);
  return vec3.normalize([], vec3.cross([], upperBone, lowerBone));
}

test('two-bone IK with hingeFromPose keeps pre-solve elbow hinge aligned to solved bend plane', () => {
  const rig = armRig();
  // Give the rest pose a clean forward bend in YZ plane (hinge axis is +X/-X)
  rig.joints[1].rotation = quat.setAxisAngle([], [1, 0, 0], -0.45);
  rig.joints[2].rotation = quat.setAxisAngle([], [1, 0, 0], 0.9);

  // Measure pose local hinge axis in upper & lower before solving
  const basePose = createSkeletonPose({ rig });
  basePose.apply(0);
  const upperStart = basePose.jointWorld('upper');
  const lowerStart = basePose.jointWorld('lower');
  const handStart = basePose.jointWorld('hand');
  const preHinge = bendNormal(upperStart.position, lowerStart.position, handStart.position);
  const localHingeInLower = vec3.transformQuat([], preHinge, quat.invert([], lowerStart.rotation));

  const target = [0.38, 1.35, 0.35];
  const pole = [0.1, 1.2, 0.9];

  const driftPose = createSkeletonPose({
    rig,
    ik: [{ type: 'two-bone', root: 'upper', middle: 'lower', end: 'hand', target, pole }],
  });
  driftPose.apply(0);
  const driftUpper = driftPose.jointWorld('upper');
  const driftLower = driftPose.jointWorld('lower');
  const driftHand = driftPose.jointWorld('hand');
  const driftPlane = bendNormal(driftUpper.position, driftLower.position, driftHand.position);
  const driftLowerHinge = vec3.transformQuat([], localHingeInLower, driftLower.rotation);
  const driftAngle = vec3.angle(driftPlane, driftLowerHinge);
  assert.ok(driftAngle > 0.05, `Expected shortest-arc solve to drift hinge normal, got ${driftAngle}`);

  const cleanPose = createSkeletonPose({
    rig,
    ik: [{ type: 'two-bone', root: 'upper', middle: 'lower', end: 'hand', target, pole, hingeFromPose: true }],
  });
  cleanPose.apply(0);
  const cleanUpper = cleanPose.jointWorld('upper');
  const cleanLower = cleanPose.jointWorld('lower');
  const cleanHand = cleanPose.jointWorld('hand');
  const solvedPlane = bendNormal(cleanUpper.position, cleanLower.position, cleanHand.position);
  const alignedLowerHinge = vec3.transformQuat([], localHingeInLower, cleanLower.rotation);
  const residual = vec3.angle(solvedPlane, alignedLowerHinge);
  assert.ok(residual < 1e-6, `Expected hingeFromPose to align lower hinge to bend plane, residual=${residual}`);
  assert.ok(vec3.distance(cleanHand.position, target) < 1e-4);
  assert.ok(vec3.distance(cleanLower.position, driftLower.position) < 1e-5);
});

test('two-bone IK validates hingeFromPose option', () => {
  assert.throws(
    () => createSkeletonPose({
      rig: armRig(),
      ik: [{ type: 'two-bone', root: 'upper', middle: 'lower', end: 'hand', target: [0, 1, 0], hingeFromPose: 'yes' }],
    }),
    TypeError,
  );
});
