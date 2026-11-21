import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { DEFAULT_NEAR, fittedNearPlane, sceneBoundsOfParts } from '../src/near-plane-fit.js';

const distantBounds = sceneBoundsOfParts([{ geometry: { positions: new Float32Array([-1, -1, -1, 1, 1, 1]) }, matrix: mat4.fromTranslation(mat4.create(), [0, 0, -80]) }]);
const view = mat4.lookAt(mat4.create(), [0, 0, 0], [0, 0, -1], [0, 1, 0]);

test('a far plane that is not a positive finite number leaves the default near plane for the camera to reject', () => {
  for (const far of [NaN, undefined, 0, -5, 0.05]) {
    assert.equal(fittedNearPlane(distantBounds, view, far), DEFAULT_NEAR, `far ${far}`);
  }
});

test('a usable far plane still moves the near plane out', () => {
  assert.ok(fittedNearPlane(distantBounds, view, 10000) > 50);
});
