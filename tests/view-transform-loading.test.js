import test from 'node:test';
import assert from 'node:assert/strict';
import { viewTransformShader } from '../src/shaders.js';
import { loadViewTransformForRendererOptions, rendererOptionsNeedViewTransform } from '../src/view-transform-loading.js';

test('renderer options need the view transform code only for a non-aces curve or a look', () => {
  assert.equal(rendererOptionsNeedViewTransform(undefined), false);
  assert.equal(rendererOptionsNeedViewTransform({}), false);
  assert.equal(rendererOptionsNeedViewTransform({ viewTransform: 'aces' }), false);
  assert.equal(rendererOptionsNeedViewTransform({ viewTransform: 'agx' }), true);
  assert.equal(rendererOptionsNeedViewTransform({ look: 'AgX - High Contrast' }), true);
  assert.equal(rendererOptionsNeedViewTransform({ environment: { viewTransform: 'neutral' } }), true);
});

test('a scene file that asks for agx gets the view transform shader loaded before the renderer is built', async () => {
  await loadViewTransformForRendererOptions({ viewTransform: 'aces' });
  assert.equal(viewTransformShader.apply, undefined);
  await loadViewTransformForRendererOptions({ viewTransform: 'agx' });
  assert.equal(typeof viewTransformShader.apply, 'function');
});
