import assert from 'node:assert/strict';
import test from 'node:test';

import { projectToScreen } from '../src/camera.js';
import { pixelRay } from '../src/agent-annotate.js';
import { projectToScreen as coreProjectToScreen } from '../src/index.js';

test('projectToScreen is re-exported from src/index.js and projects camera target to canvas centre', () => {
  assert.equal(coreProjectToScreen, projectToScreen);
  const frame = { eye: [0, 2, 6], target: [0, 0, 0], up: [0, 1, 0], fov: 45, near: 0.1, far: 100 };
  const result = projectToScreen(frame, [0, 0, 0], 800, 600);
  assert.ok(Math.abs(result.x - 400) < 1e-6);
  assert.ok(Math.abs(result.y - 300) < 1e-6);
  assert.ok(Math.abs(result.depth - Math.hypot(2, 6)) < 1e-5);
  assert.equal(result.inFront, true);
});

test('projectToScreen matches renderer default FOV, focalLength, orthographic, shift, and behind-camera', () => {
  // Default perspective matches renderer.resize() Math.PI / 5.5 when fov is omitted vs world: true Math.PI / 4
  const bare = { eye: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0] };
  const defaultProjection = projectToScreen(bare, [1, 1, 0], 640, 480);
  const explicitDefault = projectToScreen({ ...bare, fov: 180 / 5.5 }, [1, 1, 0], 640, 480);
  assert.ok(Math.abs(defaultProjection.x - explicitDefault.x) < 1e-5);
  assert.ok(Math.abs(defaultProjection.y - explicitDefault.y) < 1e-5);

  const worldProjection = projectToScreen(bare, [1, 1, 0], 640, 480, { world: true });
  const explicitWorld = projectToScreen({ ...bare, fov: 45 }, [1, 1, 0], 640, 480, { world: true });
  assert.ok(Math.abs(worldProjection.x - explicitWorld.x) < 1e-5);

  // Orthographic height exact pixel spacing
  const ortho = { eye: [0, 0, 10], target: [0, 0, 0], up: [0, 1, 0], projection: 'orthographic', orthographicHeight: 4, near: 0.1, far: 50 };
  const topEdge = projectToScreen(ortho, [0, 2, 0], 800, 600);
  assert.ok(Math.abs(topEdge.x - 400) < 1e-5);
  assert.ok(Math.abs(topEdge.y - 0) < 1e-5);
  const shiftedRight = projectToScreen({ ...ortho, shift: [0.25, -0.1] }, [0, 0, 0], 800, 600);
  assert.ok(Math.abs(shiftedRight.x - 200) < 1e-4);
  assert.ok(Math.abs(shiftedRight.y - 240) < 1e-4);

  // focalLength + sensorWidth + shift round-trips with pixelRay
  const focalFrame = { eye: [3, 4, 5], target: [0.5, 1, -0.5], up: [0, 1, 0], focalLength: 50, sensorWidth: 36, shift: [0.1, -0.05], near: 0.2, far: 100 };
  const samplePoint = [0.8, 1.4, 0.2];
  const screen = projectToScreen(focalFrame, samplePoint, 768, 576);
  const ray = pixelRay(focalFrame, screen.x, screen.y, 768, 576);
  const offset = [samplePoint[0] - ray.origin[0], samplePoint[1] - ray.origin[1], samplePoint[2] - ray.origin[2]];
  const distance = offset[0] * ray.direction[0] + offset[1] * ray.direction[1] + offset[2] * ray.direction[2];
  assert.ok(distance > 0);
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Math.abs(ray.origin[axis] + ray.direction[axis] * distance - samplePoint[axis]) < 1e-4);
  }

  // Point behind camera reports inFront: false and negative depth
  const behind = projectToScreen(bare, [0, 0, 8], 640, 480);
  assert.equal(behind.inFront, false);
  assert.ok(behind.depth < 0);
});

test('projectToScreen validates point and viewport dimensions', () => {
  const frame = { eye: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0] };
  assert.throws(() => projectToScreen(frame, [0, 0], 100, 100), RangeError);
  assert.throws(() => projectToScreen(frame, [0, NaN, 0], 100, 100), RangeError);
  assert.throws(() => projectToScreen(frame, [0, 0, 0], 0, 100), RangeError);
  assert.throws(() => projectToScreen(frame, [0, 0, 0], 100, -5), RangeError);
});
