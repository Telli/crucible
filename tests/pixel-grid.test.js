import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { blockLatticeOrigin, installPixelGrid, normalizePixelGrid, paddedGridSize, snapFrameToGrid } from '../src/pixel-grid.js';
import { installPostSteps, stylizeFragment } from '../src/post-steps.js';
import { installCameraEffects } from '../src/camera-effects.js';
import { resolveEffects } from '../src/effects.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';
import { installUserPasses } from '../src/user-pass.js';
import { createAgentScene } from '../src/agent-scene.js';
import { loadAgentSceneModules } from '../src/agent-scene-modules.js';

const GRID = { width: 256, height: 144, pad: 2 };
const NEAREST = 9728;
const LINEAR = 9729;

function recordingContext(calls) {
  return new Proxy({}, {
    get(target, name) {
      if (typeof name === 'symbol') return undefined;
      if (name === 'NEAREST') return NEAREST;
      if (name === 'LINEAR') return LINEAR;
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      if (name === 'checkFramebufferStatus') return () => 1;
      if (name === 'getContextAttributes') return () => ({ alpha: false });
      return (...args) => {
        calls.push([name, ...args]);
        return { name };
      };
    },
  });
}

// A renderer with just the surface the grid touches: it records the size its targets are allocated at and the frames it renders.
function stubRenderer(outputWidth = 1280, outputHeight = 720) {
  const calls = [];
  const realCanvas = { width: outputWidth, height: outputHeight, clientWidth: outputWidth, clientHeight: outputHeight };
  const renderer = {
    context: recordingContext(calls), canvas: realCanvas, postStages: [], pixelRatio: 1, baseSamples: 4, denseSamples: null,
    multisampleSamples: 4, capabilities: { samples: 4 }, benchmark: false, renderedFrames: [], allocations: [],
    backend: { supportedSampleCount: (format, samples) => samples },
    chooseMultisampleSamples() { return this.baseSamples; },
    resize() {
      this.canvas.width = Math.round(this.canvas.clientWidth * this.pixelRatio);
      this.canvas.height = Math.round(this.canvas.clientHeight * this.pixelRatio);
    },
    allocateFrameTargets(width, height) { this.allocations.push([width, height]); },
    render(frame) { this.renderedFrames.push(frame); this.resolveFrame(frame); },
    resolveFrame() {},
  };
  return { renderer, realCanvas, calls };
}

const orthographicFrame = (eye, target) => ({ eye, target, up: [0, 1, 0], projection: 'orthographic', orthographicHeight: 14.4 });

test('normalizePixelGrid fills the pad and rejects what it cannot use with a fix', () => {
  assert.deepEqual(normalizePixelGrid({ width: 256, height: 144 }), GRID);
  assert.equal(normalizePixelGrid(null), null);
  assert.throws(() => normalizePixelGrid({ width: 0, height: 144 }), /pixelGrid\.width.*Fix:/s);
  assert.throws(() => normalizePixelGrid({ width: 256, height: 1.5 }), /pixelGrid\.height/);
  assert.throws(() => normalizePixelGrid({ width: 256, height: 144, pad: -1 }), /pixelGrid\.pad/);
  assert.throws(() => normalizePixelGrid({ width: 256, height: 144, scale: 2 }), /no field "scale"/);
  assert.throws(() => normalizePixelGrid('256x144'), /must be an object/);
});

test('the padded target is the grid plus the pad on every side', () => {
  assert.deepEqual(paddedGridSize(GRID), { width: 260, height: 148 });
});

test('an orthographic camera snaps to whole texels and the remainder stays inside half a texel', () => {
  const texelSize = 14.4 / 144;
  for (const offset of [0, 0.013, 0.049, 0.051, 0.37, -0.22]) {
    const { frame, remainder } = snapFrameToGrid(orthographicFrame([offset, 3, 10], [offset, 3, 0]), GRID);
    const snappedTexels = frame.eye[0] / texelSize;
    assert.ok(Math.abs(snappedTexels - Math.round(snappedTexels)) < 1e-9, `eye x ${frame.eye[0]} is a whole number of texels`);
    assert.ok(Math.abs(remainder[0]) <= 0.5 + 1e-9, `remainder ${remainder[0]} stays within half a texel`);
    assert.ok(Math.abs(remainder[1]) <= 0.5 + 1e-9);
    assert.ok(Math.abs(frame.eye[0] + remainder[0] * texelSize - offset) < 1e-9, 'the snap plus the remainder is the original camera');
    assert.equal(frame.orthographicHeight, 14.4 * 148 / 144, 'the pad widens the view so the visible grid keeps its texel size');
  }
});

test('snapping follows the camera axes, not the world axes', () => {
  const texelSize = 14.4 / 144;
  const { frame } = snapFrameToGrid(orthographicFrame([7.013, 5.031, 7.013], [0.013, 0.031, 0.013]), GRID);
  const right = [Math.SQRT1_2, 0, -Math.SQRT1_2];
  const rightOffset = frame.eye[0] * right[0] + frame.eye[2] * right[2];
  assert.ok(Math.abs(rightOffset / texelSize - Math.round(rightOffset / texelSize)) < 1e-9);
  assert.deepEqual(frame.eye.map((value, axis) => +(value - frame.target[axis]).toFixed(9)), [7, 5, 7], 'the view direction is unchanged');
});

test('a perspective frame passes through unchanged', () => {
  const frame = { eye: [1, 2, 3], target: [0, 0, 0], fov: 45 };
  assert.deepEqual(snapFrameToGrid(frame, GRID), { frame, remainder: [0, 0], texel: [0, 0] });
});

test('the grid sizes the renderer\'s canvas to the padded grid and the real canvas to the output', () => {
  const { renderer, realCanvas } = stubRenderer();
  installPixelGrid(renderer);
  renderer.pixelGrid.set(GRID);
  assert.deepEqual([renderer.canvas.width, renderer.canvas.height], [260, 148], 'targets see the padded grid');
  assert.deepEqual([realCanvas.width, realCanvas.height], [1280, 720], 'the canvas keeps the output size');
  assert.deepEqual(renderer.allocations.at(-1), [260, 148]);
  assert.equal(renderer.multisampleSamples, 1);
  assert.equal(renderer.baseSamples, 1);
  renderer.pixelGrid.set(null);
  assert.deepEqual([renderer.canvas.width, renderer.canvas.height], [1280, 720]);
  assert.deepEqual(renderer.allocations.at(-1), [1280, 720]);
  assert.equal(renderer.baseSamples, 4, 'the sample count comes back');
});

test('a canvas smaller than the padded grid names the size it needs', () => {
  const { renderer } = stubRenderer(200, 100);
  installPixelGrid(renderer);
  assert.throws(() => renderer.pixelGrid.set(GRID), /needs 260x148/);
});

test('with a grid on, render snaps the frame and the blit carries the remainder; without one, nothing changes', () => {
  const { renderer, calls } = stubRenderer();
  installPixelGrid(renderer);
  const frame = orthographicFrame([0.013, 3, 10], [0.013, 3, 0]);
  renderer.render(frame);
  assert.equal(renderer.renderedFrames[0], frame, 'no grid: the very same frame object');
  assert.equal(calls.filter(call => call[0] === 'drawArrays').length, 0, 'no grid: no blit');
  renderer.pixelGrid.set(GRID);
  renderer.render(frame);
  assert.notEqual(renderer.renderedFrames[1], frame);
  const remainderCall = calls.findLast(call => call[0] === 'uniform2f' && call[2] !== 256);
  assert.ok(Math.abs(remainderCall[2]) > 0 && Math.abs(remainderCall[2]) <= 0.5, `remainder uniform ${remainderCall[2]}`);
  const copy = calls.find(call => call[0] === 'copyTexSubImage2D');
  assert.deepEqual(copy.slice(-2), [260, 148], 'the whole padded grid is copied out of the canvas corner');
  const viewport = calls.findLast(call => call[0] === 'viewport');
  assert.deepEqual(viewport.slice(1), [0, 0, 1280, 720], 'the blit covers the output canvas');
  assert.ok(calls.some(call => call[0] === 'texParameteri' && call[3] === NEAREST), 'the blit source is read nearest');
  assert.ok(!calls.some(call => call[0] === 'texParameteri' && call[3] === LINEAR));
});

test('user passes on a grid capture nearest and skip the edge smoothing', () => {
  const calls = [];
  const renderer = {
    context: recordingContext(calls), canvas: { width: 260, height: 148 }, postStages: [], depthTexture: 'depth', whiteTexture: 'white',
    inverseViewProjection: mat4.create(), resolveFrame() {}, benchmark: false, pixelGrid: { active: true },
  };
  installUserPasses(renderer);
  renderer.userPasses.set([{ name: 'tint', fragment: 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv); }' }]);
  renderer.userPasses.setAntialias('fxaa');
  renderer.resolveFrame({});
  assert.ok(!calls.some(call => call[0] === 'shaderSource' && call[2].includes('lumaOf')), 'fxaa is off on a grid');
  assert.ok(!calls.some(call => call[0] === 'texParameteri' && call[3] === LINEAR), 'no linear filter');
  assert.ok(calls.some(call => call[0] === 'texParameteri' && call[3] === NEAREST));
});

test('a recipe without pixelGrid has none, and one with it is checked', async () => {
  const plain = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [] });
  assert.equal(plain.pixelGrid, null);
  const withGrid = { format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [], pixelGrid: { width: 0, height: 9 } };
  await loadAgentSceneModules(withGrid);
  assert.throws(() => createAgentScene(withGrid), /pixelGrid\.width/);
  withGrid.pixelGrid.width = 64;
  assert.deepEqual(createAgentScene(withGrid).pixelGrid, { width: 64, height: 9, pad: 2 });
});

// Like recordingContext, but a uniform location is the uniform's own name, so a test can read which value went to which uniform.
function namedUniformContext(calls) {
  const base = recordingContext(calls);
  return new Proxy(base, {
    get(target, name) {
      if (name === 'getUniformLocation') return (program, uniformName) => uniformName;
      return Reflect.get(target, name);
    },
  });
}

const uniformValue = (calls, method, uniformName) => calls.findLast(call => call[0] === method && call[1] === uniformName)?.slice(2);
const viewportSizes = calls => calls.filter(call => call[0] === 'viewport').map(call => call.slice(3));
const PASS_THROUGH = 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv); }';

test('the block lattice follows the snapped texel, so a whole-texel pan moves the lattice with the camera', () => {
  assert.deepEqual(blockLatticeOrigin([0, 0], 4), [0, 0]);
  assert.deepEqual(blockLatticeOrigin([5, 9], 4), [1, 1]);
  assert.deepEqual(blockLatticeOrigin([-1, -6], 4), [3, 2], 'negative texels wrap into the block');
  const texelSize = 14.4 / 144;
  const texels = [0, 1, 2, 5].map(step => {
    const offset = step * texelSize + 0.013;
    return snapFrameToGrid(orthographicFrame([offset, 3, 10], [offset, 3, 0]), GRID).texel[0];
  });
  assert.deepEqual(texels.map(texel => texel - texels[0]), [0, 1, 2, 5], 'each whole-texel pan moves the texel index by that many');
});

test('the renderer lattice is zero off the grid, follows main frames, and a render pass leaves it alone', () => {
  const { renderer } = stubRenderer();
  installPixelGrid(renderer);
  assert.deepEqual(renderer.pixelGrid.latticeOrigin(4), [0, 0]);
  renderer.pixelGrid.set(GRID);
  const texelSize = 14.4 / 144;
  const mainFrame = orthographicFrame([3 * texelSize, 3, 10], [3 * texelSize, 3, 0]);
  renderer.render(mainFrame);
  const expected = blockLatticeOrigin(snapFrameToGrid(mainFrame, GRID).texel, 4);
  assert.deepEqual(renderer.pixelGrid.latticeOrigin(4), expected);
  renderer.render({ ...orthographicFrame([41 * texelSize, 3, 10], [41 * texelSize, 3, 0]), pass: 'depth' });
  assert.deepEqual(renderer.pixelGrid.latticeOrigin(4), expected, 'a pass frame does not move the lattice of the lit frame');
  renderer.pixelGrid.set(null);
  assert.deepEqual(renderer.pixelGrid.latticeOrigin(4), [0, 0]);
});

test('depth, normal and object ID pass frames on the padded grid are presented across the output like the lit frame', () => {
  const texelSize = 14.4 / 144;
  for (const pass of ['depth', 'normal', 'objectId']) {
    const { renderer, calls } = stubRenderer();
    installPixelGrid(renderer);
    const frame = { ...orthographicFrame([0.013, 3, 10], [0.013, 3, 0]), pass };
    renderer.render(frame);
    assert.equal(calls.filter(call => call[0] === 'copyTexSubImage2D').length, 0, `${pass}: no grid, no present`);
    renderer.pixelGrid.set(GRID);
    renderer.render(frame);
    const renderedTexels = renderer.renderedFrames.at(-1).eye[0] / texelSize;
    assert.ok(Math.abs(renderedTexels - Math.round(renderedTexels)) < 1e-9, `${pass}: the pass renders from the snapped camera`);
    const copy = calls.findLast(call => call[0] === 'copyTexSubImage2D');
    assert.deepEqual(copy.slice(-2), [260, 148], `${pass}: the whole padded grid is copied`);
    assert.deepEqual(calls.findLast(call => call[0] === 'viewport').slice(1), [0, 0, 1280, 720], `${pass}: drawn across the output canvas`);
    const remainder = calls.findLast(call => call[0] === 'uniform2f' && call[2] !== 256);
    assert.deepEqual(remainder.slice(2), snapFrameToGrid(frame, GRID).remainder, `${pass}: shifted by its own remainder, like the lit frame`);
  }
  const { renderer, calls } = stubRenderer();
  installPixelGrid(renderer);
  renderer.pixelGrid.set(GRID);
  renderer.render({ ...orthographicFrame([0.013, 3, 10], [0.013, 3, 0]), pass: 'depth', reflectionTarget: {} });
  renderer.render({ ...orthographicFrame([0.013, 3, 10], [0.013, 3, 0]), pass: 'emission', emissionMaskPass: true });
  assert.equal(calls.filter(call => call[0] === 'copyTexSubImage2D').length, 0, 'reflection and emission mask frames stay internal');
});

test('stylize pixelate starts its blocks on the grid lattice, and at zero off the grid', () => {
  const calls = [];
  const renderer = installPostSteps(installCameraEffects({
    postStages: [], context: namedUniformContext(calls), canvas: { width: 260, height: 148 }, hdr: false, depthTexture: 'depth',
    inverseViewProjection: mat4.create(), viewForward: [0, 0, -1],
  }));
  const stage = renderer.postStages.find(candidate => candidate.name === 'Stylize');
  const frame = { eye: [0, 1, 5], effects: { stylize: { pixelate: 4 } } };
  stage.apply(renderer, frame, resolveEffects({}), 'source');
  assert.deepEqual(uniformValue(calls, 'uniform2fv', 'pixelateOrigin'), [[0, 0]], 'no grid: blocks start at zero, as before');
  renderer.pixelGrid = { active: true, latticeOrigin: size => (size === 4 ? [1, 3] : [9, 9]) };
  stage.apply(renderer, frame, resolveEffects({}), 'source');
  assert.deepEqual(uniformValue(calls, 'uniform2fv', 'pixelateOrigin'), [[1, 3]]);
  assert.match(stylizeFragment, /floor\(\(coordinate \* resolution \+ pixelateOrigin\) \/ pixelateSize\)/);
  stage.releaseTargets(renderer.context);
  stage.dispose(renderer.context);
});

function gridUserPassRenderer(calls, origin) {
  const renderer = {
    context: namedUniformContext(calls), canvas: { width: 260, height: 148 }, postStages: [], depthTexture: 'depth', whiteTexture: 'white',
    inverseViewProjection: mat4.create(), resolveFrame() {}, benchmark: false,
    pixelGrid: { active: true, latticeOrigin: () => origin },
  };
  installUserPasses(renderer);
  return renderer;
}

test('a user pass below scale 1 on the grid draws one pixel per block on the lattice and enlarges back to the grid', () => {
  const calls = [];
  const renderer = gridUserPassRenderer(calls, [1, 2]);
  renderer.userPasses.set([{ name: 'blocks', scale: 0.25, fragment: PASS_THROUGH }, { name: 'tint', fragment: PASS_THROUGH }]);
  renderer.resolveFrame({});
  assert.deepEqual(viewportSizes(calls), [[66, 38], [260, 148], [260, 148]], 'block count (ceil((260 + 1) / 4), ceil((148 + 2) / 4)), the enlarge, the next pass');
  const scales = calls.filter(call => call[0] === 'uniform2fv' && call[1] === 'u67_uvScale').map(call => call[2]);
  assert.deepEqual(scales, [[66 * 4 / 260, 38 * 4 / 148], [1, 1]]);
  const offsets = calls.filter(call => call[0] === 'uniform2fv' && call[1] === 'u67_uvOffset').map(call => call[2]);
  assert.deepEqual(offsets, [[-1.5 / 260, -2.5 / 148], [0, 0]], 'an even block reads the pixel just before its centre');
  const resolutions = calls.filter(call => call[0] === 'uniform2f' && call[1] === 'resolution').map(call => call.slice(2));
  assert.deepEqual(resolutions, [[65, 37], [260, 148]], 'the block pass reports its block count as resolution');
  assert.deepEqual(uniformValue(calls, 'uniform1f', 'blockSize'), [4]);
  assert.deepEqual(uniformValue(calls, 'uniform2fv', 'blockOrigin'), [[1, 2]]);
  assert.ok(calls.some(call => call[0] === 'shaderSource' && call[2].includes('texelFetch(sourceTexture, clamp(block')), 'the enlarge reads whole blocks');
  renderer.userPasses.set([]);
});

test('an odd block reads its middle pixel, a scale that rounds to one pixel runs at the grid size, and off the grid nothing changes', () => {
  const oddCalls = [];
  const odd = gridUserPassRenderer(oddCalls, [2, 0]);
  odd.userPasses.set([{ name: 'thirds', scale: 1 / 3, fragment: PASS_THROUGH }]);
  odd.resolveFrame({});
  assert.deepEqual(uniformValue(oddCalls, 'uniform2fv', 'u67_uvOffset')[0].map(value => value + 0), [-2 / 260, 0]);
  assert.deepEqual(viewportSizes(oddCalls), [[88, 50], [260, 148]]);

  const nearCalls = [];
  const near = gridUserPassRenderer(nearCalls, [0, 0]);
  near.userPasses.set([{ name: 'near', scale: 0.8, fragment: PASS_THROUGH }]);
  near.resolveFrame({});
  assert.deepEqual(viewportSizes(nearCalls), [[260, 148]], 'scale 0.8 on the grid: one pass at the grid size');
  assert.equal(uniformValue(nearCalls, 'uniform1f', 'blockSize'), undefined, 'no enlarge');

  const offCalls = [];
  const off = gridUserPassRenderer(offCalls, [1, 2]);
  off.pixelGrid = undefined;
  off.userPasses.set([{ name: 'blocks', scale: 0.25, fragment: PASS_THROUGH }]);
  off.resolveFrame({});
  assert.deepEqual(viewportSizes(offCalls)[0], [65, 37], 'off the grid the pass keeps its scaled size');
  assert.deepEqual(uniformValue(offCalls, 'uniform2fv', 'u67_uvScale'), [[1, 1]]);
  assert.deepEqual(uniformValue(offCalls, 'uniform2fv', 'u67_uvOffset'), [[0, 0]]);
});

test('scene_apply set-pixel-grid sets, replaces and clears the grid, and refuses a bad one', () => {
  assert.ok(AGENT_SCENE_CAPABILITIES.operations.includes('set-pixel-grid'));
  const scene = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [] });
  scene.apply([{ type: 'set-pixel-grid', pixelGrid: { width: 256, height: 144 } }], { expectedRevision: scene.revision });
  assert.deepEqual(scene.pixelGrid, GRID);
  assert.deepEqual(scene.exportRecipe().pixelGrid, GRID);
  scene.apply([{ type: 'set-pixel-grid', pixelGrid: { width: 128, height: 72, pad: 1 } }], { expectedRevision: scene.revision });
  assert.deepEqual(scene.pixelGrid, { width: 128, height: 72, pad: 1 });
  assert.throws(() => scene.apply([{ type: 'set-pixel-grid', pixelGrid: { width: 0, height: 72 } }], { expectedRevision: scene.revision }), /pixelGrid\.width/);
  assert.deepEqual(scene.pixelGrid, { width: 128, height: 72, pad: 1 }, 'a refused op leaves the grid as it was');
  assert.throws(() => scene.apply([{ type: 'set-pixel-grid' }], { expectedRevision: scene.revision }), /pixelGrid/);
  scene.apply([{ type: 'set-pixel-grid', pixelGrid: null }], { expectedRevision: scene.revision });
  assert.equal(scene.pixelGrid, null);
  assert.equal(Object.hasOwn(scene.exportRecipe(), 'pixelGrid'), false, 'cleared, the recipe reads as if it never had a grid');
});
