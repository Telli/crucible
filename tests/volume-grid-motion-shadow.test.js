// The shadow of a blurred grid volume (#1763): the surface shadow taps read the grid at their own time in the shutter, only in the 'gridMotion' program, and the WebGPU path tracer
// still leaves grid volumes to the CPU tracer, which draws their motion blur.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertWebGpuLocalVolumes } from '../src/path-tracer-webgpu-local-volumes.js';
import { gridMotionTimeFraction } from '../src/volume-grid.js';

const SHARP_SHADOW_TAP = 'float profile = localVolumeProfile(index, position + towardSun * (entry + (span.y - entry) * (float(tap) + 0.5) / taps), true);';

test('the surface shadow of a grid reads each tap at its own time in the shutter, and a frame with the shutter off keeps the taps it had', async () => {
  await import('../src/fog-shader.js');
  const { createPostFragment, createLocalVolumeCompositeFragment, GRID_MOTION_STEP } = await import('../src/post.js');
  for (const source of [createPostFragment(['local']), createPostFragment(['bloom', 'volume', 'local', 'finish']), createLocalVolumeCompositeFragment(false)]) {
    assert.ok(!source.includes('vec3 tapPosition'), 'a shutter-off program has no shifted shadow tap');
    if (source.includes('localVolumeSurfaceShadow')) assert.ok(source.includes(SHARP_SHADOW_TAP), 'its shadow taps are the sharp ones, byte for byte');
  }
  const shutterOn = createPostFragment(['local', GRID_MOTION_STEP]);
  assert.ok(!shutterOn.includes(SHARP_SHADOW_TAP), 'a shutter-on program does not keep the sharp tap');
  const shiftedTap = shutterOn.match(/vec3 tapPosition = position \+ towardSun[^\n]*\n\s*if \(isGrid\) tapPosition = localGridMotionPosition\(index, tapPosition, fract\(localVolumeJitter\(\) \+ float\(tap\) \* ([0-9.]+)\)\);\n\s*float profile = localVolumeProfile\(index, tapPosition, true\);/);
  assert.ok(shiftedTap, 'each grid tap moves back along the velocity before it reads the density');
  assert.equal(Number(shiftedTap[1]), gridMotionTimeFraction(0, 1), 'with the golden ratio spread the march uses');
});

test('a grid volume is refused by the WebGPU tracer whatever the shutter, and the error names the CPU tracer that draws its motion blur', () => {
  const movingGrid = { shape: 'grid', gridData: {}, motionShutter: 0.5 };
  assert.throws(() => assertWebGpuLocalVolumes({ localVolumes: [movingGrid] }), /localVolumes\[0\] is a grid volume, which only backend "cpu" traces/);
});
