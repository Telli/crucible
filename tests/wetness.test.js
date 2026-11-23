import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createLightingState, updateLightingState } from '../src/lighting.js';
import { createFragmentShader, fragmentShader, WETNESS_FEATURE, SHADER_FEATURES } from '../src/shaders.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';
import { wetnessUniformValues, wetnessResponse, PUDDLE_SOURCES } from '../src/wetness.js';

function emptySession() {
  return createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [] });
}

test('a dry look has no wetness fields and the lighting state stays dry', () => {
  const { environment } = normalizeAgentLook({ environment: {} });
  assert.equal('wetness' in environment, false);
  assert.equal('puddles' in environment, false);
  const state = updateLightingState(createLightingState(), environment);
  assert.equal(state.wetness, 0);
  assert.deepEqual([...state.wetnessState], [0, 0, 0]);
});

test('wetness and puddles are bounded, and puddles fill in their defaults', () => {
  const { environment } = normalizeAgentLook({ environment: { wetness: 0.5, puddles: {} } });
  assert.equal(environment.wetness, 0.5);
  assert.deepEqual({ ...environment.puddles }, { coverage: 0.5, from: 'height' });
  for (const wetness of [-0.1, 1.1, 'wet']) {
    assert.throws(() => normalizeAgentLook({ environment: { wetness } }), /environment\.wetness/);
  }
  assert.throws(() => normalizeAgentLook({ environment: { puddles: { coverage: 2 } } }), /puddles\.coverage/);
  assert.throws(() => normalizeAgentLook({ environment: { puddles: { depth: 1 } } }), /puddles\.depth/);
  assert.throws(() => normalizeAgentLook({ environment: { puddles: 'many' } }), /environment\.puddles/);
});

test('an unknown puddle source is refused with the one to pass', () => {
  for (const from of ['cavity', 'mask', 'noise']) {
    assert.throws(() => normalizeAgentLook({ environment: { puddles: { from } } }), /puddles\.from.*pass from: "height"/);
  }
  assert.deepEqual(PUDDLE_SOURCES, ['height']);
});

test('puddles scale with wetness, so damp ground gets fewer than soaked ground', () => {
  const damp = wetnessUniformValues({ wetness: 0.5, puddles: { coverage: 0.8 } });
  assert.deepEqual([damp[0], Math.round(damp[1] * 1000) / 1000, damp[2]], [0.75, 0.6, 0]);
  assert.deepEqual(wetnessUniformValues({ wetness: 1, puddles: { coverage: 0.8 } }), [1, 0.8, 0]);
  assert.deepEqual(wetnessUniformValues({ puddles: { coverage: 0.8 } }), [0, 0, 0]);
  const state = updateLightingState(createLightingState(), { wetness: 0.5, puddles: { coverage: 0.8 } });
  assert.equal(state.wetness, 0.75);
  assert.ok(Math.abs(state.wetnessState[1] - 0.6) < 1e-6);
});

test('the wetness curve is visible by the middle of the range and keeps its ends', () => {
  assert.equal(wetnessResponse(0), 0);
  assert.equal(wetnessResponse(1), 1);
  assert.equal(wetnessResponse(0.5), 0.75);
  assert.ok(wetnessResponse(0.1) > 0.15);
});

test('the wetness code joins the fragment shader only when the feature is on', () => {
  const dry = createFragmentShader(SHADER_FEATURES);
  assert.equal(dry, fragmentShader);
  assert.equal(dry.includes('wetnessState'), false);
  const wet = createFragmentShader([...SHADER_FEATURES, WETNESS_FEATURE]);
  assert.match(wet, /uniform vec3 wetnessState;/);
  assert.match(wet, /float wetBasin\(/);
  assert.match(wet, /\(1\.0 - metallic\)/);
});

test('set-environment sets wetness and puddles and null clears them', () => {
  const session = emptySession();
  session.apply([{ type: 'set-environment', environment: { wetness: 1, puddles: { coverage: 0.6 } } }], { expectedRevision: session.revision });
  let recipe = session.exportRecipe();
  assert.equal(recipe.environment.wetness, 1);
  assert.equal(recipe.environment.puddles.coverage, 0.6);
  session.apply([{ type: 'set-environment', environment: { wetness: null, puddles: null } }], { expectedRevision: session.revision });
  recipe = session.exportRecipe();
  assert.equal(Object.hasOwn(recipe.environment, 'wetness'), false);
  assert.equal(Object.hasOwn(recipe.environment, 'puddles'), false);
});

test('scene_capabilities names the wetness topic with the sources the validator accepts', () => {
  const topic = AGENT_SCENE_CAPABILITIES.wetness;
  assert.deepEqual(topic.environment, ['environment.wetness', 'environment.puddles']);
  assert.deepEqual([...topic.puddles.from], PUDDLE_SOURCES);
  assert.match(topic.renderers, /path tracers ignore it/);
});
