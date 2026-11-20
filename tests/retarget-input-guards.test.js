import test from 'node:test';
import assert from 'node:assert/strict';

const CLIP = { duration: 1, loop: true, tracks: [] };

async function humanoidJoints() {
  const { REQUIRED_HUMANOID_BONES } = await import('../src/retarget.js');
  return REQUIRED_HUMANOID_BONES.map((name, index) => ({
    name, parent: index === 0 ? -1 : 0, translation: [0, index === 0 ? 1 : -0.5, 0], rotation: [0, 0, 0, 1],
  }));
}

function identityMapping(joints) {
  return Object.fromEntries(joints.map(joint => [joint.name, joint.name]));
}

function crowdOffsets(createCrowd, seed) {
  const crowd = createCrowd({ count: 3, clip: CLIP, seed, layout: 'scatter', randomYaw: true });
  return JSON.stringify(crowd.instances.map(instance => [instance.position, instance.timeOffset, instance.yawRadians]));
}

test('createCrowd refuses seeds that would repeat another seed', async () => {
  const { createCrowd } = await import('../src/retarget.js');
  for (const seed of [1.5, NaN, Infinity, -(2 ** 31) - 1, 2 ** 32]) {
    assert.throws(() => createCrowd({ count: 2, clip: CLIP, seed }), { name: 'RangeError', message: /Crowd seed/ }, String(seed));
  }
  assert.notEqual(crowdOffsets(createCrowd, 1), crowdOffsets(createCrowd, 2));
  assert.doesNotThrow(() => createCrowd({ count: 2, clip: CLIP, seed: -5 }));
  assert.equal(crowdOffsets(createCrowd, 4294967295), crowdOffsets(createCrowd, 4294967295));
});

test('retargetClip refuses a mapping that sends two bones to one joint or names an unknown bone', async () => {
  const { retargetClip } = await import('../src/retarget.js');
  const joints = await humanoidJoints();
  const validRig = { joints, mapping: identityMapping(joints) };
  assert.doesNotThrow(() => retargetClip(validRig, validRig, CLIP));
  const duplicate = { joints, mapping: { ...identityMapping(joints), leftHand: 'rightHand' } };
  assert.throws(() => retargetClip(duplicate, validRig, CLIP), { name: 'RangeError', message: /Source mapping.*rightHand/ });
  const typo = { joints, mapping: { ...identityMapping(joints), leftArmm: 'hips' } };
  assert.throws(() => retargetClip(validRig, typo, CLIP), { name: 'RangeError', message: /Target mapping.*unknown bone: leftArmm/ });
});

test('rig joints with a zero rotation or a non-finite translation are refused by name', async () => {
  const { retargetClip, validateRigJoints } = await import('../src/retarget.js');
  const joints = await humanoidJoints();
  const zeroRotation = joints.map((joint, index) => (index === 1 ? { ...joint, rotation: [0, 0, 0, 0] } : joint));
  assert.throws(() => retargetClip({ joints: zeroRotation }, { joints }, CLIP), { name: 'RangeError', message: new RegExp(`Source rig joint ${joints[1].name}`) });
  const notANumber = joints.map((joint, index) => (index === 2 ? { ...joint, translation: [NaN, 0, 0] } : joint));
  assert.throws(() => validateRigJoints(notANumber, 'Pose'), { name: 'RangeError', message: new RegExp(`Pose rig joint ${joints[2].name}`) });
  assert.doesNotThrow(() => validateRigJoints(joints, 'Pose'));
});
