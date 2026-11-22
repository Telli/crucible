// User passes can opt into exact G-buffer inputs and palette textures (issue #2954): normalAt, objectIdAt, albedoAt, emissionAt and
// `luts`. The checks of `needs` and `luts` run in Node; the drawn cases run in headless Chrome (SwiftShader) from the Vite dev
// server, skip locally when Chrome cannot start and fail on CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUserPasses, buildPassFragment, describeUserPasses } from '../src/user-pass.js';
import { USER_PASS_LUT_LIMITS } from '../src/user-pass-inputs.js';
import { withDevServerPage } from './helpers/dev-server-browser.js';

const PLAIN_FRAGMENT = 'vec4 userPass(vec2 uv) { return texture(sceneColor, uv); }';
const withFragment = (extra) => [{ name: 'probe', fragment: PLAIN_FRAGMENT, ...extra }];

test('needs are checked, ordered and de-duplicated; luts are bounded inline data', () => {
  const [pass] = normalizeUserPasses(withFragment({ needs: ['emission', 'normal', 'normal'] }));
  assert.deepEqual(pass.needs, ['normal', 'emission']);
  assert.throws(() => normalizeUserPasses(withFragment({ needs: ['depth'] })), /needs has "depth".*normal, objectId, albedo, emission/s);
  assert.throws(() => normalizeUserPasses(withFragment({ needs: 'normal' })), /needs must be a list/);

  const [withLut] = normalizeUserPasses(withFragment({ luts: { palette: { colors: ['#102030', '#ffffff80'] } } }));
  assert.deepEqual([withLut.luts.palette.width, withLut.luts.palette.height], [2, 1]);
  assert.equal(Buffer.from(withLut.luts.palette.pixels, 'base64').toString('hex'), '10203' + '0ff' + 'ffffff80');
  const [rows] = normalizeUserPasses(withFragment({ luts: { ramp: { colors: [['#000000', '#ffffff'], ['#ff0000', '#00ff00']] } } }));
  assert.deepEqual([rows.luts.ramp.width, rows.luts.ramp.height], [2, 2]);

  const raw = Buffer.alloc(2 * 1 * 4, 7).toString('base64');
  assert.equal(normalizeUserPasses(withFragment({ luts: { raw: { width: 2, height: 1, pixels: raw } } }))[0].luts.raw.pixels, raw);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { raw: { width: 2, height: 2, pixels: raw } } })), /holds 8 bytes; 2 x 2 RGBA needs 16/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { big: { width: USER_PASS_LUT_LIMITS.maxWidth + 1, height: 1, pixels: raw } } })), /up to 256 by 16/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { tall: { colors: Array.from({ length: 17 }, () => ['#000000']) } } })), /17 rows; the limit is 16/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { remote: { colors: 'https://example.com/palette.png' } } })), /list of colours/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { palette: { url: 'https://example.com/a.png' } } })), /url/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { palette: { colors: ['red'] } } })), /"#rrggbb"/);
  const many = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map(name => [name, { colors: ['#000000'] }]));
  assert.throws(() => normalizeUserPasses(withFragment({ luts: many })), /5 textures; the limit is 4/);
  assert.throws(() => normalizeUserPasses(withFragment({ luts: { sceneColor: { colors: ['#000000'] } } })), /input the engine provides/);
  assert.throws(() => normalizeUserPasses(withFragment({ uniforms: { palette: 1 }, luts: { palette: { colors: ['#000000'] } } })), /uniform of this pass/);
});

test('a snippet that calls an input it did not ask for is refused with the fix', () => {
  const fragment = 'vec4 userPass(vec2 uv) { return vec4(normalAt(uv), 1.0); }';
  assert.throws(() => normalizeUserPasses([{ name: 'probe', fragment }]), /calls normalAt\(\) without asking for it.*needs: \["normal"\]/s);
  assert.doesNotThrow(() => normalizeUserPasses([{ name: 'probe', fragment, needs: ['normal'] }]));
  // A snippet that defines its own helper of that name is left alone.
  const own = 'vec3 normalAt(vec2 uv) { return vec3(0.0, 1.0, 0.0); }\nvec4 userPass(vec2 uv) { return vec4(normalAt(uv), 1.0); }';
  assert.doesNotThrow(() => normalizeUserPasses([{ name: 'probe', fragment: own }]));
  // Opting in reserves the names the pass is given.
  assert.throws(() => normalizeUserPasses([{ name: 'probe', fragment, needs: ['normal'], uniforms: { sceneNormal: 1 } }]), /input the engine provides/);
});

test('a pass that does not opt in compiles the same source as before', () => {
  const [plain] = normalizeUserPasses(withFragment({}));
  const built = buildPassFragment(plain);
  assert.ok(!/sceneNormal|sceneAlbedo|sceneEmission|objectIdAt|u67_texelOf|sampler2D (?!sceneColor|sceneDepth|sceneObjectIds)/.test(built.source));
  assert.ok(!('needs' in plain) && !('luts' in plain));
  const [asking] = normalizeUserPasses(withFragment({ needs: ['normal', 'objectId', 'albedo', 'emission'], luts: { palette: { colors: ['#000000'] } } }));
  const askingBuilt = buildPassFragment(asking);
  for (const text of ['uniform sampler2D sceneNormal;', 'int objectIdAt(', 'uniform sampler2D sceneAlbedo;', 'uniform sampler2D sceneEmission;', 'uniform sampler2D palette;']) {
    assert.ok(askingBuilt.source.includes(text), text);
  }
  assert.ok(askingBuilt.headerLines > built.headerLines);
  assert.deepEqual(describeUserPasses([asking])[0].needs, ['normal', 'objectId', 'albedo', 'emission']);
  assert.deepEqual(describeUserPasses([asking])[0].luts, ['palette:1x1']);
});

const IMAGE_SIZE = 192;
const CAMERA = { eye: [0, 9, 11], target: [0, 0.5, 0], fov: 42, up: [0, 1, 0] };
const PASS_BUDGET_NOTE = 'each need draws its render pass once before the lit frame';

// Draws a grid of 20 boxes on a slab and a glowing box through the given passes; returns the bytes and the render passes drawn.
async function drawProbe(page, passes) {
  const task = async ({ imageSize, camera, passes }) => {
    const { box } = await import('/src/geometry.js');
    const { CrucibleRenderer } = await import('/src/renderer.js');
    const { installRenderPasses } = await import('/src/render-passes.js');
    const { installUserPasses } = await import('/src/user-pass.js');
    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    canvas.style.cssText = `width:${imageSize}px;height:${imageSize}px;display:block`;
    document.body.append(canvas);
    const copy = document.createElement('canvas');
    copy.width = imageSize;
    copy.height = imageSize;
    const copyContext = copy.getContext('2d', { willReadFrequently: true });
    const scaled = (sx, sy, sz, x, y, z) => new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]);
    const material = { id: 'slab-mat', tag: 'surface', color: [0.6, 0.7, 0.8], metallic: 0, roughness: 0.9 };
    const parts = [{ name: 'slab', geometry: box(0, 1), matrix: scaled(24, 0.2, 24, 0, -0.1, 0), material }];
    for (let index = 0; index < 20; index++) {
      const column = index % 5;
      const row = Math.floor(index / 5);
      parts.push({ name: `block${index}`, geometry: box(0, 1), matrix: scaled(1, 1 + (index % 3) * 0.5, 1, (column - 2) * 2.2, 0.5, (row - 1.5) * 2.2), material: { ...material, id: `block-mat-${index}`, color: [0.9, 0.3, 0.1] } });
    }
    parts.push({ name: 'glow', geometry: box(0, 1), matrix: scaled(1, 1, 1, 0, 0.5, 5.5), material: { ...material, id: 'glow-mat', color: [0.2, 0.6, 0.3], emission: 2 } });
    const renderer = new CrucibleRenderer(canvas, parts, { ground: false, world: true, samples: 1, pixelRatio: 1, depth: true });
    renderer.resize();
    installRenderPasses(renderer);
    const drawnPasses = [];
    const plainRender = renderer.render;
    renderer.render = function countingRender(frame, ...rest) {
      if (frame.pass) drawnPasses.push(frame.pass);
      return plainRender.call(this, frame, ...rest);
    };
    installUserPasses(renderer);
    renderer.userPasses.setAntialias('off');
    renderer.userPasses.set(passes);
    const frame = { ...camera, time: 0, wind: 0, exposure: 1 };
    renderer.render(frame);
    copyContext.drawImage(canvas, 0, 0, imageSize, imageSize);
    const bytes = Array.from(copyContext.getImageData(0, 0, imageSize, imageSize).data);
    renderer.dispose();
    return { bytes, drawnPasses };
  };
  return page.evaluate(task, { imageSize: IMAGE_SIZE, camera: CAMERA, passes });
}

const pixelsOf = ({ bytes }) => Array.from({ length: bytes.length / 4 }, (_, index) => bytes.slice(index * 4, index * 4 + 4));

test('objectIdAt reads the raw 24-bit part ID, past the 16 part cap of the objects list', async (context) => {
  await withDevServerPage(context, async (page) => {
    const fragment = 'vec4 userPass(vec2 uv) { int id = objectIdAt(uv); return vec4(float(id % 256) / 255.0, float(id / 256) / 255.0, 1.0, 1.0); }';
    const result = await drawProbe(page, [{ name: 'ids', needs: ['objectId'], fragment }]);
    const identifiers = new Set(pixelsOf(result).map(([red, green]) => red + green * 256));
    // 1 slab + 20 blocks + 1 glow box; 0 is the sky.
    for (let identifier = 1; identifier <= 22; identifier++) assert.ok(identifiers.has(identifier), `part ID ${identifier} is visible`);
    assert.ok(Math.max(...identifiers) > 16, 'IDs run past 16');
    assert.deepEqual(result.drawnPasses, ['objectId']);
  });
});

test('normalAt is the exact normal, also where the depth derived normal is wrong', async (context) => {
  await withDevServerPage(context, async (page) => {
    // red: the exact normal is one of the axes; green: the depth derived normal disagrees with it; blue: a surface pixel.
    const fragment = `vec4 userPass(vec2 uv) {
      vec3 exact = normalAt(uv);
      float surface = length(exact) > 0.5 ? 1.0 : 0.0;
      float axis = max(abs(exact.x), max(abs(exact.y), abs(exact.z))) > 0.99 ? 1.0 : 0.0;
      float disagree = dot(exact, worldNormalAt(uv)) < 0.9 ? 1.0 : 0.0;
      return vec4(axis, disagree * surface, surface, 1.0);
    }`;
    const result = await drawProbe(page, [{ name: 'normals', needs: ['normal'], fragment }]);
    const pixels = pixelsOf(result);
    const surface = pixels.filter(([, , blue]) => blue > 128);
    assert.ok(surface.length > 5000, 'most of the image is surface');
    assert.equal(surface.filter(([red]) => red > 128).length, surface.length, 'every surface pixel has an axis aligned exact normal');
    const wrongFromDepth = surface.filter(([, green]) => green > 128).length;
    assert.ok(wrongFromDepth > 40, `the depth derived normal is wrong on ${wrongFromDepth} silhouette pixels the exact one has right`);
    assert.deepEqual(result.drawnPasses, ['normal']);
  });
});

test('albedoAt and emissionAt read the material, and a palette texture reads back by texel', async (context) => {
  await withDevServerPage(context, async (page) => {
    const fragment = `vec4 userPass(vec2 uv) {
      vec3 base = albedoAt(uv);
      vec3 glow = emissionAt(uv);
      vec3 swatch = texelFetch(palette, ivec2(1, 1), 0).rgb;
      if (glow.g > 0.1) return vec4(glow, 1.0);
      if (base.r > 0.8 && base.b < 0.2) return vec4(swatch, 1.0);
      return vec4(0.0, 0.0, 0.0, 1.0);
    }`;
    const luts = { palette: { colors: [['#000000', '#ffffff'], ['#101010', '#ff00ff']] } };
    const result = await drawProbe(page, [{ name: 'material', needs: ['albedo', 'emission'], luts, fragment }]);
    const pixels = pixelsOf(result);
    const swatchPixels = pixels.filter(([red, green, blue]) => red === 255 && green === 0 && blue === 255);
    const glowPixels = pixels.filter(([, green]) => green > 200);
    assert.ok(swatchPixels.length > 500, `orange blocks read the palette texel (${swatchPixels.length} pixels)`);
    assert.ok(glowPixels.length > 20 && glowPixels.length < 4000, `only the glowing box shows emission (${glowPixels.length} pixels)`);
    assert.deepEqual(result.drawnPasses, ['albedo', 'emission'], PASS_BUDGET_NOTE);
  });
});

test('every input and a palette bind together without displacing each other', async (context) => {
  await withDevServerPage(context, async (page) => {
    // The palette is made on the first frame; uploading it must not take over a unit the draw already set up.
    const fragment = `vec4 userPass(vec2 uv) {
      int id = objectIdAt(uv);
      float emitted = emissionAt(uv).g > 0.1 ? 1.0 : 0.0;
      float sky = length(normalAt(uv)) < 0.5 ? 1.0 : 0.0;
      float palette0 = texelFetch(palette, ivec2(0, 0), 0).r > 0.5 ? 1.0 : 0.0;
      return vec4(float(id) / 255.0, emitted, sky * 0.5 + palette0 * 0.25, 1.0);
    }`;
    const luts = { palette: { colors: ['#ff0000', '#000000'] } };
    const result = await drawProbe(page, [{ name: 'all', needs: ['normal', 'objectId', 'albedo', 'emission'], luts, fragment }]);
    const pixels = pixelsOf(result);
    const at = (column, row) => pixels[row * IMAGE_SIZE + column];
    for (const column of [5, 50, 140, 186]) {
      const [identifier, emitted, flags] = at(column, 185);
      assert.equal(Math.round(identifier), 1, `the slab at column ${column} is one part`);
      assert.equal(emitted, 0, `the slab at column ${column} does not glow`);
      assert.equal(flags, 64, 'a surface pixel (no sky flag) reads palette texel 0 (red)');
    }
    assert.equal(at(96, 5)[2] & 128, 128, 'the sky has a zero normal');
  });
});

test('a pass that does not opt in draws no render pass at all', async (context) => {
  await withDevServerPage(context, async (page) => {
    const result = await drawProbe(page, [{ name: 'plain', fragment: 'vec4 userPass(vec2 uv) { return vec4(texture(sceneColor, uv).rgb, 1.0); }' }]);
    assert.deepEqual(result.drawnPasses, []);
  });
});
