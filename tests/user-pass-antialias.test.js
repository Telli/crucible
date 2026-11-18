import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { installUserPasses, normalizePostPassesAntialias, planUserPassSteps } from '../src/user-pass.js';

const LINE_PASS = { name: 'lines', fragment: 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv); }' };
const SECOND_PASS = { name: 'tint', fragment: 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv) * 0.5; }' };

function recordingContext(calls) {
  return new Proxy({}, {
    get(target, name) {
      if (typeof name === 'symbol') return undefined;
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      if (name === 'checkFramebufferStatus') return () => 1;
      return (...args) => {
        calls.push([name, ...args]);
        return true;
      };
    },
  });
}

function rendererWith(passes, antialias) {
  const calls = [];
  const renderer = {
    context: recordingContext(calls), canvas: { width: 16, height: 9 }, postStages: [], depthTexture: 'depth', whiteTexture: 'white',
    inverseViewProjection: mat4.create(), resolveFrame() {}, benchmark: false,
  };
  installUserPasses(renderer);
  renderer.userPasses.set(passes);
  if (antialias !== undefined) renderer.userPasses.setAntialias(antialias);
  return { renderer, calls };
}

function drawnPrograms(calls) {
  const drawCount = calls.filter(call => call[0] === 'drawArrays').length;
  const sources = calls.filter(call => call[0] === 'shaderSource').map(call => call[2]);
  return { drawCount, edgeSmoothingCompiled: sources.some(source => source.includes('lumaOf')) };
}

test('the edge antialias step is planned after the last user pass, unless it is off or the last pass is scaled down', () => {
  assert.deepEqual(planUserPassSteps([{ name: 'a', scale: 1 }, { name: 'b', scale: 1 }]).map(step => step.kind), ['pass', 'pass', 'antialias']);
  assert.deepEqual(planUserPassSteps([{ name: 'a', scale: 1 }], 'off').map(step => step.kind), ['pass']);
  assert.deepEqual(planUserPassSteps([]).map(step => step.kind), []);
  assert.deepEqual(planUserPassSteps([{ name: 'a', scale: 0.25 }]).map(step => step.kind), ['pass']);
  assert.deepEqual(planUserPassSteps([{ name: 'a', scale: 0.5 }, { name: 'b', scale: 1 }]).map(step => step.kind), ['pass', 'pass', 'antialias']);
});

test('postPassesAntialias defaults to fxaa and names the allowed values when it is wrong', () => {
  assert.equal(normalizePostPassesAntialias(undefined), 'fxaa');
  assert.equal(normalizePostPassesAntialias('off'), 'off');
  assert.throws(() => normalizePostPassesAntialias('smaa'), /must be one of "fxaa", "off", got "smaa"/);
  assert.throws(() => normalizePostPassesAntialias(2), /must be one of "fxaa", "off"/);
});

test('the renderer runs one edge antialias draw after the last user pass', () => {
  const { renderer, calls } = rendererWith([LINE_PASS, SECOND_PASS]);
  renderer.resolveFrame({ time: 0 });
  assert.deepEqual(drawnPrograms(calls), { drawCount: 3, edgeSmoothingCompiled: true });
  const draws = calls.map((call, index) => [call, index]).filter(([call]) => call[0] === 'drawArrays').map(([, index]) => index);
  const lastFramebufferBeforeLastPass = calls.slice(0, draws[1]).findLast(call => call[0] === 'bindFramebuffer');
  assert.notEqual(lastFramebufferBeforeLastPass[2], null, 'the last pass draws into a target, not the canvas');
  const lastFramebufferBeforeSmoothing = calls.slice(0, draws[2]).findLast(call => call[0] === 'bindFramebuffer');
  assert.equal(lastFramebufferBeforeSmoothing[2], null, 'the antialias draw writes the canvas');
});

test('off and an empty pass list draw no antialias step', () => {
  const off = rendererWith([LINE_PASS, SECOND_PASS], 'off');
  off.renderer.resolveFrame({ time: 0 });
  assert.deepEqual(drawnPrograms(off.calls), { drawCount: 2, edgeSmoothingCompiled: false });
  const none = rendererWith([]);
  none.renderer.resolveFrame({ time: 0 });
  assert.deepEqual(drawnPrograms(none.calls), { drawCount: 0, edgeSmoothingCompiled: false });
});
