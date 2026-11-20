import assert from 'node:assert/strict';
import test from 'node:test';

import { denoiseRadiance } from '../src/path-tracer-denoise.js';
import { resolveRealtimeOptions } from '../src/path-tracer-realtime-options.js';

test('real-time options refuse a historyLimit below 1 and accept 1 (#2543)', () => {
  for (const historyLimit of [0.5, 0.999]) {
    assert.throws(() => resolveRealtimeOptions({ historyLimit }), /historyLimit.*at least 1/, `historyLimit ${historyLimit}`);
  }
  assert.equal(resolveRealtimeOptions({ historyLimit: 1 }).historyLimit, 1);
});

test('createProgressiveTracer refuses resolutionDivisors that give no full-size level (#2544)', async () => {
  const { createProgressiveTracer } = await import('../src/path-tracer-progressive.js');
  const scene = { parts: [], camera: { eye: [0, 0, 5], target: [0, 0, 0], fov: 50 } };
  for (const resolutionDivisors of [[], [0, 1], [-2, 1], [2.5, 1], [4, 2], [Number.NaN, 1], 'x']) {
    await assert.rejects(createProgressiveTracer(scene, {}, { resolutionDivisors }), /resolutionDivisors/, JSON.stringify(resolutionDivisors));
  }
});

test('denoiseRadiance refuses a buffer shorter than width times height (#2545)', async () => {
  const pixels = 16;
  const full = () => ({
    width: 4, height: 4, color: new Float32Array(pixels * 3).fill(0.5), albedo: new Float32Array(pixels * 3).fill(0.5),
    normal: new Float32Array(pixels * 3).fill(0.5), depth: new Float32Array(pixels).fill(1), variance: new Float32Array(pixels).fill(0.1),
  });
  assert.equal(denoiseRadiance(full()).some(Number.isNaN), false);
  for (const name of ['color', 'albedo', 'normal', 'depth', 'variance']) {
    const inputs = full();
    inputs[name] = inputs[name].subarray(0, 4);
    assert.throws(() => denoiseRadiance(inputs), new RegExp(`denoiseRadiance: ${name} has 4 values`), name);
  }
});
