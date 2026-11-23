import assert from 'node:assert/strict';
import test from 'node:test';
import { mat4 } from 'gl-matrix';
import { installRenderPasses } from '../src/render-passes.js';
import { installUserPasses } from '../src/user-pass.js';

function fakeContext() {
  return new Proxy({ FRAMEBUFFER_COMPLETE: 0x8cd5 }, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name === 'symbol') return undefined;
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      if (name === 'checkFramebufferStatus') return () => 0x8cd5;
      if (name === 'getExtension' || name === 'getParameter') return () => null;
      return () => ({});
    },
  });
}

function createStubRenderer({ withRenderPasses = true } = {}) {
  const frames = [];
  const renderer = {
    context: fakeContext(),
    canvas: { width: 32, height: 32 },
    postStages: [],
    batches: [],
    depthTexture: null,
    whiteTexture: {},
    inverseViewProjection: mat4.create(),
    benchmark: false,
    renderTargets: { record() {}, release() {} },
    drawsInOpaqueLoop: () => true,
    takesObjectIds: () => false,
    requireFeatureNames() {},
    resolveFrame() {},
    render(frame) {
      frames.push(frame.pass ?? 'lit');
    },
  };
  if (withRenderPasses) installRenderPasses(renderer);
  installUserPasses(renderer);
  return { renderer, frames };
}

const OBJECT_PASS = {
  name: 'mask-ball',
  objects: ['ball'],
  fragment: 'vec4 userPass(vec2 uv) { return vec4(vec3(objectSlotAt(uv) >= 0 ? 1.0 : 0.0), 1.0); }',
};

test('raw renderer automatically draws objectId before lit frame for user passes with objects', () => {
  const { renderer, frames } = createStubRenderer({ withRenderPasses: true });
  renderer.userPasses.set([OBJECT_PASS]);
  renderer.render({ eye: [0, 0, 3], target: [0, 0, 0] });
  renderer.render({ eye: [1, 0, 3], target: [0, 0, 0] });
  assert.deepEqual(frames, ['objectId', 'lit', 'objectId', 'lit']);
});

test('host-drawn objectId frame right before render(frame) is not drawn twice', () => {
  const { renderer, frames } = createStubRenderer({ withRenderPasses: true });
  renderer.userPasses.set([OBJECT_PASS]);
  const frame = { eye: [0, 0, 3], target: [0, 0, 0] };
  renderer.render({ ...frame, pass: 'objectId', previousCamera: undefined });
  renderer.render(frame);
  assert.deepEqual(frames, ['objectId', 'lit']);
});

test('pass with objects throws an actionable error when installRenderPasses was not called', () => {
  const { renderer } = createStubRenderer({ withRenderPasses: false });
  renderer.userPasses.set([OBJECT_PASS]);
  assert.throws(
    () => renderer.render({ eye: [0, 0, 3], target: [0, 0, 0] }),
    /installRenderPasses/,
  );
});

test('passSupport.texture returns null before a pass runs, and resolveFrame throws a clear error instead of null dereference', () => {
  const { renderer } = createStubRenderer({ withRenderPasses: true });
  renderer.passSupport.objectNames = () => ['ball'];
  assert.equal(renderer.passSupport.texture, null);
  assert.equal(renderer.passSupport.framebuffer, null);
  renderer.userPasses.set([OBJECT_PASS]);
  assert.throws(
    () => renderer.resolveFrame({ eye: [0, 0, 3], target: [0, 0, 0] }),
    /pass: "objectId"/,
  );
});
