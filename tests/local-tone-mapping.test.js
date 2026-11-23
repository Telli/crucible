// Local tone mapping (#2798): a post step that compresses a blurred log-luminance base and keeps the detail. It exists only when a recipe names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { resolveEffects } from '../src/effects.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { agentSceneModulesNeeded, loadAgentSceneModules } from '../src/agent-scene-modules.js';
import { createPostFragment, postFragment } from '../src/post.js';
import { installCameraEffects } from '../src/camera-effects.js';
import { installPostSteps, resolvePostSteps, localToneMappingFragment } from '../src/post-steps.js';

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

function fakeRenderer(context) {
  return { postStages: [], context, canvas: { width: 16, height: 9 }, hdr: true, depthTexture: 'depth', inverseViewProjection: mat4.create(), viewForward: [0, 0, -1] };
}

test('naming the step resolves bounded defaults and refuses bad input with a fix', () => {
  assert.deepEqual(resolvePostSteps({ localToneMapping: {} }).localToneMapping, { strength: 0.5, highlightContrast: 0.6, shadowContrast: 0.6, detail: 1, blurRadius: 0.08 });
  assert.deepEqual(resolvePostSteps({ localToneMapping: { strength: 1, blurRadius: 0.2 } }).localToneMapping.blurRadius, 0.2);
  assert.equal(resolvePostSteps({ saturation: 1 }).localToneMapping, undefined);
  assert.throws(() => resolvePostSteps({ localToneMapping: { strength: 2 } }), /localToneMapping.strength must be between 0 and 1/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { highlightContrast: -1 } }), /localToneMapping.highlightContrast must be between/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { detail: 3 } }), /localToneMapping.detail must be between 0 and 2/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { blurRadius: 0.5 } }), /localToneMapping.blurRadius must be between 0.01 and 0.25/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { radius: 0.1 } }), /Unknown localToneMapping field/);
  assert.throws(() => resolvePostSteps({ localToneMapping: [] }), /localToneMapping must be an object/);
});

test('the look accepts the group and resolves it the same way twice', async () => {
  const input = { effects: { localToneMapping: { strength: 0.8, detail: 1.2 } } };
  assert.ok(agentSceneModulesNeeded(input).includes('postSteps'));
  await loadAgentSceneModules(input);
  const first = normalizeAgentLook(input).effects.localToneMapping;
  const second = normalizeAgentLook(input).effects.localToneMapping;
  assert.deepEqual(first, second);
  assert.equal(first.strength, 0.8);
  assert.throws(() => normalizeAgentLook({ effects: { localToneMapping: { strength: 5 } } }), /localToneMapping.strength/);
});

test('a scene that does not name the step loads no code, no shader text and no pass for it', async () => {
  assert.equal(agentSceneModulesNeeded({ effects: { bloom: { strength: 0.3 } } }).includes('postSteps'), false);
  assert.equal(Object.hasOwn(normalizeAgentLook({}).effects, 'localToneMapping'), false);
  assert.deepEqual(resolveEffects({}), resolveEffects({ saturation: 1 }));
  assert.equal(postFragment, createPostFragment());
  assert.doesNotMatch(postFragment, /logLuminance|localToneMapping|baseLod/);
  const calls = [];
  const context = recordingContext(calls);
  const renderer = installPostSteps(installCameraEffects(fakeRenderer(context)));
  const stage = renderer.postStages.find(candidate => candidate.name === 'Local tone mapping');
  calls.length = 0;
  const neutral = { localToneMapping: { highlightContrast: 1, shadowContrast: 1, detail: 1 } };
  assert.equal(stage.apply(renderer, { eye: [0, 1, 5], effects: neutral }, resolveEffects({}), 'source'), null, 'values that change nothing draw nothing');
  assert.equal(stage.apply(renderer, { eye: [0, 1, 5], effects: {} }, resolveEffects({}), 'source'), null);
  assert.equal(stage.apply(renderer, { eye: [0, 1, 5], effects: { localToneMapping: { strength: 0 } } }, resolveEffects({}), 'source'), null);
  assert.deepEqual(calls, [], 'an unused step touches no GL state, so it draws no pass and builds no mip chain');
});

test('a frame that sets the step builds the mip chain once, draws one pass and restores the filter', () => {
  const calls = [];
  const context = recordingContext(calls);
  const renderer = installPostSteps(installCameraEffects(fakeRenderer(context)));
  const stage = renderer.postStages.find(candidate => candidate.name === 'Local tone mapping');
  assert.ok(stage.apply(renderer, { eye: [0, 1, 5], effects: { localToneMapping: { strength: 1 } } }, resolveEffects({}), 'source'));
  assert.equal(calls.filter(call => call[0] === 'generateMipmap').length, 1);
  assert.equal(calls.filter(call => call[0] === 'drawArrays').length, 1);
  assert.match(localToneMappingFragment, /textureLod/);
});

test('the shader has a fixed tap pattern and reads no history, so a seek repeats the same pixels', () => {
  assert.match(localToneMappingFragment, /^#version 300 es/);
  assert.doesNotMatch(localToneMappingFragment, /previousViewProjection|\btime\b/);
});

test('a renderer without a float frame leaves the step off and draws nothing', () => {
  const calls = [];
  const context = recordingContext(calls);
  const renderer = installPostSteps(installCameraEffects({ ...fakeRenderer(context), hdr: false }));
  const stage = renderer.postStages.find(candidate => candidate.name === 'Local tone mapping');
  calls.length = 0;
  assert.equal(stage.apply(renderer, { eye: [0, 1, 5], effects: { localToneMapping: { strength: 1 } } }, resolveEffects({}), 'source'), null);
  assert.deepEqual(calls, []);
});
