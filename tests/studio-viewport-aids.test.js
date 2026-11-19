import './support/load-agent-scene-modules.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentScene } from '../src/agent-scene.js';
import { AXIS_COLORS, GRID_PART_PREFIX, axisWidgetEnds, buildGridRecipe, cameraVisibleHeight, describeBounds, describeCamera, describeGridStep, gridLayout, placeGridParts, viewportClipPlanes, viewportFloorPart } from '../src/studio-viewport-aids.js';

test('buildGridRecipe is a valid recipe of three sets of lines with a red X axis and a blue Z axis', () => {
  const recipe = buildGridRecipe();
  assert.equal(recipe.nodes.length, 368);
  assert.ok(recipe.nodes.every(node => node.id.startsWith(GRID_PART_PREFIX) && node.castShadow === false && node.receiveShadow === false));
  const axisX = recipe.nodes.find(node => node.id === `${GRID_PART_PREFIX}axis-x`);
  const axisZ = recipe.nodes.find(node => node.id === `${GRID_PART_PREFIX}axis-z`);
  assert.equal(axisX.material, 'studio-grid-x');
  assert.equal(axisZ.material, 'studio-grid-z');
  assert.ok(axisX.scale[0] > axisX.scale[2], 'the X axis line runs along X');
  assert.ok(axisZ.scale[2] > axisZ.scale[0], 'the Z axis line runs along Z');
  assert.deepEqual(buildGridRecipe(), recipe);
  assert.equal(createAgentScene(recipe).parts.length, 368);
});

test('gridLayout grows its step tenfold as the view widens, keeps lines about a pixel wide and follows the target', () => {
  const view = (visibleHeight, target = [0, 0, 0]) => {
    const distance = visibleHeight / (2 * Math.tan((42 * Math.PI) / 360));
    return { visibleHeight, viewportHeight: 720, target, eye: [target[0], target[1] + distance * 0.5, target[2] + distance * 0.866] };
  };
  const near = gridLayout(view(5));
  const far = gridLayout(view(300));
  assert.equal(near.step, 1);
  assert.equal(far.step, 10);
  assert.equal(gridLayout(view(0.5)).step, 0.1);
  const line = (layout, name) => layout.lines.find(candidate => candidate.id === `${GRID_PART_PREFIX}${name}`);
  const shown = (layout, prefix) => layout.lines.filter(candidate => candidate.id.startsWith(`${GRID_PART_PREFIX}${prefix}`) && candidate.translation[1] > 0);
  const pixelsWide = (layout, name, visibleHeight) => line(layout, name).scale[2] / (visibleHeight / 720);
  assert.ok(pixelsWide(near, 'level1-x0', 5) > 1 && pixelsWide(near, 'level1-x0', 5) < 2);
  assert.ok(pixelsWide(far, 'level1-x0', 300) > 1 && pixelsWide(far, 'level1-x0', 300) < 2);
  const offsets = shown(near, 'level0-x').map(candidate => candidate.translation[2]).sort((first, second) => first - second);
  assert.ok(offsets.length >= 21 && offsets.every((offset, index) => index === 0 || Math.abs(offset - offsets[index - 1] - 1) < 1e-9), 'one fine line per metre up close');
  const reachOf = (layout, prefix) => Math.max(...shown(layout, prefix).map(candidate => Math.abs(candidate.translation[2])));
  assert.ok(reachOf(near, 'level2-x') >= 200, 'the coarsest lines reach hundreds of metres from a close view');
  assert.ok(reachOf(near, 'level0-x') < reachOf(near, 'level1-x') && reachOf(near, 'level1-x') < reachOf(near, 'level2-x'), 'finer lines stop sooner, before they crowd');
  assert.ok(shown(near, 'level0-x').length < 61, 'lines past that reach are put away');
  assert.ok(line(far, 'level0-x1').translation[1] > line(near, 'level0-x1').translation[1], 'the lines lift off the floor as the view widens');
  const moved = gridLayout(view(5, [37, 0, -12]));
  assert.equal(line(moved, 'level0-z0').translation[0], 40, 'the middle follows the target in whole steps');
  assert.equal(line(moved, 'axis-z').translation[0], 0, 'the axis stays on the world origin');
  assert.equal(describeGridStep(0.1), '10 cm');
  assert.equal(describeGridStep(1), '1 m');
  assert.equal(describeGridStep(100), '100 m');
  assert.equal(describeGridStep(1000), '1 km');
  assert.equal(describeGridStep(0.001), '1 mm');
  assert.equal(cameraVisibleHeight({ projection: 'orthographic', orthoScale: 8 }), 8);
  assert.ok(Math.abs(cameraVisibleHeight({ eye: [0, 0, 10], target: [0, 0, 0], fov: 90 }) - 20) < 1e-9);
  assert.ok(Math.abs(cameraVisibleHeight({ eye: [0, 0, 10], target: [0, 0, 0], focalLength: 24 }) - 10) < 1e-9);
});

test('the viewport planes follow the camera out, and its floor reaches past them', () => {
  const close = viewportClipPlanes({ eye: [4, 3, 5], target: [0, 0, 0], near: 0.1, far: 120 });
  assert.deepEqual(close, { near: 0.1, far: Math.hypot(4, 3, 5) * 80 });
  const distant = viewportClipPlanes({ eye: [0, 0, 400], target: [0, 0, 0], near: 0.1, far: 120 });
  assert.equal(distant.near, 4);
  assert.equal(distant.far, 32000);
  assert.deepEqual(viewportClipPlanes({ eye: [0, 0, 1], target: [0, 0, 0] }), { near: 0.1, far: 100 });
  const floor = viewportFloorPart(0.019);
  assert.equal(floor.material.tag, 'floor');
  assert.ok(Math.max(...floor.geometry.positions) > distant.far, 'the edge of the floor is never in view');
  assert.ok([1, 4, 7, 10].every(index => Math.abs(floor.geometry.positions[index] - 0.019) < 1e-6));
});

test('placeGridParts writes each line into the matrix of its part', () => {
  const layout = gridLayout();
  const matrix = new Float32Array(16);
  placeGridParts(new Map([[layout.lines[0].id, { matrix }]]), layout);
  assert.equal(matrix[15], 1);
  assert.ok(Math.abs(matrix[0] - layout.lines[0].scale[0]) < 1e-4);
  assert.ok(Math.abs(matrix[14] - layout.lines[0].translation[2]) < 1e-4);
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
