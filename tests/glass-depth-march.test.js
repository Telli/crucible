import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { depthMapping, glassDepthMarchGlsl, isBehindSurface, marchDistance, marchSceneDepth, refractedScreenPosition } from '../src/glass-depth-march.js';
import { glassOutputCoverage, refractDirection } from '../src/glass-ball-lens.js';
import { resolveSceneDepth } from '../src/liquid-renderer.js';
import { liquidFragmentSource } from '../src/shaders.js';
import '../src/liquid-shader.js';

// Issue #3148 round 3: glass marches its refracted ray against the opaque scene's depth. The tests use a synthetic depth buffer
// (a wall at z = -5 with a nearer block at z = -3, sky on the right) seen by a 60 degree camera at the origin, in both depth conventions.

const projection = mat4.perspective(mat4.create(), Math.PI / 3, 1, 0.1, 100);

function makeScene(reversed) {
  const mapping = depthMapping(reversed);
  const project = point => {
    const x = projection[0] * point[0] + projection[8] * point[2];
    const y = projection[5] * point[1] + projection[9] * point[2];
    const z = projection[10] * point[2] + projection[14];
    const w = -point[2];
    if (w <= 0) return null;
    const clipDepth = reversed ? (w - z) / 2 : z;
    return { x: x / w * 0.5 + 0.5, y: y / w * 0.5 + 0.5, depth: clipDepth / w * mapping.scale + mapping.bias };
  };
  const wallDepth = project([0, 0, -5]).depth;
  const blockDepth = project([0, 0, -3]).depth;
  const clearDepth = reversed ? 0 : 1;
  const sceneDepth = (x, y) => {
    if (x > 0.7) return clearDepth;
    if (x > 0.4 && x < 0.6 && y > 0.4 && y < 0.6) return blockDepth;
    return wallDepth;
  };
  return { project, sceneDepth, reversed };
}

const marchFrom = (scene, direction, origin = [0, 0, -1], maximumDistance = 8) => marchSceneDepth({ origin, direction, maximumDistance, ...scene });
const lengthOf = vector => Math.hypot(...vector);
const unit = vector => vector.map(value => value / lengthOf(vector));

for (const reversed of [false, true]) {
  const label = reversed ? 'reversed' : 'standard';

  test(`the march finds the wall a ray reaches (${label} depth)`, () => {
    const scene = makeScene(reversed);
    const direction = unit([-0.3, 0.1, -1]);
    const hit = marchFrom(scene, direction);
    const expectedDistance = 4 / -direction[2];
    assert.ok(hit, 'the ray reaches the wall');
    assert.ok(Math.abs(hit.distance - expectedDistance) < 0.05, `hit at ${hit.distance}, wall at ${expectedDistance}`);
    const wallPoint = [direction[0] * expectedDistance, direction[1] * expectedDistance, -1 + direction[2] * expectedDistance];
    const expectedScreen = scene.project(wallPoint);
    assert.ok(Math.abs(hit.x - expectedScreen.x) < 0.01 && Math.abs(hit.y - expectedScreen.y) < 0.01);
  });

  test(`the march stops at the nearer block, not the wall behind it (${label} depth)`, () => {
    const scene = makeScene(reversed);
    const hit = marchFrom(scene, [0, 0, -1]);
    assert.ok(hit);
    assert.ok(Math.abs(hit.distance - 2) < 0.05, `block face at 2 m, hit at ${hit.distance}`);
  });

  test(`a ray that leaves the screen or only meets the sky misses (${label} depth)`, () => {
    const scene = makeScene(reversed);
    assert.equal(marchFrom(scene, unit([-1, 0, -0.2])), null, 'off the left edge');
    assert.equal(marchFrom(scene, unit([0.12, 0, -1]), [0.9, 0, -1]), null, 'into the cleared sky on the right');
  });

  test(`a miss falls back to the point a short reach along the ray (${label} depth)`, () => {
    const scene = makeScene(reversed);
    const origin = [0.9, 0, -1];
    const direction = unit([0.12, 0, -1]);
    const result = refractedScreenPosition({ origin, direction, maximumDistance: 8, fallbackReach: 0.5, ...scene });
    const expected = scene.project([origin[0] + direction[0] * 0.5, origin[1], origin[2] + direction[2] * 0.5]);
    assert.equal(result.marched, false);
    assert.ok(Math.abs(result.x - expected.x) < 1e-9 && Math.abs(result.y - expected.y) < 1e-9);
    const hit = refractedScreenPosition({ origin: [0, 0, -1], direction: [0, 0, -1], maximumDistance: 8, fallbackReach: 0.5, ...scene });
    assert.equal(hit.marched, true, 'a ray that hits uses the hit, not the fallback');
  });
}

test('behind means a larger depth in a standard buffer and a smaller one in a reversed buffer', () => {
  assert.equal(isBehindSurface(0.6, 0.5, false), true);
  assert.equal(isBehindSurface(0.4, 0.5, false), false);
  assert.equal(isBehindSurface(0.4, 0.5, true), true);
  assert.equal(isBehindSurface(0.6, 0.5, true), false);
  assert.deepEqual(depthMapping(false), { scale: 0.5, bias: 0.5 });
  assert.deepEqual(depthMapping(true), { scale: 1, bias: 0 });
});

test('the march steps grow with the square, so a close backdrop is sampled finely', () => {
  assert.equal(marchDistance(0, 32, 8), 0);
  assert.equal(marchDistance(32, 32, 8), 8);
  assert.equal(marchDistance(16, 32, 8), 2);
});

test('Snell: the ray bends toward the normal entering glass, keeps its direction at normal incidence and fails in total internal reflection', () => {
  const normal = [0, 0, 1];
  const straight = refractDirection([0, 0, -1], normal, 1 / 1.5);
  assert.ok(Math.abs(straight[2] + 1) < 1e-12 && Math.abs(straight[0]) < 1e-12);
  const incident = unit([Math.sin(Math.PI / 6), 0, -Math.cos(Math.PI / 6)]);
  const bent = refractDirection(incident, normal, 1 / 1.5);
  assert.ok(Math.abs(bent[0] - 0.5 / 1.5) < 1e-12, `sin of the refracted angle is sin(30) / 1.5, got ${bent[0]}`);
  assert.ok(Math.abs(lengthOf(bent) - 1) < 1e-12);
  const grazing = unit([0.9, 0, -0.1]);
  assert.equal(refractDirection(grazing, normal, 1.5), null, 'glass to air past the critical angle');
});

test('transmission raises the coverage of blended glass, so a low alpha leaves no unrefracted ghost', () => {
  assert.equal(glassOutputCoverage(0.25, 1), 1, 'a cornea with alpha 0.25 and full transmission replaces the scene behind it');
  assert.equal(glassOutputCoverage(0.25, 0), 0.25, 'without transmission the alpha is kept');
  assert.equal(glassOutputCoverage(1, 0.5), 1);
  assert.ok(Math.abs(glassOutputCoverage(0.2, 0.5) - 0.6) < 1e-12);
  assert.ok(liquidFragmentSource().includes('glassOutputCoverage(glassCoverage, transmissionShare)'));
});

test('the liquid program carries the march and the default program does not', () => {
  assert.ok(liquidFragmentSource().includes(glassDepthMarchGlsl));
  assert.ok(liquidFragmentSource().includes('marchSceneDepth(rayOrigin, rayDirection'));
});

function recordingContext() {
  const calls = [];
  const constants = { TEXTURE_2D: 'TEXTURE_2D', FRAMEBUFFER: 'FRAMEBUFFER', READ_FRAMEBUFFER: 'READ', DRAW_FRAMEBUFFER: 'DRAW', DEPTH_BUFFER_BIT: 'DEPTH', DEPTH_COMPONENT24: 'D24', DEPTH_COMPONENT32F: 'D32F', NEAREST: 'NEAREST' };
  let nextId = 0;
  const context = new Proxy({}, {
    get(target, name) {
      if (name in constants) return constants[name];
      if (typeof name !== 'string' || /^[A-Z_0-9]+$/.test(name)) return name;
      return (...args) => {
        calls.push([name, ...args]);
        return name.startsWith('create') ? { id: ++nextId } : undefined;
      };
    },
  });
  return { context, calls };
}

test('the depth copy is built on first use, refilled every frame by a depth blit, and freed on release', () => {
  const { context, calls } = recordingContext();
  const renderer = { context, reversedDepth: false, multisampleFramebuffer: { id: 'multisample' } };
  const first = resolveSceneDepth(renderer, 960, 540);
  assert.equal(calls.find(call => call[0] === 'texImage2D')[3], 'D24');
  assert.equal(calls.filter(call => call[0] === 'blitFramebuffer')[0][9], 'DEPTH');
  assert.equal(resolveSceneDepth(renderer, 960, 540), first);
  assert.equal(calls.filter(call => call[0] === 'texImage2D').length, 1);
  assert.equal(calls.filter(call => call[0] === 'blitFramebuffer').length, 2);
  renderer.reversedDepth = true;
  resolveSceneDepth(renderer, 960, 540);
  assert.equal(calls.filter(call => call[0] === 'texImage2D')[1][3], 'D32F', 'a reversed buffer needs a float copy');
  renderer.refractionDepth.release();
  assert.equal(renderer.refractionDepth, null);
});
