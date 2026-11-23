import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';

import { createSkinPose, updateSkinPose, posedVertexPositions, skinnedWorldBounds } from '../src/skinning.js';
import { posedVertexPositions as corePosedVertexPositions } from '../src/index.js';
import { posedVertexPositions as addonPosedVertexPositions } from '../src/skeleton-pose.js';

test('posedVertexPositions is exported from core and skeleton-pose and transforms unskinned parts', () => {
  assert.equal(corePosedVertexPositions, posedVertexPositions);
  assert.equal(addonPosedVertexPositions, posedVertexPositions);

  const part = {
    geometry: { positions: new Float32Array([1, 2, 3, -1, 0, 4]) },
    matrix: mat4.fromTranslation(mat4.create(), [10, -5, 2]),
  };
  const out = posedVertexPositions(part);
  assert.ok(out instanceof Float32Array);
  assert.deepEqual(Array.from(out), [11, -3, 5, 9, -5, 6]);

  const buffer = new Float32Array(6);
  const reused = posedVertexPositions(part, buffer);
  assert.equal(reused, buffer);
  assert.deepEqual(Array.from(buffer), [11, -3, 5, 9, -5, 6]);
});

test('posedVertexPositions blends normalized skin weights and agrees with skinnedWorldBounds', () => {
  const skin = createSkinPose(2);
  const joint0 = mat4.fromTranslation(mat4.create(), [1, 0, 0]);
  const joint1 = mat4.fromTranslation(mat4.create(), [5, 2, 0]);
  const worldJoints = new Float32Array(32);
  worldJoints.set(joint0, 0);
  worldJoints.set(joint1, 16);
  const inverseBind = new Float32Array(32);
  inverseBind.set(mat4.create(), 0);
  inverseBind.set(mat4.create(), 16);
  updateSkinPose(skin, worldJoints, inverseBind);

  const part = {
    skin,
    matrix: mat4.fromTranslation(mat4.create(), [0, 10, -3]),
    geometry: {
      positions: new Float32Array([0, 0, 0, 0, 0, 0]),
      skinIndices: new Uint16Array([0, 1, 0, 0, 0, 1, 0, 0]),
      // Deliberately unnormalized weights (sum = 2 and sum = 4) to verify normalization matching renderer
      skinWeights: new Float32Array([2, 0, 0, 0, 1, 3, 0, 0]),
    },
  };

  const positions = posedVertexPositions(part);
  // Vertex 0: 100% joint0 ([1,0,0]) + part.matrix ([0,10,-3]) = [1, 10, -3]
  assert.deepEqual(Array.from(positions.subarray(0, 3)), [1, 10, -3]);
  // Vertex 1: 0.25 * [1,0,0] + 0.75 * [5,2,0] = [4, 1.5, 0] + [0,10,-3] = [4, 11.5, -3]
  assert.deepEqual(Array.from(positions.subarray(3, 6)), [4, 11.5, -3]);

  const bounds = skinnedWorldBounds(part.geometry, skin, part.matrix);
  assert.deepEqual(bounds.minimum, [1, 10, -3]);
  assert.deepEqual(bounds.maximum, [4, 11.5, -3]);
});

test('posedVertexPositions validates inputs and output buffer', () => {
  assert.throws(() => posedVertexPositions({ geometry: {}, matrix: mat4.create() }), TypeError);
  assert.throws(() => posedVertexPositions({ geometry: { positions: new Float32Array(3) } }), TypeError);
  assert.throws(
    () => posedVertexPositions({ geometry: { positions: new Float32Array(6) }, matrix: mat4.create() }, new Float32Array(3)),
    RangeError,
  );
});
