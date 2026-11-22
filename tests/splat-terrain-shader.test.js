// Splat terrain (#2272): a splat material on a terrain compiles without any other world material in the scene, and draws
// without a sampler clash beside instanced grass. The source test needs no browser; the browser tests run on SwiftShader
// through the Vite dev server and skip when Chrome cannot start.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFragmentShader } from '../src/shaders.js';
import '../src/splat-shader.js';
import '../src/world-material-shader.js';
import { withDevServerPage } from './helpers/dev-server-browser.js';

test('a shader with splat layers defines terrainNoise before the splat code that calls it', () => {
  const source = createFragmentShader(['splat']);
  const definition = source.indexOf('vec3 terrainNoise(');
  const firstUse = source.indexOf('terrainNoise(position)');
  assert.ok(definition !== -1, 'terrainNoise must be defined when the splat feature is on');
  assert.ok(definition < firstUse, 'terrainNoise must come before splatOctaves');
});

// Builds a splat terrain, with or without grass, in one renderer and draws one frame. Returns what the browser reported.
async function drawSplatTerrain(page, { withGrass, withEnvironment, withGlass = false }) {
  const browserMessages = [];
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) browserMessages.push(message.text());
  });
  const task = async ({ withGrass, withEnvironment, withGlass }) => {
    await import('/src/splat-shader.js');
    await import('/src/fog-shader.js');
    const { createEnvironmentMap } = await import('/src/environment.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { createTerrain } = await import('/src/terrain.js');
    const { createGrass } = await import('/src/grass.js');
    const { scatterVegetation } = await import('/src/vegetation.js');
    const problems = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...values) => { problems.push(values.join(' ')); };
    console.error = (...values) => { problems.push(values.join(' ')); };
    const image = (fill) => {
      const data = new Uint8ClampedArray(8 * 8 * 4);
      for (let index = 0; index < data.length; index += 4) data.set(fill, index);
      return { width: 8, height: 8, data };
    };
    const layer = (color, extra) => ({
      color: { image: image(color), colorSpace: 'srgb' },
      normal: { image: image([128, 128, 255, 255]), colorSpace: 'linear' },
      roughness: { image: image([200, 200, 200, 255]), colorSpace: 'linear' },
      height: { image: image([90, 90, 90, 255]), colorSpace: 'linear' },
      scale: 3,
      ...extra,
    });
    const material = { color: [1, 1, 1], metallic: 0, roughness: 1, layers: [layer([40, 120, 30, 255]), layer([120, 90, 50, 255], { triplanar: true })], splat: { rules: [undefined, { slope: [14, 90] }] } };
    const terrain = createTerrain({ size: 80, chunks: 2, resolution: 16, levels: 2, material, seed: 7 });
    const parts = [...terrain.parts];
    if (withGrass) parts.push(...createGrass({ preset: 'lawn', area: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, terrainHeight: terrain.heightAt, eye: [0, 1.6, 10] }).parts);
    if (withGrass) parts.push(...scatterVegetation({ area: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, density: 0.01, variants: 1, seed: 5, terrainHeight: terrain.heightAt }).parts);
    if (withGlass) {
      const { box } = await import('/src/geometry.js');
      parts.push({ name: 'glass', geometry: box(0.2, 1), matrix: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]), material: { color: [0.8, 0.9, 1], metallic: 0, roughness: 0.1, alphaMode: 'blend', opacity: 0.5 }, castShadow: true });
    }
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    document.body.append(canvas);
    const environment = withEnvironment ? { map: createEnvironmentMap({ width: 32, height: 16, data: new Float32Array(32 * 16 * 3).fill(0.75), showBackground: true }) } : {};
    let failure = '';
    let glError = 0;
    try {
      const renderer = new CrucibleRenderer(canvas, parts, { world: true, hdr: true, depth: true, ground: false, samples: 1, pixelRatio: 1, environment });
      renderer.render({ eye: [0, 1.6, 10], target: [0, 1.4, 0], time: 0 });
      renderer.render({ eye: [0, 1.6, 10], target: [0, 1.4, 0], time: 0.1 });
      glError = renderer.context.getError();
    } catch (error) {
      failure = error.message;
    }
    console.warn = originalWarn;
    console.error = originalError;
    return { failure, glError, problems };
  };
  const result = await page.evaluate(task, { withGrass, withEnvironment, withGlass });
  return { ...result, problems: [...result.problems, ...browserMessages] };
}

test('a splat terrain alone compiles and draws', async context => {
  await withDevServerPage(context, async page => {
    const result = await drawSplatTerrain(page, { withGrass: false, withEnvironment: false });
    assert.equal(result.failure, '');
    assert.equal(result.glError, 0);
    assert.deepEqual(result.problems, []);
  });
});

test('a splat terrain beside instanced grass draws without a sampler clash', async context => {
  await withDevServerPage(context, async page => {
    const result = await drawSplatTerrain(page, { withGrass: true, withEnvironment: true });
    assert.equal(result.failure, '');
    assert.equal(result.glError, 0);
    assert.deepEqual(result.problems, []);
  });
});

test('a splat terrain beside a part that casts a tinted shadow draws without a sampler clash', async context => {
  await withDevServerPage(context, async page => {
    const result = await drawSplatTerrain(page, { withGrass: false, withEnvironment: false, withGlass: true });
    assert.equal(result.failure, '');
    assert.equal(result.glError, 0);
    assert.deepEqual(result.problems, []);
  });
});
