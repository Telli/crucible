import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { AXIS_COLORS, GRID_PART_PREFIX, axisWidgetEnds, buildGridRecipe, describeBounds, describeCamera } from '../src/studio-viewport-aids.js';

test('buildGridRecipe is a valid recipe of one line per metre with a red X axis and a blue Z axis', () => {
  const recipe = buildGridRecipe();
  assert.equal(recipe.nodes.length, 42);
  assert.ok(recipe.nodes.every(node => node.id.startsWith(GRID_PART_PREFIX) && node.castShadow === false && node.receiveShadow === false));
  const axisX = recipe.nodes.find(node => node.id === `${GRID_PART_PREFIX}axis-x`);
  const axisZ = recipe.nodes.find(node => node.id === `${GRID_PART_PREFIX}axis-z`);
  assert.equal(axisX.material, 'studio-grid-x');
  assert.equal(axisZ.material, 'studio-grid-z');
  assert.ok(axisX.scale[0] > axisX.scale[2], 'the X axis line runs along X');
  assert.ok(axisZ.scale[2] > axisZ.scale[0], 'the Z axis line runs along Z');
  const offsets = recipe.nodes.filter(node => node.scale[0] > node.scale[2]).map(node => node.translation[2]).sort((first, second) => first - second);
  assert.deepEqual(offsets, Array.from({ length: 21 }, (unused, index) => index - 10));
  assert.deepEqual(buildGridRecipe(), recipe);
  assert.equal(createAgentScene(recipe).parts.length, 42);
  assert.deepEqual(Object.keys(AXIS_COLORS), ['x', 'y', 'z']);
});

test('axisWidgetEnds places the axes as the camera sees them, far ends first', () => {
  const front = axisWidgetEnds({ eye: [0, 0, 5], target: [0, 0, 0], up: [0, 1, 0] });
  const find = (ends, axis, positive) => ends.find(end => end.axis === axis && end.positive === positive);
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
  near(find(front, 'x', true).x, 1);
  near(find(front, 'y', true).y, -1);
  near(find(front, 'z', true).depth, 1);
  near(find(front, 'z', false).depth, -1);
  assert.deepEqual(front.map(end => end.depth), [...front.map(end => end.depth)].sort((first, second) => first - second));
  assert.equal(front.at(-1).view, 'front');
  assert.deepEqual(front.map(end => end.view).filter(Boolean).sort(), ['back', 'front', 'left', 'right', 'top']);
  const right = axisWidgetEnds({ eye: [5, 0, 0], target: [0, 0, 0] });
  near(find(right, 'x', true).depth, 1);
  near(find(right, 'z', true).x, -1);
});

test('describeCamera and describeBounds write the readout lines', () => {
  assert.equal(describeCamera({ projection: 'orthographic', fov: 40 }), 'Orthographic');
  assert.equal(describeCamera({ focalLength: 49.6 }), 'Perspective · 50 mm');
  assert.equal(describeCamera({ fov: 41.6 }), 'Perspective · 42°');
  assert.equal(describeCamera({}), 'Perspective · 45°');
  assert.equal(describeBounds({ size: [0.42, 0.9, 0.42] }), '0.42 × 0.90 × 0.42 m');
  assert.equal(describeBounds({ size: [120.4, 3, 0.005] }), '120 × 3.00 × 0.01 m');
});
