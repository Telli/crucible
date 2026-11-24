import test from 'node:test';
import assert from 'node:assert/strict';
import { backFaceExit, drawsBackFaces, glassBackFaceGlsl } from '../src/glass-back-face.js';
import { ballLensExit, refractDirection } from '../src/glass-ball-lens.js';
import { liquidFragmentSource } from '../src/shaders.js';
import '../src/liquid-shader.js';

// Issue #3225: the exit bend comes from the shape's own back faces. An ellipsoid (radii 1.5, 0.6, 0.6) seen along -z by an orthographic camera
// is a closed shape the ball lens estimate (a sphere tangent to the front surface) cannot describe.
const radii = [1.5, 0.6, 0.6];
const cameraDistance = 10;
const project = point => ({ x: (point[0] + 2) / 4, y: (point[1] + 2) / 4, depth: (cameraDistance - point[2]) / 20 });
const backPoint = (x, y) => {
  const px = x * 4 - 2;
  const py = y * 4 - 2;
  const remainder = 1 - (px / radii[0]) ** 2 - (py / radii[1]) ** 2;
  return remainder > 0 ? [px, py, -radii[2] * Math.sqrt(remainder)] : null;
};
const backDepth = (x, y) => {
  const point = backPoint(x, y);
  return point ? project(point).depth : 1;
};
const backNormal = (x, y) => {
  const point = backPoint(x, y);
  if (!point) return null;
  const gradient = [point[0] / radii[0] ** 2, point[1] / radii[1] ** 2, point[2] / radii[2] ** 2];
  const length = Math.hypot(...gradient);
  return gradient.map(value => value / length);
};

function frontHit(px, py) {
  const z = radii[2] * Math.sqrt(1 - (px / radii[0]) ** 2 - (py / radii[1]) ** 2);
  const gradient = [px / radii[0] ** 2, py / radii[1] ** 2, z / radii[2] ** 2];
  const length = Math.hypot(...gradient);
  return { position: [px, py, z], normal: gradient.map(value => value / length) };
}

// The exact exit: intersect the inside ray with the ellipsoid, refract with its true normal.
function exactExit(position, normal, indexOfRefraction) {
  const inside = refractDirection([0, 0, -1], normal, 1 / indexOfRefraction);
  const a = inside.reduce((sum, value, axis) => sum + (value / radii[axis]) ** 2, 0);
  const b = 2 * inside.reduce((sum, value, axis) => sum + (value * position[axis]) / radii[axis] ** 2, 0);
  const distance = -b / a;
  const exitPosition = position.map((value, axis) => value + inside[axis] * distance);
  const gradient = exitPosition.map((value, axis) => value / radii[axis] ** 2);
  const outward = gradient.map(value => value / Math.hypot(...gradient));
  return { exitPosition, direction: refractDirection(inside, outward.map(value => -value), indexOfRefraction) };
}

const angleBetween = (first, second) => Math.acos(Math.min(1, first[0] * second[0] + first[1] * second[1] + first[2] * second[2]));

test('the back-face exit bends the ray where it leaves a closed non-spherical shape', () => {
  const front = frontHit(0.7, 0.2);
  const found = backFaceExit({ ...front, viewDirection: [0, 0, 1], indexOfRefraction: 1.5, thickness: 1.2, project, backDepth, backNormal, reversed: false });
  const exact = exactExit(front.position, front.normal, 1.5);
  assert.ok(found, 'the back face is found');
  assert.ok(angleBetween(found.direction, exact.direction) < 0.02, 'exit direction within 1 degree of the exact one');
  assert.ok(Math.hypot(...found.exitPosition.map((value, axis) => value - exact.exitPosition[axis])) < 0.02, 'exit point within 2 cm');
  const estimate = ballLensExit({ ...front, viewDirection: [0, 0, 1], indexOfRefraction: 1.5, radius: 0.6, thickness: 1.2 });
  assert.ok(angleBetween(estimate.direction, exact.direction) > 0.05, 'the sphere estimate is visibly off for this shape');
});

test('a ray that finds no back face returns null so the shader keeps the thickness heuristic', () => {
  const front = frontHit(0.7, 0.2);
  const empty = backFaceExit({ ...front, viewDirection: [0, 0, 1], indexOfRefraction: 1.5, thickness: 1.2, project, backDepth: () => 1, backNormal: () => null, reversed: false });
  assert.equal(empty, null);
});

test('only closed transmissive parts draw back faces; a cap with a continuing medium keeps the open-cap path', () => {
  assert.equal(drawsBackFaces({ transmission: 1, thickness: 0.4, mediumContinues: false }), true);
  assert.equal(drawsBackFaces({ transmission: 1, thickness: 0.4, mediumContinues: true }), false);
  assert.equal(drawsBackFaces({ transmission: 0, thickness: 0.4, mediumContinues: false }), false);
  assert.equal(drawsBackFaces({ transmission: 1, thickness: 0, mediumContinues: false }), false);
});

test('the liquid shader reads the back-face exit after the ball lens estimate', () => {
  const source = liquidFragmentSource();
  assert.ok(source.includes(glassBackFaceGlsl));
  assert.ok(source.indexOf('glassBackFaceRay(worldPosition') > source.indexOf('ballLensRay(worldPosition'));
});
