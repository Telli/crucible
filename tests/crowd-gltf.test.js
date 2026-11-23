import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { parseGltf } from '../src/gltf.js';
import { crowdFrameBlend, createCrowdPartsFromGltf, createCrowdRigFromGltf } from '../src/crowd-skinning.js';

const bytes = readFileSync(new URL('./fixtures/RobotExpressive.glb', import.meta.url));

async function loadRobot() {
  const asset = await parseGltf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { maxVertices: 500000 });
  return { asset, running: asset.animations.findIndex(animation => animation.name === 'Running') };
}

function identityInstances(count) {
  return Array.from({ length: count }, (_, index) => ({ matrix: mat4.fromTranslation(mat4.create(), [index * 2, 0, 0]), phase: index * 0.1 }));
}

test('every palette frame equals the joint matrices applyAnimation poses at that clip time', async () => {
  const { asset, running } = await loadRobot();
  const { rig, palette } = createCrowdRigFromGltf(asset, running);
  const matricesPerFrame = palette.jointCount * 16;
  assert.ok(palette.frameCount > 2);
  const skinned = asset.parts.filter(part => part.skin);
  assert.ok(skinned.length > 0);
  let compared = 0;
  for (const frame of [0, 1, Math.floor(palette.frameCount / 2), palette.frameCount - 1]) {
    asset.applyAnimation(frame * palette.frameStep, running);
    const expected = rig.readJointMatrices(new Float32Array(matricesPerFrame));
    const baked = palette.data.subarray(frame * matricesPerFrame, (frame + 1) * matricesPerFrame);
    for (let index = 0; index < matricesPerFrame; index++) assert.ok(Math.abs(baked[index] - expected[index]) < 1e-5, `frame ${frame} value ${index}`);
    // The skinned joints are the part matrix times the asset's own skin.jointMatrices, joint by joint.
    for (const part of skinned) {
      const joint = Array.from(part.skin.jointMatrices.subarray(0, 16));
      const placed = mat4.multiply(mat4.create(), part.matrix, joint);
      const offset = rigJointOffset(asset, part) * 16;
      for (let index = 0; index < 16; index++) assert.ok(Math.abs(baked[offset + index] - placed[index]) < 1e-5);
      compared++;
    }
  }
  assert.ok(compared >= 4 * skinned.length);
});

function rigJointOffset(asset, target) {
  let offset = 0;
  for (const part of asset.parts) {
    if (part === target) return offset;
    offset += part.skin ? part.skin.jointMatrices.length / 16 : 1;
  }
  throw new Error('part not in asset');
}

test('a glTF crowd shares one geometry, material and palette and gives each instance its own clip time', async () => {
  const { asset, running } = await loadRobot();
  const set = createCrowdPartsFromGltf(asset, identityInstances(5), { clip: running, lods: false });
  const materials = new Set(asset.parts.map(part => part.material));
  assert.equal(set.parts.length, 5 * materials.size);
  assert.equal(new Set(set.parts.map(part => part.geometry)).size, materials.size);
  assert.equal(new Set(set.parts.map(part => part.crowd)).size, 1);
  assert.equal(set.parts[0].crowd, set.palette);
  set.setTime(0.2);
  const lastPart = set.parts.at(-1);
  const expected = crowdFrameBlend(set.palette, 0.2 + 0.4);
  assert.deepEqual(Array.from(lastPart.assembly.offset), expected);
  const first = set.parts[0].assembly.offset;
  assert.deepEqual(Array.from(first), crowdFrameBlend(set.palette, 0.2));
});

test('a clip that animates morph weights is refused, and so is any input a crowd cannot take', async () => {
  const { asset, running } = await loadRobot();
  const morphed = asset.parts.find(part => part.morph);
  const animatingMorphs = { parts: asset.parts, animations: asset.animations, applyAnimation(seconds, clip) {
    asset.applyAnimation(seconds, clip);
    morphed.morph.weights[0] = seconds;
  } };
  assert.throws(() => createCrowdRigFromGltf(animatingMorphs, running), /animates morph weights.*one asset per instance/);
  assert.throws(() => createCrowdRigFromGltf(asset, 99), /Clip 99 does not exist: this asset has 14 clips/);
  assert.throws(() => createCrowdRigFromGltf({ parts: [] }, 0), /needs the asset parseGltf returned/);
  assert.throws(() => createCrowdPartsFromGltf(asset, []), /needs a list of instances/);
  assert.throws(() => createCrowdPartsFromGltf(asset, [{ matrix: [1, 2] }]), /instance 0 needs a matrix of 16 finite numbers/);
  assert.throws(() => createCrowdPartsFromGltf(asset, [{ matrix: mat4.create(), phase: Infinity }]), /finite phase/);
  assert.throws(() => createCrowdPartsFromGltf(asset, new Array(100001).fill({ matrix: mat4.create() })), /at most 100000 instances/);
  const set = createCrowdPartsFromGltf(asset, identityInstances(1), { clip: running });
  assert.throws(() => set.setTime(Number.NaN), /finite seconds/);
});
