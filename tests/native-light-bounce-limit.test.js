import assert from 'node:assert/strict';

import { cookModule, cookTest } from './support/cook.js';
import { box } from '../src/geometry.js';
import { createCamera } from '../src/path-tracer.js';
import * as pack from '../src/path-tracer-gpu-pack.js';
import { buildTraceScene } from '../src/path-tracer-scene.js';

const cook = await cookModule();
const { STRUCT_STRIDES_V2, buildNativeInput, buildNativeInputV2, upgradeNativeInputV1ToV2 } = cook ?? {};

const LIGHT_FLAGS_WORD_INDEX = 7;
const LIGHT_BOUNCE_LIMIT_SHIFT = 8;
const LIGHT_BOUNCE_LIMIT_MASK = 0xff;

function floorPart() {
  const matrix = new Float32Array([4, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, 4, 0, 0, -0.05, 0, 1]);
  return { name: 'floor', geometry: box(0, 1), matrix, material: { color: [0.5, 0.5, 0.5] } };
}

// A sun, a point, a spot and an area light, in the order Cook packs them.
function lampEnvironment(limits) {
  return {
    keyColor: [1, 1, 1],
    lightDirection: [0, 1, 0],
    ...limits.environment,
    pointLights: [{ position: [0, 2, 0], color: [1, 1, 1], intensity: 5, radius: 0.3, ...limits.point }],
    spotLights: [{ position: [1, 3, 0], direction: [0, -1, 0], angle: 0.6, intensity: 5, radius: 0.2, ...limits.spot }],
    areaLights: [{ position: [2, 3, 0], direction: [0, -1, 0], width: 1, height: 1, intensity: 5, ...limits.area }],
  };
}

const cameraDescription = { eye: [0, 1, 6], target: [0, 0, 0], fov: 45 };
const optionsOfPack = { width: 8, height: 8, samples: 1 };

// The limit each of the four light records carries: -1 for none, else the limit.
function packedLimits(v2) {
  const stride = STRUCT_STRIDES_V2.light;
  const words = new Uint32Array(v2.lights.buffer, v2.lights.byteOffset, v2.lights.byteLength / 4);
  return [0, 1, 2, 3].map(index => ((words[(index * stride) / 4 + LIGHT_FLAGS_WORD_INDEX] >>> LIGHT_BOUNCE_LIMIT_SHIFT) & LIGHT_BOUNCE_LIMIT_MASK) - 1);
}

const LIMITS = { environment: { sunMaxBounces: 2 }, point: { maxBounces: 0 }, spot: { maxBounces: 1 }, area: { maxBounces: 254 } };

cookTest('the v2 light records carry the limit of the sun and of each point, spot and area light', () => {
  const scene = buildTraceScene([floorPart()], lampEnvironment(LIMITS));
  const v2 = buildNativeInputV2(scene, createCamera(cameraDescription, 8, 8), optionsOfPack);
  assert.deepEqual(packedLimits(v2), [2, 0, 1, 254]);
});

cookTest('the v1 input a render job packs keeps the same limits through its upgrade to v2', () => {
  const scene = buildTraceScene([floorPart()], lampEnvironment(LIMITS));
  const v1 = buildNativeInput(scene, createCamera(cameraDescription, 8, 8), optionsOfPack, pack);
  assert.deepEqual(packedLimits(upgradeNativeInputV1ToV2(v1, optionsOfPack)), [2, 0, 1, 254]);
});

cookTest('lights without a limit pack as no limit in both input versions', () => {
  const scene = buildTraceScene([floorPart()], lampEnvironment({}));
  const camera = createCamera(cameraDescription, 8, 8);
  assert.deepEqual(packedLimits(buildNativeInputV2(scene, camera, optionsOfPack)), [-1, -1, -1, -1]);
  assert.deepEqual(packedLimits(upgradeNativeInputV1ToV2(buildNativeInput(scene, camera, optionsOfPack, pack), optionsOfPack)), [-1, -1, -1, -1]);
});
