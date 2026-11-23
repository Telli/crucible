// Local tone mapping (#2798): a post step that compresses a blurred log-luminance base and keeps the detail. It exists only when a recipe names it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mat4 } from 'gl-matrix';
import { resolveEffects } from '../src/effects.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { agentSceneModulesNeeded, loadAgentSceneModules } from '../src/agent-scene-modules.js';
import { createPostFragment, postFragment } from '../src/post.js';
import { installCameraEffects } from '../src/camera-effects.js';
import { installPostSteps, resolvePostSteps, localToneMappingFragment, localToneMappedLog } from '../src/post-steps.js';

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
  assert.deepEqual(resolvePostSteps({ localToneMapping: {} }).localToneMapping, { strength: 0.4, highlightContrast: 0.6, shadowContrast: 0.6, detail: 1, blurRadius: 0.08, midtoneRange: 1.5 });
  assert.deepEqual(resolvePostSteps({ localToneMapping: { strength: 1, blurRadius: 0.2 } }).localToneMapping.blurRadius, 0.2);
  assert.equal(resolvePostSteps({ saturation: 1 }).localToneMapping, undefined);
  assert.throws(() => resolvePostSteps({ localToneMapping: { strength: 2 } }), /localToneMapping.strength must be between 0 and 1/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { highlightContrast: -1 } }), /localToneMapping.highlightContrast must be between/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { detail: 3 } }), /localToneMapping.detail must be between 0 and 2/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { blurRadius: 0.5 } }), /localToneMapping.blurRadius must be between 0.01 and 0.25/);
  assert.throws(() => resolvePostSteps({ localToneMapping: { midtoneRange: 5 } }), /localToneMapping.midtoneRange must be between 0 and 4/);
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

// The grey look An saw (#2798): the first version pulled the whole base toward middle grey, so the frame lost its darks and its lights. These pin what the curve keeps.
const STOP = Math.LN2;
const PIVOT_LOG = Math.log(0.18);
const demoRecipe = resolvePostSteps({ localToneMapping: { strength: 1, highlightContrast: 0.35, shadowContrast: 0.35, detail: 1, blurRadius: 0.1 } }).localToneMapping;
const defaultRecipe = resolvePostSteps({ localToneMapping: {} }).localToneMapping;

function rampInStops(settings, fromStop, toStop) {
  const inputs = [];
  const outputs = [];
  for (let stop = fromStop; stop <= toStop; stop += 0.25) {
    inputs.push(PIVOT_LOG + stop * STOP);
    outputs.push(localToneMappedLog(PIVOT_LOG + stop * STOP, 0, settings));
  }
  return { inputs, outputs };
}

function standardDeviation(values) {
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
}

test('midtones within the knee keep their contrast and only the tails are compressed', () => {
  const { inputs, outputs } = rampInStops(demoRecipe, -1, 1);
  inputs.forEach((input, index) => assert.ok(Math.abs(outputs[index] - input) < 0.12, 'a stop either side of middle grey stays within 0.12 of the input in natural-log units'));
  const bright = localToneMappedLog(PIVOT_LOG + 5 * STOP, 0, demoRecipe);
  assert.ok(bright < PIVOT_LOG + 5 * STOP - 0.5, 'a base five stops over middle grey is pulled down');
  const dark = localToneMappedLog(PIVOT_LOG - 4 * STOP, 0, demoRecipe);
  assert.ok(dark > PIVOT_LOG - 4 * STOP + 0.4, 'a base four stops under middle grey is lifted');
});

test('the global contrast of a full range ramp stays near what it was, even at the recipe that went grey', () => {
  const { inputs, outputs } = rampInStops(demoRecipe, -6, 6);
  const keptByDemo = standardDeviation(outputs) / standardDeviation(inputs);
  assert.ok(keptByDemo > 0.6, 'the strong recipe keeps over 60 percent of the log contrast, where a curve with no knee kept under 50: ' + keptByDemo);
  const defaults = rampInStops(defaultRecipe, -6, 6);
  const keptByDefault = standardDeviation(defaults.outputs) / standardDeviation(defaults.inputs);
  assert.ok(keptByDefault > 0.85, 'the defaults keep over 85 percent: ' + keptByDefault);
});

test('a shadow is lifted by a bounded amount, so the darkest base stays dark', () => {
  for (const stop of [-3, -6, -10, -16]) {
    const lift = localToneMappedLog(PIVOT_LOG + stop * STOP, 0, demoRecipe) - (PIVOT_LOG + stop * STOP);
    assert.ok(lift >= 0 && lift <= 1.386 + 1e-9, 'lift at ' + stop + ' stops is ' + lift);
  }
});

test('the curve is monotonic, so a brighter base never maps darker than a dimmer one', () => {
  const { outputs } = rampInStops({ ...demoRecipe, highlightContrast: 0, shadowContrast: 0 }, -10, 10);
  outputs.forEach((output, index) => index > 0 && assert.ok(output >= outputs[index - 1] - 1e-9));
});

test('strength 0 and contrasts of 1 leave the pixel as it was, and detail is added back by its gain', () => {
  for (const settings of [{ ...demoRecipe, strength: 0 }, { ...demoRecipe, highlightContrast: 1, shadowContrast: 1 }]) {
    assert.ok(Math.abs(localToneMappedLog(PIVOT_LOG + 3 * STOP, 0.3, settings) - (PIVOT_LOG + 3 * STOP + 0.3)) < 1e-9);
  }
  assert.ok(Math.abs(localToneMappedLog(PIVOT_LOG, 0.5, { ...demoRecipe, detail: 2 }) - localToneMappedLog(PIVOT_LOG, 0, demoRecipe) - 1) < 1e-9);
});

test('the shader scales all three channels by one gain, so hue and saturation survive', () => {
  assert.ok(localToneMappingFragment.includes('outputColor = vec4(source.rgb * exp(mappedLog - centerLog), source.a)'));
  const color = [0.8, 0.2, 0.05];
  const gain = Math.exp(localToneMappedLog(Math.log(0.3), 0, demoRecipe) - Math.log(0.3));
  const mapped = color.map(channel => channel * gain);
  assert.ok(Math.abs(mapped[0] / mapped[1] - color[0] / color[1]) < 1e-9);
  assert.ok(Math.abs(mapped[1] / mapped[2] - color[1] / color[2]) < 1e-9);
  assert.match(localToneMappingFragment, /tanh\(lowWanted/, 'the shader caps the lift the same way the reference does');
});
