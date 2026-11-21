import assert from 'node:assert/strict';
import test from 'node:test';

import { box } from '../src/geometry.js';
import { gpuTriangleCapacity } from '../src/path-tracer-gpu-pack.js';
import { DATA_TEXTURE_WIDTH, TRIANGLE_TEXELS } from '../src/path-tracer-gpu-shader.js';
import { MAX_GPU_TRACE_TRIANGLES, MAX_TRACE_TRIANGLES } from '../src/path-tracer-scene.js';

// The WebGPU real-time tracer and the GPU light bake bound their scene by the device, as the still render does (#1242).
// A fake adapter whose storage buffer holds one table row (a few hundred triangles, far under the 400,000 default) shows
// the bound reaches both callers: with the old default bound a scene past it would be accepted and fail later in the kernel.
const CUBE_TRIANGLES = 12;
const DEVICE_BUFFER_BYTES = DATA_TEXTURE_WIDTH * 16;
const DEVICE_TRIANGLE_LIMIT = gpuTriangleCapacity({ maximumBufferBytes: DEVICE_BUFFER_BYTES }, MAX_GPU_TRACE_TRIANGLES);
const KERNEL_REACHED = 'fake device: the scene was accepted and the kernel was requested';

assert.ok(DEVICE_TRIANGLE_LIMIT < MAX_TRACE_TRIANGLES);
assert.ok(DEVICE_TRIANGLE_LIMIT > 2 * CUBE_TRIANGLES);

const cubesUnderLimit = Math.floor(DEVICE_TRIANGLE_LIMIT / CUBE_TRIANGLES) - 1;
const cubesOverLimit = Math.floor(DEVICE_TRIANGLE_LIMIT / CUBE_TRIANGLES) + 2;
const tripleCount = (cubeCount) => cubeCount * CUBE_TRIANGLES;

assert.ok(tripleCount(cubesUnderLimit) <= DEVICE_TRIANGLE_LIMIT);
assert.ok(tripleCount(cubesOverLimit) > DEVICE_TRIANGLE_LIMIT);

const limits = { maxStorageBufferBindingSize: DEVICE_BUFFER_BYTES, maxBufferSize: DEVICE_BUFFER_BYTES, maxStorageBuffersPerShaderStage: 10 };
const fakeDevice = {
  limits,
  createBindGroupLayout: () => ({}),
  createPipelineLayout: () => ({}),
  createShaderModule: () => {
    throw new Error(KERNEL_REACHED);
  },
};
const fakeAdapter = { limits, info: { vendor: 'fake' }, requestDevice: async () => fakeDevice };

Object.defineProperty(globalThis, 'navigator', {
  value: { gpu: { requestAdapter: async () => fakeAdapter, getPreferredCanvasFormat: () => 'rgba8unorm' } },
  configurable: true,
});
globalThis.GPUShaderStage = { COMPUTE: 4 };

const { createWebGpuRealtimeTracer } = await import('../src/path-tracer-realtime-webgpu.js');
const { bakeLightmapsAsync } = await import('../src/light-bake-gpu.js');

const cube = box(0, 1);

// The real-time tracer flattens, so its cubes may share one mesh; the light bake keeps copies of one mesh as instances (#2239), so it needs a mesh per cube to reach the bound.
function cubeParts(count, geometryOf = () => cube) {
  return Array.from({ length: count }, (_, index) => ({
    name: `cube-${index}`,
    geometry: geometryOf(),
    matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, index * 2, 0, 0, 1]),
    material: { tag: 'surface', color: [0.7, 0.7, 0.7], metallic: 0, roughness: 0.8, emission: 0 },
  }));
}

const resolvedRealtimeOptions = {
  outputWidth: 32, outputHeight: 32, traceWidth: 16, traceHeight: 16, options: {}, historyLimit: 8, filterIterations: 1, cacheCellSize: null, followPartMotion: false,
};
const lamp = { pointLights: [{ position: [0, 3, 0], color: [1, 1, 1], intensity: 8, radius: 0.05 }], keyColor: [0, 0, 0] };
const bakeOptions = { samples: 1, bounces: 1, texelsPerUnit: 1, maxResolution: 8, backend: 'webgpu' };
const refusal = (triangles) => ({
  name: 'RangeError',
  message: new RegExp(`^This GPU path trace takes at most ${DEVICE_TRIANGLE_LIMIT} triangles in total .*, got ${triangles}\\. Simplify or drop meshes`),
});

test('the WebGPU real-time tracer refuses a scene past the device bound with its count', async () => {
  const parts = cubeParts(cubesOverLimit);
  await assert.rejects(createWebGpuRealtimeTracer({ parts }, resolvedRealtimeOptions), refusal(tripleCount(cubesOverLimit)));
});

test('the WebGPU real-time tracer takes a scene inside the device bound as far as the kernel', async () => {
  const parts = cubeParts(cubesUnderLimit);
  await assert.rejects(createWebGpuRealtimeTracer({ parts }, resolvedRealtimeOptions), { message: KERNEL_REACHED });
});

test('the GPU light bake refuses a scene past the device bound with its count', async () => {
  const ownCubes = cubeParts(cubesOverLimit, () => box(0, 1));
  await assert.rejects(bakeLightmapsAsync(ownCubes, lamp, bakeOptions), refusal(tripleCount(cubesOverLimit)));
});

test('the GPU light bake counts copies of one shared cube once, so they pass a bound their flattened triangles exceed', async () => {
  assert.ok(tripleCount(cubesOverLimit) > DEVICE_TRIANGLE_LIMIT);
  await assert.rejects(bakeLightmapsAsync(cubeParts(cubesOverLimit), lamp, bakeOptions), { message: KERNEL_REACHED });
});

test('the GPU light bake takes a scene inside the device bound as far as the kernel', async () => {
  const parts = cubeParts(cubesUnderLimit);
  await assert.rejects(bakeLightmapsAsync(parts, lamp, bakeOptions), { message: KERNEL_REACHED });
});

test('a light bake with its own texel tracer keeps the default bound', async () => {
  const texelTracer = async (scene, texels) => ({ radiance: new Float32Array(texels.count * 3), escaped: new Float32Array(texels.count), gpu: 'fake', compileSeconds: 0 });
  const baked = await bakeLightmapsAsync(cubeParts(cubesOverLimit), lamp, { ...bakeOptions, backend: 'native', texelTracer });
  assert.equal(baked.report.gpu, 'fake');
});
