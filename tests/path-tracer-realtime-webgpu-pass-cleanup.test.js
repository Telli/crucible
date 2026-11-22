import test from 'node:test';
import assert from 'node:assert/strict';

import { createWebGpuRadianceCache, createWebGpuDenoiser } from '../src/path-tracer-realtime-webgpu-passes.js';

globalThis.GPUBufferUsage = { STORAGE: 16, UNIFORM: 8, COPY_DST: 4, COPY_SRC: 2 };

// A device that counts the buffers a pass makes, and fails the call at a chosen position as a real one does on a large allocation.
function countingDevice({ failBufferAt = Infinity, failBindGroupAt = Infinity } = {}) {
  const buffers = [];
  let bufferCalls = 0;
  let bindGroupCalls = 0;
  return {
    buffers,
    live: () => buffers.filter(buffer => !buffer.destroyed),
    createBuffer(descriptor) {
      if (++bufferCalls === failBufferAt) throw new RangeError(`buffer ${descriptor.label} is too large`);
      const buffer = { label: descriptor.label, size: descriptor.size, destroyed: false, destroy() { this.destroyed = true; } };
      buffers.push(buffer);
      return buffer;
    },
    createShaderModule: () => ({ async getCompilationInfo() { return { messages: [] }; } }),
    createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup() {
      if (++bindGroupCalls === failBindGroupAt) throw new RangeError('bind group too large');
      return {};
    },
    queue: { writeBuffer() {} },
  };
}

const denoiserOptions = {
  traceWidth: 8, traceHeight: 8, outputWidth: 8, outputHeight: 8, filterIterations: 2,
  tracedBuffers: [{ label: 'traced 0' }, { label: 'traced 1' }], motionBuffer: { label: 'motion' },
};

test('a failed radiance cache setup destroys the buffers it made (#2628)', async () => {
  const device = countingDevice({ failBufferAt: 2 });
  await assert.rejects(createWebGpuRadianceCache(device), /too large/);
  assert.equal(device.buffers.length, 1);
  assert.deepEqual(device.live(), []);
});

test('a failed denoiser buffer destroys the ones made before it (#2628)', async () => {
  const device = countingDevice({ failBufferAt: 4 });
  await assert.rejects(createWebGpuDenoiser(device, denoiserOptions), /too large/);
  assert.equal(device.buffers.length, 3);
  assert.deepEqual(device.live(), []);
});

test('a failed denoiser bind group destroys every buffer the pass made (#2628)', async () => {
  const device = countingDevice({ failBindGroupAt: 1 });
  await assert.rejects(createWebGpuDenoiser(device, denoiserOptions), /bind group too large/);
  assert.ok(device.buffers.length > 0);
  assert.deepEqual(device.live(), []);
});

test('a denoiser that sets up keeps its buffers until dispose (#2628)', async () => {
  const device = countingDevice();
  const denoiser = await createWebGpuDenoiser(device, denoiserOptions);
  assert.equal(denoiser.rowWords, 64);
  assert.equal(device.live().length, device.buffers.length);
  denoiser.dispose();
  assert.deepEqual(device.live(), []);
});
