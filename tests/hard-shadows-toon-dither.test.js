import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentLook, resolveAgentShadow, fitAgentShadow } from '../src/agent-look.js';
import { resolveShadowLight, shadowBiasPerSlope } from '../src/shadow-light.js';
import { snapShadowView } from '../src/hard-shadows.js';
import { effectiveShadowCascades } from '../src/cascaded-shadows.js';
import { createFragmentShader } from '../src/shaders.js';
import { createAgentScene } from '../src/agent-scene.js';
import { loadAgentSceneModules, agentSceneModulesNeeded } from '../src/agent-scene-modules.js';
import { AGENT_SCENE_CAPABILITIES } from '../src/agent-scene-capabilities.js';
import { materialLayerState, MATERIAL_LAYER_STATE_LENGTH } from '../src/material-layers.js';
import { MaterialSnapshot } from '../src/material-snapshot.js';

const BASE_RECIPE = {
  format: 'crucible.scene', schemaVersion: 1,
  geometries: [{ id: 'box', type: 'box' }],
  materials: [{ id: 'gray', color: [0.5, 0.5, 0.5] }],
  nodes: [{ id: 'block', geometry: 'box', material: 'gray' }],
};

function lightSpaceOffset(light, point) {
  const forward = light.target.map((value, axis) => value - light.eye[axis]);
  const length = Math.hypot(...forward);
  const unit = forward.map(value => value / length);
  const right = [unit[1] * 0 - unit[2] * 1, unit[2] * 0 - unit[0] * 0, unit[0] * 1 - unit[1] * 0];
  const rightLength = Math.hypot(...right);
  return right.reduce((sum, value, axis) => sum + (value / rightLength) * point[axis], 0);
}

test('shadow.hard is opt-in: a default look has no hard key and a true one reaches the renderer bounds', () => {
  assert.equal('hard' in normalizeAgentLook({}).shadow, false);
  assert.equal('hard' in resolveAgentShadow({}, [-3, 6, 4]), false);
  assert.equal(resolveAgentShadow({ hard: true }, [-3, 6, 4]).hard, true);
  assert.equal(normalizeAgentLook({ shadow: { hard: true } }).shadow.hard, true);
  assert.throws(() => normalizeAgentLook({ shadow: { hard: 1 } }), /shadow hard must be true or false/);
});

test('a shadow view fitted to a wide scene keeps hard', async () => {
  const recipe = { ...BASE_RECIPE, nodes: [{ id: 'block', geometry: 'box', material: 'gray', scale: [30, 4, 30] }], shadow: { hard: true } };
  await loadAgentSceneModules(recipe);
  const scene = createAgentScene(recipe);
  const fitted = fitAgentShadow(scene.shadow, scene.parts);
  assert.ok(fitted.extent > 3.5, 'the view was fitted');
  assert.equal(fitted.hard, true);
});

test('snapShadowView leaves a soft view alone and puts a hard view target on a whole texel', () => {
  const soft = resolveShadowLight(false, [-3, 6, 4], { extent: 3.5, target: [0.123, 1.017, 0.4] });
  assert.equal(snapShadowView(soft, 2048), soft);
  const hard = resolveShadowLight(false, [-3, 6, 4], { extent: 3.5, target: [0.123, 1.017, 0.4], hard: true });
  const snapped = snapShadowView(hard, 2048);
  const texel = 7 / 2048;
  const position = lightSpaceOffset(snapped, snapped.target);
  assert.ok(Math.abs(position / texel - Math.round(position / texel)) < 1e-6, `target is ${position / texel} texels along the light x axis`);
  const shift = Math.hypot(...snapped.target.map((value, axis) => value - hard.target[axis]));
  assert.ok(shift <= texel * Math.SQRT1_2 + 1e-9, `moved ${shift / texel} texels`);
  snapped.eye.forEach((value, axis) => assert.ok(Math.abs(value - snapped.target[axis] - (hard.eye[axis] - hard.target[axis])) < 1e-9));
});

test('two hard targets inside one texel snap to the same view, so a slow pan does not crawl', () => {
  const texel = 7 / 2048;
  const first = snapShadowView(resolveShadowLight(false, [0, 0.0001, 1], { extent: 3.5, target: [0.1 * texel, 1, 0], hard: true }), 2048);
  const second = snapShadowView(resolveShadowLight(false, [0, 0.0001, 1], { extent: 3.5, target: [0.3 * texel, 1, 0], hard: true }), 2048);
  first.target.forEach((value, axis) => assert.ok(Math.abs(value - second.target[axis]) < 1e-9));
});

test('a hard shadow asks for a smaller depth bias than the 3 by 3 filter', () => {
  const view = { extent: 3.5, near: 0.1, far: 15 };
  assert.ok(shadowBiasPerSlope({ ...view, hard: true }, 2048) < shadowBiasPerSlope(view, 2048));
});

test('automatic cascades stand aside for shadow.hard but an explicit count still wins', () => {
  assert.equal(effectiveShadowCascades({}, { extent: 80 }), 3);
  assert.equal(effectiveShadowCascades({}, { extent: 80, hard: true }), 0);
  assert.equal(effectiveShadowCascades({ shadowCascades: 2 }, { extent: 80, hard: true }), 2);
});

test('the hardShadows feature replaces shadowVisibility with one texel-centred compare and no other shader has it', async () => {
  await loadAgentSceneModules({ ...BASE_RECIPE, shadow: { hard: true } });
  const shader = createFragmentShader(['hardShadows']);
  assert.match(shader, /#define shadowVisibility\(normal\) hardShadowVisibility\(normal\)/);
  assert.match(shader, /floor\(projected\.xy \* size\) \+ 0\.5/);
  assert.doesNotMatch(createFragmentShader([]), /hardShadowVisibility/);
  assert.ok(agentSceneModulesNeeded({ ...BASE_RECIPE, shadow: { hard: true } }).includes('cascades'));
});

test('toonEdge is a 0 to 2 layer field in the state, the snapshot and the capabilities', async () => {
  const recipe = { ...BASE_RECIPE, materials: [{ id: 'gray', color: [0.5, 0.5, 0.5], toon: 3, toonEdge: 2 }] };
  await loadAgentSceneModules(recipe);
  assert.equal(createAgentScene(recipe).parts[0].material.toonEdge, 2);
  assert.throws(() => createAgentScene({ ...recipe, materials: [{ id: 'gray', toon: 3, toonEdge: 3 }] }), /toonEdge must be between 0 and 2/);
  const state = materialLayerState({ tag: 'surface', toon: 3, toonEdge: 2 });
  assert.equal(state.length, MATERIAL_LAYER_STATE_LENGTH);
  assert.equal(state.at(-1), 2);
  assert.equal(materialLayerState({ tag: 'surface', toon: 3 }).at(-1), 0);
  assert.ok(AGENT_SCENE_CAPABILITIES.materialLayers.toonEdge.note);
  const snapshot = new MaterialSnapshot({ tag: 'surface', toon: 3, toonEdge: 1 });
  assert.equal(snapshot.matches({ tag: 'surface', toon: 3, toonEdge: 2 }), false);
  assert.equal(snapshot.matches({ tag: 'surface', toon: 3, toonEdge: 1 }), true);
});

test('the toon feature carries the Bayer 4x4 threshold and the crisp edge, and default scenes carry neither', async () => {
  await loadAgentSceneModules({ ...BASE_RECIPE, materials: [{ id: 'gray', toon: 3 }] });
  const shader = createFragmentShader(['toon']);
  assert.match(shader, /const float BAYER_4\[16\]/);
  assert.match(shader, /materialToonEdge > 0\.5/);
  assert.doesNotMatch(createFragmentShader([]), /BAYER_4/);
});
