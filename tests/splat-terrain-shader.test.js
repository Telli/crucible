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
async function drawSplatTerrain(page, { withGrass, withEnvironment, withGlass = false, glassCastsShadow = true, glassColor = [0, 1, 1] }) {
  const browserMessages = [];
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) browserMessages.push(message.text());
  });
  const task = async ({ withGrass, withEnvironment, withGlass, glassCastsShadow, glassColor }) => {
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
      parts.push({ name: 'glass', geometry: box(0.2, 1), matrix: new Float32Array([3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 2, 0, 1]), material: { color: glassColor, metallic: 0, roughness: 0.1, alphaMode: 'blend', opacity: 0.9 }, castShadow: glassCastsShadow });
    }
    // Reads the sampler uniforms of the linked program: how many the fragment stage reads, the highest unit and any unit
    // that two samplers of different types share.
    const auditSamplerUnits = (gl, program) => {
      const samplerTypes = new Map([[gl.SAMPLER_2D, '2D'], [gl.SAMPLER_2D_ARRAY, '2DArray'], [gl.SAMPLER_2D_SHADOW, '2DShadow'], [gl.SAMPLER_CUBE, 'Cube'], [gl.SAMPLER_3D, '3D']]);
      const typesByUnit = new Map();
      let samplerCount = 0;
      let highestUnit = -1;
      for (let index = 0; index < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); index++) {
        const info = gl.getActiveUniform(program, index);
        if (!samplerTypes.has(info.type)) continue;
        samplerCount++;
        const unit = gl.getUniform(program, gl.getUniformLocation(program, info.name));
        highestUnit = Math.max(highestUnit, unit);
        typesByUnit.set(unit, [...(typesByUnit.get(unit) ?? []), samplerTypes.get(info.type)]);
      }
      const clashes = [...typesByUnit].filter(([, types]) => new Set(types).size > 1).map(([unit, types]) => unit + ':' + types.join('+'));
      return { samplerCount, highestUnit, clashes, maxSamplers: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS), maxCombined: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) };
    };
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    document.body.append(canvas);
    const environment = withEnvironment ? { map: createEnvironmentMap({ width: 32, height: 16, data: new Float32Array(32 * 16 * 3).fill(0.75), showBackground: true }) } : {};
    let failure = '';
    let glError = 0;
    let audit = null;
    let pixels = [];
    try {
      const renderer = new CrucibleRenderer(canvas, parts, { world: true, hdr: true, depth: true, ground: false, samples: 1, pixelRatio: 1, environment });
      renderer.render({ eye: [0, 1.6, 10], target: [0, 1.4, 0], time: 0 });
      renderer.render({ eye: [0, 1.6, 10], target: [0, 1.4, 0], time: 0.1 });
      glError = renderer.context.getError();
      audit = auditSamplerUnits(renderer.context, renderer.program);
      audit.splatBatchesBlind = renderer.batches?.filter(batch => batch.splat && batch.tintBlind).length ?? -1;
      const buffer = new Uint8Array(96 * 96 * 4);
      renderer.render({ eye: [1, 16, -1.1], target: [1, 0, -1], time: 0 });
      renderer.context.readPixels(0, 0, 96, 96, renderer.context.RGBA, renderer.context.UNSIGNED_BYTE, buffer);
      pixels = Array.from(buffer);
    } catch (error) {
      failure = error.message;
    }
    console.warn = originalWarn;
    console.error = originalError;
    return { failure, glError, problems, audit, pixels };
  };
  const result = await page.evaluate(task, { withGrass, withEnvironment, withGlass, glassCastsShadow, glassColor });
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

function assertWithinUnitBudget(audit) {
  assert.deepEqual(audit.clashes, [], 'two sampler types share a texture unit');
  assert.ok(audit.samplerCount <= audit.maxSamplers, `${audit.samplerCount} fragment samplers exceed MAX_TEXTURE_IMAGE_UNITS ${audit.maxSamplers}`);
  assert.ok(audit.highestUnit < audit.maxCombined, `unit ${audit.highestUnit} is past MAX_COMBINED_TEXTURE_IMAGE_UNITS ${audit.maxCombined}`);
}

test('grass, splat layers and a blended caster together stay inside the texture unit budget with no GL error', async context => {
  await withDevServerPage(context, async page => {
    const result = await drawSplatTerrain(page, { withGrass: true, withEnvironment: true, withGlass: true });
    assert.equal(result.failure, '');
    assert.equal(result.glError, 0);
    assert.deepEqual(result.problems, []);
    assertWithinUnitBudget(result.audit);
  });
});

// Sums one colour channel over the pixels where the two frames differ, which are the pixels the glass shadow covers.
function shadowedChannelRatios(shadowedFrame, litFrame) {
  const lit = [0, 0, 0];
  const shadowed = [0, 0, 0];
  let changedPixels = 0;
  for (let offset = 0; offset < litFrame.length; offset += 4) {
    const difference = Math.abs(shadowedFrame[offset] - litFrame[offset]) + Math.abs(shadowedFrame[offset + 1] - litFrame[offset + 1]) + Math.abs(shadowedFrame[offset + 2] - litFrame[offset + 2]);
    if (difference < 20) continue;
    changedPixels++;
    for (let channel = 0; channel < 3; channel++) {
      lit[channel] += litFrame[offset + channel];
      shadowed[channel] += shadowedFrame[offset + channel];
    }
  }
  return { changedPixels, ratios: shadowed.map((value, channel) => value / Math.max(lit[channel], 1)) };
}

test('a cyan glass cube throws a cyan shadow on a splat terrain and a white one a neutral shadow', async context => {
  await withDevServerPage(context, async page => {
    const draw = (glassColor, glassCastsShadow) => drawSplatTerrain(page, { withGrass: false, withEnvironment: false, withGlass: true, glassColor, glassCastsShadow });
    // Each caster colour has its own frame without a shadow, so the cube itself never counts as shadowed terrain.
    const cyanShadow = shadowedChannelRatios((await draw([0, 1, 1], true)).pixels, (await draw([0, 1, 1], false)).pixels);
    const whiteFrame = await draw([1, 1, 1], true);
    const whiteShadow = shadowedChannelRatios(whiteFrame.pixels, (await draw([1, 1, 1], false)).pixels);
    const cyanFrame = await draw([0, 1, 1], true);
    assert.equal(cyanFrame.audit.splatBatchesBlind, 0, 'splat batches must read the tinted shadow map');
    assertWithinUnitBudget(cyanFrame.audit);
    context.diagnostic(`shadow pixels cyan ${cyanShadow.changedPixels}, white ${whiteShadow.changedPixels}; kept rgb under cyan ${cyanShadow.ratios.map(value => value.toFixed(3))}, under white ${whiteShadow.ratios.map(value => value.toFixed(3))}`);
    assert.ok(whiteShadow.changedPixels > 0 && cyanShadow.changedPixels > 0, 'the glass cube threw no shadow on the terrain');
    assert.ok(cyanShadow.ratios[0] < cyanShadow.ratios[1] - 0.1, `under cyan glass the terrain keeps ${cyanShadow.ratios[0].toFixed(2)} of its red and ${cyanShadow.ratios[1].toFixed(2)} of its green: the shadow is not tinted`);
    assert.ok(Math.abs(whiteShadow.ratios[0] - whiteShadow.ratios[1]) < 0.05, 'a white caster must darken red and green alike');
  });
});
