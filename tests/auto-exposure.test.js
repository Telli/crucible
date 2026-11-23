// Automatic exposure (#2797): the recipe boundary, the metering and adaptation math, the post program and scene_inspect. None of it needs a GPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { requireFeatureCode } from '../src/shader-registry.js';
import { agentSceneModulesNeeded, loadAgentSceneModules } from '../src/agent-scene-modules.js';
import { normalizeAgentLook } from '../src/agent-look.js';
import { createAgentScene } from '../src/agent-scene.js';
import * as post from '../src/post.js';
import { resolveAutoExposure, meteredLuminance, targetExposure, adaptExposure } from '../src/auto-exposure.js';

const GRID_SIZE = 16;

function gridOf(valueAt) {
  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (unused, index) => valueAt(index % GRID_SIZE, Math.floor(index / GRID_SIZE)));
}

test('autoExposure fills defaults and names the field and the fix when an input is wrong', () => {
  assert.deepEqual(resolveAutoExposure({}), { metering: 'average', key: 0.18, minimum: 0.25, maximum: 4, speed: 1.5 });
  assert.equal(resolveAutoExposure({ metering: 'centre-weighted', speed: 4 }).metering, 'centre-weighted');
  assert.throws(() => resolveAutoExposure({ metering: 'spot' }), /metering must be one of average, centre-weighted\. Pass "average"/);
  assert.throws(() => resolveAutoExposure({ key: 0 }), /effects\.autoExposure\.key must be between 0\.01 and 1/);
  assert.throws(() => resolveAutoExposure({ speed: 0 }), /speed must be between/);
  assert.throws(() => resolveAutoExposure({ minimum: 5, maximum: 2 }), /minimum \(5\) must not exceed maximum \(2\)\. Pass a minimum at or below the maximum/);
  assert.throws(() => resolveAutoExposure({ gain: 1 }), /Unknown effects\.autoExposure field "gain"/);
  assert.throws(() => resolveAutoExposure('on'), /must be an object/);
});

test('a recipe that names autoExposure loads the post steps and keeps the resolved group in the look', async () => {
  const look = { effects: { autoExposure: { metering: 'centre-weighted', maximum: 8 } } };
  assert.ok(agentSceneModulesNeeded(look).includes('postSteps'));
  await loadAgentSceneModules(look);
  const effects = normalizeAgentLook(look).effects;
  assert.deepEqual(effects.autoExposure, { metering: 'centre-weighted', key: 0.18, minimum: 0.25, maximum: 8, speed: 1.5 });
  assert.equal(Object.hasOwn(normalizeAgentLook({ effects: {} }).effects, 'autoExposure'), false);
  assert.throws(() => normalizeAgentLook({ effects: { autoExposure: { key: 3 } } }), /autoExposure\.key/);
});

test('the meter averages log luminance, and centre weighting follows the middle of the frame', () => {
  const grey = gridOf(() => Math.log(0.5));
  assert.ok(Math.abs(meteredLuminance(grey, 'average') - 0.5) < 1e-9);
  assert.ok(Math.abs(meteredLuminance(grey, 'centre-weighted') - 0.5) < 1e-9);
  // Bright rim and dark middle: the average sits between, centre weighting leans dark.
  const brightRim = gridOf((column, row) => (column >= 4 && column < 12 && row >= 4 && row < 12 ? Math.log(0.05) : Math.log(2)));
  const average = meteredLuminance(brightRim, 'average');
  const centred = meteredLuminance(brightRim, 'centre-weighted');
  assert.ok(centred < average, `centre ${centred} should be below average ${average}`);
  assert.ok(average > 0.05 && average < 2);
  assert.throws(() => meteredLuminance([1, 2, 3], 'average'), /holds 256 values/);
});

test('the target exposure brings the metered luminance to the key inside the limits', () => {
  const settings = resolveAutoExposure({ key: 0.18, minimum: 0.25, maximum: 4 });
  assert.equal(targetExposure(0.18, settings), 1);
  assert.equal(targetExposure(0.09, settings), 2);
  assert.equal(targetExposure(100, settings), 0.25);
  assert.equal(targetExposure(0, settings), 4);
});

test('adaptation follows the frame time: it snaps on a first frame, a repeat or a seek back, and converges at the speed', () => {
  assert.equal(adaptExposure(null, 2, 0, 1), 2);
  assert.equal(adaptExposure({ exposure: 1, time: 1 }, 2, 1, 1), 2);
  assert.equal(adaptExposure({ exposure: 1, time: 1 }, 2, 0.5, 1), 2);
  const oneSecond = adaptExposure({ exposure: 1, time: 0 }, 4, 1, 1);
  const expected = Math.exp(Math.log(4) * (1 - Math.exp(-1)));
  assert.ok(Math.abs(oneSecond - expected) < 1e-12);
  const faster = adaptExposure({ exposure: 1, time: 0 }, 4, 1, 4);
  assert.ok(faster > oneSecond && faster < 4);
});

test('two runs over the same frames at a fixed step give the same exposures, whatever the wall clock does', () => {
  const settings = resolveAutoExposure({ speed: 2 });
  const lumaByFrame = [0.4, 0.4, 0.02, 0.02, 0.02, 0.6, 0.6];
  const run = (wait) => {
    let state = null;
    return lumaByFrame.map((luminance, frame) => {
      wait();
      const exposure = adaptExposure(state, targetExposure(luminance, settings), frame / 24, settings.speed);
      state = { exposure, time: frame / 24 };
      return exposure;
    });
  };
  const first = run(() => {});
  const second = run(() => { for (let spin = 0; spin < 20000; spin++) Math.sqrt(spin); });
  assert.deepEqual(first, second);
  assert.ok(first[2] > first[1] && first[2] < targetExposure(0.02, settings), 'the exposure moves toward the dark scene without jumping');
});

test('the default post program is unchanged; the step adds the scale before the tone map in its own program only', async () => {
  await loadAgentSceneModules({ effects: { autoExposure: {} } });
  const display = post.createPostFragment(post.POST_STEPS);
  assert.equal(display, post.postFragment);
  assert.equal(display.includes('autoExposureScale'), false);
  assert.equal(post.POST_STEPS.includes('autoExposure'), false);
  const metered = post.createPostFragment([...post.POST_STEPS, 'autoExposure']);
  const scaleAt = metered.indexOf('color *= autoExposureScale;');
  assert.ok(scaleAt > metered.indexOf('volumeFog(color)'));
  assert.ok(scaleAt < metered.indexOf('2.51 * color'));
  assert.equal(metered.match(/uniform float autoExposureScale;/g).length, 1);
  assert.equal(createHash('sha256').update(display).digest('hex'), createHash('sha256').update(post.createPostFragment()).digest('hex'));
});

function meteringContext(logLuminance) {
  return new Proxy({}, {
    get(target, name) {
      if (typeof name === 'symbol') return undefined;
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      if (name === 'checkFramebufferStatus') return () => 1;
      if (name === 'readPixels') return (...args) => args[6].fill(logLuminance);
      return () => ({});
    },
  });
}

function meteringRenderer(logLuminance, hdr = true) {
  const backend = { startProgram: () => ({}), finishProgram: () => ({}) };
  return { hdr, backend, context: meteringContext(logLuminance) };
}

test('measure returns the scale that brings the frame to the key and keeps the chosen exposure for scene_inspect', async () => {
  await loadAgentSceneModules({ effects: { autoExposure: {} } });
  const { measure } = requireFeatureCode('autoExposure');
  const renderer = meteringRenderer(Math.log(0.09));
  const effects = { autoExposure: { key: 0.18, minimum: 0.25, maximum: 4 } };
  // The frame was lit at exposure 0.5, so its luminance at exposure 1 is 0.18 and the exposure to choose is 1: a scale of 2.
  const scale = measure(renderer, { effects, exposure: 0.5, time: 0 }, {});
  assert.ok(Math.abs(scale - 2) < 1e-6);
  assert.ok(Math.abs(renderer.autoExposure.exposure - 1) < 1e-6);
  assert.ok(Math.abs(renderer.autoExposure.luminance - 0.18) < 1e-6);
  assert.throws(() => measure(meteringRenderer(0, false), { effects, time: 0 }, {}), /needs an HDR renderer/);
});

test('scene_inspect lists the autoExposure settings with chosen null until a frame has been drawn', async () => {
  const look = { effects: { autoExposure: { key: 0.2 } } };
  await loadAgentSceneModules(look);
  const scene = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [], ...look });
  assert.deepEqual(scene.inspect().look.autoExposure, { metering: 'average', key: 0.2, minimum: 0.25, maximum: 4, speed: 1.5, chosen: null });
  const plain = createAgentScene({ format: 'crucible.scene', schemaVersion: 1, geometries: [], materials: [], nodes: [] });
  assert.equal(Object.hasOwn(plain.inspect().look, 'autoExposure'), false);
});
