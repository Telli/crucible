import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STUDIO_PIXEL_RATIO_CAPS,
  detectStudioHardware,
  gatherStudioHardwareInputs,
  readableRendererName,
  resolveStudioPerformanceTier,
  studioPixelRatioFor,
} from '../src/studio-hardware.js';
import { STUDIO_PREFERENCE_DEFAULTS, normalizeStudioPreferences } from '../src/studio-preferences.js';

// Renderer strings as Chrome, Firefox and Safari report them through WEBGL_debug_renderer_info.
const RENDERER_TABLE = [
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 20, 8, 'sharp', 'NVIDIA GeForce RTX 3060'],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1050 Ti (0x00001C82) Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8, 'sharp', 'NVIDIA GeForce GTX 1050 Ti'],
  ['ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 16, 8, 'sharp', 'AMD Radeon RX 6700 XT'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)', 10, 8, 'sharp', 'Apple M5'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 16, 8, 'sharp', 'Intel Arc A770 Graphics'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)', 12, 8, 'balanced', 'Intel Iris Xe Graphics'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 8, 8, 'balanced', 'AMD Radeon Graphics'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 4, 'light', 'Intel UHD Graphics 620'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 4, 8, 'light', 'Intel UHD Graphics 630'],
  ['Mali-G78', 8, 4, 'light', 'Mali-G78'],
  ['Adreno (TM) 740', 8, 8, 'balanced', 'Adreno 740'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 8, 8, 'light', 'llvmpipe (LLVM 15.0.7, 256 bits)'],
  ['Microsoft Basic Render Driver', 8, 8, 'light', 'Microsoft Basic Render Driver'],
  ['Apple GPU', 6, 8, 'balanced', 'Apple GPU'],
  ['', 12, 8, 'balanced', ''],
];

test('each renderer string lands in its tier, with the browser wrapping taken off the name', () => {
  for (const [rendererName, cores, memoryGigabytes, tier, name] of RENDERER_TABLE) {
    const found = detectStudioHardware({ rendererName, cores, memoryGigabytes });
    assert.equal(found.tier, tier, rendererName || '(no renderer)');
    assert.equal(readableRendererName(rendererName), name, rendererName || '(no renderer)');
    assert.ok(found.summary.length > 0);
  }
});

test('a software renderer goes light on any machine', () => {
  const swiftShader = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)';
  assert.equal(detectStudioHardware({ rendererName: swiftShader, cores: 28, memoryGigabytes: 8 }).tier, 'light');
});

test('an integrated chip on a very large screen draws too many pixels and goes light', () => {
  const integrated = 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
  assert.equal(detectStudioHardware({ rendererName: integrated, cores: 12, memoryGigabytes: 8, screenPixels: 2_073_600 }).tier, 'balanced');
  assert.equal(detectStudioHardware({ rendererName: integrated, cores: 12, memoryGigabytes: 8, screenPixels: 8_294_400 }).tier, 'light');
  const discrete = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  assert.equal(detectStudioHardware({ rendererName: discrete, cores: 2, memoryGigabytes: 2, screenPixels: 8_294_400 }).tier, 'sharp', 'a discrete card stays sharp on any screen');
});

test('the summary names what was found and says so when nothing was reported', () => {
  const found = detectStudioHardware({
    rendererName: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    cores: 20,
    memoryGigabytes: 8,
    devicePixelRatio: 2,
  });
  assert.equal(found.summary, 'NVIDIA GeForce RTX 3060, 20 cores, 8 GB, 2x screen');
  assert.deepEqual(detectStudioHardware(), { tier: 'balanced', summary: 'Hardware not reported' });
});

test('the inputs are read from a WebGL context and the browser, and a missing one is left out', () => {
  const glContext = {
    getExtension: name => (name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null),
    getParameter: parameter => (parameter === 37446 ? 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)' : null),
  };
  const inputs = gatherStudioHardwareInputs({
    glContext,
    navigatorReference: { hardwareConcurrency: 10, deviceMemory: 8 },
    windowReference: { devicePixelRatio: 2, screen: { width: 1512, height: 982 } },
  });
  assert.deepEqual(inputs, {
    rendererName: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
    cores: 10,
    memoryGigabytes: 8,
    devicePixelRatio: 2,
    screenPixels: 5_939_136,
  });
  const nothing = gatherStudioHardwareInputs({ glContext: null, navigatorReference: {}, windowReference: {} });
  assert.deepEqual(nothing, { rendererName: '', cores: undefined, memoryGigabytes: undefined, devicePixelRatio: 1, screenPixels: undefined });
  const blocked = { getExtension: () => { throw new Error('blocked'); } };
  assert.equal(gatherStudioHardwareInputs({ glContext: blocked, navigatorReference: {}, windowReference: {} }).rendererName, '');
});

test('a tier caps the pixel ratio and Automatic stands for the detected tier', () => {
  assert.deepEqual(STUDIO_PIXEL_RATIO_CAPS, { light: 1, balanced: 1.5, sharp: 2 });
  assert.equal(studioPixelRatioFor('light', 3), 1);
  assert.equal(studioPixelRatioFor('balanced', 3), 1.5);
  assert.equal(studioPixelRatioFor('sharp', 3), 2);
  assert.equal(studioPixelRatioFor('sharp', 1), 1, 'a screen below the cap keeps its own ratio');
  assert.equal(studioPixelRatioFor('sharp', undefined), 1);
  assert.equal(resolveStudioPerformanceTier('automatic', 'light'), 'light');
  assert.equal(resolveStudioPerformanceTier('sharp', 'light'), 'sharp');
});

test('the theme, performance and setup preferences are kept when valid and defaulted when not', () => {
  assert.equal(STUDIO_PREFERENCE_DEFAULTS.theme, 'system');
  assert.equal(STUDIO_PREFERENCE_DEFAULTS.performance, 'automatic');
  assert.equal(STUDIO_PREFERENCE_DEFAULTS.setupDone, false);
  const kept = normalizeStudioPreferences({ theme: 'dark', performance: 'sharp', setupDone: true });
  assert.deepEqual([kept.theme, kept.performance, kept.setupDone], ['dark', 'sharp', true]);
  const dropped = normalizeStudioPreferences({ theme: 'pink', performance: 'ultra', setupDone: 'yes' });
  assert.deepEqual([dropped.theme, dropped.performance, dropped.setupDone], ['system', 'automatic', false]);
});
