import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMegakernelSource, WAVEFRONT_SOURCE } from '../src/path-tracer-webgpu-kernel.js';
import { renderLampRoom } from './helpers/lamp-room-render.js';
import { withWebGpuPage } from './helpers/webgpu-page.js';

// A glowing bulb around its own point light is the lamp, not an obstacle to it (#2299, #2353): the CPU and WebGPU path tracers let that
// light's shadow rays through. With the bulb in the room the walls must be nearly as bright as with the bare light.
const BULB_KEEPS_AT_LEAST = 0.85;
const HELPER_PATH = '/tests/helpers/lamp-room-render.js';

test('the CPU path tracer lights a room through the bulb around its point light', async () => {
  const { withBulb, withoutBulb } = await renderLampRoom({ width: 32, height: 16, samples: 24 });
  assert.ok(withoutBulb.meanLinear > 0.05, `the bare light lights the room: ${withoutBulb.meanLinear}`);
  assert.ok(withBulb.meanLinear >= BULB_KEEPS_AT_LEAST * withoutBulb.meanLinear, `with the bulb ${withBulb.meanLinear}, without ${withoutBulb.meanLinear}`);
});

test('both WebGPU kernels pass the shadow ray of a light through its own lamp mesh', () => {
  for (const source of [buildMegakernelSource(), WAVEFRONT_SOURCE]) {
    assert.match(source, /fn occluded\(origin: vec3<f32>, direction: vec3<f32>, limit: f32, lightBit: i32\)/);
    assert.match(source, /let ownLamp = lightBit >= 0 && \(\(i32\(materials\[material \+ 5\]\.w\) >> u32\(lightBit\)\) & 1\) == 1;/);
  }
  assert.match(WAVEFRONT_SOURCE, /vec4<f32>\(shadowDirection, f32\(shadowLightBit\)\)/, 'the wavefront shadow record carries the light bit to its later pass');
});

for (const kernel of ['megakernel', 'wavefront']) {
  test(`on a WebGPU adapter the ${kernel} lights a room through the bulb around its point light`, { timeout: 300000 }, async context => {
    await withWebGpuPage(context, async page => {
      const { withBulb, withoutBulb } = await page.evaluate(async ({ helperPath, parameters }) => {
        const { renderLampRoom: render } = await import(helperPath);
        return render(parameters);
      }, { helperPath: HELPER_PATH, parameters: { width: 48, height: 28, samples: 32, backend: 'webgpu', kernel, moduleBase: '' } });
      assert.ok(withoutBulb.meanLinear > 0.05, `the bare light lights the room: ${withoutBulb.meanLinear}`);
      assert.ok(withBulb.meanLinear >= BULB_KEEPS_AT_LEAST * withoutBulb.meanLinear, `with the bulb ${withBulb.meanLinear}, without ${withoutBulb.meanLinear}`);
    });
  });
}
