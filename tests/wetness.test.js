import './support/load-agent-scene-modules.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentScene } from '../src/agent-scene.js';
import { createLightingState, updateLightingState } from '../src/lighting.js';
import { createFragmentShader, fragmentShader, WETNESS_FEATURE, SHADER_FEATURES } from '../src/shaders.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';
import { wetnessUniformValues, wetnessResponse, puddleShare, PUDDLE_SOURCES, PUDDLE_SHARE_CAP } from '../src/wetness.js';
import { puddleFillLevel, PUDDLE_LEVEL_TABLE, SOAKED_ROAD_ROUGHNESS_SCALE, WATER_SURFACE_ROUGHNESS } from '../src/wetness-shader.js';
import { wetnessKeepOutBoxes, wetnessGroundHeight, KEEP_OUT_LIMIT } from '../src/wetness-keep-out.js';
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
  assert.deepEqual([...state.wetnessState], [0, 0, 0, 0]);
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

test('the puddle share is a quarter of the ground at most, and grows with wetness and coverage', () => {
  assert.equal(PUDDLE_SHARE_CAP, 0.25);
  assert.equal(puddleShare(1, 1), 0.25);
  assert.equal(puddleShare(0.5, 0.5), 0.25 * 0.5 * 0.25);
  assert.equal(puddleShare(0, 1), 0);
  assert.deepEqual(wetnessUniformValues({ puddles: { coverage: 0.8 } }), [0, 0, 0, 0]);
  assert.deepEqual(wetnessUniformValues({ wetness: 1, puddles: { coverage: 0 } }), [1, 0, 0, 0]);
  const state = updateLightingState(createLightingState(), { wetness: 0.5, puddles: { coverage: 0.8 } });
  assert.equal(state.wetness, 0.75);
  assert.ok(Math.abs(state.wetnessState[1] - puddleFillLevel(puddleShare(0.5, 0.8))) < 1e-6);
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
  assert.match(wet, /uniform vec4 wetnessState;/);
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

function wetShaderSource() {
  return createFragmentShader(new Set([...SHADER_FEATURES, WETNESS_FEATURE]));
}

test('the fill level falls as the share grows, through the measured table', () => {
  const levels = [0, 0.005, 0.01, 0.02, 0.03, 0.0625, 0.1, 0.125, 0.2, 0.25].map(puddleFillLevel);
  for (let index = 1; index < levels.length; index++) assert.ok(levels[index] < levels[index - 1], `level ${index} falls`);
  for (const [share, level] of PUDDLE_LEVEL_TABLE) assert.ok(Math.abs(puddleFillLevel(share) - level) < 1e-9);
  assert.equal(puddleFillLevel(1), puddleFillLevel(0.25));
});

function raisedGround(height) {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, height, 0, 1];
  return { geometry: { positions: new Float32Array([-10, -0.1, -20, 10, 0, 20]) }, matrix: identity, material: { roughness: 0.95, metallic: 0 } };
}

test('the ground height is the top of the widest part, so a raised or sunk road is measured from itself', () => {
  assert.equal(wetnessGroundHeight([]), 0);
  for (const height of [3, -2, 0]) {
    const marking = partWithFootprint(-0.1, -5, 0.1, 5, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, height + 50, 0, 1]);
    assert.ok(Math.abs(wetnessGroundHeight([marking, raisedGround(height)]) - height) < 1e-6);
  }
});

test('the shader measures the water depth from the ground height, not from world y', () => {
  const wet = wetShaderSource();
  assert.ok(wet.includes('6.0 * (worldPosition.y - wetnessState.w)'));
  assert.equal(wet.includes('6.0 * worldPosition.y'), false);
});

test('only standing water mirrors: the road is set rough after the lighting and the water smooth', () => {
  const wet = wetShaderSource();
  assert.ok(wet.includes(`roughness = wetStanding > 0.99 ? ${WATER_SURFACE_ROUGHNESS.toFixed(2)} : mix(0.5, 0.35, wetStanding);`));
  assert.ok(wet.includes(`roughness * ${SOAKED_ROAD_ROUGHNESS_SCALE.toFixed(2)}`));
  assert.ok(WATER_SURFACE_ROUGHNESS < 0.1 && SOAKED_ROAD_ROUGHNESS_SCALE > 0.5, 'water is a mirror, soaked road is satin');
});

test('the water edge is narrow and pixel-wide, and the interior is flat and smooth', () => {
  const wet = wetShaderSource();
  assert.ok(wet.includes('standing = smoothstep(-edgeWidth, edgeWidth, stoneDepth) * gate'));
  assert.ok(wet.includes('float edgeWidth = max(fwidth(puddleDepth), 0.00001);'));
  assert.ok(wet.includes('normal = normalize(mix(normal, vec3(0.0, 1.0, 0.0), standing));'));
  assert.ok(wet.includes('float gate = smoothstep(0.996, 0.9995, geometricNormal.y)'));
});

test('grain and fine detail fade with the pixel footprint so the horizon does not speckle', () => {
  const wet = wetShaderSource();
  assert.ok(wet.includes('float pixelSize = sqrt(length(dFdx(worldPosition)) * length(dFdy(worldPosition)));'));
  assert.ok(wet.includes('* grainFade;'));
  assert.match(wet, /wetBasin[(]worldPosition, detailFade[)]/);
});
