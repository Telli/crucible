import assert from 'node:assert/strict';
import test from 'node:test';

import { createWebGpuRealtimeTracer } from '../src/path-tracer-realtime-webgpu.js';
import { resolveRealtimeOptions } from '../src/path-tracer-realtime-options.js';

// A device like the one in path-tracer-realtime-webgpu-device.test.js, plus control over which buffer and bind group fail.
const usageFlags = { MAP_READ: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, STORAGE: 16, RENDER_ATTACHMENT: 32, COMPUTE: 64 };
globalThis.GPUBufferUsage = usageFlags;
globalThis.GPUTextureUsage = usageFlags;
globalThis.GPUShaderStage = usageFlags;
globalThis.GPUMapMode = { READ: 1 };

let failLabel = null;
let failBindGroupAt = Infinity;
let bindGroupCalls = 0;
const buffers = [];

function createBuffer(descriptor) {
  if (descriptor.label === failLabel) throw new RangeError(`${descriptor.label} is too large`);
  const buffer = {
    ...descriptor,
    destroyed: false,
    destroy() { this.destroyed = true; },
    async mapAsync() {},
    getMappedRange() { return new ArrayBuffer(descriptor.size); },
  };
  buffers.push(buffer);
  return buffer;
}

// Every bind group a frame sets, so a test can tell which load's groups drew it.
const boundGroups = [];
const fakePass = { setPipeline() {}, setBindGroup(index, group) { boundGroups.push(group); }, dispatchWorkgroups() {}, end() {} };

const fakeDevice = {
  limits: { maxStorageBufferBindingSize: 1 << 30 },
  addEventListener() {},
  createBuffer,
  createShaderModule: () => ({ async getCompilationInfo() { return { messages: [] }; } }),
  createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
  createBindGroupLayout: () => ({}),
  createPipelineLayout: () => ({}),
  createBindGroup() {
    if (++bindGroupCalls === failBindGroupAt) throw new RangeError('bind group too large');
    return { serial: bindGroupCalls };
  },
  createCommandEncoder: () => ({
    beginComputePass: () => fakePass,
    clearBuffer() {},
    copyBufferToTexture() {},
    copyBufferToBuffer() {},
    finish: () => ({}),
  }),
  queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {} },
};

const fakeAdapter = {
  limits: { maxStorageBuffersPerShaderStage: 10, maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  info: { vendor: 'fake', architecture: 'device' },
  requestDevice: async () => fakeDevice,
};

const fakeCanvas = { getContext: () => ({ configure() {}, getCurrentTexture: () => ({}), unconfigure() {} }) };

const floor = {
  positions: new Float32Array([-1, 0, 1, 1, 0, 1, 1, 0, -1, -1, 0, -1]),
  normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
  uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
};
const scene = { parts: [{ name: 'floor', geometry: floor, material: { color: [0.5, 0.5, 0.5] } }], environment: {}, camera: { eye: [0, 1, 4], target: [0, 0, 0], fov: 50 } };
const options = resolveRealtimeOptions({ backend: 'webgpu', width: 64, height: 32 });

Object.defineProperty(globalThis.navigator, 'gpu', {
  configurable: true,
  value: { requestAdapter: async () => fakeAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' },
});

test('a first scene load that fails in the denoiser destroys every buffer it made (#2637)', async () => {
  const start = buffers.length;
  failLabel = 'history 0';
  await assert.rejects(() => createWebGpuRealtimeTracer(scene, options, fakeCanvas), /history 0 is too large/);
  failLabel = null;
  assert.ok(buffers.length > start, 'the load made buffers before the failure');
  assert.deepEqual(buffers.slice(start).filter(buffer => !buffer.destroyed).map(buffer => buffer.label), []);
});

test('a reload that fails after the new kernel keeps the previous kernel usable (#2637)', async () => {
  const first = buffers.length;
  const tracer = await createWebGpuRealtimeTracer(scene, options, fakeCanvas);
  const start = buffers.length;
  const firstLoadBuffers = () => buffers.slice(first, start);
  const liveBefore = firstLoadBuffers().filter(buffer => !buffer.destroyed).length;
  const lastGroupBeforeReload = bindGroupCalls;
  // The second trace group fails, so the reload has already made one group of its own that must not be used.
  failBindGroupAt = bindGroupCalls + 2;
  await assert.rejects(() => tracer.update({ parts: [{ ...scene.parts[0], geometry: { ...floor } }] }), /bind group too large/);
  failBindGroupAt = Infinity;
  assert.equal(bindGroupCalls, lastGroupBeforeReload + 2, 'the reload got as far as its second trace group');
  boundGroups.length = 0;
  const { frame } = tracer.frame(scene.camera);
  assert.equal(frame, 1, 'the tracer still draws after the failed reload');
  assert.ok(boundGroups.length > 0);
  const fromFailedReload = group => group.serial > lastGroupBeforeReload && group.serial <= lastGroupBeforeReload + 2;
  assert.ok(boundGroups.some(group => group.serial <= lastGroupBeforeReload), 'the frame binds a trace group of the first load');
  assert.deepEqual(boundGroups.filter(fromFailedReload).map(group => group.serial), [], 'the frame draws with the previous scene, not the half-built one');
  assert.deepEqual(firstLoadBuffers().filter(buffer => buffer.destroyed).map(buffer => buffer.label), [], 'the previous kernel keeps its buffers');
  assert.equal(firstLoadBuffers().filter(buffer => !buffer.destroyed).length, liveBefore);
  assert.ok(buffers.slice(start).length > 0, 'the failed reload made buffers');
  assert.deepEqual(buffers.slice(start).filter(buffer => !buffer.destroyed).map(buffer => buffer.label), []);
  // The scene the tracer holds is still the first one: updating to the same parts follows their motion and keeps working.
  await tracer.update({ parts: scene.parts });
  assert.equal(tracer.frame(scene.camera).frame, 2);
  tracer.dispose();
});
