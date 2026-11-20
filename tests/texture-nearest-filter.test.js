import assert from 'node:assert/strict';
import test from 'node:test';
import { configureTexture } from '../src/renderer.js';
import { withDevServerPage } from './helpers/dev-server-browser.js';

const NEAREST = 9728;
const LINEAR = 9729;
const NEAREST_MIPMAP_NEAREST = 9984;
const LINEAR_MIPMAP_NEAREST = 9985;
const NEAREST_MIPMAP_LINEAR = 9986;
const LINEAR_MIPMAP_LINEAR = 9987;

function recordingRenderer() {
  const anisotropyTargets = [];
  const context = new Proxy({}, {
    get: (target, name) => (name === 'TEXTURE_2D' ? 3553 : () => {}),
  });
  return { renderer: { context, applyAnisotropy: target => anisotropyTargets.push(target) }, anisotropyTargets };
}

const CASES = [
  ['NEAREST magnification with NEAREST_MIPMAP_NEAREST (the placed GLB of #2260)', NEAREST_MIPMAP_NEAREST, NEAREST, false],
  ['NEAREST magnification with LINEAR_MIPMAP_LINEAR', LINEAR_MIPMAP_LINEAR, NEAREST, false],
  ['LINEAR magnification with NEAREST_MIPMAP_LINEAR', NEAREST_MIPMAP_LINEAR, LINEAR, false],
  ['LINEAR magnification with NEAREST_MIPMAP_NEAREST', NEAREST_MIPMAP_NEAREST, LINEAR, false],
  ['the default LINEAR_MIPMAP_LINEAR with LINEAR', LINEAR_MIPMAP_LINEAR, LINEAR, true],
  ['LINEAR_MIPMAP_NEAREST with LINEAR', LINEAR_MIPMAP_NEAREST, LINEAR, true],
];

for (const [name, minFilter, magFilter, expectAnisotropy] of CASES) {
  test(`anisotropic filtering ${expectAnisotropy ? 'is applied' : 'is skipped'} for ${name}`, () => {
    const { renderer, anisotropyTargets } = recordingRenderer();
    configureTexture(renderer, { wrapS: 10497, wrapT: 10497, minFilter, magFilter, mipmaps: true });
    assert.equal(anisotropyTargets.length, expectAnisotropy ? 1 : 0);
  });
}

test('a NEAREST checker stays hard-edged on a real context while a LINEAR one is filtered', async testContext => {
  await withDevServerPage(testContext, async page => {
    const result = await page.evaluate(async () => {
      const { CrucibleRenderer } = await import('/src/renderer.js');
      const { box } = await import('/src/geometry.js');
      const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      const material = { tag: 'surface', color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5, emission: 0 };
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      document.body.append(canvas);
      const renderer = new CrucibleRenderer(canvas, [{ name: 'box', geometry: box(0, 1), matrix: identity, material }], { samples: 1, pixelRatio: 1 });
      const context = renderer.context;
      const extension = context.getExtension('EXT_texture_filter_anisotropic');
      const checker = Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
      const painter = checker.getContext('2d');
      for (let index = 0; index < 16; index++) {
        painter.fillStyle = (index + Math.floor(index / 4)) % 2 ? '#fff' : '#000';
        painter.fillRect(index % 4, Math.floor(index / 4), 1, 1);
      }
      const anisotropyOf = map => {
        context.bindTexture(context.TEXTURE_2D, renderer.createTexture(map));
        return context.getTexParameter(context.TEXTURE_2D, extension.TEXTURE_MAX_ANISOTROPY_EXT);
      };
      return {
        hasExtension: Boolean(extension),
        nearest: anisotropyOf({ image: checker, minFilter: 9984, magFilter: 9728 }),
        linear: anisotropyOf({ image: checker, minFilter: 9987, magFilter: 9729 }),
      };
    });
    if (!result.hasExtension) return testContext.skip('this context has no anisotropic filtering');
    assert.equal(result.nearest, 1);
    assert.ok(result.linear > 1);
  });
});
