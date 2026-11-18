// A hero world switch hands the main thread back every few milliseconds: the sky prefilter in steps of a fixed texel count and
// replaceParts in slices sized from how long the last one took (#779).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentMap, createEnvironmentResources, createEnvironmentResourcesInSlices } from '../src/environment.js';
import { replacePartsInSlices } from '../src/hero-lab/loop/world.js';

function recordingContext() {
  const constants = { FRAMEBUFFER_COMPLETE: 36053, TEXTURE_2D: 3553 };
  return new Proxy({}, {
    get(_, name) {
      if (name in constants) return constants[name];
      if (name === 'getExtension') return () => ({});
      if (name === 'checkFramebufferStatus') return () => constants.FRAMEBUFFER_COMPLETE;
      return () => ({});
    },
  });
}

test('the sky prefilter checks the clock inside the pass over the whole map, not only after it', async () => {
  const width = 2048;
  const height = 1024;
  const data = new Float32Array(width * height * 3).map((_, index) => (index % 13) / 4);
  const map = createEnvironmentMap({ width, height, data });
  const programs = { compileProgram: () => ({}), fullscreenVertex: '' };
  let checkpoints = 0;
  const sliced = await createEnvironmentResourcesInSlices(recordingContext(), map, programs, async () => { checkpoints++; });
  const whole = createEnvironmentResources(recordingContext(), map, programs);
  assert.deepEqual(sliced.irradiance, whole.irradiance);
  assert.deepEqual(sliced.irradianceGrid, whole.irradianceGrid);
  // 65,536 texels a step: 32 rows of upload, 32 of the downsample, 32 of the spherical harmonics, then the grid, the levels and the mipmaps.
  assert.ok(checkpoints >= 100, `expected at least 100 steps for a 2048 by 1024 map, got ${checkpoints}`);
});

// Parts that share one geometry per group of three, so the slicer has many boundaries to choose from.
function makeWorld(geometryCount) {
  const parts = [];
  for (let geometryIndex = 0; geometryIndex < geometryCount; geometryIndex++) {
    const geometry = { indices: new Array(300).fill(0) };
    for (let copy = 0; copy < 3; copy++) parts.push({ name: `part-${geometryIndex}-${copy}`, geometry, material: {} });
  }
  return parts;
}

function makeClockedRenderer(millisecondsPerPart) {
  const clock = { time: 0 };
  const calls = [];
  const renderer = {
    replaceParts(parts, options) {
      const previous = calls.at(-1)?.parts.length ?? 0;
      // The cost of a call is the parts it adds, as with retainedUnchanged, plus a little for the ones before.
      clock.time += (parts.length - previous) * millisecondsPerPart + previous * millisecondsPerPart * 0.02;
      calls.push({ parts, options, cost: 0 });
    },
  };
  return { renderer, clock, calls };
}

test('replacePartsInSlices feeds the world in growing prefixes and ends on the whole list in the same order', async () => {
  const world = makeWorld(60);
  const { renderer, clock, calls } = makeClockedRenderer(0.05);
  await replacePartsInSlices(renderer, world, { now: () => clock.time, pause: async () => {} });
  assert.ok(calls.length > 2);
  assert.ok(calls.every(call => call.options.retainedUnchanged === true));
  for (let index = 1; index < calls.length; index++) {
    const earlier = calls[index - 1].parts;
    assert.ok(calls[index].parts.length >= earlier.length);
    assert.ok(earlier.every((part, position) => part === calls[index].parts[position]), 'each call starts with the parts of the one before');
  }
  assert.deepEqual(calls.at(-1).parts, world);
});

test('replacePartsInSlices cuts a slow world into more pieces than a fast one and keeps each piece near the budget', async () => {
  const world = makeWorld(300);
  const fast = makeClockedRenderer(0.001);
  await replacePartsInSlices(fast.renderer, world, { now: () => fast.clock.time, pause: async () => {} });
  const slow = makeClockedRenderer(0.2);
  const costs = [];
  let previousTime = 0;
  await replacePartsInSlices(slow.renderer, world, {
    sliceMilliseconds: 8,
    now: () => slow.clock.time,
    pause: async () => { costs.push(slow.clock.time - previousTime); previousTime = slow.clock.time; },
  });
  assert.ok(slow.calls.length > fast.calls.length, `a slow world needs more slices (${slow.calls.length}) than a fast one (${fast.calls.length})`);
  // The first piece is a guess; every piece after it is sized from the one before, so it stays close to the 8 ms budget.
  const afterFirst = costs.slice(1);
  assert.ok(afterFirst.length >= 3);
  assert.ok(Math.max(...afterFirst) < 8 * 2.5, `slices after the first should last about 8 ms, got ${afterFirst.map(cost => cost.toFixed(1)).join(', ')}`);
  assert.ok(slow.calls.length <= 32 + 1, 'the number of calls stays bounded, because each call pays for the parts before it');
});

test('replacePartsInSlices keeps pinned parts in every prefix and puts them first', async () => {
  const world = makeWorld(20);
  const pinned = { name: 'crane', skin: {}, geometry: { indices: [0, 1, 2] }, material: {} };
  const parts = [world[0], pinned, ...world.slice(1)];
  const { renderer, clock, calls } = makeClockedRenderer(0.5);
  await replacePartsInSlices(renderer, parts, { now: () => clock.time, pause: async () => {} });
  assert.ok(calls.slice(0, -1).every(call => call.parts[0] === pinned));
  assert.equal(calls.at(-1).parts, parts);
});

test('a world built in slices on a sliced sky draws the same pixels as the one-piece build (#779)', async (testContext) => {
  const { withDevServerPage } = await import('./helpers/dev-server-browser.js');
  await withDevServerPage(testContext, async (page) => {
    const result = await page.evaluate(async () => {
      const { sphere } = await import('/src/geometry.js');
      const { CrucibleRenderer } = await import('/src/renderer.js');
      const { createEnvironmentMap } = await import('/src/environment.js');
      const { createSlicer } = await import('/src/cooperative.js');
      const { replacePartsInSlices } = await import('/src/hero-lab/loop/world.js');
      const width = 256;
      const height = 128;
      const data = new Float32Array(width * height * 3).map((_, index) => 0.2 + ((index * 7) % 23) / 6);
      const map = createEnvironmentMap({ width, height, data, showBackground: true });
      const parts = [];
      for (let index = 0; index < 12; index++) {
        const x = (index % 4) * 1.1 - 1.65;
        const y = Math.floor(index / 4) * 1.1 - 1.1;
        const matrix = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, x, y, 0, 1]);
        parts.push({ name: `ball-${index}`, geometry: sphere(8 + index, 6 + index), matrix, material: { tag: 'surface', color: [0.9, 0.5 + index / 30, 0.3], metallic: index % 2, roughness: 0.2 + index / 20, emission: 0 } });
      }
      const frame = { eye: [0, 0, 5], target: [0, 0, 0], fov: 50, time: 0 };
      const build = async (sliced) => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        document.body.append(canvas);
        const context = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
        const renderer = new CrucibleRenderer(canvas, [parts[0]], { samples: 1, pixelRatio: 1, deferProgramLink: true, deferEnvironmentPrefilter: sliced, environment: { map } });
        await renderer.programsReady();
        let replaceCalls = 0;
        const realReplace = renderer.replaceParts.bind(renderer);
        renderer.replaceParts = (...callArguments) => { replaceCalls++; return realReplace(...callArguments); };
        if (sliced) {
          await renderer.prepareEnvironmentInSlices(map, createSlicer(0));
          // A clock that runs 40 ms a call, so the slices shrink to the smallest the slicer allows.
          let time = 0;
          await replacePartsInSlices(renderer, parts, { now: () => (time += 40), pause: async () => {} });
        } else {
          renderer.replaceParts(parts, { retainedUnchanged: true });
        }
        renderer.render(frame);
        const pixels = new Uint8Array(96 * 96 * 4);
        context.readPixels(0, 0, 96, 96, context.RGBA, context.UNSIGNED_BYTE, pixels);
        return { replaceCalls, pixels: Array.from(pixels) };
      };
      const whole = await build(false);
      const sliced = await build(true);
      let differing = 0;
      for (let index = 0; index < whole.pixels.length; index++) if (whole.pixels[index] !== sliced.pixels[index]) differing++;
      return { differing, drawn: whole.pixels.some(value => value !== 0), wholeCalls: whole.replaceCalls, slicedCalls: sliced.replaceCalls };
    });
    assert.equal(result.drawn, true, 'the scene draws something');
    assert.equal(result.wholeCalls, 1);
    assert.ok(result.slicedCalls > 2, `the sliced build calls replaceParts several times, got ${result.slicedCalls}`);
    assert.equal(result.differing, 0, 'the sliced build draws the same bytes');
  });
});

test('replaceParts reads the layer state of a material once per call, not once per value of every group (#779)', async (testContext) => {
  const { withDevServerPage } = await import('./helpers/dev-server-browser.js');
  await withDevServerPage(testContext, async (page) => {
    const result = await page.evaluate(async () => {
      const { box } = await import('/src/geometry.js');
      const { CrucibleRenderer } = await import('/src/renderer.js');
      const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      let clearcoatReads = 0;
      const material = { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5, emission: 0 };
      Object.defineProperty(material, 'clearcoat', { get() { clearcoatReads++; return 0; }, enumerable: true });
      const parts = [1, 2, 3, 4, 5, 6].map(size => ({ name: `box-${size}`, geometry: box(0, size), matrix: identity, material }));
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      document.body.append(canvas);
      const renderer = new CrucibleRenderer(canvas, parts.slice(0, 1), { samples: 1, pixelRatio: 1 });
      renderer.replaceParts(parts);
      clearcoatReads = 0;
      renderer.replaceParts(parts);
      return { clearcoatReads, groupCount: renderer.batches.length };
    });
    assert.equal(result.groupCount, 7, "six boxes and the floor");
    assert.ok(result.clearcoatReads <= 12, `six groups of one material should read the layer state a few times, read it ${result.clearcoatReads} times`);
  });
});
