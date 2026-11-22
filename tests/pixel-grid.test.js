import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { installPixelGrid, normalizePixelGrid, paddedGridSize, snapFrameToGrid } from '../src/pixel-grid.js';
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
  assert.deepEqual(snapFrameToGrid(frame, GRID), { frame, remainder: [0, 0] });
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
