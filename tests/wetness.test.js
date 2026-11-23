import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createLightingState, updateLightingState } from '../src/lighting.js';
import { createFragmentShader, fragmentShader, WETNESS_FEATURE, SHADER_FEATURES } from '../src/shaders.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';
import { wetnessUniformValues, wetnessResponse, PUDDLE_SOURCES } from '../src/wetness.js';
import { wetnessKeepOutBoxes, KEEP_OUT_LIMIT } from '../src/wetness-keep-out.js';
import { findWaterSurface, flagWetMirrorParts, wetMirrorSurface } from '../src/water-reflection.js';

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

function partWithFootprint(minimumX, minimumZ, maximumX, maximumZ, matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) {
  const positions = new Float32Array([minimumX, 0, minimumZ, maximumX, 0.01, maximumZ]);
  return { geometry: { positions }, matrix };
}

test('keep-out boxes list thin parts at their world footprint and skip wide ones', () => {
  const marking = partWithFootprint(-0.1, -5, 0.1, 5, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 2, 1]);
  const road = partWithFootprint(-10, -20, 10, 20);
  const { boxes, count } = wetnessKeepOutBoxes([road, marking]);
  assert.equal(count, 1);
  assert.deepEqual([...boxes.slice(0, 4)].map((value) => Math.round(value * 100) / 100), [2.9, -3, 3.1, 7]);
});

test('keep-out boxes stop at the shader limit and ignore parts that deform', () => {
  const posts = Array.from({ length: KEEP_OUT_LIMIT + 5 }, (_, index) => partWithFootprint(index, 0, index + 0.2, 0.2));
  assert.equal(wetnessKeepOutBoxes(posts).count, KEEP_OUT_LIMIT);
  const skinned = { ...partWithFootprint(0, 0, 0.1, 0.1), skin: {} };
  assert.equal(wetnessKeepOutBoxes([skinned]).count, 0);
});

test('the wet shader fades puddles out near keep-out boxes', () => {
  const wet = createFragmentShader(new Set([...SHADER_FEATURES, WETNESS_FEATURE]));
  assert.match(wet, /wetnessKeepOut\[24\]/);
  assert.match(wet, /clearance = wetKeepOutDistance[(]worldPosition[)]/);
});

function groundPart(minimumX, minimumZ, maximumX, maximumZ, roughness = 0.95, metallic = 0) {
  const positions = new Float32Array([minimumX, -0.1, minimumZ, maximumX, 0, maximumZ]);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  return { geometry: { positions }, matrix: identity, material: { roughness, metallic } };
}

test('wet mirror mode takes a rough flat ground part that a dry scene would leave out', () => {
  const road = groundPart(-10, -20, 10, 20);
  assert.equal(findWaterSurface([road]), null);
  assert.equal(findWaterSurface([road], { wet: true }).height, 0);
});

test('wet mirror mode skips metal and flags the ground so the renderer can mirror it', () => {
  const metalSheet = groundPart(-10, -20, 10, 20, 0.2, 1);
  assert.equal(findWaterSurface([metalSheet], { wet: true }), null);
  const road = groundPart(-10, -20, 10, 20);
  const [flagged] = flagWetMirrorParts([road]);
  assert.equal(flagged.material.waterReflection, true);
  assert.equal(wetMirrorSurface([flagged]).height, 0);
  assert.equal(wetMirrorSurface([road]), null);
});
